//! Meeting transcripts: a call transcribed live, both sides of it, then
//! written up as notes when it ends.
//!
//! A meeting captures up to two channels at once: the microphone ("You") and
//! what the computer plays ("Them"), each with its own `recorder::live`
//! capture and its own task. A phone can't hear another app's call, so on
//! Android there's one channel, the microphone, hearing everyone ("Room"),
//! recorded by the Kotlin service (`android::meeting_audio`).
//!
//! A task cuts its audio into turns at pauses
//! (`live::Segmenter`) and either streams each turn to OpenAI Realtime or
//! Sarvam over a WebSocket, committing it at the pause, or transcribes each
//! finished turn with the dictation engine. A stream that drops is
//! reconnected; one that can't be falls back to the dictation engine, so the
//! rest of the call still gets transcribed.
//!
//! The meeting is saved every few seconds while it runs, and once more when
//! it stops. Then the AI cleanup model writes the notes from the transcript
//! and whatever the user typed during the call.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::{self, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use voice_core::live::{self, Event, Segmenter, Turn};
use voice_core::meetings::{self, Meeting, Overview, Segment, Speaker, Store};
use voice_core::settings::{CallAudio, Engine, LiveEngine};
use voice_core::{cleanup, text as fixes, Settings};

use crate::error::{AppError, AppResult};
use crate::overlay::{self, OverlayState};
use crate::pipeline::join_err;
#[cfg(desktop)]
use crate::recorder::{self, Source};
#[cfg(desktop)]
use crate::sounds::{self, Cue};
use crate::state::{now_ms, AppState};
use crate::{pipeline, secrets};
#[cfg(desktop)]
use crate::{tray, whisper};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// One channel's audio, being captured.
#[cfg(desktop)]
type Capture = recorder::Live;
#[cfg(target_os = "android")]
type Capture = crate::android::MeetingAudio;
/// Where a channel's audio comes from: a phone has only its microphone.
#[cfg(target_os = "android")]
type Source = ();

/// A meeting is being transcribed. Read without locks by the overlay, tray and dictation.
static LIVE: AtomicBool = AtomicBool::new(false);

pub fn is_live() -> bool {
    LIVE.load(Ordering::SeqCst)
}

/// Audio is sent in 200 ms messages, not every 50 ms tick.
const SEND_SAMPLES: usize = voice_core::SAMPLE_RATE as usize / 5;
/// After the audio ends, how long to wait for the last turns' text.
const FINISH_WAIT: Duration = Duration::from_secs(8);
/// How long a transcription task may take to wind down when stopped.
const STOP_WAIT: Duration = Duration::from_secs(60);
const SAVE_EVERY: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Attempts to reconnect a dropped stream before falling back to the dictation engine.
const RECONNECTS: u64 = 3;

pub struct Meetings {
    store: Store,
    live: Mutex<Option<Live>>,
    /// The meeting being stopped: its last turns are still coming in.
    finishing: Mutex<Option<Arc<Mutex<Meeting>>>>,
    /// Starting and stopping happen one at a time, so a double press can't start two.
    switching: tokio::sync::Mutex<()>,
    /// Meetings whose notes are being written.
    summarizing: Mutex<Vec<u64>>,
    /// One write at a time to a meeting's file.
    writing: Mutex<()>,
}

struct Live {
    meeting: Arc<Mutex<Meeting>>,
    captures: Vec<Capture>,
    tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
    saver: tauri::async_runtime::JoinHandle<()>,
    info: LiveInfo,
}

/// The meeting being transcribed, as the UI shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveInfo {
    pub id: u64,
    pub started_at: u64,
    pub engine: String,
    /// Which channels are being captured.
    pub speakers: Vec<Speaker>,
}

/// Sent as `meeting-status` whenever a meeting starts or stops, or notes start or finish.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub live: Option<LiveInfo>,
    pub summarizing: Vec<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SegmentEvent<'a> {
    meeting_id: u64,
    segment: &'a Segment,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelEvent {
    speaker: Speaker,
    level: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoticeEvent {
    meeting_id: u64,
    text: String,
}

impl Meetings {
    pub fn new(dir: std::path::PathBuf) -> Meetings {
        Meetings {
            store: Store::new(dir),
            live: Mutex::new(None),
            finishing: Mutex::new(None),
            switching: tokio::sync::Mutex::new(()),
            summarizing: Mutex::new(Vec::new()),
            writing: Mutex::new(()),
        }
    }

    pub fn status(&self) -> Status {
        Status { live: self.live.lock().unwrap().as_ref().map(|l| l.info.clone()), summarizing: self.summarizing.lock().unwrap().clone() }
    }

    pub fn list(&self) -> Vec<Overview> {
        let mut list = self.store.list();
        // The file of the meeting in progress lags behind it.
        if let Some(m) = self.active_any() {
            let live = m.lock().unwrap().overview();
            match list.iter_mut().find(|o| o.id == live.id) {
                Some(o) => *o = live,
                None => list.insert(0, live),
            }
        }
        list
    }

    pub fn get(&self, id: u64) -> AppResult<Meeting> {
        match self.active(id) {
            Some(m) => Ok(m.lock().unwrap().clone()),
            None => self.store.get(id).ok_or_else(gone),
        }
    }

    pub fn delete(&self, id: u64) -> AppResult<()> {
        if self.active(id).is_some() {
            return Err(AppError::Invalid("Stop the meeting before deleting it.".into()));
        }
        let _writing = self.writing.lock().unwrap();
        Ok(self.store.delete(id)?)
    }

    /// The meeting in progress or being stopped, if it's `id`.
    fn active(&self, id: u64) -> Option<Arc<Mutex<Meeting>>> {
        self.active_any().filter(|m| m.lock().unwrap().id == id)
    }

    fn active_any(&self) -> Option<Arc<Mutex<Meeting>>> {
        let live = self.live.lock().unwrap().as_ref().map(|l| l.meeting.clone());
        live.or_else(|| self.finishing.lock().unwrap().clone())
    }

    /// Change meeting `id` and save it, whether it's in progress or on disk.
    pub fn update(&self, id: u64, f: impl FnOnce(&mut Meeting)) -> AppResult<Meeting> {
        let _writing = self.writing.lock().unwrap();
        let meeting = match self.active(id) {
            Some(m) => {
                let mut m = m.lock().unwrap();
                f(&mut m);
                m.clone()
            }
            None => {
                let mut m = self.store.get(id).ok_or_else(gone)?;
                f(&mut m);
                m
            }
        };
        self.store.save(&meeting)?;
        Ok(meeting)
    }

    fn save(&self, meeting: &Meeting) {
        let _writing = self.writing.lock().unwrap();
        if let Err(e) = self.store.save(meeting) {
            eprintln!("couldn't save the meeting: {e}");
        }
    }

    /// Yammer is quitting mid-meeting: save what there is, ended now.
    #[cfg_attr(not(desktop), allow(dead_code))]
    pub fn save_on_exit(&self) {
        if let Some(m) = self.active_any() {
            let mut snapshot = m.lock().unwrap().clone();
            snapshot.finish(now_ms());
            self.save(&snapshot);
        }
    }
}

fn gone() -> AppError {
    AppError::NotFound("That meeting is no longer saved.".into())
}

fn emit_status(app: &AppHandle) {
    let _ = app.emit("meeting-status", app.state::<Meetings>().status());
}

/// The hotkey, tray and overlay: start a meeting, or stop the one in progress.
/// Errors go to the overlay, as there's no window to show them in.
pub fn toggle(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = if is_live() { stop(&app).await.map(drop) } else { start(&app).await.map(drop) };
        if let Err(e) = result {
            #[cfg(desktop)]
            if app.state::<AppState>().settings().sounds {
                sounds::play(Cue::Error);
            }
            overlay::flash(&app, OverlayState::Message { text: e.to_string(), error: true }, 6000);
        }
    });
}

pub async fn start(app: &AppHandle) -> AppResult<LiveInfo> {
    let me = app.state::<Meetings>();
    let _switching = me.switching.lock().await;
    if let Some(live) = me.live.lock().unwrap().as_ref() {
        return Ok(live.info.clone());
    }
    let settings = app.state::<AppState>().settings();
    check_engine(app, &settings)?;

    let id = now_ms();
    let meeting = Arc::new(Mutex::new(Meeting::new(id, settings.meeting_engine_label())));
    let (mut captures, mut tasks, mut speakers) = (Vec::new(), Vec::new(), Vec::new());
    let mut notice = None;
    for (source, speaker) in channels(&settings) {
        // Connected before recording, so a refused key stops the meeting before it starts.
        let ws = connect(&settings).await?;
        let (tx, rx) = unbounded_channel::<Vec<f32>>();
        let (open_app, level_app) = (app.clone(), app.clone());
        let opened = tauri::async_runtime::spawn_blocking(move || {
            open(
                &open_app,
                source,
                move |audio| drop(tx.send(audio)),
                move |level| drop(level_app.emit("meeting-level", LevelEvent { speaker, level })),
            )
        })
        .await
        .map_err(join_err)?;
        match opened {
            Ok(capture) => {
                captures.push(capture);
                speakers.push(speaker);
                tasks.push(tauri::async_runtime::spawn(transcribe(app.clone(), meeting.clone(), speaker, settings.clone(), ws, rx)));
            }
            // The other side of the call can't be heard: carry on with the microphone.
            Err(e) if speaker == Speaker::Them && settings.meeting.audio == CallAudio::Both => {
                notice = Some(format!("Only your microphone is being transcribed. {e}"));
            }
            Err(e) => return Err(e),
        }
    }
    if let Some(text) = &notice {
        meeting.lock().unwrap().notice = Some(text.clone());
    }
    me.save(&meeting.lock().unwrap());

    let saver = {
        let (app, meeting) = (app.clone(), meeting.clone());
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(SAVE_EVERY).await;
                let snapshot = meeting.lock().unwrap().clone();
                app.state::<Meetings>().save(&snapshot);
            }
        })
    };
    let info = LiveInfo { id, started_at: id, engine: settings.meeting_engine_label(), speakers };
    *me.live.lock().unwrap() = Some(Live { meeting, captures, tasks, saver, info: info.clone() });
    LIVE.store(true, Ordering::SeqCst);

    #[cfg(desktop)]
    if settings.sounds {
        sounds::play(Cue::Start);
    }
    overlay::set_meeting(app, Some(id));
    if let Some(text) = notice {
        overlay::flash(app, OverlayState::Message { text, error: true }, 6000);
    }
    #[cfg(desktop)]
    tray::refresh(app);
    emit_status(app);
    Ok(info)
}

/// Stop the meeting in progress, wait for its last words, and save it. Its
/// notes are then written in the background, if that's turned on.
pub async fn stop(app: &AppHandle) -> AppResult<Option<Meeting>> {
    let me = app.state::<Meetings>();
    let _switching = me.switching.lock().await;
    let Some(live) = me.live.lock().unwrap().take() else { return Ok(None) };
    let Live { meeting, captures, tasks, saver, info } = live;
    *me.finishing.lock().unwrap() = Some(meeting.clone());
    LIVE.store(false, Ordering::SeqCst);
    saver.abort();

    let settings = app.state::<AppState>().settings();
    #[cfg(desktop)]
    if settings.sounds {
        sounds::play(Cue::Stop);
    }
    overlay::set_meeting(app, None);
    overlay::show(app, OverlayState::Transcribing { engine: info.engine.clone() });
    #[cfg(desktop)]
    tray::refresh(app);
    emit_status(app);

    // Stopping the captures closes their channels, which ends each task once it has caught up.
    tauri::async_runtime::spawn_blocking(move || captures.into_iter().for_each(Capture::stop)).await.map_err(join_err)?;
    for mut task in tasks {
        if tokio::time::timeout(STOP_WAIT, &mut task).await.is_err() {
            task.abort();
        }
    }

    let finished = {
        let mut m = meeting.lock().unwrap();
        m.finish(now_ms());
        m.clone()
    };
    me.save(&finished);
    *me.finishing.lock().unwrap() = None;
    let _ = app.emit("meeting-updated", &finished);

    let has_content = finished.words() > 0 || !finished.notes.trim().is_empty();
    if settings.meeting.auto_summary && has_content {
        overlay::show(app, OverlayState::Polishing { model: settings.cleanup.label() });
        let (app, id) = (app.clone(), finished.id);
        tauri::async_runtime::spawn(async move {
            let done = summarize(&app, id).await;
            let (text, error) = match &done {
                Ok(m) if m.error.is_none() => ("Meeting notes are ready".to_string(), false),
                Ok(m) => (m.error.clone().unwrap_or_default(), true),
                Err(e) => (e.to_string(), true),
            };
            overlay::flash(&app, OverlayState::Message { text, error }, 4000);
        });
    } else {
        let text = if has_content { "Meeting saved" } else { "Nothing was said, so there's no transcript" };
        overlay::flash(app, OverlayState::Message { text: text.into(), error: false }, 3000);
    }
    Ok(Some(finished))
}

/// Write meeting `id`'s notes from its transcript and the user's own notes,
/// replacing any it had. A failure is saved on the meeting (`error`) as well as returned.
pub async fn summarize(app: &AppHandle, id: u64) -> AppResult<Meeting> {
    let me = app.state::<Meetings>();
    if me.active(id).is_some() {
        return Err(AppError::Invalid("The notes are written once the meeting is stopped.".into()));
    }
    let meeting = me.store.get(id).ok_or_else(gone)?;
    {
        let mut busy = me.summarizing.lock().unwrap();
        if busy.contains(&id) {
            return Err(AppError::Invalid("The notes for this meeting are already being written.".into()));
        }
        busy.push(id);
    }
    emit_status(app);
    let written = write_notes(app, &meeting).await;
    me.summarizing.lock().unwrap().retain(|&m| m != id);
    emit_status(app);

    // Applied to the meeting as it is now, so notes typed meanwhile aren't lost.
    let saved = me.update(id, |m| match &written {
        Ok((title, notes, by)) => {
            if let Some(title) = title.as_ref().filter(|_| m.title.trim().is_empty()) {
                m.title = title.clone();
            }
            m.summary = Some(notes.clone());
            m.summary_by = Some(by.clone());
            m.error = None;
        }
        Err(e) => m.error = Some(format!("Couldn't write the notes: {e}")),
    })?;
    let _ = app.emit("meeting-updated", &saved);
    written.map(|_| saved)
}

/// (title, notes, model label).
async fn write_notes(app: &AppHandle, meeting: &Meeting) -> AppResult<(Option<String>, String, String)> {
    let state = app.state::<AppState>();
    let settings = state.settings();
    let transcript = meeting.transcript();
    if transcript.is_empty() && meeting.notes.trim().is_empty() {
        return Err(AppError::Invalid("Nothing was transcribed, so there's nothing to write notes from.".into()));
    }
    let key = secrets::cleanup(&settings)?;
    let format = cleanup::summary_format(settings.meeting.summary, &settings.meeting.summary_instructions);
    let out = cleanup::summarize(&settings.cleanup, key.as_deref(), &state.http, &settings.vocabulary, &format, &meeting.notes, &transcript).await?;
    if out.trim().is_empty() {
        return Err(AppError::Invalid("The model sent back no notes.".into()));
    }
    let (title, notes) = meetings::split_title(&out);
    Ok((title, notes, settings.cleanup.label()))
}

/// What to capture, and who it is in the transcript.
#[cfg(desktop)]
fn channels(settings: &Settings) -> Vec<(Source, Speaker)> {
    let mic = (Source::Mic(settings.mic_device.clone()), Speaker::You);
    let system = (Source::System, Speaker::Them);
    match settings.meeting.audio {
        CallAudio::Both => vec![mic, system],
        CallAudio::Mic => vec![mic],
        CallAudio::System => vec![system],
    }
}

/// Android doesn't let an app hear another's call, so a phone listens to the room.
#[cfg(target_os = "android")]
fn channels(_: &Settings) -> Vec<(Source, Speaker)> {
    vec![((), Speaker::Room)]
}

/// Start capturing a channel. Blocks until it's listening, so call it off the async runtime.
#[cfg(desktop)]
fn open(_: &AppHandle, source: Source, on_audio: impl Fn(Vec<f32>) + Send + 'static, on_level: impl Fn(f32) + Send + 'static) -> AppResult<Capture> {
    recorder::live(source, on_audio, on_level)
}

#[cfg(target_os = "android")]
fn open(app: &AppHandle, _: Source, on_audio: impl Fn(Vec<f32>) + Send + 'static, on_level: impl Fn(f32) + Send + 'static) -> AppResult<Capture> {
    crate::android::meeting_audio(app, on_audio, on_level)
}

/// Refuse to start a meeting that couldn't be transcribed.
fn check_engine(#[cfg_attr(not(desktop), allow(unused_variables))] app: &AppHandle, settings: &Settings) -> AppResult<()> {
    match settings.meeting.engine {
        LiveEngine::Dictation => match settings.engine {
            #[cfg(desktop)]
            Engine::Local if !whisper::is_downloaded(&app.state::<AppState>().models_dir, &settings.local_model) => {
                Err(AppError::Invalid("Download a speech model in Settings → Speech engine, or pick a streaming engine for meetings.".into()))
            }
            Engine::Cloud if settings.cloud.base_url.trim().is_empty() || settings.cloud.model.trim().is_empty() => {
                Err(AppError::Invalid("Choose a speech provider and model in Settings → Speech engine.".into()))
            }
            _ => Ok(()),
        },
        // `connect` checks the key and the model.
        LiveEngine::OpenaiRealtime | LiveEngine::SarvamStreaming => Ok(()),
    }
}

fn provider_name(engine: LiveEngine) -> &'static str {
    match engine {
        LiveEngine::OpenaiRealtime => "OpenAI",
        LiveEngine::SarvamStreaming => "Sarvam",
        LiveEngine::Dictation => "the speech service",
    }
}

/// The streaming engine's key: the one saved for its provider, from whichever page.
fn live_key(settings: &Settings) -> AppResult<String> {
    secrets::live(settings)?
        .ok_or_else(|| AppError::Invalid(format!("Add your {} API key in Settings → Meetings.", provider_name(settings.meeting.engine))))
}

fn language(settings: &Settings) -> Option<String> {
    match settings.language.trim() {
        "" | "auto" => None,
        code => Some(code.to_string()),
    }
}

/// Open the streaming engine's WebSocket, or `None` for the dictation engine.
async fn connect(settings: &Settings) -> AppResult<Option<Ws>> {
    let engine = settings.meeting.engine;
    let name = provider_name(engine);
    let lang = language(settings);
    let model = settings.meeting.model();
    let (url, header, value, session) = match engine {
        LiveEngine::Dictation => return Ok(None),
        LiveEngine::OpenaiRealtime => (
            live::OPENAI_URL.to_string(),
            "Authorization",
            format!("Bearer {}", live_key(settings)?),
            Some(live::openai_session(model, lang.as_deref(), &settings.vocabulary)),
        ),
        LiveEngine::SarvamStreaming => (live::sarvam_url(model, lang.as_deref()), "Api-Subscription-Key", live_key(settings)?, None),
    };
    let mut request = url.into_client_request().map_err(AppError::invalid)?;
    let value = HeaderValue::from_str(&value).map_err(|_| AppError::Invalid(format!("The {name} API key has characters that can't be sent.")))?;
    request.headers_mut().insert(header, value);

    let connecting = tokio_tungstenite::connect_async(request);
    let (mut ws, _) = tokio::time::timeout(CONNECT_TIMEOUT, connecting)
        .await
        .map_err(|_| AppError::Invalid(format!("{name} didn't answer. Check your connection.")))?
        .map_err(|e| ws_error(name, e))?;
    if let Some(session) = session {
        ws.send(Message::text(session.to_string())).await.map_err(|e| ws_error(name, e))?;
        // A key without Realtime access or an unknown model is refused straight away.
        let answer = tokio::time::timeout(Duration::from_secs(5), async {
            while let Some(msg) = ws.next().await {
                let Ok(Message::Text(text)) = msg else { continue };
                let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                match v.get("type").and_then(Value::as_str) {
                    Some("session.updated" | "transcription_session.updated") => return Ok(()),
                    Some("error") => {
                        if let Event::Error(e) = live::parse_openai(&v) {
                            return Err(AppError::Invalid(format!("OpenAI: {e}")));
                        }
                    }
                    _ => {}
                }
            }
            Err(AppError::Invalid("OpenAI closed the connection.".into()))
        })
        .await;
        // No answer in time: carry on, and let the first transcript tell.
        if let Ok(Err(e)) = answer {
            return Err(e);
        }
    }
    Ok(Some(ws))
}

fn ws_error(name: &str, e: tungstenite::Error) -> AppError {
    match e {
        tungstenite::Error::Http(resp) => match resp.status().as_u16() {
            401 | 403 => AppError::Invalid(format!("{name} rejected the API key. Update it in Settings → Meetings.")),
            status => {
                let body = resp.body().as_deref().map(String::from_utf8_lossy).unwrap_or_default();
                let body: String = body.chars().take(200).collect();
                AppError::Invalid(format!("{name} refused the connection (HTTP {status}). {body}").trim().to_string())
            }
        },
        e => AppError::Invalid(format!("Couldn't reach {name}: {e}")),
    }
}

/// Add or replace a segment and tell the UI.
fn put(app: &AppHandle, meeting: &Mutex<Meeting>, segment: Segment) {
    let id = {
        let mut m = meeting.lock().unwrap();
        m.upsert(segment.clone());
        m.id
    };
    let _ = app.emit("meeting-segment", SegmentEvent { meeting_id: id, segment: &segment });
}

/// Something went wrong while transcribing: keep the first such notice, and tell the UI.
fn notice(app: &AppHandle, meeting: &Mutex<Meeting>, text: String) {
    eprintln!("meeting: {text}");
    let id = {
        let mut m = meeting.lock().unwrap();
        m.notice.get_or_insert_with(|| text.clone());
        m.id
    };
    let _ = app.emit("meeting-notice", NoticeEvent { meeting_id: id, text });
}

fn prefix(speaker: Speaker) -> &'static str {
    match speaker {
        Speaker::You => "you",
        Speaker::Them => "them",
        Speaker::Room => "room",
    }
}

/// One channel's task: stream it if there's a socket, else (or once streaming fails for good) transcribe it piece by piece.
async fn transcribe(
    app: AppHandle,
    meeting: Arc<Mutex<Meeting>>,
    speaker: Speaker,
    settings: Settings,
    ws: Option<Ws>,
    mut rx: UnboundedReceiver<Vec<f32>>,
) {
    let mut seg = Segmenter::new();
    if let Some(ws) = ws {
        let mut stream = Stream::new(&app, &meeting, speaker, &settings, ws);
        match stream.run(&mut rx, &mut seg).await {
            Ok(()) => return,
            Err(e) => {
                let fallback = settings.engine_label();
                notice(&app, &meeting, format!("{e} The rest is being transcribed with {fallback}."));
                // The turn in progress was half sent; start afresh.
                seg.flush();
            }
        }
    }
    pieces(&app, &meeting, speaker, &settings, &mut rx, &mut seg).await;
}

/// Transcribe each turn once it ends, with the dictation engine.
async fn pieces(
    app: &AppHandle,
    meeting: &Mutex<Meeting>,
    speaker: Speaker,
    settings: &Settings,
    rx: &mut UnboundedReceiver<Vec<f32>>,
    seg: &mut Segmenter,
) {
    let (mut turn, mut at, mut n) = (Vec::<f32>::new(), 0, 0);
    let mut failed = false;
    loop {
        let chunk = rx.recv().await;
        let ended = chunk.is_none();
        let turns = match chunk {
            Some(audio) => seg.push(&audio),
            None => seg.flush(),
        };
        for t in turns {
            match t {
                Turn::Begin { at_ms } => {
                    at = at_ms;
                    turn.clear();
                }
                Turn::Audio(audio) => turn.extend(audio),
                Turn::End => {
                    n += 1;
                    let id = format!("{}-piece-{n}", prefix(speaker));
                    // An empty partial shows that something's being transcribed.
                    put(app, meeting, Segment { id: id.clone(), at_ms: at, speaker, text: String::new(), partial: true });
                    let text = match pipeline::transcribe(app, settings, std::mem::take(&mut turn).into()).await {
                        Ok((text, ..)) => fixes::apply(text.trim(), &settings.replacements, &[]),
                        Err(e) => {
                            if !failed {
                                failed = true;
                                notice(app, meeting, format!("Couldn't transcribe part of the meeting: {e}"));
                            }
                            String::new()
                        }
                    };
                    put(app, meeting, Segment { id, at_ms: at, speaker, text, partial: false });
                }
            }
        }
        if ended {
            return;
        }
    }
}

/// One channel streamed to OpenAI Realtime or Sarvam.
struct Stream<'a> {
    app: &'a AppHandle,
    meeting: &'a Mutex<Meeting>,
    speaker: Speaker,
    settings: &'a Settings,
    ws: Ws,
    /// Audio waiting to be sent, until there's 200 ms of it.
    out: Vec<f32>,
    /// When each turn not yet matched to a transcript began, and whether it has ended.
    turns: VecDeque<(u64, bool)>,
    last_at: u64,
    /// Each transcript item: when it was said, and its text so far.
    items: HashMap<String, (u64, String)>,
    /// Turns ended but not yet transcribed.
    awaiting: usize,
    /// Sarvam's messages, numbered.
    seq: u64,
}

impl<'a> Stream<'a> {
    fn new(app: &'a AppHandle, meeting: &'a Mutex<Meeting>, speaker: Speaker, settings: &'a Settings, ws: Ws) -> Stream<'a> {
        Stream {
            app,
            meeting,
            speaker,
            settings,
            ws,
            out: Vec::new(),
            turns: VecDeque::new(),
            last_at: 0,
            items: HashMap::new(),
            awaiting: 0,
            seq: 0,
        }
    }

    fn engine(&self) -> LiveEngine {
        self.settings.meeting.engine
    }

    /// Until the audio ends and the last turn's text is in. An error means the stream is lost for good.
    async fn run(&mut self, rx: &mut UnboundedReceiver<Vec<f32>>, seg: &mut Segmenter) -> AppResult<()> {
        let mut done = false;
        let deadline = tokio::time::sleep(Duration::from_secs(u32::MAX as u64));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                chunk = rx.recv(), if !done => {
                    let turns = match chunk {
                        Some(audio) => seg.push(&audio),
                        None => {
                            done = true;
                            deadline.as_mut().reset(tokio::time::Instant::now() + FINISH_WAIT);
                            seg.flush()
                        }
                    };
                    for turn in turns {
                        self.turn(turn).await?;
                    }
                    if done && self.awaiting == 0 {
                        break;
                    }
                }
                msg = self.ws.next() => match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(v) = serde_json::from_str::<Value>(&text) {
                            self.event(&v);
                        }
                        if done && self.awaiting == 0 {
                            break;
                        }
                    }
                    Some(Ok(_)) => {}
                    // Dropped (or the session ran out of time): what was in flight is lost, the rest carries on.
                    Some(Err(_)) | None => {
                        if done {
                            break;
                        }
                        self.reconnect().await?;
                    }
                },
                _ = &mut deadline, if done => break,
            }
        }
        let _ = self.ws.close(None).await;
        Ok(())
    }

    async fn turn(&mut self, turn: Turn) -> AppResult<()> {
        match turn {
            Turn::Begin { at_ms } => {
                self.turns.push_back((at_ms, false));
                self.last_at = at_ms;
            }
            Turn::Audio(audio) => {
                self.out.extend(audio);
                if self.out.len() >= SEND_SAMPLES {
                    self.send_audio().await?;
                }
            }
            Turn::End => {
                self.send_audio().await?;
                let end = match self.engine() {
                    LiveEngine::SarvamStreaming => live::sarvam_flush(),
                    _ => live::openai_commit(),
                };
                self.send(end).await?;
                if let Some(t) = self.turns.iter_mut().rev().find(|t| !t.1) {
                    t.1 = true;
                }
                self.awaiting += 1;
            }
        }
        Ok(())
    }

    async fn send_audio(&mut self) -> AppResult<()> {
        if self.out.is_empty() {
            return Ok(());
        }
        let audio = std::mem::take(&mut self.out);
        let msg = match self.engine() {
            LiveEngine::SarvamStreaming => live::sarvam_audio(&audio),
            _ => live::openai_append(&audio),
        };
        self.send(msg).await
    }

    /// Send, reconnecting once if the connection has dropped.
    async fn send(&mut self, msg: Value) -> AppResult<()> {
        if self.ws.send(Message::text(msg.to_string())).await.is_ok() {
            return Ok(());
        }
        self.reconnect().await?;
        self.ws.send(Message::text(msg.to_string())).await.map_err(|e| ws_error(provider_name(self.engine()), e))
    }

    async fn reconnect(&mut self) -> AppResult<()> {
        let name = provider_name(self.engine());
        let mut last = None;
        for attempt in 0..RECONNECTS {
            tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
            match connect(self.settings).await {
                Ok(Some(ws)) => {
                    self.ws = ws;
                    // Whatever was in flight on the old connection won't be answered.
                    self.awaiting = 0;
                    self.turns.retain(|t| !t.1);
                    return Ok(());
                }
                Ok(None) => break,
                Err(e) => last = Some(e),
            }
        }
        Err(last.unwrap_or_else(|| AppError::Invalid(format!("Lost the connection to {name}."))))
    }

    /// When item `id` was said, assigned the first time it's seen, and its text so far.
    fn item(&mut self, id: &str) -> &mut (u64, String) {
        if !self.items.contains_key(id) {
            let at = match self.engine() {
                // One item per committed turn, in order.
                LiveEngine::OpenaiRealtime => self.turns.pop_front().map(|t| t.0),
                // Sarvam may answer a turn in more than one piece.
                _ => match self.turns.front().copied() {
                    Some((at, true)) => {
                        self.turns.pop_front();
                        Some(at)
                    }
                    Some((at, false)) => Some(at),
                    None => None,
                },
            };
            self.items.insert(id.to_string(), (at.unwrap_or(self.last_at), String::new()));
        }
        self.items.get_mut(id).unwrap()
    }

    fn event(&mut self, v: &Value) {
        let event = match self.engine() {
            LiveEngine::SarvamStreaming => {
                self.seq += 1;
                live::parse_sarvam(v, self.seq)
            }
            _ => live::parse_openai(v),
        };
        match event {
            Event::Delta { id, text } => {
                let (at, so_far) = self.item(&id);
                so_far.push_str(&text);
                let (at, text) = (*at, so_far.clone());
                self.put(&id, at, text, true);
            }
            Event::Final { id, text } => {
                self.awaiting = self.awaiting.saturating_sub(1);
                let text = fixes::apply(text.trim(), &self.settings.replacements, &[]);
                // Sarvam answers a flush of silence with an empty transcript.
                if text.is_empty() && !self.items.contains_key(&id) {
                    return;
                }
                let at = self.item(&id).0;
                self.put(&id, at, text, false);
            }
            Event::Failed { id, error } => {
                self.awaiting = self.awaiting.saturating_sub(1);
                eprintln!("meeting: a turn failed to transcribe: {error}");
                if self.items.contains_key(&id) {
                    let at = self.item(&id).0;
                    self.put(&id, at, String::new(), false);
                }
            }
            Event::Error(e) => notice(self.app, self.meeting, format!("{}: {e}", provider_name(self.engine()))),
            Event::Other => {}
        }
    }

    fn put(&self, id: &str, at_ms: u64, text: String, partial: bool) {
        let segment = Segment { id: format!("{}-{id}", prefix(self.speaker)), at_ms, speaker: self.speaker, text, partial };
        put(self.app, self.meeting, segment);
    }
}
