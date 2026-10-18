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
    let body: String = body.chars().take(400).collect();
    Err(Error::Status { what: what.to_string(), status: status.as_u16(), body })
}
