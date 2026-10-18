//! The floating pill at the bottom of the screen that shows the dictation's
//! state. It never takes focus, so the app you're dictating into keeps it.
//! Clicks pass through it except over Sushi and the pill, which the webview
//! reports as hit areas: there it can be dragged, and when dropped it snaps to
//! the middle of the nearest screen edge (`Settings::overlay_edge`).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use voice_core::settings::OverlayEdge;

use crate::state::AppState;

pub const LABEL: &str = "overlay";
/// Square, so the pill and Sushi fit along any edge: wide enough for the
/// longest pill, deep enough for Sushi's hops, flips and floating notes.
const SIZE: f64 = 320.0;
/// Gap between the window and the screen edge's work area.
const EDGE_MARGIN: f64 = 4.0;
/// How long the window has to sit still before a drag counts as dropped.
#[cfg(target_os = "macos")]
const DROP_WAIT: Duration = Duration::from_millis(150);
#[cfg(not(target_os = "macos"))]
const DROP_WAIT: Duration = Duration::from_millis(400);

/// Bumped on every change, so a delayed hide doesn't hide a newer state.
static GENERATION: AtomicU64 = AtomicU64::new(0);
/// Keep a small idle pill on screen between dictations, instead of hiding.
static ALWAYS_VISIBLE: AtomicBool = AtomicBool::new(false);
/// The last state shown, for an overlay webview that loads after it was sent.
static CURRENT: Mutex<OverlayState> = Mutex::new(OverlayState::Hidden);
/// Sushi and the pill, which take the mouse; clicks anywhere else pass through.
static HIT_AREAS: Mutex<Vec<HitArea>> = Mutex::new(Vec::new());
/// The cursor is over a hit area, so the window takes the mouse.
static GRABBABLE: AtomicBool = AtomicBool::new(false);
/// Where `place` last put the window, to tell its own moves from the user's drags.
static PLACED: Mutex<Option<PhysicalPosition<i32>>> = Mutex::new(None);
/// Bumped on every drag move, so only the last one in a burst snaps.
static DRAG_GENERATION: AtomicU64 = AtomicU64::new(0);
/// How often to check whether the cursor is over Sushi or the pill.
const CURSOR_POLL: Duration = Duration::from_millis(40);

/// A rectangle in CSS px from the overlay window's top-left.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct HitArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum OverlayState {
    Listening { hint: Option<String> },
    /// `engine` is the settings' engine label, e.g. "Sarvam · saaras:v4".
    Transcribing { engine: String },
    Polishing { model: String },
    Message { text: String, error: bool },
    /// Not dictating, but the pill stays on screen ("Always show the pill").
    Idle,
    Hidden,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Larp")
        .inner_size(SIZE, SIZE)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        // macOS: the first click on it starts a drag rather than activating it.
        .accept_first_mouse(true)
        .visible(false)
        .build()?;
    #[cfg(target_os = "macos")]
    crate::panel::make_panel(&window);
    #[cfg(target_os = "macos")]
    crate::panel::keep_rendering(&window);
    window.set_ignore_cursor_events(true)?;
    watch_cursor(app.clone());
    Ok(())
}

/// Let the window take the mouse only while the cursor is over a hit area.
/// A click-through window gets no mouse events, so the webview can't tell on
/// its own when it's hovered; this asks the OS where the cursor is instead.
/// macOS doesn't send mouse moves to a window that never takes focus either,
/// so the cursor position goes to the webview too, for the island's hover.
fn watch_cursor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<(f64, f64)> = None;
        loop {
            std::thread::sleep(CURSOR_POLL);
            let Some(window) = app.get_webview_window(LABEL) else { continue };
            let cursor = (!matches!(current(), OverlayState::Hidden)).then(|| cursor_in(&app, &window)).flatten();
            let over = cursor.is_some_and(|(x, y)| {
                HIT_AREAS.lock().unwrap().iter().any(|r| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
            });
            if over != GRABBABLE.load(Ordering::SeqCst) {
                GRABBABLE.store(over, Ordering::SeqCst);
                let _ = window.set_ignore_cursor_events(!over);
            }
            if cursor != last {
                last = cursor;
                let _ = app.emit_to(LABEL, "overlay-cursor", cursor.map(|(x, y)| CursorPos { x, y }));
            }
        }
    });
}

/// The cursor in CSS px from the overlay window's top-left.
#[derive(Clone, Copy, Serialize)]
struct CursorPos {
    x: f64,
    y: f64,
}

/// The cursor in CSS px from the overlay's top-left, if it's over the window.
fn cursor_in(app: &AppHandle, window: &WebviewWindow) -> Option<(f64, f64)> {
    let (Ok(cursor), Ok(pos), Ok(scale)) = (app.cursor_position(), window.outer_position(), window.scale_factor()) else {
        return None;
    };
    let (x, y) = ((cursor.x - pos.x as f64) / scale, (cursor.y - pos.y as f64) / scale);
    (x >= 0.0 && x < SIZE && y >= 0.0 && y < SIZE).then_some((x, y))
}

pub fn set_hit_areas(areas: Vec<HitArea>) {
    *HIT_AREAS.lock().unwrap() = areas;
}

/// The window moved. If the user dragged it, snap it to the nearest edge once
/// it's dropped.
pub fn moved(app: &AppHandle, pos: PhysicalPosition<i32>) {
    if !GRABBABLE.load(Ordering::SeqCst) || *PLACED.lock().unwrap() == Some(pos) {
        return;
    }
    let generation = DRAG_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(DROP_WAIT).await;
        if DRAG_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        // A pause mid-drag isn't a drop: wait for the button to come up.
        #[cfg(target_os = "macos")]
        while mouse_down() {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        if DRAG_GENERATION.load(Ordering::SeqCst) == generation {
            snap(&app);
        }
    });
}

#[cfg(target_os = "macos")]
fn mouse_down() -> bool {
    objc2_app_kit::NSEvent::pressedMouseButtons() & 1 != 0
}

/// Move to the middle of the screen edge nearest the cursor.
fn snap(app: &AppHandle) {
    if let Some(edge) = nearest_edge(app) {
        save_edge(app, edge);
    }
    place(app);
}

fn nearest_edge(app: &AppHandle) -> Option<OverlayEdge> {
    let cursor = app.cursor_position().ok()?;
    let area = *app.monitor_from_point(cursor.x, cursor.y).ok().flatten()?.work_area();
    let (left, top) = (area.position.x as f64, area.position.y as f64);
    let (right, bottom) = (left + area.size.width as f64, top + area.size.height as f64);
    [
        (OverlayEdge::Left, cursor.x - left),
        (OverlayEdge::Right, right - cursor.x),
        (OverlayEdge::Top, cursor.y - top),
        (OverlayEdge::Bottom, bottom - cursor.y),
    ]
    .into_iter()
    .min_by(|a, b| a.1.total_cmp(&b.1))
    .map(|(edge, _)| edge)
}

fn save_edge(app: &AppHandle, edge: OverlayEdge) {
    let state = app.state::<AppState>();
    let settings = {
        let mut settings = state.settings.lock().unwrap();
        if settings.overlay_edge == edge {
            return;
        }
        settings.overlay_edge = edge;
        settings.clone()
    };
    if let Err(e) = settings.save(&state.settings_path) {
        eprintln!("saving the overlay edge failed: {e}");
    }
    let _ = app.emit("settings-changed", &settings);
}

/// The middle of the chosen edge of the screen the cursor is on, inside its
/// work area (clear of the menu bar, Dock and taskbar).
pub fn place(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let edge = app.state::<AppState>().settings().overlay_edge;
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return };
    let scale = m.scale_factor();
    let area = *m.work_area();
    let (left, top) = (area.position.x as f64, area.position.y as f64);
    let (width, height) = (area.size.width as f64, area.size.height as f64);
    let (size, margin) = (SIZE * scale, EDGE_MARGIN * scale);
    let (x, y) = match edge {
        OverlayEdge::Bottom => (left + (width - size) / 2.0, top + height - size - margin),
        OverlayEdge::Top => (left + (width - size) / 2.0, top + margin),
        OverlayEdge::Left => (left + margin, top + (height - size) / 2.0),
        OverlayEdge::Right => (left + width - size - margin, top + (height - size) / 2.0),
    };
    let pos = PhysicalPosition::new(x.round() as i32, y.round() as i32);
    *PLACED.lock().unwrap() = Some(pos);
    let _ = window.set_position(pos);
}

pub fn show(app: &AppHandle, state: OverlayState) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let state = match state {
        OverlayState::Hidden | OverlayState::Idle if ALWAYS_VISIBLE.load(Ordering::SeqCst) => OverlayState::Idle,
        OverlayState::Idle => OverlayState::Hidden,
        s => s,
    };
    *CURRENT.lock().unwrap() = state.clone();
    let _ = app.emit("dictation", &state);
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if matches!(state, OverlayState::Hidden) {
        let _ = window.hide();
        return;
    }
    let visible = window.is_visible().unwrap_or(false);
    // A pill that stays up follows you to the monitor you start dictating on.
    if !visible || matches!(state, OverlayState::Listening { .. }) {
        place(app);
    }
    if !visible {
        let _ = window.show();
        // Some window managers drop always-on-top across hide/show.
        let _ = window.set_always_on_top(true);
    }
}

pub fn current() -> OverlayState {
    CURRENT.lock().unwrap().clone()
}

/// Turn the always-visible idle pill on or off. Mid-dictation this only
/// changes what happens when the dictation ends.
pub fn set_always_visible(app: &AppHandle, on: bool) {
    ALWAYS_VISIBLE.store(on, Ordering::SeqCst);
    if matches!(current(), OverlayState::Hidden | OverlayState::Idle) {
        hide(app);
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

/// Microphone level for the meter and Sushi (in the overlay and on Home), 0..1 RMS.
pub fn level(app: &AppHandle, rms: f32) {
    let _ = app.emit("level", rms);
}
