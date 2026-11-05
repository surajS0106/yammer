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

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::Modifiers;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use voice_core::history::Entry;
use voice_core::{audio, Settings};

use crate::error::{AppError, AppResult};
use crate::overlay::{self, OverlayState};
use crate::paste::{self, Outcome};
use crate::pipeline::{join_err, make, redo, save, Job, Made};
use crate::recorder::{self, Recording};
use crate::sounds::{self, Cue};
use crate::state::AppState;
use crate::{focus, hotkey, mute};

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

async fn retry_and_paste(app: &AppHandle, id: u64) -> AppResult<Done> {
    let (entry, made) = redo(app, id, true).await?;
    let Some(made) = made else {
        return Ok(Done::Failed { error: entry.error.unwrap_or_default(), retry: entry.audio.then_some(id) });
    };
    let settings = app.state::<AppState>().settings();
    Ok(done(deliver(app, &settings, &entry.text).await?, made))
}
