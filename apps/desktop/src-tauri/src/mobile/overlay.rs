//! The phones' stand-in for `overlay.rs`. There's no overlay window, and on
//! Android the Kotlin service draws Sushi over other apps. This only keeps the
//! webview's status up to date.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

pub use crate::overlay_state::OverlayState;

/// The last state shown, for a page that loads after it was sent.
static CURRENT: Mutex<OverlayState> = Mutex::new(OverlayState::Hidden);

pub fn show(app: &AppHandle, state: OverlayState) {
    *CURRENT.lock().unwrap() = state.clone();
    let _ = app.emit("dictation", &state);
}

pub fn current() -> OverlayState {
    CURRENT.lock().unwrap().clone()
}
