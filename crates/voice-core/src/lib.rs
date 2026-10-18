//! Larp's core: everything that doesn't need Tauri or an OS device.
//! Audio buffers in, text out; settings and history on disk.

pub mod audio;
pub mod cleanup;
pub mod error;
pub mod history;
pub mod models;
pub mod settings;
pub mod text;
pub mod transcribe;

pub use error::{Error, Result};
pub use settings::Settings;

/// Sample rate whisper (and every cloud STT API we use) expects.
pub const SAMPLE_RATE: u32 = 16_000;
