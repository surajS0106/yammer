//! The floating pill at the bottom of the screen that shows the dictation's
//! state. It never takes focus, so the app you're dictating into keeps it,
//! and clicks pass through it.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";
const WIDTH: f64 = 320.0;
const HEIGHT: f64 = 72.0;
/// Clearance above the bottom edge, for the taskbar or dock.
const BOTTOM_MARGIN: f64 = 96.0;

/// Bumped on every change, so a delayed hide doesn't hide a newer state.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum OverlayState {
    Listening { hint: Option<String> },
    Transcribing,
    Polishing,
    Message { text: String, error: bool },
    Hidden,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Sush Voice")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .build()?;
    window.set_ignore_cursor_events(true)?;
    Ok(())
}

fn place(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let (pos, size) = (m.position(), m.size());
        let x = pos.x as f64 + (size.width as f64 - WIDTH * scale) / 2.0;
        let y = pos.y as f64 + size.height as f64 - (HEIGHT + BOTTOM_MARGIN) * scale;
        let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
}

pub fn show(app: &AppHandle, state: OverlayState) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let _ = app.emit("dictation", &state);
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if matches!(state, OverlayState::Hidden) {
        let _ = window.hide();
        return;
    }
    if !window.is_visible().unwrap_or(false) {
        place(app);
        let _ = window.show();
        // Some window managers drop always-on-top across hide/show.
        let _ = window.set_always_on_top(true);
    }
}

pub fn hide(app: &AppHandle) {
    show(app, OverlayState::Hidden);
}

/// Show `state`, then hide after `ms` unless something newer was shown.
pub fn flash(app: &AppHandle, state: OverlayState, ms: u64) {
    show(app, state);
    let generation = GENERATION.load(Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        if GENERATION.load(Ordering::SeqCst) == generation {
            hide(&app);
        }
    });
}

/// Microphone level for the meter, 0..1 RMS.
pub fn level(app: &AppHandle, rms: f32) {
    let _ = app.emit_to(LABEL, "level", rms);
}
