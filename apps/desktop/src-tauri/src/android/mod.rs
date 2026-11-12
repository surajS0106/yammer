//! The Android shell. Kotlin (`gen/android/.../com/sush/yammer`) owns the
//! microphone, the Sushi bubble and pasting; this hands a finished recording
//! to the shared pipeline and answers the webview.
//!
//! The foreground service keeps running after the activity is gone, so it
//! calls in over JNI (`YammerNative.kt`) rather than through the Tauri plugin,
//! which needs the activity. The plugin is only for the settings UI, and for
//! starting a meeting's recording, which only the app's Meetings page does.

pub mod overlay;

use std::sync::{Arc, Mutex, OnceLock};

use jni::objects::{JByteArray, JObject, JShortArray};
use jni::sys::{jboolean, jfloat, jint, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;
use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Wry};
use voice_core::history::Entry;
use voice_core::settings::{CloudStt, Engine, SttApi};
use voice_core::{audio, Settings};

use crate::error::{AppError, AppResult};
use crate::meeting::{self, Meetings};
use crate::overlay::OverlayState;
use crate::pipeline::{self, Job};
use crate::state::AppState;
use crate::{commands, secrets};

const MIN_SPEECH_SAMPLES: usize = voice_core::SAMPLE_RATE as usize * 3 / 10;

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
            app.manage(Meetings::new(data_dir.join("meetings")));
            let state = AppState::new(config_dir, data_dir)?;
            secrets::migrate(&state.settings());
            cloud_only(&state)?;
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
            commands::meeting_start,
            commands::meeting_stop,
            commands::meeting_toggle,
            commands::meeting_status,
            commands::meetings_list,
            commands::meeting_get,
            commands::meeting_update,
            commands::meeting_delete,
            commands::meeting_summarize,
            copy_text,
            android_status,
            android_action,
            android_share,
            android_update_check,
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

/// Whisper isn't built for Android, so a phone always uses a cloud engine,
/// starting with Sarvam. Must match the Sarvam preset in `lib/presets.ts`.
/// A new install also keeps less than a computer does, since a phone is carried
/// around and lost: a month of History and the latest 10 recordings. Both are in Settings.
fn cloud_only(state: &AppState) -> AppResult<()> {
    let mut settings = state.settings.lock().unwrap();
    if settings.engine == Engine::Local {
        settings.engine = Engine::Cloud;
        if !settings.onboarded {
            settings.cloud =
                CloudStt { preset: "sarvam".into(), base_url: "https://api.sarvam.ai".into(), model: "saaras:v4".into(), api: SttApi::Sarvam };
            settings.history_days = 30;
            settings.keep_recordings = 10;
        }
        settings.save(&state.settings_path)?;
    }
    Ok(())
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

/// Android releases are `android-v*` on this repo. Must match `plugins.updater` in tauri.conf.json.
const RELEASES_URL: &str = "https://api.github.com/repos/surajS0106/yammer/releases?per_page=30";

/// A newer Android release than this one, for the "Upgrade now" card. Its APK opens in the browser,
/// and Android's installer takes it from there; installing it here would need the
/// install-packages permission, which Play doesn't allow.
#[tauri::command]
async fn android_update_check(app: AppHandle, state: tauri::State<'_, AppState>) -> AppResult<Option<voice_core::releases::AndroidRelease>> {
    let resp = state
        .http
        .get(RELEASES_URL)
        .header("User-Agent", "Yammer")
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(AppError::invalid)?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!("GitHub answered HTTP {}", resp.status().as_u16())));
    }
    let releases: serde_json::Value = resp.json().await.map_err(AppError::invalid)?;
    Ok(voice_core::releases::newer_android(&releases, &app.package_info().version.to_string()))
}

// ---- Called by the Kotlin service, on its own threads (YammerNative.kt) ----

/// How a recording ended, as JSON for the service.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum Dictated {
    Text { text: String, warning: Option<String> },
    Nothing,
    Failed { error: String },
}

async fn dictate(app: &AppHandle, samples: Vec<f32>) -> Dictated {
    if samples.len() < MIN_SPEECH_SAMPLES || audio::is_silent(&samples) {
        return Dictated::Nothing;
    }
    let settings = app.state::<AppState>().settings();
    let duration_ms = audio::duration_ms(samples.len());
    let samples: Arc<[f32]> = samples.into();
    let job = Job::dictate(&settings, None);
    crate::overlay::show(app, OverlayState::Transcribing { engine: settings.engine_label() });
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
            let done = tauri::async_runtime::block_on(dictate(app, samples));
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

// ---- A meeting's microphone ----

type OnAudio = Box<dyn Fn(Vec<f32>) + Send>;
type OnLevel = Box<dyn Fn(f32) + Send>;

/// Where `meetingAudio` hands the meeting's audio. `None` tells the service to stop recording.
static MEETING_SINK: Mutex<Option<(OnAudio, OnLevel)>> = Mutex::new(None);

/// A meeting's microphone, recorded by the Kotlin service (`YammerService.startMeeting`).
/// Stopping it ends the recording the next time the service hands over audio.
pub struct MeetingAudio;

impl MeetingAudio {
    pub fn stop(self) {}
}

impl Drop for MeetingAudio {
    fn drop(&mut self) {
        *MEETING_SINK.lock().unwrap() = None;
    }
}

/// Ask the service to record the meeting, starting it if it's off. `on_audio` gets 16 kHz mono
/// audio about ten times a second, and `on_level` its level, on the service's recording thread.
/// Blocks until the microphone is open. Only the app's own page starts a meeting, so the activity
/// the plugin needs is there, and a foreground service may still start.
pub fn meeting_audio(
    app: &AppHandle,
    on_audio: impl Fn(Vec<f32>) + Send + 'static,
    on_level: impl Fn(f32) + Send + 'static,
) -> AppResult<MeetingAudio> {
    *MEETING_SINK.lock().unwrap() = Some((Box::new(on_audio), Box::new(on_level)));
    let audio = MeetingAudio;
    app.state::<Native>().0.run_mobile_plugin::<serde_json::Value>("startMeeting", ()).map_err(AppError::invalid)?;
    Ok(audio)
}

/// The meeting's microphone audio: mono 16-bit at `rate` Hz. False once the meeting has stopped,
/// which tells the service to stop recording.
#[no_mangle]
pub extern "system" fn Java_com_sush_yammer_YammerNative_meetingAudio<'l>(
    mut env: JNIEnv<'l>,
    _this: JObject<'l>,
    pcm: JShortArray<'l>,
    rate: jint,
) -> jboolean {
    let sink = MEETING_SINK.lock().unwrap();
    let Some((on_audio, on_level)) = sink.as_ref() else { return JNI_FALSE };
    if let Ok(pcm) = read_pcm(&mut env, &pcm) {
        let floats: Vec<f32> = pcm.iter().map(|&s| s as f32 / 32768.0).collect();
        let samples = audio::to_whisper(&floats, 1, rate as u32);
        on_level(audio::rms(&samples));
        on_audio(samples);
    }
    JNI_TRUE
}

/// The notification's Stop button, or the service losing the microphone.
#[no_mangle]
pub extern "system" fn Java_com_sush_yammer_YammerNative_meetingStop(_env: JNIEnv, _this: JObject) {
    if let Some(app) = APP.get() {
        if meeting::is_live() {
            meeting::toggle(app);
        }
    }
}

/// The key for the API keys file, unwrapped by the Android Keystore (`Vault.kt`). Called before
/// Tauri starts, and again by the service; it's the same key each time.
#[no_mangle]
pub extern "system" fn Java_com_sush_yammer_YammerNative_unlock<'l>(env: JNIEnv<'l>, _this: JObject<'l>, key: JByteArray<'l>) {
    match env.convert_byte_array(&key).map(<[u8; 32]>::try_from) {
        Ok(Ok(key)) => secrets::unlock(key),
        _ => eprintln!("the keys file's key wasn't 32 bytes"),
    }
}
