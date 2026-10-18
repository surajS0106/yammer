//! The global dictation hotkey, plus Esc (registered only while recording)
//! to cancel. The handler only forwards events to the dictation task; it
//! may run on the main thread, which registering a shortcut blocks on.

use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::dictation::{Dictation, Input};
use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct Hotkey {
    current: Mutex<Option<Shortcut>>,
    /// Why the configured hotkey couldn't be registered, for the UI.
    pub error: Mutex<Option<String>>,
}

fn escape() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

pub fn parse(accelerator: &str) -> AppResult<Shortcut> {
    Shortcut::from_str(accelerator).map_err(|e| AppError::Invalid(format!("“{accelerator}” isn't a valid shortcut: {e}")))
}

pub fn on_event(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    let dictation = app.state::<Dictation>();
    if *shortcut == escape() {
        if event.state == ShortcutState::Pressed {
            dictation.send(Input::Cancel);
        }
        return;
    }
    dictation.send(match event.state {
        ShortcutState::Pressed => Input::Down,
        ShortcutState::Released => Input::Up,
    });
}

/// Make `accelerator` the dictation hotkey, replacing the previous one.
pub fn register(app: &AppHandle, accelerator: &str) -> AppResult<()> {
    let shortcut = parse(accelerator)?;
    let state = app.state::<Hotkey>();
    let mut current = state.current.lock().unwrap();
    if let Some(old) = current.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    let result = app
        .global_shortcut()
        .register(shortcut)
        .map_err(|e| AppError::Invalid(format!("Couldn't use {} as the hotkey ({e}). Another app may already be using it.", display(accelerator))));
    match &result {
        Ok(()) => {
            *current = Some(shortcut);
            *state.error.lock().unwrap() = None;
        }
        Err(e) => *state.error.lock().unwrap() = Some(e.to_string()),
    }
    result
}

/// Release the hotkey (while the UI records a new one) or take it back.
pub fn suspend(app: &AppHandle, suspended: bool, accelerator: &str) -> AppResult<()> {
    if suspended {
        if let Some(old) = app.state::<Hotkey>().current.lock().unwrap().take() {
            let _ = app.global_shortcut().unregister(old);
        }
        Ok(())
    } else {
        register(app, accelerator)
    }
}

pub fn set_escape(app: &AppHandle, on: bool) {
    let gs = app.global_shortcut();
    if on {
        if !gs.is_registered(escape()) {
            let _ = gs.register(escape());
        }
    } else if gs.is_registered(escape()) {
        let _ = gs.unregister(escape());
    }
}

/// "CommandOrControl+Shift+Space" → "Ctrl+Shift+Space" (or "⌘⇧Space" on macOS).
pub fn display(accelerator: &str) -> String {
    let mac = cfg!(target_os = "macos");
    let parts: Vec<String> = accelerator
        .split('+')
        .map(|p| {
            let lower = p.trim().to_ascii_lowercase();
            match lower.as_str() {
                "commandorcontrol" | "cmdorctrl" | "commandorctrl" | "cmdorcontrol" => if mac { "⌘" } else { "Ctrl" }.into(),
                "control" | "ctrl" => if mac { "⌃" } else { "Ctrl" }.into(),
                "command" | "cmd" | "super" | "meta" => if mac { "⌘" } else { "Win" }.into(),
                "shift" => if mac { "⇧" } else { "Shift" }.into(),
                "alt" | "option" => if mac { "⌥" } else { "Alt" }.into(),
                _ => {
                    // DOM-style codes ("KeyA", "Digit1") read better as the key itself.
                    let p = p.trim();
                    match p.strip_prefix("Key").or_else(|| p.strip_prefix("Digit")) {
                        Some(rest) if rest.len() == 1 => rest.to_string(),
                        _ => p.to_string(),
                    }
                }
            }
        })
        .collect();
    parts.join(if mac { "" } else { "+" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_hotkey() {
        assert!(parse(voice_core::settings::default_hotkey()).is_ok());
        assert!(parse("Alt+F9").is_ok());
        assert!(parse("Nope+Nope").is_err());
    }

    #[test]
    fn displays_accelerators() {
        let shown = display("CommandOrControl+Shift+Space");
        if cfg!(target_os = "macos") {
            assert_eq!(shown, "⌘⇧Space");
        } else {
            assert_eq!(shown, "Ctrl+Shift+Space");
        }
    }
}
