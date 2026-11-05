//! From a recording to finished text, on every platform: speech to text, then
//! cleanup, corrections and the history entry. What starts a recording and
//! where the text goes differ, so `dictation.rs` (desktop) and `android`
//! each drive this themselves.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use voice_core::history::Entry;
use voice_core::settings::{Engine, Transform};
#[cfg(desktop)]
use voice_core::{audio, models};
use voice_core::{cleanup, text as fixes, transcribe, Settings};

use crate::error::{AppError, AppResult};
use crate::overlay::{self, OverlayState};
use crate::secrets;
use crate::state::AppState;
#[cfg(desktop)]
use crate::whisper::{self, Whisper};

/// "Anthropic · claude-haiku-5-5", plus the transform's name when there is one.
fn cleanup_label(settings: &Settings, transform: Option<&Transform>) -> String {
    let label = settings.cleanup.label();
    match transform {
        Some(t) => format!("{label} · {}", t.name),
        None => label,
    }
}

#[cfg(desktop)]
pub fn join_err(e: impl std::fmt::Display) -> AppError {
    AppError::Invalid(format!("internal error: {e}"))
}

/// What a recording is turned into.
pub enum Job {
    /// Dictation, restyled by `transform` if there is one. `own_hotkey`: the
    /// transform's hotkey asked for it, so it runs even with cleanup turned off.
    Dictate { transform: Option<Transform>, own_hotkey: bool },
    /// This selected text, rewritten as what was said asks.
    Edit(String),
}

impl Job {
    /// A dictation with the transform whose hotkey started it, or else the active one.
    pub fn dictate(settings: &Settings, own: Option<&str>) -> Job {
        match own.and_then(|id| settings.transform(id)) {
            Some(t) => Job::Dictate { transform: Some(t.clone()), own_hotkey: true },
            None => Job::Dictate { transform: settings.active().cloned(), own_hotkey: false },
        }
    }

    /// An entry for this job, before there's any text.
    pub fn entry(&self, settings: &Settings, duration_ms: u64) -> Entry {
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
#[cfg_attr(not(desktop), allow(dead_code))]
pub struct Made {
    pub entry: Entry,
    pub warning: Option<String>,
    pub words: Vec<String>,
}

/// Speech to text, with the engine in `settings`: (text, engine id, language).
async fn transcribe(app: &AppHandle, settings: &Settings, samples: Arc<[f32]>) -> AppResult<(String, String, Option<String>)> {
    let state = app.state::<AppState>();
    match settings.engine {
        // Whisper isn't built for Android; `android::cloud_only` keeps settings off this.
        #[cfg(not(desktop))]
        Engine::Local => {
            let _ = samples;
            Err(AppError::Invalid("On-device speech isn't available on this device yet. Pick a cloud service in Settings.".into()))
        }
        #[cfg(desktop)]
        Engine::Local => {
            let vocabulary = settings.vocabulary.clone();
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
pub async fn make(app: &AppHandle, settings: &Settings, samples: Arc<[f32]>, job: &Job, duration_ms: u64, progress: bool) -> AppResult<Option<Made>> {
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

/// Add `entry` to the history, with its recording. Returns it as saved.
pub fn save(app: &AppHandle, entry: Entry, samples: &[f32]) -> Option<Entry> {
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

/// Transcribe entry `id`'s kept recording again with the current settings, and
/// save the result over the entry. Returns the updated entry, and what was
/// made if it worked. `progress` shows each step on the overlay.
pub async fn redo(app: &AppHandle, id: u64, progress: bool) -> AppResult<(Entry, Option<Made>)> {
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
