//! Android's stand-in for `overlay.rs`. There's no overlay window: the Kotlin
//! service draws Sushi over other apps, and this only keeps the webview's
//! status up to date.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

pub use crate::overlay_state::OverlayState;

/// The last state shown, for a page that loads after it was sent.
static CURRENT: Mutex<OverlayState> = Mutex::new(OverlayState::Hidden);
/// When the meeting being transcribed started, if one is.
static MEETING: Mutex<Option<u64>> = Mutex::new(None);
/// Bumped by every `show`, so a `flash` only hides what it showed.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Between dictations, a meeting in progress is what's shown, as on desktop.
pub fn show(app: &AppHandle, state: OverlayState) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let state = match (state, *MEETING.lock().unwrap()) {
        (OverlayState::Hidden | OverlayState::Idle | OverlayState::Meeting { .. }, Some(started_at)) => OverlayState::Meeting { started_at },
        (OverlayState::Idle | OverlayState::Meeting { .. }, None) => OverlayState::Hidden,
        (s, _) => s,
    };
    *CURRENT.lock().unwrap() = state.clone();
    let _ = app.emit("dictation", &state);
}

/// Show `state`, then hide it after `ms` unless something newer was shown.
pub fn flash(app: &AppHandle, state: OverlayState, ms: u64) {
    show(app, state);
    let generation = GENERATION.load(Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        if GENERATION.load(Ordering::SeqCst) == generation {
            show(&app, OverlayState::Hidden);
        }
    });
}

/// A meeting started (`started_at`, Unix ms) or ended (`None`).
pub fn set_meeting(app: &AppHandle, started_at: Option<u64>) {
    *MEETING.lock().unwrap() = started_at;
    if matches!(current(), OverlayState::Hidden | OverlayState::Idle | OverlayState::Meeting { .. }) {
        show(app, OverlayState::Hidden);
    }
}

pub fn current() -> OverlayState {
    CURRENT.lock().unwrap().clone()
}
