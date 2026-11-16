//! Sush, Yammer's sibling AI app, reads Yammer's meetings through `yammer --mcp`
//! (voice-core's `mcp.rs`). This is the way back: "Ask in Sush" on a meeting
//! opens `sush://ask?meeting=<id>&title=<title>`, and Sush opens a chat ready
//! to ask about it.
//!
//! A Sush from before those links can't take one (on macOS, `open` fails when
//! no app claims the scheme). There, Sush is opened with the question on the
//! clipboard, to paste into a new chat, so the button still does something useful.

use std::process::{Command, Stdio};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// What "Ask in Sush" did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Asked {
    /// Sush took the link and opened a chat with the question.
    Opened,
    /// Sush can't take links yet: it was opened, and the question is on the clipboard.
    Copied,
}

/// Whether Sush is installed, for showing "Ask in Sush".
#[tauri::command]
pub async fn sush_installed() -> bool {
    tauri::async_runtime::spawn_blocking(installed).await.unwrap_or(false)
}

fn installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        app().is_some()
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // Sush registers its link scheme for the user when it starts.
        Command::new("reg")
            .args(["query", r"HKCU\Software\Classes\sush"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .is_ok_and(|s| s.success())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-mime")
            .args(["query", "default", "x-scheme-handler/sush"])
            .stderr(Stdio::null())
            .output()
            .is_ok_and(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty())
    }
}

/// Sush.app, in /Applications or ~/Applications.
#[cfg(target_os = "macos")]
fn app() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    let dirs = [Some(std::path::PathBuf::from("/Applications")), home.map(|h| h.join("Applications"))];
    dirs.into_iter().flatten().map(|d| d.join("Sush.app")).find(|a| a.is_dir())
}

/// Whether this Sush.app claims `sush://` (its Info.plist's `CFBundleURLTypes`). Older builds don't.
#[cfg(target_os = "macos")]
fn takes_links(app: &std::path::Path) -> bool {
    let Ok(info) = plist::Value::from_file(app.join("Contents/Info.plist")) else { return false };
    let types = info.as_dictionary().and_then(|d| d.get("CFBundleURLTypes")).and_then(plist::Value::as_array);
    types
        .into_iter()
        .flatten()
        .filter_map(|t| t.as_dictionary()?.get("CFBundleURLSchemes")?.as_array())
        .flatten()
        .any(|s| s.as_string() == Some("sush"))
}

/// Open Sush on a chat about meeting `id`: through its link, or, for a Sush that can't take one yet,
/// by opening it with the question on the clipboard.
#[tauri::command]
pub async fn ask_in_sush(id: u64, title: String) -> AppResult<Asked> {
    tauri::async_runtime::spawn_blocking(move || ask(id, &title))
        .await
        .map_err(AppError::because("Something went wrong opening Sush. Try again."))?
}

fn ask(id: u64, title: &str) -> AppResult<Asked> {
    #[cfg(target_os = "macos")]
    {
        let app = app().ok_or_else(|| AppError::NotFound("Sush isn't installed.".into()))?;
        if takes_links(&app) && tauri_plugin_opener::open_url(ask_link(id, title), None::<&str>).is_ok() {
            return Ok(Asked::Opened);
        }
        crate::paste::copy(&ask_prompt(id, title))?;
        let opened = Command::new("open").arg("-a").arg(&app).stdout(Stdio::null()).stderr(Stdio::null()).status();
        if !opened.is_ok_and(|s| s.success()) {
            return Err(AppError::Invalid("Couldn't open Sush. The question is on your clipboard to paste into it.".into()));
        }
        Ok(Asked::Copied)
    }
    #[cfg(not(target_os = "macos"))]
    {
        if tauri_plugin_opener::open_url(ask_link(id, title), None::<&str>).is_ok() {
            return Ok(Asked::Opened);
        }
        crate::paste::copy(&ask_prompt(id, title))?;
        Err(AppError::Invalid("Couldn't open Sush. The question is on your clipboard to paste into it.".into()))
    }
}

fn ask_link(id: u64, title: &str) -> String {
    format!("sush://ask?meeting={id}&title={}", encode(title.trim()))
}

/// What Sush puts in the composer for a link (`askAboutMeetingPrompt` in Sush's `lib/library.ts`).
fn ask_prompt(id: u64, title: &str) -> String {
    match title.trim() {
        "" => format!("@Yammer About my meeting (yammer://meeting/{id}): "),
        t => format!("@Yammer About my meeting “{t}” (yammer://meeting/{id}): "),
    }
}

/// Percent-encode everything but RFC 3986's unreserved characters.
fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_ask_links_and_prompts() {
        assert_eq!(ask_link(42, " Q3 pricing & next steps "), "sush://ask?meeting=42&title=Q3%20pricing%20%26%20next%20steps");
        assert_eq!(ask_link(7, "Café"), "sush://ask?meeting=7&title=Caf%C3%A9");
        assert_eq!(ask_link(1, ""), "sush://ask?meeting=1&title=");
        assert_eq!(ask_prompt(5, " Dubai Corporation Call "), "@Yammer About my meeting “Dubai Corporation Call” (yammer://meeting/5): ");
        assert_eq!(ask_prompt(5, ""), "@Yammer About my meeting (yammer://meeting/5): ");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_whether_an_app_takes_sush_links() {
        let dir = std::env::temp_dir().join(format!("yammer-sush-{}", std::process::id()));
        let contents = dir.join("Sush.app/Contents");
        std::fs::create_dir_all(&contents).unwrap();
        let mut types = plist::Dictionary::new();
        types.insert("CFBundleURLSchemes".into(), plist::Value::Array(vec!["sush".into()]));
        let mut info = plist::Dictionary::new();
        info.insert("CFBundleURLTypes".into(), plist::Value::Array(vec![types.into()]));
        plist::Value::Dictionary(info).to_file_xml(contents.join("Info.plist")).unwrap();
        assert!(takes_links(&dir.join("Sush.app")));
        plist::Value::Dictionary(plist::Dictionary::new()).to_file_xml(contents.join("Info.plist")).unwrap();
        assert!(!takes_links(&dir.join("Sush.app")));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
