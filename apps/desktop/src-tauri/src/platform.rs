//! What the UI needs to know about the OS: permissions and Wayland limits.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Platform {
    /// "windows", "macos" or "linux".
    os: &'static str,
    /// Linux on Wayland: no global hotkeys or synthetic keystrokes for apps.
    wayland: bool,
    /// GNOME on Wayland: the hotkey is a GNOME custom shortcut instead (gnome.rs).
    gnome_shortcut: bool,
    /// Wayland helpers found on PATH.
    wtype: bool,
    ydotool: bool,
    /// macOS: whether the app may send keystrokes (Accessibility). `None` elsewhere.
    accessibility: Option<bool>,
    version: &'static str,
}

pub fn on_path(program: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else { return false };
    std::env::split_paths(&path).any(|dir| dir.join(program).is_file())
}

#[cfg(target_os = "macos")]
pub fn accessibility_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}

pub fn info() -> Platform {
    let linux = cfg!(target_os = "linux");
    Platform {
        os: std::env::consts::OS,
        wayland: crate::paste::is_wayland(),
        gnome_shortcut: crate::gnome::available(),
        wtype: linux && on_path("wtype"),
        ydotool: linux && on_path("ydotool"),
        #[cfg(target_os = "macos")]
        accessibility: Some(accessibility_trusted()),
        #[cfg(not(target_os = "macos"))]
        accessibility: None,
        version: env!("CARGO_PKG_VERSION"),
    }
}
