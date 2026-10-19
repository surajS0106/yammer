//! macOS: the Dock icon shows only while the main window is open (not closed or
//! minimized), and follows the system light/dark setting. On macOS 26 the system
//! does that itself from the bundle's `Assets.car`, including the Clear and Tinted
//! icon styles, so the app leaves it alone there. Elsewhere (`tauri dev`, older
//! macOS) the bundle has only the static light `icon.icns`, so the running app
//! sets the matching Dock image itself.

use std::ptr::NonNull;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::AnyObject;
use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage, NSWindowDidDeminiaturizeNotification, NSWindowDidMiniaturizeNotification};
use objc2_foundation::{
    ns_string, NSBundle, NSData, NSNotification, NSNotificationCenter, NSOperatingSystemVersion, NSOperationQueue, NSProcessInfo,
};
use tauri::{ActivationPolicy, App, AppHandle, Manager, Theme, WebviewWindow};

const LIGHT: &[u8] = include_bytes!("../icons/macos-light.png");
const DARK: &[u8] = include_bytes!("../icons/macos-dark.png");

/// Call from the main thread (app setup and window events run there).
pub fn set_icon(theme: Theme) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    if system_swaps_icon() {
        return;
    }
    let bytes = if matches!(theme, Theme::Dark) { DARK } else { LIGHT };
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)) else { return };
    let ns_app = NSApplication::sharedApplication(mtm);
    unsafe { ns_app.setApplicationIconImage(Some(&image)) };
    // The Dock doesn't always redraw the tile for a new image on its own.
    ns_app.dockTile().display();
}

/// Whether macOS already switches the icon: 26+ with an asset-catalog icon (`CFBundleIconName`).
/// Setting an image over it would pin one look and ignore the user's icon style.
fn system_swaps_icon() -> bool {
    let tahoe = NSOperatingSystemVersion { majorVersion: 26, minorVersion: 0, patchVersion: 0 };
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(tahoe)
        && NSBundle::mainBundle().objectForInfoDictionaryKey(ns_string!("CFBundleIconName")).is_some()
}

/// Start as an accessory app, so launching adds no Dock tile until `show` does. tao otherwise makes the
/// app Regular as it finishes launching, before `setup` runs, and the Dock answered that tile going on,
/// off and on again within a moment with a second Yammer tile. Must be called before `App::run`; the
/// bundle's `LSUIElement` keeps macOS from adding a tile even earlier, at exec.
pub fn start_hidden(mut app: App) -> App {
    app.set_activation_policy(ActivationPolicy::Accessory);
    app
}

/// Show or hide the Dock icon. macOS keeps a Dock app's windows off other apps'
/// full-screen Spaces, so Sushi's overlay can only follow you there while Yammer is
/// an accessory app: with the main window closed, Yammer lives in the menu bar.
pub fn show(app: &AppHandle, visible: bool) {
    let policy = if visible { ActivationPolicy::Regular } else { ActivationPolicy::Accessory };
    let _ = app.set_activation_policy(policy);
    if visible {
        // The Dock makes a new tile, with the binary's own icon, a moment after
        // the policy changes; an icon set before then is lost. So set the themed
        // one once the tile is there, and again in case the Dock was slow.
        let handle = app.clone();
        let id = app.config().identifier.clone();
        std::thread::spawn(move || {
            for delay in [300, 1200] {
                std::thread::sleep(Duration::from_millis(delay));
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let theme = app.get_webview_window("main").and_then(|w| w.theme().ok());
                    set_icon(theme.unwrap_or(Theme::Light));
                });
            }
            // After a reinstall the Dock may not match the new bundle to its old tile and add a
            // second one only now, after the startup check has run, so check again.
            if let Err(e) = remove_duplicate_tiles(&id) {
                eprintln!("dock: couldn't check for duplicate tiles: {e}");
            }
        });
    }
}

/// The Dock sometimes keeps two "recent app" tiles for Yammer, both pointing at the
/// same bundle. Builds before `start_hidden` and `LSUIElement` made them at launch,
/// and they stay in the Dock's preferences after the update. Only one of them is the
/// running app; the other never goes away on its own.
/// At startup, and again each time the Dock icon appears (`show`), keep the first
/// Yammer tile and drop the rest. The Dock rereads its
/// preferences only on restart, so it's restarted, but only when a duplicate
/// was actually found.
pub fn dedupe_recents(app: &AppHandle) {
    let id = app.config().identifier.clone();
    std::thread::spawn(move || {
        if let Err(e) = remove_duplicate_tiles(&id) {
            eprintln!("dock: couldn't check for duplicate tiles: {e}");
        }
    });
}

fn remove_duplicate_tiles(id: &str) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let out = Command::new("/usr/bin/defaults").args(["export", "com.apple.dock", "-"]).output()?;
    let mut prefs = plist::Value::from_reader_xml(out.stdout.as_slice())?;
    let Some(recents) = prefs.as_dictionary_mut().and_then(|d| d.get_mut("recent-apps")).and_then(|v| v.as_array_mut()) else {
        return Ok(());
    };
    let is_yammer = |tile: &plist::Value| {
        tile.as_dictionary()
            .and_then(|t| t.get("tile-data"))
            .and_then(|d| d.as_dictionary())
            .and_then(|d| d.get("bundle-identifier"))
            .and_then(|b| b.as_string())
            == Some(id)
    };
    let before = recents.len();
    let mut seen = false;
    recents.retain(|tile| !is_yammer(tile) || !std::mem::replace(&mut seen, true));
    if recents.len() == before {
        return Ok(());
    }

    let mut xml = Vec::new();
    prefs.to_writer_xml(&mut xml)?;
    let mut import = Command::new("/usr/bin/defaults").args(["import", "com.apple.dock", "-"]).stdin(Stdio::piped()).spawn()?;
    import.stdin.take().ok_or("no stdin")?.write_all(&xml)?;
    if !import.wait()?.success() {
        return Err("defaults import failed".into());
    }
    Command::new("/usr/bin/killall").arg("Dock").status()?;
    Ok(())
}

/// Minimizing the main window counts as closing it for the Dock, so Sushi stays
/// on full-screen apps while it's minimized; un-minimizing brings the icon back.
/// Tauri has no minimize event, so this listens for AppKit's notifications.
pub fn follow_minimize(window: &WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window = unsafe { &*ptr.cast::<AnyObject>() };
    let center = NSNotificationCenter::defaultCenter();
    let queue = NSOperationQueue::mainQueue();
    for (name, visible) in unsafe { [(NSWindowDidMiniaturizeNotification, false), (NSWindowDidDeminiaturizeNotification, true)] } {
        let app = window.app_handle().clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| show(&app, visible));
        let observer = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), Some(ns_window), Some(&queue), &block) };
        // The main window lasts as long as the app, so the observer does too.
        std::mem::forget(observer);
    }
}
