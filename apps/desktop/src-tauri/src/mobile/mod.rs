//! What the Android and iOS shells share: from a finished recording to text
//! and a history entry. Each records, and delivers the text, its own way.

pub mod overlay;

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use voice_core::history::Entry;
use voice_core::settings::{CloudStt, Engine, SttApi};
use voice_core::{audio, Settings};

use crate::error::AppResult;
use crate::pipeline::{self, Job};
use crate::state::AppState;
use overlay::OverlayState;

const MIN_SPEECH_SAMPLES: usize = voice_core::SAMPLE_RATE as usize * 3 / 10;

/// Whisper isn't built for phones, so they always use a cloud engine,
/// starting with Sarvam. Must match the Sarvam preset in `lib/presets.ts`.
pub fn cloud_only(state: &AppState) -> AppResult<()> {
    let mut settings = state.settings.lock().unwrap();
    if settings.engine == Engine::Local {
        settings.engine = Engine::Cloud;
        if !settings.onboarded {
            settings.cloud =
                CloudStt { preset: "sarvam".into(), base_url: "https://api.sarvam.ai".into(), model: "saaras:v4".into(), api: SttApi::Sarvam };
        }
        settings.save(&state.settings_path)?;
    }
    Ok(())
}

/// How a recording ended. Android's service gets this as JSON.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Dictated {
    Text { text: String, warning: Option<String> },
    Nothing,
    Failed { error: String },
}

pub async fn dictate(app: &AppHandle, samples: Vec<f32>) -> Dictated {
    if samples.len() < MIN_SPEECH_SAMPLES || audio::is_silent(&samples) {
        return Dictated::Nothing;
    }
    let settings = app.state::<AppState>().settings();
    let duration_ms = audio::duration_ms(samples.len());
    let samples: Arc<[f32]> = samples.into();
    let job = Job::dictate(&settings, None);
    overlay::show(app, OverlayState::Transcribing { engine: settings.engine_label() });
    match pipeline::make(app, &settings, samples.clone(), &job, duration_ms, true).await {
        Ok(None) => Dictated::Nothing,
        Ok(Some(made)) => {
            let text = delivered_text(&settings, &made.entry);
            pipeline::save(app, made.entry, &samples);
            Dictated::Text { text, warning: made.warning }
        }
        Err(e) => {
            let error = e.to_string();
            pipeline::save(app, Entry { error: Some(error.clone()), ..job.entry(&settings, duration_ms) }, &samples);
            Dictated::Failed { error }
        }
    }
}

fn delivered_text(settings: &Settings, entry: &Entry) -> String {
    if settings.trailing_space {
        format!("{} ", entry.text)
    } else {
        entry.text.clone()
    }
}
