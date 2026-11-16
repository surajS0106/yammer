use serde::{Serialize, Serializer};

/// Error returned from commands. Serialised as a plain message string so the
/// UI can show it directly, so every message is a sentence for the user, never
/// a library's own text. The technical cause goes to the log (`because`).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Voice(#[from] voice_core::Error),
    #[cfg(desktop)]
    #[error("Yammer couldn't use your system's password storage for your keys. Unlock it if it's locked, then try again.")]
    Keyring(#[from] keyring::Error),
    #[error("{}", voice_core::error::file_problem(.0))]
    Io(#[from] std::io::Error),
    #[error("Yammer got something back in a form it didn't expect. Try again, or update Yammer.")]
    Json(#[from] serde_json::Error),
    #[error("Something went wrong in Yammer's window. Try again, or restart Yammer.")]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
}

impl AppError {
    /// For a message that's already a sentence for the user. Don't pass a library's error here:
    /// use `because`, which shows a sentence and logs the error.
    pub fn invalid(e: impl std::fmt::Display) -> AppError {
        AppError::Invalid(e.to_string())
    }

    /// Show `message` for any error, and log the error itself for whoever's debugging:
    /// `.map_err(AppError::because("Couldn't open System Settings."))`.
    pub fn because<E: std::fmt::Display>(message: &str) -> impl FnOnce(E) -> AppError + '_ {
        move |e| {
            eprintln!("{message} ({e})");
            AppError::Invalid(message.to_string())
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn messages_are_for_people() {
        let io = AppError::Io(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "Operation not permitted (os error 1)"));
        assert!(!io.to_string().contains("os error"));
        let json = AppError::Json(serde_json::from_str::<u8>("x").unwrap_err());
        assert!(!json.to_string().contains("line"));
        let shown = AppError::because::<&str>("Couldn't open Sush.")("JoinError::Panic");
        assert_eq!(shown.to_string(), "Couldn't open Sush.");
    }
}
