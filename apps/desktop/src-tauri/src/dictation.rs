//! The dictation state machine. Hotkey, tray and CLI events all land on one
//! channel and are handled in order by a single task, so there are no races
//! between a press, a release, Esc, and a pipeline finishing.
//!
//! Hold vs. tap: recording starts on press. Released within `TAP` it latches
//! (toggle mode: the next press stops it); held longer, the release stops it.
//!
//! A dictation is pasted as said (with the active transform), restyled by a
//! transform's own hotkey, or, with the edit hotkey, used as an instruction
//! for rewriting the selected text. Each one's audio is kept with its history
//! entry (`Settings::keep_recordings`), so a failed one can be retried.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::Modifiers;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use voice_core::history::Entry;
use voice_core::settings::{Engine, Transform};
use voice_core::{audio, cleanup, models, text as fixes, transcribe, Settings};

use crate::error::{AppError, AppResult};
use crate::overlay::{self, OverlayState};
use crate::paste::{self, Outcome};
use crate::recorder::{self, Recording};
use crate::sounds::{self, Cue};
use crate::state::AppState;
use crate::whisper::{self, Whisper};
use crate::{focus, hotkey, mute, secrets};

const TAP: Duration = Duration::from_millis(300);
const MIN_SPEECH_SAMPLES: usize = voice_core::SAMPLE_RATE as usize * 3 / 10;
const MAX_DURATION: Duration = Duration::from_secs(600);
/// Long enough for the start cue to play before the sound output is muted.
const CUE_MS: u64 = 350;

/// What a hotkey's recording is for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    /// Paste what's said, with the active transform.
    Dictate,
    /// Paste what's said, restyled by the transform with this id (its own hotkey).
    Transform(String),
    /// Rewrite the selected text as what's said asks.
    Edit,
}

#[derive(Debug)]
pub enum Input {
    /// A hotkey went down / up.
    Down(Mode),
    Up(Mode),
    /// Start or stop without hold semantics (tray menu, `--toggle`).
    Toggle(Mode),
    /// Esc while recording: discard.
    Cancel,
    /// The recording with this session id hit the length cap.
    Cap(u64),
    /// An edit's copy of the selection came back empty, or failed with `error`.
    NoSelection {
        session: u64,
        error: Option<String>,
    },
    /// Transcribe a kept recording again and paste it (the overlay's Retry).
    Retry(u64),
    /// The pipeline finished; ready for the next dictation.
    Finished,
}

pub struct Dictation {
    tx: UnboundedSender<Input>,
}

impl Dictation {
    pub fn send(&self, input: Input) {
        let _ = self.tx.send(input);
    }
}

/// The selected text an edit rewrites, being copied while recording starts.
type Selection = tauri::async_runtime::JoinHandle<AppResult<Option<String>>>;

enum Phase {
    Idle,
    Recording { rec: Recording, pressed_at: Instant, latched: bool, session: u64, mode: Mode, selection: Option<Selection> },
    Busy,
}

struct Controller {
    app: AppHandle,
    tx: UnboundedSender<Input>,
    phase: Phase,
    /// The hotkey being held, to skip its auto-repeats.
    key_down: Option<Mode>,
    session: u64,
}

pub fn spawn(app: AppHandle) -> Dictation {
    let (tx, mut rx) = unbounded_channel();
    let mut ctl = Controller { app, tx: tx.clone(), phase: Phase::Idle, key_down: None, session: 0 };
    tauri::async_runtime::spawn(async move {
        while let Some(input) = rx.recv().await {
            ctl.handle(input);
        }
    });
    Dictation { tx }
}

impl Controller {
    fn handle(&mut self, input: Input) {
        match input {
            Input::Down(mode) => {
                // Held keys auto-repeat on some platforms.
                if self.key_down.replace(mode.clone()).as_ref() == Some(&mode) {
                    return;
                }
                match self.phase {
                    Phase::Idle => self.start(mode, false),
                    // Any hotkey finishes a latched recording.
                    Phase::Recording { latched: true, .. } => self.finish(),
                    _ => {}
                }
            }
            Input::Up(mode) => {
                if self.key_down.as_ref() == Some(&mode) {
                    self.key_down = None;
                }
                if let Phase::Recording { pressed_at, latched: latched @ false, mode: recording, .. } = &mut self.phase {
                    if *recording != mode {
                        return;
                    }
                    if pressed_at.elapsed() < TAP {
                        *latched = true;
                        overlay::show(&self.app, OverlayState::Listening { hint: Some(self.stop_hint(&mode)) });
                    } else {
                        self.finish();
                    }
                }
            }
            Input::Toggle(mode) => match self.phase {
                Phase::Idle => self.start(mode, true),
                Phase::Recording { .. } => self.finish(),
                Phase::Busy => {}
            },
            Input::Cancel => {
                if self.discard() {
                    overlay::flash(&self.app, OverlayState::Message { text: "Cancelled".into(), error: false }, 900);
                }
            }
            Input::Cap(session) => {
                if matches!(self.phase, Phase::Recording { session: s, .. } if s == session) {
                    self.finish();
                }
            }
            Input::NoSelection { session, error } => {
                if matches!(self.phase, Phase::Recording { session: s, .. } if s == session) && self.discard() {
                    let settings = self.app.state::<AppState>().settings();
                    let text = error
                        .clone()
                        .unwrap_or_else(|| format!("Select some text first, then press {}", hotkey::display(&settings.edit_hotkey)));
                    if settings.sounds {
                        sounds::play(Cue::Error);
                    }
                    overlay::flash(&self.app, OverlayState::Message { text, error: error.is_some() }, 3500);
                }
            }
            Input::Retry(id) => {
                if !matches!(self.phase, Phase::Idle) {
                    return;
                }
                self.phase = Phase::Busy;
                overlay::show(&self.app, OverlayState::Transcribing { engine: self.app.state::<AppState>().settings().engine_label() });
                let (app, tx) = (self.app.clone(), self.tx.clone());
                tauri::async_runtime::spawn(async move {
                    show_done(&app, retry_and_paste(&app, id).await);
                    let _ = tx.send(Input::Finished);
                });
            }
            Input::Finished => self.phase = Phase::Idle,
        }
    }

    /// Stop recording and throw it away. False if nothing was recording.
    fn discard(&mut self) -> bool {
        if !matches!(self.phase, Phase::Recording { .. }) {
            return false;
        }
        if let Phase::Recording { rec, .. } = std::mem::replace(&mut self.phase, Phase::Idle) {
            std::thread::spawn(move || drop(rec.stop()));
        }
        hotkey::set_escape(&self.app, false);
        mute::restore(|| {});
        true
    }

    fn stop_hint(&self, mode: &Mode) -> String {
        let settings = self.app.state::<AppState>().settings();
        let key = match mode {
            Mode::Dictate => settings.hotkey.clone(),
            Mode::Edit => settings.edit_hotkey.clone(),
            Mode::Transform(id) => settings.transforms.iter().find(|t| &t.id == id).map_or(settings.hotkey.clone(), |t| t.hotkey.clone()),
        };
        format!("Press {} to finish", hotkey::display(&key))
    }

    fn start(&mut self, mode: Mode, latched: bool) {
        let settings = self.app.state::<AppState>().settings();
        let app = self.app.clone();
        let rec = match recorder::start(settings.mic_device.clone(), move |level| overlay::level(&app, level)) {
            Ok(rec) => rec,
            Err(e) => {
                if settings.sounds {
                    sounds::play(Cue::Error);
                }
                overlay::flash(&self.app, OverlayState::Message { text: e.to_string(), error: true }, 4000);
                return;
            }
        };
        if settings.sounds {
            sounds::play(Cue::Start);
        }
        if settings.mute_audio {
            mute::mute_after(Duration::from_millis(if settings.sounds { CUE_MS } else { 0 }));
        }
        self.session += 1;
        let session = self.session;
        let selection = (mode == Mode::Edit).then(|| self.copy_selection(session, &settings));
        let hint = latched.then(|| self.stop_hint(&mode));
        self.phase = Phase::Recording { rec, pressed_at: Instant::now(), latched, session, mode, selection };
        overlay::show(&self.app, OverlayState::Listening { hint });
        hotkey::set_escape(&self.app, true);
        focus::prime();

        let tx = self.tx.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(MAX_DURATION).await;
            let _ = tx.send(Input::Cap(session));
        });
    }

    /// Copy the selection an edit will rewrite, while the user speaks. With
    /// nothing selected, the recording is stopped straight away.
    fn copy_selection(&self, session: u64, settings: &Settings) -> Selection {
        let held = hotkey::parse(&settings.edit_hotkey).map_or(Modifiers::empty(), |s| s.mods);
        let (app, tx) = (self.app.clone(), self.tx.clone());
        tauri::async_runtime::spawn(async move {
            let result = tauri::async_runtime::spawn_blocking(move || paste::copy_selection(&app, held)).await.map_err(join_err).and_then(|r| r);
            match &result {
                Ok(Some(_)) => {}
                Ok(None) => drop(tx.send(Input::NoSelection { session, error: None })),
                Err(e) => drop(tx.send(Input::NoSelection { session, error: Some(e.to_string()) })),
            }
            result
        })
    }

    fn finish(&mut self) {
        let Phase::Recording { rec, mode, selection, .. } = std::mem::replace(&mut self.phase, Phase::Busy) else { return };
        hotkey::set_escape(&self.app, false);
        let settings = self.app.state::<AppState>().settings();
        // Unmute first, or the stop cue would be lost.
        let sounds = settings.sounds;
        mute::restore(move || {
            if sounds {
                sounds::play(Cue::Stop);
            }
        });
        overlay::show(&self.app, OverlayState::Transcribing { engine: settings.engine_label() });

        let app = self.app.clone();
        let tx = self.tx.clone();
        tauri::async_runtime::spawn(async move {
            show_done(&app, pipeline(&app, rec, mode, selection).await);
            let _ = tx.send(Input::Finished);
        });
    }
}

/// Tell the user how a dictation ended.
fn show_done(app: &AppHandle, done: AppResult<Done>) {
    let error_cue = || {
        if app.state::<AppState>().settings().sounds {
            sounds::play(Cue::Error);
        }
    };
    match done {
        Ok(Done::Pasted { warning: None, words }) if words.is_empty() => overlay::hide(app),
        Ok(Done::Pasted { warning: None, words }) => overlay::show(app, OverlayState::Words { words }),
        Ok(Done::Pasted { warning: Some(w), .. }) => overlay::flash(app, OverlayState::Message { text: w, error: false }, 3500),
        Ok(Done::Copied) => {
            let keys = if cfg!(target_os = "macos") { "⌘V" } else { "Ctrl+V" };
            overlay::flash(app, OverlayState::Message { text: format!("Copied. Press {keys} to paste."), error: false }, 3500);
        }
        Ok(Done::NoTextField { text, words }) => overlay::show(app, OverlayState::Transcript { text, words }),
        Ok(Done::NothingHeard) => overlay::flash(app, OverlayState::Message { text: "Didn't catch that".into(), error: false }, 1500),
        Ok(Done::Failed { error, retry: Some(id) }) => {
            error_cue();
            overlay::show(app, OverlayState::Failed { text: error, id });
        }
        Ok(Done::Failed { error, retry: None }) => {
            error_cue();
            overlay::flash(app, OverlayState::Message { text: error, error: true }, 5000);
        }
        Err(e) => {
            error_cue();
            overlay::flash(app, OverlayState::Message { text: e.to_string(), error: true }, 5000);
        }
    }
}

/// "Anthropic · claude-haiku-5-5", plus the transform's name when there is one.
fn cleanup_label(settings: &Settings, transform: Option<&Transform>) -> String {
    let label = settings.cleanup.label();
    match transform {
        Some(t) => format!("{label} · {}", t.name),
        None => label,
    }
}

/// `words` are new words to offer for the Dictionary.
enum Done {
    Pasted {
        warning: Option<String>,
        words: Vec<String>,
    },
    Copied,
    /// No text box had focus, so nothing was pasted.
    NoTextField {
        text: String,
        words: Vec<String>,
    },
    NothingHeard,
    /// Transcribing or rewriting failed. `retry` is its history entry, when its recording was kept.
    Failed {
        error: String,
        retry: Option<u64>,
    },
}

fn join_err(e: impl std::fmt::Display) -> AppError {
    AppError::Invalid(format!("internal error: {e}"))
}

/// What a recording is turned into.
enum Job {
    /// Dictation, restyled by `transform` if there is one. `own_hotkey`: the
    /// transform's hotkey asked for it, so it runs even with cleanup turned off.
    Dictate { transform: Option<Transform>, own_hotkey: bool },
    /// This selected text, rewritten as what was said asks.
    Edit(String),
}

impl Job {
    /// A dictation with the transform whose hotkey started it, or else the active one.
    fn dictate(settings: &Settings, own: Option<&str>) -> Job {
        match own.and_then(|id| settings.transform(id)) {
            Some(t) => Job::Dictate { transform: Some(t.clone()), own_hotkey: true },
            None => Job::Dictate { transform: settings.active().cloned(), own_hotkey: false },
        }
    }

    /// An entry for this job, before there's any text.
    fn entry(&self, settings: &Settings, duration_ms: u64) -> Entry {
        let engine = match settings.engine {
            Engine::Local => format!("local:{}", settings.local_model),
            Engine::Cloud => format!("cloud:{}", settings.cloud.model.trim()),
        };
        Entry {
            id: 0,
            at: crate::state::now_ms(),
            text: String::new(),
            raw: None,
            duration_ms,
            engine,
            engine_label: Some(settings.engine_label()),
            cleanup: None,
            language: None,
            transform: match self {
                Job::Dictate { transform: Some(t), own_hotkey: true } => Some(t.id.clone()),
                _ => None,
            },
            selection: match self {
                Job::Edit(s) => Some(s.clone()),
                Job::Dictate { .. } => None,
            },
            error: None,
            audio: false,
        }
    }
}

/// A recording, transcribed and polished: its history entry and how it went.
struct Made {
    entry: Entry,
    warning: Option<String>,
    words: Vec<String>,
}

/// Speech to text, with the engine in `settings`: (text, engine id, language).
async fn transcribe(app: &AppHandle, settings: &Settings, samples: Arc<[f32]>) -> AppResult<(String, String, Option<String>)> {
    let state = app.state::<AppState>();
    let vocabulary = settings.vocabulary.clone();
    match settings.engine {
        Engine::Local => {
            let model = models::find(&settings.local_model).ok_or_else(|| AppError::Invalid("Pick a speech model in Settings → Engine.".into()))?;
            let language = settings.whisper_language(model.english_only);
            let dir = state.models_dir.clone();
            let id = model.id.to_string();
            let handle = app.clone();
            let (text, spoken) = tauri::async_runtime::spawn_blocking(move || {
                let ctx = handle.state::<Whisper>().context(&dir, &id)?;
                whisper::run(&ctx, &audio::pad_for_whisper(samples.to_vec()), language.as_deref(), &vocabulary)
            })
            .await
            .map_err(join_err)??;
            Ok((text, format!("local:{}", model.id), spoken))
        }
        Engine::Cloud => {
            let key = secrets::get("stt")?;
            let language = match settings.language.trim() {
                "" | "auto" => None,
                code => Some(code.to_string()),
            };
            let opts = transcribe::Options { language: language.as_deref(), vocabulary: &settings.vocabulary };
            let text = transcribe::transcribe(&settings.cloud, key.as_deref(), &state.http, &samples, opts).await?;
            Ok((text, format!("cloud:{}", settings.cloud.model.trim()), language))
        }
    }
}

/// Transcribe `samples` and do `job` with the text. `None` if nothing was said.
/// `progress` shows each step on the overlay.
async fn make(app: &AppHandle, settings: &Settings, samples: Arc<[f32]>, job: &Job, duration_ms: u64, progress: bool) -> AppResult<Option<Made>> {
    let state = app.state::<AppState>();
    let (raw, engine, language) = transcribe(app, settings, samples).await?;
    let raw = raw.trim().to_string();
    if raw.is_empty() {
        return Ok(None);
    }
    let mut entry = Entry { engine, language, ..job.entry(settings, duration_ms) };

    let (transform, own_hotkey) = match job {
        Job::Edit(selection) => {
            if progress {
                overlay::show(app, OverlayState::Editing { model: settings.cleanup.label() });
            }
            let key = secrets::get("cleanup")?;
            let out = cleanup::edit(&settings.cleanup, key.as_deref(), &state.http, &settings.vocabulary, &raw, selection).await?;
            if out.trim().is_empty() {
                return Err(AppError::Invalid("The cleanup model sent back no text.".into()));
            }
            entry.text = fixes::apply(&out, &settings.replacements, &[]);
            entry.raw = Some(raw);
            entry.cleanup = Some(settings.cleanup.label());
            return Ok(Some(Made { entry, warning: None, words: Vec::new() }));
        }
        Job::Dictate { transform, own_hotkey } => (transform.as_ref(), *own_hotkey),
    };

    let mut text = raw.clone();
    let mut warning = None;
    let mut cleaned_by = None;
    let mut words = Vec::new();
    // A snippet said on its own is pasted as is: no cleanup, no corrections.
    if let Some(snippet) = fixes::whole_snippet(&raw, &settings.snippets) {
        text = snippet.to_string();
    } else {
        if settings.cleanup.enabled || own_hotkey {
            if progress {
                overlay::show(app, OverlayState::Polishing { model: settings.cleanup.label() });
            }
            let key = secrets::get("cleanup")?;
            let instructions = transform.map(|t| t.instructions.as_str());
            match cleanup::clean(&settings.cleanup, key.as_deref(), &state.http, &settings.vocabulary, instructions, &raw).await {
                Ok(cleaned) if !cleaned.trim().is_empty() => {
                    text = cleaned;
                    cleaned_by = Some(cleanup_label(settings, transform));
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("cleanup failed: {e:?}");
                    warning = Some(format!("{e} (pasted the raw transcript)"));
                }
            }
        }
        text = fixes::apply(&text, &settings.replacements, &settings.snippets);
        if settings.suggest_words {
            words = fixes::suggest_words(&text, settings);
        }
    }
    entry.raw = (raw != text).then_some(raw);
    entry.cleanup = cleaned_by.filter(|_| entry.raw.is_some());
    entry.text = text;
    Ok(Some(Made { entry, warning, words }))
}

/// Paste `text`, unless no text box has focus (then the overlay shows it instead: `None`).
async fn deliver(app: &AppHandle, settings: &Settings, text: &str) -> AppResult<Option<Outcome>> {
    let target = tauri::async_runtime::spawn_blocking(focus::text_field_focused).await.map_err(join_err)?;
    if target == Some(false) {
        return Ok(None);
    }
    let pasted = if settings.trailing_space { format!("{text} ") } else { text.to_string() };
    let restore = settings.restore_clipboard;
    let handle = app.clone();
    Ok(Some(tauri::async_runtime::spawn_blocking(move || paste::paste(&handle, &pasted, restore)).await.map_err(join_err)??))
}

fn done(outcome: Option<Outcome>, made: Made) -> Done {
    match outcome {
        Some(Outcome::Pasted) => Done::Pasted { warning: made.warning, words: made.words },
        Some(Outcome::Copied) => Done::Copied,
        None => Done::NoTextField { text: made.entry.text, words: made.words },
    }
}

/// Add `entry` to the history, with its recording. Returns it as saved.
fn save(app: &AppHandle, entry: Entry, samples: &[f32]) -> Option<Entry> {
    let state = app.state::<AppState>();
    let settings = state.settings();
    let keep = settings.keep_recordings as usize;
    let saved = {
        let mut history = state.history.lock().unwrap();
        // The app can run for weeks, so old entries go as new ones come, not only at launch.
        if let Err(e) = history.prune(crate::state::now_ms(), settings.history_days, keep) {
            eprintln!("couldn't drop old history: {e}");
        }
        history.push(entry, Some(samples), keep)
    };
    match saved {
        Ok(entry) => {
            let _ = app.emit("history-added", &entry);
            Some(entry)
        }
        Err(e) => {
            eprintln!("couldn't save history: {e}");
            None
        }
    }
}

async fn pipeline(app: &AppHandle, rec: Recording, mode: Mode, selection: Option<Selection>) -> AppResult<Done> {
    let captured = tauri::async_runtime::spawn_blocking(move || rec.stop()).await.map_err(join_err)?;
    let samples = audio::to_whisper(&captured.samples, captured.channels, captured.rate);
    if samples.len() < MIN_SPEECH_SAMPLES || audio::is_silent(&samples) {
        return Ok(Done::NothingHeard);
    }
    let samples: Arc<[f32]> = samples.into();
    let settings = app.state::<AppState>().settings();
    let duration_ms = audio::duration_ms(samples.len());

    let job = match mode {
        Mode::Dictate => Job::dictate(&settings, None),
        Mode::Transform(id) => Job::dictate(&settings, Some(&id)),
        Mode::Edit => {
            let selected = match selection {
                Some(copying) => copying.await.map_err(join_err)??,
                None => None,
            };
            Job::Edit(selected.ok_or_else(|| AppError::Invalid("Select some text first.".into()))?)
        }
    };

    match make(app, &settings, samples.clone(), &job, duration_ms, true).await {
        Ok(None) => Ok(Done::NothingHeard),
        Ok(Some(made)) => {
            let delivered = deliver(app, &settings, &made.entry.text).await;
            // Saved even if pasting failed, so the text isn't lost.
            save(app, made.entry.clone(), &samples);
            Ok(done(delivered?, made))
        }
        Err(e) => {
            let error = e.to_string();
            let entry = Entry { error: Some(error.clone()), ..job.entry(&settings, duration_ms) };
            let retry = save(app, entry, &samples).filter(|e| e.audio).map(|e| e.id);
            Ok(Done::Failed { error, retry })
        }
    }
}

/// Transcribe entry `id`'s kept recording again with the current settings, and
/// save the result over the entry. Returns the updated entry, and what was
/// made if it worked. `progress` shows each step on the overlay.
async fn redo(app: &AppHandle, id: u64, progress: bool) -> AppResult<(Entry, Option<Made>)> {
    let state = app.state::<AppState>();
    let (old, samples) = {
        let history = state.history.lock().unwrap();
        (history.get(id).cloned(), history.audio(id))
    };
    let old = old.ok_or_else(|| AppError::NotFound("That dictation is no longer in your history.".into()))?;
    let samples: Arc<[f32]> =
        samples.ok_or_else(|| AppError::NotFound("Its recording wasn't kept, so it can't be transcribed again.".into()))?.into();
    let settings = state.settings();
    let job = match &old.selection {
        Some(selection) => Job::Edit(selection.clone()),
        None => Job::dictate(&settings, old.transform.as_deref()),
    };
    let failed = |error: String| Entry { id, error: Some(error), ..job.entry(&settings, old.duration_ms) };
    let (entry, made) = match make(app, &settings, samples, &job, old.duration_ms, progress).await {
        Ok(Some(made)) => (Entry { id, ..made.entry.clone() }, Some(made)),
        Ok(None) => (failed("Didn't catch anything in the recording.".into()), None),
        Err(e) => (failed(e.to_string()), None),
    };
    let saved = state.history.lock().unwrap().update(entry)?;
    let _ = app.emit("history-updated", &saved);
    Ok((saved, made))
}

/// History's "Transcribe again": redo entry `id` without pasting it.
pub async fn retry(app: &AppHandle, id: u64) -> AppResult<Entry> {
    Ok(redo(app, id, false).await?.0)
}

async fn retry_and_paste(app: &AppHandle, id: u64) -> AppResult<Done> {
    let (entry, made) = redo(app, id, true).await?;
    let Some(made) = made else {
        return Ok(Done::Failed { error: entry.error.unwrap_or_default(), retry: entry.audio.then_some(id) });
    };
    let settings = app.state::<AppState>().settings();
    Ok(done(deliver(app, &settings, &entry.text).await?, made))
}
