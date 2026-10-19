//! The tray (menu bar) icon: the app's home while its window is closed.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::dictation::{Dictation, Input};

pub fn create(app: &AppHandle, hotkey: &str) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Start / stop dictation", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Yammer", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(format!("Yammer: hold {} to dictate", crate::hotkey::display(hotkey)))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => app.state::<Dictation>().send(Input::Toggle),
            "settings" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
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

pub fn set_tooltip(app: &AppHandle, hotkey: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("Yammer: hold {} to dictate", crate::hotkey::display(hotkey))));
    }
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
