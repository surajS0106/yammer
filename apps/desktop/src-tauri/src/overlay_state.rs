//! What a dictation is doing, as the UI shows it. Sent as the `dictation` event.

use serde::Serialize;

#[cfg_attr(not(desktop), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case", rename_all_fields = "camelCase")]
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
    /// Not dictating, while a meeting is being transcribed: a recording pill
    /// with its running time. `started_at` is Unix ms.
    Meeting { started_at: u64 },
    /// `app` started a call, or `event` on the calendar began: a card offers to
    /// transcribe it as a meeting (`calls.rs`). `app` is empty for an event alone;
    /// `event` is the calendar event's title, when there is one. With
    /// `countdown_ms` it starts by itself when the count runs out; without, the
    /// card closes then. `id` names this offer in `call_answer`.
    CallStarted { id: u64, app: String, event: Option<String>, countdown_ms: Option<u64> },
    /// The call the meeting was transcribing has ended: a card counts down to stopping it.
    CallEnded { id: u64, app: String, countdown_ms: u64 },
    Hidden,
}

#[cfg(test)]
mod tests {
    use super::OverlayState;

    #[test]
    fn fields_are_camel_case() {
        // The overlay reads `startedAt` and `countdownMs` (`lib/tauri.ts`).
        let v = serde_json::to_value(OverlayState::CallStarted { id: 1, app: "Zoom".into(), event: None, countdown_ms: Some(5000) }).unwrap();
        assert_eq!(v, serde_json::json!({ "phase": "call-started", "id": 1, "app": "Zoom", "event": null, "countdownMs": 5000 }));
        let v = serde_json::to_value(OverlayState::Meeting { started_at: 7 }).unwrap();
        assert_eq!(v, serde_json::json!({ "phase": "meeting", "startedAt": 7 }));
    }
}
