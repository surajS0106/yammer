//! The floating pill at the bottom of the screen that shows the dictation's
//! state. It never takes focus, so the app you're dictating into keeps it.
//! Clicks pass through it except over Sushi and the pill, which the webview
//! reports as hit areas: there it can be dragged anywhere on screen, and it
//! stays where it's dropped (`Settings::overlay_position`).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use voice_core::settings::OverlayPosition;

use crate::state::AppState;

pub const LABEL: &str = "overlay";
const WIDTH: f64 = 320.0;
/// Tall enough for Sushi standing on top of the pill, with room for its hops,
/// flips and floating notes.
const HEIGHT: f64 = 128.0;
/// Clearance above the bottom edge, for the taskbar or dock.
const BOTTOM_MARGIN: f64 = 96.0;

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
/// Bumped on every drag move, so only the last one in a burst is saved.
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
        // macOS: the first click on it starts a drag rather than activating it.
        .accept_first_mouse(true)
        .visible(false)
        .build()?;
    window.set_ignore_cursor_events(true)?;
    watch_cursor(app.clone());
    Ok(())
}

/// Let the window take the mouse only while the cursor is over a hit area.
/// A click-through window gets no mouse events, so the webview can't tell on
/// its own when it's hovered; this asks the OS where the cursor is instead.
fn watch_cursor(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(CURSOR_POLL);
        let Some(window) = app.get_webview_window(LABEL) else { continue };
        let over = !matches!(current(), OverlayState::Hidden) && cursor_over(&app, &window);
        if over != GRABBABLE.load(Ordering::SeqCst) {
            GRABBABLE.store(over, Ordering::SeqCst);
            let _ = window.set_ignore_cursor_events(!over);
        }
    });
}

fn cursor_over(app: &AppHandle, window: &WebviewWindow) -> bool {
    let (Ok(cursor), Ok(pos), Ok(scale)) = (app.cursor_position(), window.outer_position(), window.scale_factor()) else {
        return false;
    };
    let (x, y) = ((cursor.x - pos.x as f64) / scale, (cursor.y - pos.y as f64) / scale);
    HIT_AREAS.lock().unwrap().iter().any(|r| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
}

pub fn set_hit_areas(areas: Vec<HitArea>) {
    *HIT_AREAS.lock().unwrap() = areas;
}

/// The window moved. If the user dragged it, remember where, once it settles.
pub fn moved(app: &AppHandle, pos: PhysicalPosition<i32>) {
    if !GRABBABLE.load(Ordering::SeqCst) || *PLACED.lock().unwrap() == Some(pos) {
        return;
    }
    *PLACED.lock().unwrap() = Some(pos);
    let generation = DRAG_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        if DRAG_GENERATION.load(Ordering::SeqCst) == generation {
            save_position(&app, Some(OverlayPosition { x: pos.x, y: pos.y }));
        }
    });
}

/// Put the pill back at the bottom centre of the screen.
pub fn reset_position(app: &AppHandle) {
    save_position(app, None);
    place(app);
}

fn save_position(app: &AppHandle, position: Option<OverlayPosition>) {
    let state = app.state::<AppState>();
    let settings = {
        let mut settings = state.settings.lock().unwrap();
        if settings.overlay_position == position {
            return;
        }
        settings.overlay_position = position;
        settings.clone()
    };
    if let Err(e) = settings.save(&state.settings_path) {
        eprintln!("saving the overlay position failed: {e}");
    }
    let _ = app.emit("settings-changed", &settings);
}

/// Whether the window, put at `pos`, would have its middle on some screen.
fn on_screen(app: &AppHandle, pos: PhysicalPosition<i32>) -> bool {
    app.available_monitors().unwrap_or_default().iter().any(|m| {
        let scale = m.scale_factor();
        let (x, y) = (pos.x as f64 + WIDTH * scale / 2.0, pos.y as f64 + HEIGHT * scale / 2.0);
        let (mp, ms) = (m.position(), m.size());
        let (left, top) = (mp.x as f64, mp.y as f64);
        x >= left && x < left + ms.width as f64 && y >= top && y < top + ms.height as f64
    })
}

/// Where the user dragged it, if that's still on a screen; otherwise centred
/// above the bottom of the screen the cursor is on.
pub fn place(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let saved = app
        .state::<AppState>()
        .settings()
        .overlay_position
        .map(|p| PhysicalPosition::new(p.x, p.y))
        .filter(|&p| on_screen(app, p));
    if let Some(pos) = saved {
        *PLACED.lock().unwrap() = Some(pos);
        let _ = window.set_position(pos);
        return;
    }
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
        let pos = PhysicalPosition::new(x.round() as i32, y.round() as i32);
        *PLACED.lock().unwrap() = Some(pos);
        let _ = window.set_position(pos);
    }
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
    // A pill that stays up follows you to the monitor you start dictating on,
    // unless it was dragged somewhere.
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
