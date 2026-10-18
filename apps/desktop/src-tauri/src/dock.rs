//! macOS: the Dock icon shows only while the main window is open, and follows the
//! system light/dark setting. The bundled `icon.icns` is static (light), so Finder
//! and Launchpad keep showing that one.

use std::time::Duration;

use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;
use tauri::{ActivationPolicy, AppHandle, Manager, Theme};

const LIGHT: &[u8] = include_bytes!("../icons/macos-light.png");
const DARK: &[u8] = include_bytes!("../icons/macos-dark.png");

/// Call from the main thread (app setup and window events run there).
pub fn set_icon(theme: Theme) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let bytes = if matches!(theme, Theme::Dark) { DARK } else { LIGHT };
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)) else { return };
    let ns_app = NSApplication::sharedApplication(mtm);
    unsafe { ns_app.setApplicationIconImage(Some(&image)) };
    // The Dock doesn't always redraw the tile for a new image on its own.
    ns_app.dockTile().display();
}

/// Show or hide the Dock icon. macOS keeps a Dock app's windows off other apps'
/// full-screen Spaces, so Sushi's overlay can only follow you there while Larp is
/// an accessory app: with the main window closed, Larp lives in the menu bar.
pub fn show(app: &AppHandle, visible: bool) {
    let policy = if visible { ActivationPolicy::Regular } else { ActivationPolicy::Accessory };
    let _ = app.set_activation_policy(policy);
    if visible {
        // The Dock makes a new tile, with the binary's own icon, a moment after
        // the policy changes; an icon set before then is lost. So set the themed
        // one once the tile is there, and again in case the Dock was slow.
        let handle = app.clone();
        std::thread::spawn(move || {
            for delay in [300, 1200] {
                std::thread::sleep(Duration::from_millis(delay));
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let theme = app.get_webview_window("main").and_then(|w| w.theme().ok());
                    set_icon(theme.unwrap_or(Theme::Light));
                });
            }
        });
    }
}
