//! What a dictation is doing, as the UI shows it. Sent as the `dictation` event.

use serde::Serialize;

#[cfg_attr(not(desktop), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
#[rustfmt::skip] // rustfmt expands every struct variant once any variant has a doc comment.
pub enum OverlayState {
    Listening { hint: Option<String> },
    /// `engine` is the settings' engine label, e.g. "Sarvam · saaras:v4".
    Transcribing { engine: String },
    Polishing { model: String },
    /// Rewriting the selection as the user asked (the edit hotkey).
    Editing { model: String },
    Message { text: String, error: bool },
    /// The dictation failed and its recording was kept: a card offers to retry
    /// history entry `id`. It closes itself (`dismiss`) like the transcript card.
    Failed { text: String, id: u64 },
    /// No text box had focus, so the transcript is shown in a card to copy.
    /// The card closes itself (`dismiss`) on its timer, its close button or Copy.
    /// `words` are new words to offer for the Dictionary, as in `Words`.
    Transcript { text: String, words: Vec<String> },
    /// The dictation was pasted and had words the Dictionary doesn't know; a
    /// card offers to add them. It closes itself (`dismiss`) like the transcript card.
    Words { words: Vec<String> },
    /// Not dictating, but the pill stays on screen ("Always show the pill").
    Idle,
    Hidden,
}
