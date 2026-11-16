//! Errors, worded for the person using Yammer: every message is a plain sentence
//! saying what went wrong and, where there's something to do, what to do. The
//! technical cause (a reqwest or io error) stays attached as `source()` for logs,
//! but never reaches the screen.

use std::fmt;

#[derive(Debug)]
pub enum Error {
    /// Something to fix in Settings, already worded for the user.
    Config(String),
    /// A request never got an answer: offline, refused, timed out. `what` names who was asked ("your calendar").
    Send {
        what: String,
        source: reqwest::Error,
    },
    /// The service answered with an error. `body` is its own message, when it gave a readable one.
    Status {
        what: String,
        status: u16,
        body: String,
    },
    /// An answer that couldn't be used, already worded for the user.
    Decode(String),
    Http(reqwest::Error),
    Io(std::io::Error),
    Json(serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub(crate) fn sending(what: &str) -> impl FnOnce(reqwest::Error) -> Error + '_ {
        move |source| Error::Send { what: what.to_string(), source }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Config(m) | Error::Decode(m) => f.write_str(m),
            Error::Send { what, source } => f.write_str(&unreachable(what, source)),
            Error::Http(e) => f.write_str(&unreachable("the service", e)),
            Error::Status { what, status, body } => f.write_str(&refused(what, *status, body)),
            Error::Io(e) => f.write_str(&file_problem(e)),
            Error::Json(_) => f.write_str("Yammer got something back in a form it didn't expect. Try again, or update Yammer."),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Send { source, .. } | Error::Http(source) => Some(source),
            Error::Io(e) => Some(e),
            Error::Json(e) => Some(e),
            _ => None,
        }
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Error {
        Error::Http(e)
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Error {
        Error::Io(e)
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Error {
        Error::Json(e)
    }
}

/// "Your calendar …" from "your calendar".
fn capitalized(what: &str) -> String {
    let mut chars = what.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// A request that got no answer.
fn unreachable(what: &str, e: &reqwest::Error) -> String {
    if e.is_timeout() {
        format!("{} took too long to answer. Try again in a moment.", capitalized(what))
    } else if e.is_decode() || e.is_body() {
        format!("{} sent back an answer Yammer couldn't read. Try again.", capitalized(what))
    } else {
        format!("Couldn't reach {what}. Check your internet connection and try again.")
    }
}

/// A service's error answer, by what it means for the user rather than its code.
pub(crate) fn refused(what: &str, status: u16, body: &str) -> String {
    let who = capitalized(what);
    // The service's own words help when they're a sentence ("model not found"), not a web page or JSON.
    let detail = body.trim();
    let readable = !detail.is_empty() && detail.len() <= 200 && !detail.starts_with(['<', '{', '[']);
    let said = |s: String| if readable { format!("{s} It said: “{}”", detail.trim_end_matches('.')) } else { s };
    match status {
        401 | 403 => format!("{who} turned down the API key. Check it in Settings."),
        404 => said(format!("{who} couldn't find that. Check the model name or address in Settings.")),
        408 | 504 | 524 => format!("{who} took too long to answer. Try again in a moment."),
        413 => format!("That was too much for {what} to take at once."),
        429 => format!("{who} is busy, or your plan's limit is used up. Wait a moment and try again."),
        500..=599 => format!("{who} is having trouble right now. Try again in a moment."),
        _ => said(format!("{who} didn't accept the request.")),
    }
}

/// A file Yammer couldn't read or write.
pub fn file_problem(e: &std::io::Error) -> String {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::NotFound => "A file Yammer needs is missing. Try again, or restart Yammer.".into(),
        ErrorKind::PermissionDenied => "Yammer isn't allowed to use one of its files. Check the folder's permissions.".into(),
        ErrorKind::StorageFull => "Your disk is full, so Yammer couldn't save. Free up some space and try again.".into(),
        ErrorKind::TimedOut => "That took too long. Try again.".into(),
        _ => "Yammer couldn't read or save a file. Try again.".into(),
    }
}

/// Turn a non-2xx response into an error carrying (the start of) its body.
pub(crate) async fn check_status(what: &str, resp: reqwest::Response) -> Result<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    let body: String = api_message(&body).unwrap_or(body).chars().take(400).collect();
    Err(Error::Status { what: what.to_string(), status: status.as_u16(), body })
}

/// The human-readable message from an OpenAI/Anthropic/Groq-style error body
/// (`{"error": {"message": ...}}` or `{"error": "..."}`), so it fits the overlay.
fn api_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let err = v.get("error")?;
    err.get("message").and_then(|m| m.as_str()).or_else(|| err.as_str()).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_api_messages() {
        let anthropic = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        assert_eq!(api_message(anthropic).as_deref(), Some("invalid x-api-key"));
        assert_eq!(api_message(r#"{"error":"model not found"}"#).as_deref(), Some("model not found"));
        assert_eq!(api_message("Bad Gateway"), None);
    }

    #[test]
    fn words_errors_for_people() {
        assert_eq!(refused("your calendar", 401, "nope"), "Your calendar turned down the API key. Check it in Settings.");
        assert_eq!(refused("Sarvam", 503, "<html>"), "Sarvam is having trouble right now. Try again in a moment.");
        assert_eq!(
            refused("your AI cleanup model", 404, "model not found."),
            "Your AI cleanup model couldn't find that. Check the model name or address in Settings. It said: “model not found”"
        );
        // A web page or JSON never shows.
        assert_eq!(refused("Ollama", 400, "<!doctype html><p>Bad</p>"), "Ollama didn't accept the request.");
        assert_eq!(refused("Ollama", 400, "{\"x\":1}"), "Ollama didn't accept the request.");
        let missing = Error::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "No such file or directory (os error 2)"));
        assert!(!missing.to_string().contains("os error"));
        let json = Error::Json(serde_json::from_str::<u8>("x").unwrap_err());
        assert!(!json.to_string().contains("line 1"));
        assert_eq!(Error::Config("Pick a model.".into()).to_string(), "Pick a model.");
    }
}
