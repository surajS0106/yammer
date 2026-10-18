//! Putting the transcript where the cursor is: copy it to the clipboard,
//! synthesize the paste shortcut in the focused app, then put the user's
//! own clipboard back.
//!
//! Wayland doesn't let apps inject keys, so there we try `wtype` and
//! `ydotool` and otherwise leave the text on the clipboard for Ctrl+V.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// arboard on Linux serves the clipboard from this process for as long as a
/// `Clipboard` lives, so keep one for the life of the app.
static CLIPBOARD: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Pasted,
    /// Couldn't send the keystroke; the text is on the clipboard.
    Copied,
}

fn with_clipboard<T>(f: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>) -> AppResult<T> {
    let mut guard = CLIPBOARD.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| AppError::Invalid(format!("Clipboard unavailable: {e}")))?);
    }
    f(guard.as_mut().unwrap()).map_err(|e| AppError::Invalid(format!("Clipboard error: {e}")))
}

pub fn copy(text: &str) -> AppResult<()> {
    with_clipboard(|c| c.set_text(text.to_string()))
}

/// Paste `text` into the focused app. Blocking (a few hundred ms).
pub fn paste(text: &str, restore_clipboard: bool) -> AppResult<Outcome> {
    let previous = if restore_clipboard { with_clipboard(|c| c.get_text()).ok() } else { None };
    copy(text)?;
    // Give the clipboard owner a moment to announce the new contents.
    std::thread::sleep(Duration::from_millis(40));

    if let Err(e) = send_paste_keystroke() {
        eprintln!("paste keystroke failed: {e}");
        return Ok(Outcome::Copied);
    }

    if let Some(previous) = previous {
        // The target app reads the clipboard asynchronously after the keystroke;
        // restoring too soon would paste the old contents.
        std::thread::sleep(Duration::from_millis(450));
        let still_ours = with_clipboard(|c| c.get_text()).map(|t| t == text).unwrap_or(false);
        if still_ours {
            let _ = copy(&previous);
        }
    }
    Ok(Outcome::Pasted)
}

pub fn is_wayland() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v.eq_ignore_ascii_case("wayland")) || std::env::var_os("WAYLAND_DISPLAY").is_some())
}

fn send_paste_keystroke() -> Result<(), String> {
    if is_wayland() {
        return wayland_paste();
    }
    enigo_paste()
}

fn enigo_paste() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let (modifier, v) = (Key::Meta, Key::Unicode('v'));
    #[cfg(target_os = "windows")]
    let (modifier, v) = (Key::Control, Key::V);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (modifier, v) = (Key::Control, Key::Unicode('v'));

    enigo.key(modifier, Direction::Press).map_err(|e| e.to_string())?;
    let result = enigo.key(v, Direction::Click).map_err(|e| e.to_string());
    enigo.key(modifier, Direction::Release).map_err(|e| e.to_string())?;
    result
}

fn wayland_paste() -> Result<(), String> {
    use std::process::{Command, Stdio};
    let run = |program: &str, args: &[&str]| {
        Command::new(program).args(args).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
    };
    // wtype speaks the virtual-keyboard protocol (wlroots compositors, KDE).
    if run("wtype", &["-M", "ctrl", "-k", "v", "-m", "ctrl"]) {
        return Ok(());
    }
    // ydotool goes through uinput, so it works on GNOME too (needs ydotoold running).
    // 29 = KEY_LEFTCTRL, 47 = KEY_V.
    if run("ydotool", &["key", "29:1", "47:1", "47:0", "29:0"]) {
        return Ok(());
    }
    Err("no way to send keystrokes on Wayland (install wtype or ydotool)".into())
}
