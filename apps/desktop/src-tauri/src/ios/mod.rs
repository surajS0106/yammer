//! The iOS shell. Swift (`gen/apple/Sources/yammer/Dictation.swift`) owns the
//! microphone, the clipboard and the share sheet; this hands a finished
//! recording to the shared pipeline and answers the webview.
//!
//! iOS has no equivalent of Android's Sushi bubble or Accessibility paste: an
//! app can't draw over other apps or type into them. So a dictation starts in
//! Yammer and its text goes to the clipboard.
//!
//! The two sides talk over a plain C interface, declared for Swift in
//! `gen/apple/Sources/yammer/bridge.h`. Its names must match the `extern` block
//! and the `yammer_ios_*` functions here, or the app won't link.

use std::ffi::{c_char, c_float, CStr, CString};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use voice_core::audio;

use crate::error::{AppError, AppResult};
use crate::mobile::overlay::{self, OverlayState};
use crate::mobile::{self, Dictated};
use crate::state::AppState;
use crate::{commands, secrets};

/// How long a result stays in Home's status before it goes back to ready.
const MESSAGE_FOR: Duration = Duration::from_secs(4);

static APP: OnceLock<AppHandle> = OnceLock::new();

extern "C" {
    fn yammer_swift_mic_allowed() -> bool;
    fn yammer_swift_is_recording() -> bool;
    fn yammer_swift_action(action: *const c_char);
    fn yammer_swift_copy(text: *const c_char);
    fn yammer_swift_share(name: *const c_char, contents: *const c_char);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            secrets::init(&config_dir);
            let state = AppState::new(config_dir, data_dir)?;
            mobile::cloud_only(&state)?;
            app.manage(state);
            let _ = APP.set(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings_get,
            commands::settings_set,
            commands::overlay_state,
            commands::dictionary_add,
            commands::secret_status,
            commands::secret_set,
            commands::history_list,
            commands::history_delete,
            commands::history_clear,
            commands::history_retry,
            commands::export_file,
            commands::scratchpad_list,
            commands::scratchpad_save,
            commands::text_rewrite,
            commands::platform_info,
            copy_text,
            ios_status,
            ios_action,
            ios_share,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Yammer");
}

/// A C string for Swift. Text with a NUL in it loses the NUL, not everything after it.
fn c_string(text: &str) -> CString {
    CString::new(text.replace('\0', "")).unwrap_or_default()
}

// ---- Commands for the settings UI ----

/// The same shape as Android's, so the phone UI reads one type (`PhoneStatus`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    mic: bool,
    overlay: bool,
    accessibility: bool,
    notifications: bool,
    running: bool,
    recording: bool,
}

#[tauri::command]
async fn ios_status() -> Status {
    let (mic, recording) = unsafe { (yammer_swift_mic_allowed(), yammer_swift_is_recording()) };
    Status { mic, overlay: false, accessibility: false, notifications: true, running: true, recording }
}

/// Ask the Swift side to do something the settings UI offers.
#[tauri::command]
async fn ios_action(action: String) -> AppResult<()> {
    const ACTIONS: &[&str] = &["requestMic", "openAppSettings", "toggle", "barsLight", "barsDark"];
    if !ACTIONS.contains(&action.as_str()) {
        return Err(AppError::Invalid(format!("unknown action {action}")));
    }
    if action == "toggle" && !unsafe { yammer_swift_mic_allowed() } {
        return Err(AppError::Invalid("Allow the microphone first.".into()));
    }
    let action = c_string(&action);
    unsafe { yammer_swift_action(action.as_ptr()) };
    Ok(())
}

#[tauri::command]
async fn copy_text(text: String) {
    let text = c_string(&text);
    unsafe { yammer_swift_copy(text.as_ptr()) };
}

/// Hand a file to iOS's share sheet: a phone's files aren't somewhere you go and look.
#[tauri::command]
async fn ios_share(name: String, contents: String) {
    let (name, contents) = (c_string(&name), c_string(&contents));
    unsafe { yammer_swift_share(name.as_ptr(), contents.as_ptr()) };
}

// ---- Called by Dictation.swift ----

/// Show a result on Home for a moment. It only clears a message, never a dictation started since.
fn say(app: &AppHandle, text: String, error: bool) {
    overlay::show(app, OverlayState::Message { text, error });
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(MESSAGE_FOR);
        if matches!(overlay::current(), OverlayState::Message { .. }) {
            overlay::show(&app, OverlayState::Hidden);
        }
    });
}

/// `samples` is mono at `rate` Hz. Blocks until the text is on the clipboard, so call it off the main thread.
///
/// # Safety
/// `samples` must point to `len` floats, or be null.
#[no_mangle]
pub unsafe extern "C" fn yammer_ios_process(samples: *const c_float, len: usize, rate: u32) {
    let Some(app) = APP.get() else { return };
    let floats = if samples.is_null() { &[][..] } else { std::slice::from_raw_parts(samples, len) };
    let samples = audio::to_whisper(floats, 1, rate);
    match tauri::async_runtime::block_on(mobile::dictate(app, samples)) {
        Dictated::Text { text, warning } => {
            let c_text = c_string(&text);
            yammer_swift_copy(c_text.as_ptr());
            say(app, warning.unwrap_or_else(|| "Copied. Paste it anywhere.".into()), false);
        }
        Dictated::Nothing => say(app, "Didn’t catch that".into(), false),
        Dictated::Failed { error } => say(app, error, true),
    }
}

/// Recording started or was thrown away, for the webview's status.
#[no_mangle]
pub extern "C" fn yammer_ios_recording(on: bool) {
    if let Some(app) = APP.get() {
        overlay::show(app, if on { OverlayState::Listening { hint: None } } else { OverlayState::Hidden });
    }
}

/// Microphone level, 0..1 RMS, for Sushi on Home.
#[no_mangle]
pub extern "C" fn yammer_ios_level(rms: c_float) {
    if let Some(app) = APP.get() {
        let _ = app.emit("level", rms);
    }
}

/// The microphone wouldn't start.
///
/// # Safety
/// `message` must be a valid C string.
#[no_mangle]
pub unsafe extern "C" fn yammer_ios_failed(message: *const c_char) {
    if let Some(app) = APP.get() {
        say(app, CStr::from_ptr(message).to_string_lossy().into_owned(), true);
    }
}
