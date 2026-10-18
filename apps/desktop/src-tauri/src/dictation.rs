//! The dictation state machine. Hotkey, tray and CLI events all land on one
//! channel and are handled in order by a single task, so there are no races
//! between a press, a release, Esc, and a pipeline finishing.
//!
//! Hold vs. tap: recording starts on press. Released within `TAP` it latches
//! (toggle mode: the next press stops it); held longer, the release stops it.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use voice_core::history::Entry;
use voice_core::settings::Engine;
use voice_core::{audio, cleanup, models, text as fixes, transcribe};

use crate::error::{AppError, AppResult};
use crate::overlay::{self, OverlayState};
use crate::paste::{self, Outcome};
use crate::recorder::{self, Recording};
use crate::sounds::{self, Cue};
use crate::state::AppState;
use crate::whisper::{self, Whisper};
use crate::{hotkey, secrets};

const TAP: Duration = Duration::from_millis(300);
const MIN_SPEECH_SAMPLES: usize = voice_core::SAMPLE_RATE as usize * 3 / 10;
const MAX_DURATION: Duration = Duration::from_secs(600);

#[derive(Debug)]
pub enum Input {
    /// The hotkey went down / up.
    Down,
    Up,
    /// Start or stop without hold semantics (tray menu, `--toggle`).
    Toggle,
    /// Esc while recording: discard.
    Cancel,
    /// The recording with this session id hit the length cap.
    Cap(u64),
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

enum Phase {
    Idle,
    Recording { rec: Recording, pressed_at: Instant, latched: bool, session: u64 },
    Busy,
}

struct Controller {
    app: AppHandle,
    tx: UnboundedSender<Input>,
    phase: Phase,
    key_down: bool,
    session: u64,
}

pub fn spawn(app: AppHandle) -> Dictation {
    let (tx, mut rx) = unbounded_channel();
    let mut ctl = Controller { app, tx: tx.clone(), phase: Phase::Idle, key_down: false, session: 0 };
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
            Input::Down => {
                // Held keys auto-repeat on some platforms.
                if std::mem::replace(&mut self.key_down, true) {
                    return;
                }
                match self.phase {
                    Phase::Idle => self.start(false),
                    Phase::Recording { latched: true, .. } => self.finish(),
                    _ => {}
                }
            }
            Input::Up => {
                self.key_down = false;
                if let Phase::Recording { pressed_at, latched: latched @ false, .. } = &mut self.phase {
                    if pressed_at.elapsed() < TAP {
                        *latched = true;
                        overlay::show(&self.app, OverlayState::Listening { hint: Some(self.stop_hint()) });
                    } else {
                        self.finish();
                    }
                }
            }
            Input::Toggle => match self.phase {
                Phase::Idle => self.start(true),
                Phase::Recording { .. } => self.finish(),
                Phase::Busy => {}
            },
            Input::Cancel => {
                if let Phase::Recording { .. } = self.phase {
                    if let Phase::Recording { rec, .. } = std::mem::replace(&mut self.phase, Phase::Idle) {
                        std::thread::spawn(move || drop(rec.stop()));
                    }
                    hotkey::set_escape(&self.app, false);
                    overlay::flash(&self.app, OverlayState::Message { text: "Cancelled".into(), error: false }, 900);
                }
            }
            Input::Cap(session) => {
                if matches!(self.phase, Phase::Recording { session: s, .. } if s == session) {
                    self.finish();
                }
            }
            Input::Finished => self.phase = Phase::Idle,
        }
    }

    fn stop_hint(&self) -> String {
        let hotkey = self.app.state::<AppState>().settings().hotkey;
        format!("Press {} to finish", hotkey::display(&hotkey))
    }

    fn start(&mut self, latched: bool) {
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
        self.session += 1;
        let session = self.session;
        self.phase = Phase::Recording { rec, pressed_at: Instant::now(), latched, session };
        let hint = latched.then(|| self.stop_hint());
        overlay::show(&self.app, OverlayState::Listening { hint });
        hotkey::set_escape(&self.app, true);

        let tx = self.tx.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(MAX_DURATION).await;
            let _ = tx.send(Input::Cap(session));
        });
    }

    fn finish(&mut self) {
        let Phase::Recording { rec, .. } = std::mem::replace(&mut self.phase, Phase::Busy) else { return };
        hotkey::set_escape(&self.app, false);
        let settings = self.app.state::<AppState>().settings();
        if settings.sounds {
            sounds::play(Cue::Stop);
        }
        overlay::show(&self.app, OverlayState::Transcribing { engine: settings.engine_label() });

        let app = self.app.clone();
        let tx = self.tx.clone();
        tauri::async_runtime::spawn(async move {
            match pipeline(&app, rec).await {
                Ok(Done::Pasted { warning: None }) => overlay::hide(&app),
                Ok(Done::Pasted { warning: Some(w) }) => overlay::flash(&app, OverlayState::Message { text: w, error: false }, 3500),
                Ok(Done::Copied) => {
                    let keys = if cfg!(target_os = "macos") { "⌘V" } else { "Ctrl+V" };
                    overlay::flash(&app, OverlayState::Message { text: format!("Copied. Press {keys} to paste."), error: false }, 3500);
                }
                Ok(Done::NothingHeard) => overlay::flash(&app, OverlayState::Message { text: "Didn't catch that".into(), error: false }, 1500),
                Err(e) => {
                    if app.state::<AppState>().settings().sounds {
                        sounds::play(Cue::Error);
                    }
                    overlay::flash(&app, OverlayState::Message { text: e.to_string(), error: true }, 5000);
                }
            }
            let _ = tx.send(Input::Finished);
        });
    }
}

/// "Anthropic · claude-haiku-5-5", plus the transform's name when one is active.
fn cleanup_label(settings: &voice_core::Settings) -> String {
    let label = settings.cleanup.label();
    match settings.transforms.iter().find(|t| settings.transform_instructions().is_some() && t.id == settings.active_transform) {
        Some(t) => format!("{label} · {}", t.name),
        None => label,
    }
}

enum Done {
    Pasted { warning: Option<String> },
    Copied,
    NothingHeard,
}

fn join_err(e: impl std::fmt::Display) -> AppError {
    AppError::Invalid(format!("internal error: {e}"))
}

async fn pipeline(app: &AppHandle, rec: Recording) -> AppResult<Done> {
    let captured = tauri::async_runtime::spawn_blocking(move || rec.stop()).await.map_err(join_err)?;
    let samples = audio::to_whisper(&captured.samples, captured.channels, captured.rate);
    if samples.len() < MIN_SPEECH_SAMPLES || audio::is_silent(&samples) {
        return Ok(Done::NothingHeard);
    }

    let state = app.state::<AppState>();
    let settings = state.settings();
    let duration_ms = audio::duration_ms(samples.len());
    let vocabulary = settings.vocabulary.clone();

    let (raw, engine, language) = match settings.engine {
        Engine::Local => {
            let model = models::find(&settings.local_model).ok_or_else(|| AppError::Invalid("Pick a speech model in Settings → Engine.".into()))?;
            let language = settings.whisper_language(model.english_only);
            let dir = state.models_dir.clone();
            let id = model.id.to_string();
            let handle = app.clone();
            let (text, spoken) = tauri::async_runtime::spawn_blocking(move || {
                let ctx = handle.state::<Whisper>().context(&dir, &id)?;
                whisper::run(&ctx, &audio::pad_for_whisper(samples), language.as_deref(), &vocabulary)
            })
            .await
            .map_err(join_err)??;
            (text, format!("local:{}", model.id), spoken)
        }
        Engine::Cloud => {
            let key = secrets::get("stt")?;
            let language = match settings.language.trim() {
                "" | "auto" => None,
                code => Some(code.to_string()),
            };
            let opts = transcribe::Options { language: language.as_deref(), vocabulary: &settings.vocabulary };
            let text = transcribe::transcribe(&settings.cloud, key.as_deref(), &state.http, audio::encode_wav(&samples), opts).await?;
            (text, format!("cloud:{}", settings.cloud.model.trim()), language)
        }
    };
    let raw = raw.trim().to_string();
    if raw.is_empty() {
        return Ok(Done::NothingHeard);
    }

    let mut text = raw.clone();
    let mut warning = None;
    let mut cleaned_by = None;
    // A snippet said on its own is pasted as is: no cleanup, no corrections.
    if let Some(snippet) = fixes::whole_snippet(&raw, &settings.snippets) {
        text = snippet.to_string();
    } else {
        if settings.cleanup.enabled {
            overlay::show(app, OverlayState::Polishing { model: settings.cleanup.label() });
            let key = secrets::get("cleanup")?;
            let transform = settings.transform_instructions();
            match cleanup::clean(&settings.cleanup, key.as_deref(), &state.http, &settings.vocabulary, transform, &raw).await {
                Ok(cleaned) if !cleaned.trim().is_empty() => {
                    text = cleaned;
                    cleaned_by = Some(cleanup_label(&settings));
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("cleanup failed: {e:?}");
                    warning = Some(format!("{e} (pasted the raw transcript)"));
                }
            }
        }
        text = fixes::apply(&text, &settings.replacements, &settings.snippets);
    }

    let pasted = if settings.trailing_space { format!("{text} ") } else { text.clone() };
    let restore = settings.restore_clipboard;
    let handle = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || paste::paste(&handle, &pasted, restore)).await.map_err(join_err)??;

    let at = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let raw = (raw != text).then_some(raw);
    let cleanup = cleaned_by.filter(|_| raw.is_some());
    let entry = Entry { id: 0, at, text, raw, duration_ms, engine, engine_label: Some(settings.engine_label()), cleanup, language };
    let saved = state.history.lock().unwrap().push(entry);
    match saved {
        Ok(entry) => {
            let _ = app.emit("history-added", entry);
        }
        Err(e) => eprintln!("couldn't save history: {e}"),
    }

    Ok(match outcome {
        Outcome::Pasted => Done::Pasted { warning },
        Outcome::Copied => Done::Copied,
    })
}
