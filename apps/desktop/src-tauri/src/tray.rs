//! The tray (menu bar) icon: the app's home while its window is closed. Its
//! menu switches the transform, language and engine without opening Settings,
//! and is rebuilt (`refresh`) whenever the settings change.

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use voice_core::settings::{Engine, LANGUAGES};
use voice_core::Settings;

use crate::dictation::{Dictation, Input, Mode};
use crate::state::AppState;

pub fn create(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(tooltip(&settings.hotkey))
        .menu(&menu(app, settings)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn menu(app: &AppHandle, settings: &Settings) -> tauri::Result<Menu<Wry>> {
    let check = |id: String, label: &str, checked: bool| CheckMenuItem::with_id(app, id, label, true, checked, None::<&str>);
    let submenu = |label: &str, enabled: bool, items: &[CheckMenuItem<Wry>]| {
        let items: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
        Submenu::with_items(app, label, enabled, &items)
    };

    let active = settings.active().map(|t| t.id.as_str()).unwrap_or("");
    let mut transforms = vec![check("transform:".into(), "None", active.is_empty())?];
    for t in &settings.transforms {
        transforms.push(check(format!("transform:{}", t.id), &t.name, t.id == active)?);
    }

    let english_only = settings.engine == Engine::Local && voice_core::models::find(&settings.local_model).is_some_and(|m| m.english_only);
    let languages = LANGUAGES
        .iter()
        .map(|(code, name)| check(format!("language:{code}"), name, *code == settings.language))
        .collect::<tauri::Result<Vec<_>>>()?;

    let label = |engine| Settings { engine, ..settings.clone() }.engine_label();
    let engines = [
        check("engine:local".into(), &label(Engine::Local), settings.engine == Engine::Local)?,
        check("engine:cloud".into(), &label(Engine::Cloud), settings.engine == Engine::Cloud)?,
    ];

    let toggle = MenuItem::with_id(app, "toggle", "Start / stop dictation", true, None::<&str>)?;
    let transform = submenu("Transform", true, &transforms)?;
    let language = submenu(if english_only { "Language (English-only model)" } else { "Language" }, !english_only, &languages)?;
    let engine = submenu("Speech engine", true, &engines)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Yammer", true, None::<&str>)?;
    let separator = || PredefinedMenuItem::separator(app);
    Menu::with_items(app, &[&toggle, &separator()?, &transform, &language, &engine, &separator()?, &settings_item, &separator()?, &quit])
}

fn on_menu(app: &AppHandle, id: &str) {
    let mut settings = app.state::<AppState>().settings();
    if let Some(transform) = id.strip_prefix("transform:") {
        settings.active_transform = transform.into();
    } else if let Some(code) = id.strip_prefix("language:") {
        settings.language = code.into();
    } else if let Some(engine) = id.strip_prefix("engine:") {
        settings.engine = if engine == "cloud" { Engine::Cloud } else { Engine::Local };
    } else {
        match id {
            "toggle" => app.state::<Dictation>().send(Input::Toggle(Mode::Dictate)),
            "settings" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        }
        return;
    }
    // `apply` rebuilds the menu. A check item ticks itself when clicked, so put it back if the change failed.
    if let Err(e) = crate::commands::apply(app, settings) {
        eprintln!("couldn't change the setting from the tray: {e}");
        refresh(app);
    }
}

/// Rebuild the menu and tooltip from the current settings.
pub fn refresh(app: &AppHandle) {
    let settings = app.state::<AppState>().settings();
    let Some(tray) = app.tray_by_id("main") else { return };
    let _ = tray.set_tooltip(Some(tooltip(&settings.hotkey)));
    match menu(app, &settings) {
        Ok(menu) => drop(tray.set_menu(Some(menu))),
        Err(e) => eprintln!("couldn't rebuild the tray menu: {e}"),
    }
}

fn tooltip(hotkey: &str) -> String {
    format!("Yammer: hold {} to dictate", crate::hotkey::display(hotkey))
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        crate::dock::show(app, true);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
