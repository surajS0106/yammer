#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Config(String),
    #[error("couldn't reach {what}: {source}")]
    Send {
        what: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("{what} failed (HTTP {status}): {body}")]
    Status { what: String, status: u16, body: String },
    #[error("{0}")]
    Decode(String),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub(crate) fn sending(what: &str) -> impl FnOnce(reqwest::Error) -> Error + '_ {
        move |source| Error::Send { what: what.to_string(), source }
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
    use super::api_message;

    #[test]
    fn extracts_api_messages() {
        let anthropic = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        assert_eq!(api_message(anthropic).as_deref(), Some("invalid x-api-key"));
        assert_eq!(api_message(r#"{"error":"model not found"}"#).as_deref(), Some("model not found"));
        assert_eq!(api_message("Bad Gateway"), None);
    }
}
