//! Local speech-to-text: whisper.cpp running in-process (ported from Sush).
//! Models come from `voice_core::models`, downloaded on demand into the app
//! data dir and verified against a pinned SHA-256 before use.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::AsyncWriteExt;
use voice_core::models::{self, Model};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Default)]
pub struct Whisper {
    /// The loaded model and its id. Loading takes a second or two, so it's kept.
    ctx: Mutex<Option<(String, Arc<WhisperContext>)>>,
    /// Held while downloading so concurrent requests wait for one download.
    download: tokio::sync::Mutex<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    #[serde(flatten)]
    model: Model,
    downloaded: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    received: u64,
    total: u64,
}

fn model(id: &str) -> AppResult<&'static Model> {
    models::find(id).ok_or_else(|| AppError::NotFound(format!("unknown speech model {id}")))
}

pub fn model_path(dir: &Path, model: &Model) -> PathBuf {
    dir.join(model.file)
}

pub fn is_downloaded(dir: &Path, id: &str) -> bool {
    models::find(id).is_some_and(|m| model_path(dir, m).is_file())
}

#[tauri::command]
pub fn models_list(state: State<'_, AppState>) -> Vec<ModelInfo> {
    models::MODELS.iter().map(|m| ModelInfo { model: *m, downloaded: model_path(&state.models_dir, m).is_file() }).collect()
}

/// Download a model if it isn't already there. Verified against its pinned
/// SHA-256 before it's moved into place, so a partial or tampered file is never used.
#[tauri::command]
pub async fn model_download(
    whisper: State<'_, Whisper>,
    state: State<'_, AppState>,
    id: String,
    on_progress: Channel<DownloadProgress>,
) -> AppResult<()> {
    let model = model(&id)?;
    let _guard = whisper.download.lock().await;
    let path = model_path(&state.models_dir, model);
    if path.is_file() {
        return Ok(());
    }
    std::fs::create_dir_all(&state.models_dir)?;
    let part = path.with_extension("bin.part");

    let failed = |e: &dyn std::fmt::Display| AppError::Invalid(format!("Model download failed: {e}"));
    let resp = state.http.get(model.url()).send().await.map_err(|e| failed(&e))?;
    if !resp.status().is_success() {
        return Err(failed(&format!("HTTP {}", resp.status())));
    }
    let mut file = tokio::fs::File::create(&part).await?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last_report = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| failed(&e))?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        // Every ~1 MB is plenty for a progress bar.
        if received - last_report > 1 << 20 || received == model.size_bytes {
            last_report = received;
            let _ = on_progress.send(DownloadProgress { received, total: model.size_bytes });
        }
    }
    file.flush().await?;
    drop(file);

    let digest = format!("{:x}", hasher.finalize());
    if received != model.size_bytes || digest != model.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(AppError::Invalid("The speech model download was corrupted. Try again.".into()));
    }
    std::fs::rename(&part, &path)?;
    Ok(())
}

#[tauri::command]
pub fn model_delete(whisper: State<'_, Whisper>, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let model = model(&id)?;
    let mut ctx = whisper.ctx.lock().unwrap();
    if ctx.as_ref().is_some_and(|(loaded, _)| *loaded == id) {
        *ctx = None;
    }
    match std::fs::remove_file(model_path(&state.models_dir, model)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

impl Whisper {
    /// The context for `id`, loading it (blocking) if a different one or none is loaded.
    pub fn context(&self, dir: &Path, id: &str) -> AppResult<Arc<WhisperContext>> {
        if let Some((loaded, ctx)) = self.ctx.lock().unwrap().as_ref() {
            if loaded == id {
                return Ok(ctx.clone());
            }
        }
        let model = model(id)?;
        let path = model_path(dir, model);
        if !path.is_file() {
            return Err(AppError::Invalid(format!("The {} speech model isn't downloaded yet. Download it in Settings → Engine.", model.label)));
        }
        whisper_rs::install_logging_hooks(); // keep whisper.cpp's chatter off stdout
        let ctx = WhisperContext::new_with_params(&path, WhisperContextParameters::default())
            .map(Arc::new)
            .map_err(|e| AppError::Invalid(format!("Couldn't load the speech model: {e}")))?;
        *self.ctx.lock().unwrap() = Some((id.to_string(), ctx.clone()));
        Ok(ctx)
    }

    /// Free the loaded model. Must run before the process exits: ggml's Metal device is a
    /// C++ static whose destructor aborts if any model's GPU buffers are still alive, which
    /// turned every quit into a crash (and left the dying app's Dock tile beside a relaunch).
    pub fn unload(&self) {
        self.ctx.lock().unwrap_or_else(|e| e.into_inner()).take();
    }
}

/// Transcribe 16 kHz mono samples, returning the text and the language spoken (detected when
/// `language` is None). Blocking; run it off the async runtime.
pub fn run(ctx: &WhisperContext, samples: &[f32], language: Option<&str>, vocabulary: &str) -> AppResult<(String, Option<String>)> {
    let err = |e: whisper_rs::WhisperError| AppError::Invalid(format!("Transcription failed: {e}"));
    let mut state = ctx.create_state().map_err(err)?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    // Scales with every logical core (measured on a Ryzen 3700X), so use them all.
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    params.set_n_threads(threads as i32);
    params.set_language(Some(language.unwrap_or("auto")));
    if !vocabulary.trim().is_empty() {
        params.set_initial_prompt(vocabulary.trim());
    }
    params.set_no_context(true);
    params.set_no_timestamps(true);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    state.full(params, samples).map_err(err)?;

    let text = state
        .as_iter()
        .filter_map(|seg| seg.to_str_lossy().ok().map(|s| s.trim().to_string()))
        // Whisper labels silence and noise as "[BLANK_AUDIO]", "(music)" and the like.
        .filter(|s| !s.is_empty() && !is_annotation(s))
        .collect::<Vec<_>>()
        .join(" ");
    let spoken = match language {
        Some(code) => Some(code.to_string()),
        None => whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(str::to_string),
    };
    Ok((text, spoken))
}

fn is_annotation(s: &str) -> bool {
    (s.starts_with('[') && s.ends_with(']')) || (s.starts_with('(') && s.ends_with(')')) || (s.starts_with('*') && s.ends_with('*'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spots_whisper_annotations() {
        assert!(is_annotation("[BLANK_AUDIO]"));
        assert!(is_annotation("(music)"));
        assert!(is_annotation("*coughs*"));
        assert!(!is_annotation("Hello there."));
    }

    /// Real inference. Run with WHISPER_MODEL=<ggml-base.en.bin> WHISPER_WAV=<16 kHz mono wav>
    /// `cargo test -p larp whisper -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn transcribes_real_audio() {
        let model = std::env::var("WHISPER_MODEL").expect("WHISPER_MODEL");
        let wav = std::fs::read(std::env::var("WHISPER_WAV").expect("WHISPER_WAV")).unwrap();
        let samples = voice_core::audio::pad_for_whisper(voice_core::audio::decode_wav(&wav).unwrap());
        let ctx = WhisperContext::new_with_params(&model, WhisperContextParameters::default()).unwrap();
        let start = std::time::Instant::now();
        let (text, _) = run(&ctx, &samples, Some("en"), "").unwrap();
        println!("{:.1}s audio in {:?}: {text}", samples.len() as f32 / 16000.0, start.elapsed());
        assert!(!text.is_empty());
    }
}
