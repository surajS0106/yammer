//! GNOME on Wayland only delivers global key grabs to X11 apps, so there the
//! hotkey is a GNOME custom keyboard shortcut that runs `yammer --toggle`,
//! written with `gsettings` (`--edit` for editing by voice, `--transform=<id>`
//! for a transform's own hotkey). GNOME only reports the press, so it's tap to
//! start, tap to finish. While recording, Esc is bound to `yammer --cancel`.

use std::process::Command;

use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

use crate::dictation::Mode;

const LIST_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const ENTRY_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";
const BASE: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings";
const TOGGLE: &str = "yammer";
const CANCEL: &str = "yammer-cancel";
const EDIT: &str = "yammer-edit";
/// Followed by a number: one entry per transform hotkey.
const TRANSFORM: &str = "yammer-transform-";

/// Whether hotkeys go through GNOME's custom shortcuts.
pub fn available() -> bool {
    crate::paste::is_wayland()
        && std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|d| d.split(':').any(|d| d.eq_ignore_ascii_case("gnome")))
        && crate::platform::on_path("gsettings")
}

/// Bind each shortcut to what it starts, set up the (unbound) Esc entry, and
/// clear entries left from hotkeys that were removed.
pub fn bind(hotkeys: &[(&Shortcut, &Mode)]) -> Result<(), String> {
    let mut used = vec![path(TOGGLE), path(CANCEL)];
    let mut transforms = 0;
    for (shortcut, mode) in hotkeys {
        let binding = gtk_accelerator(shortcut)?;
        let (id, name, flag) = match mode {
            Mode::Dictate => (TOGGLE.to_string(), "Yammer: dictate".to_string(), "--toggle".to_string()),
            Mode::Edit => (EDIT.to_string(), "Yammer: edit the selection".to_string(), "--edit".to_string()),
            Mode::Transform(t) => {
                transforms += 1;
                (format!("{TRANSFORM}{transforms}"), format!("Yammer: dictate with {t}"), format!("--transform={}", shell_word(t)))
            }
        };
        entry(&id, &name, &flag, &binding)?;
        used.push(path(&id));
    }
    entry(CANCEL, "Yammer: cancel dictation", "--cancel", "")?;
    for stale in ours()?.into_iter().filter(|p| !used.contains(p)) {
        set(&stale, "binding", "")?;
    }
    Ok(())
}

/// Release the hotkeys, so the app can see them while recording a new one.
pub fn unbind() -> Result<(), String> {
    for p in ours()?.into_iter().filter(|p| *p != path(CANCEL)) {
        set(&p, "binding", "")?;
    }
    Ok(())
}

/// The custom shortcuts Yammer added.
fn ours() -> Result<Vec<String>, String> {
    let current = gsettings(&["get", LIST_SCHEMA, "custom-keybindings"])?;
    Ok(current.split('\'').skip(1).step_by(2).filter(|p| p.starts_with(&format!("{BASE}/yammer"))).map(String::from).collect())
}

/// Bind Esc to cancel while recording, and give it back afterwards.
pub fn set_cancel(on: bool) {
    if let Err(e) = set(&path(CANCEL), "binding", if on { "Escape" } else { "" }) {
        eprintln!("couldn't change the GNOME Esc shortcut: {e}");
    }
}

fn path(id: &str) -> String {
    format!("{BASE}/{id}/")
}

fn entry(id: &str, name: &str, flag: &str, binding: &str) -> Result<(), String> {
    let path = path(id);
    let current = gsettings(&["get", LIST_SCHEMA, "custom-keybindings"])?;
    let mut paths: Vec<&str> = current.split('\'').skip(1).step_by(2).collect();
    if !paths.contains(&path.as_str()) {
        paths.push(&path);
        let list = paths.iter().map(|p| quote(p)).collect::<Vec<_>>().join(", ");
        gsettings(&["set", LIST_SCHEMA, "custom-keybindings", &format!("[{list}]")])?;
    }
    set(&path, "name", name)?;
    set(&path, "command", &format!("{} {flag}", executable()))?;
    set(&path, "binding", binding)
}

fn set(path: &str, key: &str, value: &str) -> Result<(), String> {
    gsettings(&["set", &format!("{ENTRY_SCHEMA}:{path}"), key, &quote(value)]).map(drop)
}

fn gsettings(args: &[&str]) -> Result<String, String> {
    let out = Command::new("gsettings").args(args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// A GVariant string literal.
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// This app as a shell word for GNOME to run. An AppImage runs from a temporary mount, so use the image itself.
fn executable() -> String {
    let exe = std::env::var_os("APPIMAGE").map(Into::into).or_else(|| std::env::current_exe().ok()).unwrap_or_else(|| "yammer".into());
    shell_word(&exe.to_string_lossy())
}

fn shell_word(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The shortcut in GTK's accelerator syntax, e.g. "<Control><Shift>space".
fn gtk_accelerator(shortcut: &Shortcut) -> Result<String, String> {
    let mut accel = String::new();
    for (modifier, name) in
        [(Modifiers::CONTROL, "<Control>"), (Modifiers::SHIFT, "<Shift>"), (Modifiers::ALT, "<Alt>"), (Modifiers::SUPER | Modifiers::META, "<Super>")]
    {
        if shortcut.mods.intersects(modifier) {
            accel.push_str(name);
        }
    }
    let code = shortcut.key.to_string();
    let key = if let Some(c) = code.strip_prefix("Key").or_else(|| code.strip_prefix("Digit")).filter(|c| c.len() == 1) {
        c.to_ascii_lowercase()
    } else if let Some(n) = code.strip_prefix("Numpad").filter(|n| n.len() == 1) {
        format!("KP_{n}")
    } else if code.starts_with('F') && code[1..].parse::<u8>().is_ok() {
        code
    } else {
        match shortcut.key {
            Code::Space => "space",
            Code::Enter => "Return",
            Code::Tab => "Tab",
            Code::Backspace => "BackSpace",
            Code::Delete => "Delete",
            Code::Insert => "Insert",
            Code::Home => "Home",
            Code::End => "End",
            Code::PageUp => "Page_Up",
            Code::PageDown => "Page_Down",
            Code::ArrowUp => "Up",
            Code::ArrowDown => "Down",
            Code::ArrowLeft => "Left",
            Code::ArrowRight => "Right",
            Code::Backquote => "grave",
            Code::Minus => "minus",
            Code::Equal => "equal",
            Code::BracketLeft => "bracketleft",
            Code::BracketRight => "bracketright",
            Code::Backslash => "backslash",
            Code::Semicolon => "semicolon",
            Code::Quote => "apostrophe",
            Code::Comma => "comma",
            Code::Period => "period",
            Code::Slash => "slash",
            Code::Pause => "Pause",
            Code::PrintScreen => "Print",
            _ => return Err(format!("GNOME shortcuts can't use the {code} key")),
        }
        .into()
    };
    accel.push_str(&key);
    Ok(accel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_to_gtk_accelerators() {
        let gtk = |a| gtk_accelerator(&crate::hotkey::parse(a).unwrap()).unwrap();
        assert_eq!(gtk("Shift+KeyZ"), "<Shift>z");
        assert_eq!(gtk("CommandOrControl+Shift+Space"), "<Control><Shift>space");
        assert_eq!(gtk("Super+Alt+Digit1"), "<Alt><Super>1");
        assert_eq!(gtk("F9"), "F9");
        assert_eq!(quote(r"it's \"), r"'it\'s \\'");
    }
}
