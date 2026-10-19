//! Yammer: hold a hotkey anywhere, speak, and the transcript is pasted
//! where your cursor is. This crate is the OS shell (hotkey, microphone,
//! tray, overlay, paste); `voice-core` holds the platform-free logic.

mod commands;
mod dictation;
#[cfg(target_os = "macos")]
mod dock;
mod error;
mod hotkey;
mod overlay;
#[cfg(target_os = "macos")]
mod panel;
mod paste;
mod platform;
mod recorder;
mod secrets;
mod sounds;
mod state;
mod tray;
mod whisper;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::dictation::{Dictation, Input};

pub fn run() {
    tauri::Builder::default()
        // Must come first: a second launch hands its arguments to this instance and exits.
        // `yammer --toggle` is how Wayland users bind a system shortcut to dictation.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|a| a == "--toggle") {
                app.state::<Dictation>().send(Input::Toggle);
            } else {
                tray::show_main(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(hotkey::on_event).build())
        .manage(whisper::Whisper::default())
        .manage(hotkey::Hotkey::default())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            adopt_larp_dir(&config_dir);
            adopt_larp_dir(&data_dir);
            secrets::init(&config_dir);
            app.manage(state::AppState::new(config_dir, data_dir)?);
            app.manage(dictation::spawn(app.handle().clone()));

            let settings = app.state::<state::AppState>().settings();
            overlay::create(app.handle())?;
            overlay::set_always_visible(app.handle(), settings.overlay_always_visible);
            tray::create(app.handle(), &settings.hotkey)?;
            if let Err(e) = hotkey::register(app.handle(), &settings.hotkey) {
                eprintln!("{e}");
            }
            commands::preload(app.handle());

            // No Dock icon until the main window opens (dock::show).
            #[cfg(target_os = "macos")]
            {
                dock::show(app.handle(), false);
                dock::dedupe_recents(app.handle());
                if let Some(window) = app.get_webview_window("main") {
                    dock::follow_minimize(&window);
                }
            }

            // Launched at login → stay in the tray. Otherwise, or before setup is done, show the window.
            let hidden = std::env::args().any(|a| a == "--hidden");
            if !hidden || !settings.onboarded {
                tray::show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the window keeps the app running in the tray.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                dock::show(window.app_handle(), false);
            }
            #[cfg(target_os = "macos")]
            WindowEvent::ThemeChanged(theme) => dock::set_icon(*theme),
            WindowEvent::Moved(pos) if window.label() == overlay::LABEL => overlay::moved(window.app_handle(), *pos),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings_get,
            commands::settings_set,
            commands::overlay_state,
            commands::overlay_hit_areas,
            commands::overlay_reset_position,
            commands::overlay_toggle_dictation,
            commands::overlay_open,
            commands::hotkey_label,
            commands::hotkey_suspend,
            commands::hotkey_error,
            commands::mic_devices,
            commands::secret_status,
            commands::secret_set,
            commands::history_list,
            commands::history_delete,
            commands::history_clear,
            commands::copy_text,
            commands::text_rewrite,
            commands::platform_info,
            commands::autostart_get,
            commands::autostart_set,
            commands::open_permission_settings,
            commands::models_dir,
            whisper::models_list,
            whisper::model_download,
            whisper::model_delete,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Yammer")
        .run(|app, event| match event {
            // Keep running in the tray when the last window is hidden or closed.
            tauri::RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
            // Every way out (tray Quit, Dock Quit, logout) passes here before exit() runs C++ destructors.
            tauri::RunEvent::Exit => app.state::<whisper::Whisper>().unload(),
            // After Tauri's own startup icon (dev builds set one on Ready), so ours wins.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Ready => {
                if let Some(window) = app.get_webview_window("main") {
                    dock::set_icon(window.theme().unwrap_or(tauri::Theme::Light));
                }
            }
            // Clicking the Dock icon brings back the hidden window.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => tray::show_main(app),
            _ => {}
        });
}

/// Yammer was called Larp (bundle id `com.sush.larp`), and the app's folders are named after the bundle id.
/// On the first launch after the rename, move Larp's folder into place so settings, history and the
/// downloaded whisper models carry over. On macOS and Windows config and data share one folder, so the
/// second call finds nothing left to move.
fn adopt_larp_dir(dir: &std::path::Path) {
    let old = dir.with_file_name("com.sush.larp");
    if dir.exists() || !old.is_dir() {
        return;
    }
    if let Err(e) = std::fs::rename(&old, dir) {
        eprintln!("couldn't move {} to {}: {e}", old.display(), dir.display());
    }
}
