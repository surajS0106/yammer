//! macOS: the Dock icon follows the system light/dark setting while Larp runs.
//! The bundled `icon.icns` is static (light), so Finder and Launchpad keep showing that one.

use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;
use tauri::Theme;

const LIGHT: &[u8] = include_bytes!("../icons/macos-light.png");
const DARK: &[u8] = include_bytes!("../icons/macos-dark.png");

/// Call from the main thread (app setup and window events run there).
pub fn set_icon(theme: Theme) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let bytes = if matches!(theme, Theme::Dark) { DARK } else { LIGHT };
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)) else { return };
    unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image)) };
}
