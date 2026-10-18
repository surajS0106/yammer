//! Larp: hold a hotkey anywhere, speak, and the transcript is pasted
//! where your cursor is. This crate is the OS shell (hotkey, microphone,
//! tray, overlay, paste); `voice-core` holds the platform-free logic.

mod commands;
mod dictation;
mod error;
mod hotkey;
mod overlay;
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
        // `larp --toggle` is how Wayland users bind a system shortcut to dictation.
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
            secrets::init(&config_dir);
            app.manage(state::AppState::new(config_dir, data_dir)?);
            app.manage(dictation::spawn(app.handle().clone()));

            // A menu-bar app on macOS: no Dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let settings = app.state::<state::AppState>().settings();
            overlay::create(app.handle())?;
            overlay::set_always_visible(app.handle(), settings.overlay_always_visible);
            tray::create(app.handle(), &settings.hotkey)?;
            if let Err(e) = hotkey::register(app.handle(), &settings.hotkey) {
                eprintln!("{e}");
            }
            commands::preload(app.handle());

            // Launched at login → stay in the tray. Otherwise, or before setup is done, show the window.
            let hidden = std::env::args().any(|a| a == "--hidden");
            if !hidden || !settings.onboarded {
                tray::show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the app running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings_get,
            commands::settings_set,
            commands::overlay_state,
            commands::hotkey_suspend,
            commands::hotkey_error,
            commands::mic_devices,
            commands::secret_status,
            commands::secret_set,
            commands::history_list,
            commands::history_delete,
            commands::history_clear,
            commands::copy_text,
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
        .expect("error while building Larp")
        .run(|_app, event| {
            // Keep running in the tray when the last window is hidden or closed.
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
                api.prevent_exit();
            }
        });
}
