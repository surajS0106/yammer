//! Putting the transcript where the cursor is: copy it to the clipboard,
//! synthesize the paste shortcut in the focused app, then put the user's
//! own clipboard back. Editing by voice copies the selection the same way,
//! with Ctrl/⌘+C.
//!
//! Wayland doesn't let apps inject keys, so there we try `wtype`, GNOME's
//! RemoteDesktop portal and `ydotool`, and otherwise leave the text on the
//! clipboard for Ctrl+V.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri_plugin_global_shortcut::Modifiers;

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

/// Paste `text` into the focused app. Blocking (a few hundred ms), so call it
/// off the main thread.
pub fn paste(app: &tauri::AppHandle, text: &str, restore_clipboard: bool) -> AppResult<Outcome> {
    let previous = if restore_clipboard { with_clipboard(|c| c.get_text()).ok() } else { None };
    copy(text)?;
    // Give the clipboard owner a moment to announce the new contents.
    std::thread::sleep(Duration::from_millis(40));

    if let Err(e) = send_shortcut(app, Letter::V, Modifiers::empty()) {
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

/// The focused app's selected text, copied with Ctrl/⌘+C, or `None` if nothing
/// is selected. `held` are the modifiers of the hotkey the user is pressing,
/// let go first so the app sees Ctrl+C rather than, say, Ctrl+Shift+C. The
/// clipboard is put back afterwards. Blocking, so call it off the main thread.
pub fn copy_selection(app: &tauri::AppHandle, held: Modifiers) -> AppResult<Option<String>> {
    let previous = with_clipboard(|c| c.get_text()).ok();
    with_clipboard(|c| c.clear())?;
    send_shortcut(app, Letter::C, held).map_err(|e| AppError::Invalid(format!("Couldn't copy the selection ({e}).")))?;
    // Apps fill the clipboard a moment after the keystroke.
    let deadline = Instant::now() + Duration::from_millis(500);
    let selection = loop {
        let text = with_clipboard(|c| c.get_text()).ok().filter(|t| !t.trim().is_empty());
        if text.is_some() || Instant::now() >= deadline {
            break text;
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    match previous {
        Some(previous) => copy(&previous)?,
        None => with_clipboard(|c| c.clear())?,
    }
    Ok(selection)
}

pub fn is_wayland() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v.eq_ignore_ascii_case("wayland")) || std::env::var_os("WAYLAND_DISPLAY").is_some())
}

/// The letter of a Ctrl/⌘ shortcut to press.
#[derive(Clone, Copy)]
enum Letter {
    C,
    V,
}

impl Letter {
    fn char(self) -> char {
        match self {
            Letter::C => 'c',
            Letter::V => 'v',
        }
    }

    /// evdev key code.
    fn evdev(self) -> i32 {
        match self {
            Letter::C => 46,
            Letter::V => 47,
        }
    }
}

/// Press Ctrl/⌘+`letter` in the focused app, after letting go of `release`.
fn send_shortcut(app: &tauri::AppHandle, letter: Letter, release: Modifiers) -> Result<(), String> {
    if is_wayland() {
        return wayland_shortcut(letter);
    }
    // On macOS enigo looks up the keyboard layout through Text Input Sources,
    // which asserts it's on the main queue and kills the app otherwise.
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(enigo_shortcut(letter, release));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

fn enigo_shortcut(letter: Letter, release: Modifiers) -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    // enigo's default asks macOS to show the Accessibility prompt on every call
    // when the app isn't trusted. The UI already reports the permission state.
    let settings = Settings { open_prompt_to_get_permissions: false, ..Settings::default() };
    let mut enigo = Enigo::new(&settings).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let (modifier, own, key) = (Key::Meta, Modifiers::SUPER | Modifiers::META, Key::Unicode(letter.char()));
    #[cfg(target_os = "windows")]
    let (modifier, own, key) = (Key::Control, Modifiers::CONTROL, if matches!(letter, Letter::C) { Key::C } else { Key::V });
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (modifier, own, key) = (Key::Control, Modifiers::CONTROL, Key::Unicode(letter.char()));

    // The shortcut's own modifier stays down: it's pressed anyway.
    for (m, k) in [
        (Modifiers::SHIFT, Key::Shift),
        (Modifiers::ALT, Key::Alt),
        (Modifiers::CONTROL, Key::Control),
        (Modifiers::SUPER | Modifiers::META, Key::Meta),
    ] {
        if release.intersects(m) && !own.intersects(m) {
            enigo.key(k, Direction::Release).map_err(|e| e.to_string())?;
        }
    }

    enigo.key(modifier, Direction::Press).map_err(|e| e.to_string())?;
    let result = enigo.key(key, Direction::Click).map_err(|e| e.to_string());
    enigo.key(modifier, Direction::Release).map_err(|e| e.to_string())?;
    result
}

fn wayland_shortcut(letter: Letter) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let run = |program: &str, args: &[&str]| {
        Command::new(program).args(args).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
    };
    // wtype speaks the virtual-keyboard protocol (wlroots compositors, KDE).
    if run("wtype", &["-M", "ctrl", "-k", &letter.char().to_string(), "-m", "ctrl"]) {
        return Ok(());
    }
    // GNOME doesn't speak virtual-keyboard, but lets the user allow keyboard control (portal.rs).
    #[cfg(target_os = "linux")]
    if crate::gnome::available() {
        match crate::portal::ctrl(letter.evdev()) {
            Ok(()) => return Ok(()),
            Err(e) => eprintln!("RemoteDesktop portal keystroke failed: {e}"),
        }
    }
    // ydotool goes through uinput, so it works on GNOME too (needs ydotoold running). 29 = KEY_LEFTCTRL.
    let (down, up) = (format!("{}:1", letter.evdev()), format!("{}:0", letter.evdev()));
    if run("ydotool", &["key", "29:1", &down, &up, "29:0"]) {
        return Ok(());
    }
    Err("no way to send keystrokes on Wayland (install wtype or ydotool)".into())
}
