//! The global hotkeys: dictation, editing the selection by voice, and one
//! for each transform that has its own, plus Esc (registered only while
//! recording) to cancel. The handler only forwards events to the dictation
//! task; it may run on the main thread, which registering a shortcut blocks on.

use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};
use voice_core::Settings;

use crate::dictation::{Dictation, Input, Mode};
use crate::error::{AppError, AppResult};
use crate::gnome;

#[derive(Default)]
pub struct Hotkey {
    /// The registered shortcuts and what each starts.
    current: Mutex<Vec<(Shortcut, Mode)>>,
    /// Why a configured hotkey couldn't be registered, for the UI.
    pub error: Mutex<Option<String>>,
}

fn escape() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

pub fn parse(accelerator: &str) -> AppResult<Shortcut> {
    Shortcut::from_str(accelerator).map_err(|e| AppError::Invalid(format!("“{accelerator}” isn't a valid shortcut: {e}")))
}

/// A configured hotkey: its accelerator, what it starts, and its name in errors.
pub struct Binding {
    pub accelerator: String,
    pub mode: Mode,
    pub name: String,
}

/// Every hotkey `settings` asks for. The dictation hotkey comes first.
pub fn bindings(settings: &Settings) -> Vec<Binding> {
    let mut list = vec![Binding { accelerator: settings.hotkey.clone(), mode: Mode::Dictate, name: "dictation".into() }];
    if !settings.edit_hotkey.trim().is_empty() {
        list.push(Binding { accelerator: settings.edit_hotkey.clone(), mode: Mode::Edit, name: "editing by voice".into() });
    }
    for t in settings.transforms.iter().filter(|t| !t.hotkey.trim().is_empty()) {
        list.push(Binding { accelerator: t.hotkey.clone(), mode: Mode::Transform(t.id.clone()), name: format!("the {} transform", t.name) });
    }
    list
}

pub fn on_event(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    let dictation = app.state::<Dictation>();
    if *shortcut == escape() {
        if event.state == ShortcutState::Pressed {
            dictation.send(Input::Cancel);
        }
        return;
    }
    let mode = app.state::<Hotkey>().current.lock().unwrap().iter().find(|(s, _)| s == shortcut).map(|(_, m)| m.clone());
    let Some(mode) = mode else { return };
    dictation.send(match event.state {
        ShortcutState::Pressed => Input::Down(mode),
        ShortcutState::Released => Input::Up(mode),
    });
}

/// The shortcut each binding means, refusing the same one twice.
fn parse_all(list: &[Binding]) -> AppResult<Vec<Shortcut>> {
    let mut shortcuts: Vec<Shortcut> = Vec::new();
    for b in list {
        let shortcut = parse(&b.accelerator)?;
        if let Some(j) = shortcuts.iter().position(|s| *s == shortcut) {
            return Err(AppError::Invalid(format!("{} is already the hotkey for {}.", display(&b.accelerator), list[j].name)));
        }
        if shortcut == escape() {
            return Err(AppError::Invalid("Esc cancels a dictation, so it can't be a hotkey.".into()));
        }
        shortcuts.push(shortcut);
    }
    Ok(shortcuts)
}

/// Make `settings`' hotkeys the registered ones, replacing the previous set.
/// On an error the ones that could be registered stay registered.
pub fn register(app: &AppHandle, settings: &Settings) -> AppResult<()> {
    let list = bindings(settings);
    let state = app.state::<Hotkey>();
    let mut current = state.current.lock().unwrap();
    for (old, _) in current.drain(..) {
        let _ = app.global_shortcut().unregister(old);
    }
    let result = parse_all(&list).and_then(|shortcuts| {
        if gnome::available() {
            let entries: Vec<_> = list.iter().zip(&shortcuts).map(|(b, s)| (s, &b.mode)).collect();
            gnome::bind(&entries).map_err(|e| AppError::Invalid(format!("Couldn't add the hotkeys as GNOME shortcuts ({e}).")))?;
            current.extend(shortcuts.into_iter().zip(list.iter().map(|b| b.mode.clone())));
            return Ok(());
        }
        let mut first_error = None;
        for (shortcut, b) in shortcuts.into_iter().zip(&list) {
            match app.global_shortcut().register(shortcut) {
                Ok(()) => current.push((shortcut, b.mode.clone())),
                Err(e) => {
                    first_error.get_or_insert_with(|| {
                        AppError::Invalid(format!(
                            "Couldn't use {} as the hotkey for {} ({e}). Another app may already be using it.",
                            display(&b.accelerator),
                            b.name
                        ))
                    });
                }
            }
        }
        first_error.map_or(Ok(()), Err)
    });
    *state.error.lock().unwrap() = result.as_ref().err().map(|e| e.to_string());
    result
}

/// Whether `a` and `b` ask for the same hotkeys, so nothing needs re-registering.
pub fn same(a: &Settings, b: &Settings) -> bool {
    let key = |s: &Settings| bindings(s).into_iter().map(|b| (b.accelerator, b.mode)).collect::<Vec<_>>();
    key(a) == key(b)
}

/// Release the hotkeys (while the UI records a new one) or take them back.
pub fn suspend(app: &AppHandle, suspended: bool, settings: &Settings) -> AppResult<()> {
    if suspended && gnome::available() {
        gnome::unbind().map_err(AppError::Invalid)
    } else if suspended {
        for (old, _) in app.state::<Hotkey>().current.lock().unwrap().drain(..) {
            let _ = app.global_shortcut().unregister(old);
        }
        Ok(())
    } else {
        register(app, settings)
    }
}

pub fn set_escape(app: &AppHandle, on: bool) {
    if gnome::available() {
        return gnome::set_cancel(on);
    }
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

    #[test]
    fn lists_every_hotkey_and_refuses_repeats() {
        let mut s = Settings { edit_hotkey: "Alt+KeyE".into(), ..Settings::default() };
        s.transforms[1].hotkey = "Alt+KeyB".into();
        let list = bindings(&s);
        let modes: Vec<_> = list.iter().map(|b| b.mode.clone()).collect();
        assert_eq!(modes, [Mode::Dictate, Mode::Edit, Mode::Transform("bullets".into())]);
        assert!(parse_all(&list).is_ok());

        s.transforms[1].hotkey = "Alt+KeyE".into();
        let err = parse_all(&bindings(&s)).unwrap_err().to_string();
        assert!(err.contains("editing by voice"), "{err}");
        assert!(!same(&s, &Settings::default()) && same(&s, &s.clone()));
    }
}
