//! The Android shell. Kotlin (`gen/android/.../com/sush/yammer`) owns the
//! microphone, the Sushi bubble and pasting; this hands a finished recording
//! to the shared pipeline and answers the webview.
//!
//! The foreground service keeps running after the activity is gone, so it
//! calls in over JNI (`YammerNative.kt`) rather than through the Tauri plugin,
//! which needs the activity. The plugin is only for the settings UI.

use std::sync::OnceLock;

use jni::objects::{JObject, JShortArray};
use jni::sys::{jfloat, jint, jstring};
use jni::JNIEnv;
use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Wry};
use voice_core::audio;

use crate::error::{AppError, AppResult};
use crate::mobile::{self, Dictated};
use crate::overlay::OverlayState;
use crate::state::AppState;
use crate::{commands, secrets};

static APP: OnceLock<AppHandle> = OnceLock::new();

struct Native(PluginHandle<Wry>);

fn native_plugin() -> TauriPlugin<Wry> {
    Builder::new("yammer-android")
        .setup(|app, api| {
            app.manage(Native(api.register_android_plugin("com.sush.yammer", "YammerPlugin")?));
            Ok(())
        })
        .build()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(native_plugin())
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
            android_status,
            android_action,
            android_share,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Yammer")
        .run(|_, event| {
            // Swiping the app away destroys its only window, and Tauri would then exit the
            // process, taking the foreground service and Sushi with it.
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
                api.prevent_exit();
            }
        });
}

// ---- Commands for the settings UI ----

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    mic: bool,
    overlay: bool,
    accessibility: bool,
    notifications: bool,
    /// The foreground service is up, so Sushi can start a recording.
    running: bool,
    recording: bool,
}

#[tauri::command]
async fn android_status(native: tauri::State<'_, Native>) -> AppResult<Status> {
    native.0.run_mobile_plugin("status", ()).map_err(AppError::invalid)
}

/// Ask the Kotlin side to do something the settings UI offers.
#[tauri::command]
async fn android_action(native: tauri::State<'_, Native>, action: String) -> AppResult<()> {
    const ACTIONS: &[&str] = &[
        "requestMic",
        "requestNotifications",
        "openOverlaySettings",
        "openAccessibilitySettings",
        "openAppSettings",
        "startBubble",
        "stopBubble",
        "toggle",
        "barsLight",
        "barsDark",
    ];
    if !ACTIONS.contains(&action.as_str()) {
        return Err(AppError::Invalid(format!("unknown action {action}")));
    }
    native.0.run_mobile_plugin::<serde_json::Value>(&action, ()).map(drop).map_err(AppError::invalid)
}

#[derive(Serialize)]
struct CopyArgs {
    text: String,
}

#[tauri::command]
async fn copy_text(native: tauri::State<'_, Native>, text: String) -> AppResult<()> {
    native.0.run_mobile_plugin::<serde_json::Value>("copyText", CopyArgs { text }).map(drop).map_err(AppError::invalid)
}

#[derive(Serialize)]
struct ShareArgs {
    name: String,
    contents: String,
}

/// Hand a file to Android's share sheet: a phone's files aren't somewhere you go and look.
#[tauri::command]
async fn android_share(native: tauri::State<'_, Native>, name: String, contents: String) -> AppResult<()> {
    native
        .0
        .run_mobile_plugin::<serde_json::Value>("shareFile", ShareArgs { name, contents })
        .map(drop)
        .map_err(AppError::invalid)
}

// ---- Called by the Kotlin service, on its own threads (YammerNative.kt) ----

/// `pcm` is mono 16-bit at `rate` Hz. Blocks until the text is ready, so call it off the main thread.
#[no_mangle]
pub extern "system" fn Java_com_sush_yammer_YammerNative_process<'l>(
    mut env: JNIEnv<'l>,
    _this: JObject<'l>,
    pcm: JShortArray<'l>,
    rate: jint,
) -> jstring {
    let result = match (APP.get(), read_pcm(&mut env, &pcm)) {
        (Some(app), Ok(pcm)) => {
            let floats: Vec<f32> = pcm.iter().map(|&s| s as f32 / 32768.0).collect();
            let samples = audio::to_whisper(&floats, 1, rate as u32);
            let done = tauri::async_runtime::block_on(mobile::dictate(app, samples));
            crate::overlay::show(app, OverlayState::Hidden);
            done
        }
        (None, _) => Dictated::Failed { error: "Open Yammer once, then try again.".into() },
        (_, Err(e)) => Dictated::Failed { error: format!("Couldn't read the recording: {e}") },
    };
    let json = serde_json::to_string(&result).unwrap_or_else(|_| r#"{"kind":"nothing"}"#.into());
    env.new_string(json).map_or(std::ptr::null_mut(), |s| s.into_raw())
}

fn read_pcm(env: &mut JNIEnv, pcm: &JShortArray) -> jni::errors::Result<Vec<i16>> {
    let mut out = vec![0i16; env.get_array_length(pcm)? as usize];
    env.get_short_array_region(pcm, 0, &mut out)?;
    Ok(out)
}

/// Recording started or was thrown away, for the webview's status.
#[no_mangle]
pub extern "system" fn Java_com_sush_yammer_YammerNative_recording(_env: JNIEnv, _this: JObject, on: jni::sys::jboolean) {
    if let Some(app) = APP.get() {
        crate::overlay::show(app, if on != 0 { OverlayState::Listening { hint: None } } else { OverlayState::Hidden });
    }
}

/// Microphone level, 0..1 RMS, for Sushi on Home.
#[no_mangle]
pub extern "system" fn Java_com_sush_yammer_YammerNative_level(_env: JNIEnv, _this: JObject, rms: jfloat) {
    if let Some(app) = APP.get() {
        let _ = app.emit("level", rms);
    }
}
