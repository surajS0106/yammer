//! Commands the settings window calls. Mirrored in `src/lib/tauri.ts`.

use std::collections::BTreeMap;

#[cfg(desktop)]
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(desktop)]
use tauri_plugin_autostart::ManagerExt;
use voice_core::history::Entry;
use voice_core::scratchpad::{self, Note};
#[cfg(desktop)]
use voice_core::settings::Engine;
use voice_core::settings::NoteTemplate;
use voice_core::Settings;

#[cfg(desktop)]
use crate::dictation::{Dictation, Input, Mode};
use crate::error::{AppError, AppResult};
#[cfg(desktop)]
use crate::hotkey::{self, Hotkey};
use crate::meeting::{self, Meetings};
use crate::overlay::{self, OverlayState};
use crate::state::AppState;
#[cfg(desktop)]
use crate::whisper::{self, Whisper};
#[cfg(desktop)]
use crate::{paste, recorder, tray};
use crate::{pipeline, platform, secrets};
use voice_core::meetings::{Hit, Meeting, Overview};

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Settings {
    state.settings()
}

/// What the overlay pill shows now; it may load after the last event was sent.
#[tauri::command]
pub fn overlay_state() -> OverlayState {
    overlay::current()
}

#[cfg(desktop)]
/// Sushi and the pill, which take the mouse so the overlay can be dragged.
#[tauri::command]
pub fn overlay_hit_areas(app: AppHandle, areas: Vec<overlay::HitArea>) {
    overlay::set_hit_areas(&app, areas);
}

#[cfg(desktop)]
/// Put the dragged pill back at the bottom centre of the screen.
#[tauri::command]
pub fn overlay_reset_position(app: AppHandle) {
    overlay::reset_position(&app);
}

#[cfg(desktop)]
/// The hovered island's buttons: start or stop dictating, without taking focus
/// from the app the text goes into.
#[tauri::command]
pub fn overlay_toggle_dictation(app: AppHandle) {
    app.state::<Dictation>().send(Input::Toggle(Mode::Dictate));
}

#[cfg(desktop)]
/// The failed card's Retry: transcribe history entry `id` again and paste it.
#[tauri::command]
pub fn overlay_retry(app: AppHandle, id: u64) {
    app.state::<Dictation>().send(Input::Retry(id));
}

#[cfg(desktop)]
/// Open the settings window at `page` ("home", "history", …).
#[tauri::command]
pub fn overlay_open(app: AppHandle, page: String) {
    tray::show_main(&app);
    let _ = app.emit_to("main", "navigate", page);
}

#[cfg(desktop)]
/// The overlay's right-click menu: "Hide the pill".
#[tauri::command]
pub fn overlay_hide(app: AppHandle) {
    overlay::hide_pill(&app);
}

#[cfg(desktop)]
/// The transcript card closed: its timer ran out, or its close or Copy button was clicked.
#[tauri::command]
pub fn overlay_dismiss(app: AppHandle) {
    overlay::dismiss(&app);
}

/// The overlay's new-words card: add `add` to the Dictionary and never offer `ignore` again.
#[tauri::command]
pub fn dictionary_add(app: AppHandle, state: State<'_, AppState>, add: Vec<String>, ignore: Vec<String>) -> AppResult<()> {
    let settings = {
        let mut settings = state.settings.lock().unwrap();
        settings.add_vocabulary(&add);
        settings.ignore_words(&ignore);
        settings.clone()
    };
    settings.save(&state.settings_path)?;
    let _ = app.emit("settings-changed", &settings);
    Ok(())
}

#[cfg(desktop)]
/// The overlay's right-click menu: "Quit Yammer".
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(desktop)]
/// The dictation hotkey as the island's tooltip shows it, e.g. "⌘⇧Space".
#[tauri::command]
pub fn hotkey_label(state: State<'_, AppState>) -> String {
    hotkey::display(&state.settings().hotkey)
}

/// Save new settings. Hotkeys that can't be registered are rejected and the
/// old ones stay.
#[tauri::command]
pub fn settings_set(app: AppHandle, settings: Settings) -> AppResult<Settings> {
    apply(&app, settings)
}

/// Save new settings and put them into effect, from Settings or the tray.
pub fn apply(app: &AppHandle, settings: Settings) -> AppResult<Settings> {
    let state = app.state::<AppState>();
    let old = state.settings();
    #[cfg(desktop)]
    if !hotkey::same(&settings, &old) {
        if let Err(e) = hotkey::register(app, &settings) {
            let _ = hotkey::register(app, &old);
            return Err(e);
        }
    }
    settings.save(&state.settings_path)?;
    *state.settings.lock().unwrap() = settings.clone();
    #[cfg(desktop)]
    {
        if settings.overlay_always_visible != old.overlay_always_visible {
            overlay::set_always_visible(app, settings.overlay_always_visible);
        }
        if settings.overlay_position != old.overlay_position {
            overlay::place(app);
        }
        if settings.engine == Engine::Local && (old.engine != Engine::Local || old.local_model != settings.local_model) {
            preload(app);
        }
    }
    if (settings.history_days, settings.keep_recordings) != (old.history_days, old.keep_recordings) {
        let pruned = state.history.lock().unwrap().prune(crate::state::now_ms(), settings.history_days, settings.keep_recordings as usize);
        if let Err(e) = pruned {
            eprintln!("couldn't drop old history: {e}");
        }
    }
    #[cfg(desktop)]
    tray::refresh(app);
    let _ = app.emit("settings-changed", &settings);
    Ok(settings)
}

#[cfg(desktop)]
/// Load the local model in the background, so the first dictation doesn't wait for it.
pub fn preload(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.settings();
    if settings.engine != Engine::Local || !whisper::is_downloaded(&state.models_dir, &settings.local_model) {
        return;
    }
    let dir = state.models_dir.clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = app.state::<Whisper>().context(&dir, &settings.local_model) {
            eprintln!("preloading the speech model failed: {e}");
        }
    });
}

#[cfg(desktop)]
/// Release the global hotkeys while the UI listens for a new one.
#[tauri::command]
pub fn hotkey_suspend(app: AppHandle, state: State<'_, AppState>, suspended: bool) -> AppResult<()> {
    hotkey::suspend(&app, suspended, &state.settings())
}

#[cfg(desktop)]
#[tauri::command]
pub fn hotkey_error(hotkey: State<'_, Hotkey>) -> Option<String> {
    hotkey.error.lock().unwrap().clone()
}

#[cfg(desktop)]
#[tauri::command]
pub async fn mic_devices() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(recorder::input_devices).await.unwrap_or_default()
}

/// Which keys are saved; the values never leave Rust.
#[tauri::command]
pub fn secret_status() -> AppResult<BTreeMap<String, bool>> {
    secrets::NAMES.iter().map(|n| Ok((n.to_string(), secrets::get(n)?.is_some()))).collect()
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> AppResult<()> {
    secrets::set(&name, &value)
}

#[tauri::command]
pub fn history_list(state: State<'_, AppState>) -> Vec<Entry> {
    state.history.lock().unwrap().entries().to_vec()
}

#[tauri::command]
pub fn history_delete(state: State<'_, AppState>, id: u64) -> AppResult<()> {
    Ok(state.history.lock().unwrap().delete(id)?)
}

#[tauri::command]
pub fn history_clear(state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.history.lock().unwrap().clear()?)
}

/// History's "Transcribe again": redo a kept recording with the current settings. Emits `history-updated` too.
#[tauri::command]
pub async fn history_retry(app: AppHandle, id: u64) -> AppResult<Entry> {
    pipeline::retry(&app, id).await
}

/// Write `contents` to `name` in Downloads (a number added if it's taken), show
/// it in the file manager, and return where it went.
#[tauri::command]
pub fn export_file(app: AppHandle, name: String, contents: String) -> AppResult<String> {
    let dir = app.path().download_dir().or_else(|_| app.path().document_dir())?;
    let name = std::path::Path::new(&name).file_name().ok_or_else(|| AppError::Invalid("That isn't a file name.".into()))?.to_owned();
    let (stem, ext) = {
        let p = std::path::Path::new(&name);
        (
            p.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
            p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default(),
        )
    };
    let mut path = dir.join(&name);
    for n in 2.. {
        if !path.exists() {
            break;
        }
        path = dir.join(format!("{stem} ({n}){ext}"));
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&path, contents)?;
    #[cfg(desktop)]
    if let Err(e) = tauri_plugin_opener::reveal_item_in_dir(&path) {
        eprintln!("couldn't show the export: {e}");
    }
    Ok(path.display().to_string())
}

/// Start transcribing a meeting. Resolves once it's listening.
#[tauri::command]
/// `event` (`Event::key`): the calendar event it's for, from "Start notes" on it; else the one under way.
pub async fn meeting_start(app: AppHandle, event: Option<String>) -> AppResult<meeting::LiveInfo> {
    app.state::<crate::calendar::Calendar>().choose(event);
    meeting::start(&app).await
}

/// Stop the meeting; resolves to it, transcribed to the end. Its notes follow as `meeting-updated`.
#[tauri::command]
pub async fn meeting_stop(app: AppHandle) -> AppResult<Option<Meeting>> {
    meeting::stop(&app).await
}

/// The overlay's menu: start or stop, reporting errors on the overlay.
#[tauri::command]
pub fn meeting_toggle(app: AppHandle) {
    meeting::toggle(&app);
}

#[tauri::command]
pub fn meeting_status(meetings: State<'_, Meetings>) -> meeting::Status {
    meetings.status()
}

#[tauri::command]
pub fn meetings_list(meetings: State<'_, Meetings>) -> Vec<Overview> {
    meetings.list()
}

#[tauri::command]
pub fn meeting_get(meetings: State<'_, Meetings>, id: u64) -> AppResult<Meeting> {
    meetings.get(id)
}

/// Rename a meeting, change the notes typed during it, edit the notes written from it, or clear its Ask thread.
#[tauri::command]
pub fn meeting_update(
    meetings: State<'_, Meetings>,
    id: u64,
    title: Option<String>,
    notes: Option<String>,
    summary: Option<String>,
    clear_chat: Option<bool>,
) -> AppResult<Meeting> {
    meetings.update(id, |m| {
        if clear_chat == Some(true) {
            m.chat.clear();
        }
        if let Some(title) = title {
            m.title = title.trim().to_string();
        }
        if let Some(notes) = notes {
            m.notes = notes;
        }
        if let Some(summary) = summary {
            m.summary = Some(summary);
        }
    })
}

/// Pick the template a meeting's notes will be written with, without writing them: from the
/// live view or the pill's menu. Sent as `meeting-updated`, so the other window follows.
#[tauri::command]
pub fn meeting_set_template(app: AppHandle, meetings: State<'_, Meetings>, id: u64, template: String) -> AppResult<Meeting> {
    let saved = meetings.update(id, |m| m.template = Some(template).filter(|t| !t.trim().is_empty()))?;
    let _ = app.emit("meeting-updated", &saved);
    Ok(saved)
}

#[tauri::command]
pub fn meeting_delete(meetings: State<'_, Meetings>, id: u64) -> AppResult<()> {
    meetings.delete(id)
}

#[cfg(desktop)]
/// A call card's buttons, or its countdown running out: `id` is the card's.
#[tauri::command]
pub fn call_answer(app: AppHandle, id: u64, answer: crate::calls::Answer) {
    crate::calls::answer(&app, id, answer);
}

/// Write (or rewrite) a meeting's notes with the AI cleanup model, with `template` if given.
/// A meeting in progress gets notes of what's been said so far.
#[tauri::command]
pub async fn meeting_summarize(app: AppHandle, id: u64, template: Option<String>) -> AppResult<Meeting> {
    meeting::summarize(&app, id, template).await
}

/// Rewrite a meeting's written notes as asked ("make it shorter").
#[tauri::command]
pub async fn meeting_revise(app: AppHandle, id: u64, request: String) -> AppResult<Meeting> {
    meeting::revise(&app, id, &request).await
}

/// Ask a question about a meeting; resolves to the meeting with the question and answer added to its thread.
#[tauri::command]
pub async fn meeting_ask(app: AppHandle, id: u64, question: String) -> AppResult<Meeting> {
    meeting::ask(&app, id, &question).await
}

/// Take lines out of a meeting's transcript.
#[tauri::command]
pub fn meeting_delete_segments(app: AppHandle, meetings: State<'_, Meetings>, id: u64, segments: Vec<String>) -> AppResult<Meeting> {
    let saved = meetings.update(id, |m| {
        m.delete_segments(&segments);
    })?;
    let _ = app.emit("meeting-updated", &saved);
    Ok(saved)
}

#[tauri::command]
pub fn meeting_search(meetings: State<'_, Meetings>, query: String) -> Vec<Hit> {
    meetings.search(&query)
}

/// The calendar: whether it's connected, and its events for the week ahead.
#[tauri::command]
pub fn calendar_status(calendar: State<'_, crate::calendar::Calendar>) -> crate::calendar::Status {
    calendar.status()
}

/// Save the calendar's secret iCal address (checked first), or forget it with an empty one.
#[tauri::command]
pub async fn calendar_connect(app: AppHandle, url: String) -> AppResult<crate::calendar::Status> {
    crate::calendar::connect(&app, &url).await
}

#[tauri::command]
pub async fn calendar_refresh(app: AppHandle) -> crate::calendar::Status {
    crate::calendar::refresh(&app).await
}

/// Every note template: Yammer's own, then the user's.
#[tauri::command]
pub fn meeting_templates(state: State<'_, AppState>) -> Vec<NoteTemplate> {
    state.settings().meeting.all_templates()
}

#[tauri::command]
pub fn scratchpad_list(state: State<'_, AppState>) -> Vec<Note> {
    scratchpad::load(&state.scratchpad_path)
}

#[tauri::command]
pub fn scratchpad_save(state: State<'_, AppState>, notes: Vec<Note>) -> AppResult<()> {
    Ok(scratchpad::save(&state.scratchpad_path, &notes)?)
}

/// Rewrite `text` by `instructions` with the cleanup model (a Transform run from the Scratchpad).
#[tauri::command]
pub async fn text_rewrite(state: State<'_, AppState>, text: String, instructions: String) -> AppResult<String> {
    let settings = state.settings();
    let key = secrets::cleanup(&settings)?;
    let out = voice_core::cleanup::rewrite(&settings.cleanup, key.as_deref(), &state.http, &settings.vocabulary, &instructions, &text).await?;
    Ok(voice_core::text::apply(&out, &settings.replacements, &[]))
}

#[cfg(desktop)]
#[tauri::command]
pub fn copy_text(text: String) -> AppResult<()> {
    paste::copy(&text)
}

#[tauri::command]
pub fn platform_info(app: tauri::AppHandle) -> platform::Platform {
    platform::info(app.package_info().version.to_string())
}

#[cfg(desktop)]
#[tauri::command]
pub fn autostart_get(app: AppHandle) -> AppResult<bool> {
    app.autolaunch().is_enabled().map_err(AppError::because("Couldn't check whether Yammer starts with your computer."))
}

#[cfg(desktop)]
#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> AppResult<()> {
    let launcher = app.autolaunch();
    if enabled { launcher.enable() } else { launcher.disable() }
        .map_err(AppError::because("Couldn't change whether Yammer starts with your computer. Try again."))
}

#[cfg(desktop)]
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionPane {
    Microphone,
    Accessibility,
}

#[cfg(desktop)]
/// Open the OS settings page where the user grants a permission (macOS).
#[tauri::command]
pub fn open_permission_settings(pane: PermissionPane) -> AppResult<()> {
    let url = match pane {
        PermissionPane::Microphone => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        PermissionPane::Accessibility => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    };
    if !cfg!(target_os = "macos") {
        return Err(AppError::Invalid("Only macOS has these permission settings.".into()));
    }
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(AppError::because("Couldn't open System Settings. Open it yourself and go to Privacy & Security."))
}

#[cfg(desktop)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsDir {
    path: String,
}

#[cfg(desktop)]
#[tauri::command]
pub fn models_dir(state: State<'_, AppState>) -> ModelsDir {
    ModelsDir { path: state.models_dir.display().to_string() }
}
