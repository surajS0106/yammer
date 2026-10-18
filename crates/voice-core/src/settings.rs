//! User settings, kept as `settings.json` in the app config dir. Every field
//! has a default, so files written by older versions load without migration.
//! API keys are never here; they live in the OS keyring.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::models::DEFAULT_MODEL;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Global shortcut in Tauri's accelerator syntax.
    pub hotkey: String,
    /// Input device name; `None` follows the system default.
    pub mic_device: Option<String>,
    pub sounds: bool,
    /// Put back whatever was on the clipboard after pasting.
    pub restore_clipboard: bool,
    /// Add a space after the pasted text, so consecutive dictations don't run together.
    pub trailing_space: bool,
    /// Keep a small pill on screen between dictations, not only while recording.
    pub overlay_always_visible: bool,
    /// The screen edge the pill sits at the middle of. Dragging it snaps it to
    /// the nearest edge.
    pub overlay_edge: OverlayEdge,
    pub engine: Engine,
    pub local_model: String,
    /// ISO 639-1 code, or "auto" (multilingual models only).
    pub language: String,
    /// Names and terms to bias recognition toward, e.g. "Sush, Tauri, Kubernetes".
    pub vocabulary: String,
    pub cloud: CloudStt,
    pub cleanup: Cleanup,
    /// Set once the first-run walkthrough is finished or skipped.
    pub onboarded: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum OverlayEdge {
    #[default]
    Bottom,
    Top,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Engine {
    #[default]
    Local,
    Cloud,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SttApi {
    /// `POST {base}/audio/transcriptions`, multipart (OpenAI, Groq, Azure, …).
    #[default]
    Transcriptions,
    /// Ollama's native `/api/chat` with an audio-capable model.
    OllamaChat,
    /// Sarvam AI's `POST {base}/speech-to-text`, keyed by `api-subscription-key`.
    Sarvam,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CloudStt {
    /// Which preset the UI shows ("groq", "openai", "sarvam", "ollama", "custom"). Informational.
    pub preset: String,
    pub base_url: String,
    pub model: String,
    pub api: SttApi,
}

impl Default for CloudStt {
    fn default() -> Self {
        Self {
            preset: "groq".into(),
            base_url: "https://api.groq.com/openai/v1".into(),
            model: "whisper-large-v3-turbo".into(),
            api: SttApi::Transcriptions,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LlmFormat {
    /// `POST {base}/chat/completions` (OpenAI, Groq, OpenRouter, Ollama, …).
    #[default]
    OpenaiChat,
    /// `POST {base}/messages` (Anthropic).
    AnthropicMessages,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cleanup {
    pub enabled: bool,
    pub preset: String,
    pub base_url: String,
    pub model: String,
    pub format: LlmFormat,
    /// Extra rules appended to the cleanup prompt ("British spelling", "no emoji", …).
    pub instructions: String,
}

impl Default for Cleanup {
    fn default() -> Self {
        Self {
            enabled: false,
            preset: "anthropic".into(),
            base_url: "https://api.anthropic.com/v1".into(),
            model: "claude-haiku-5-5".into(),
            format: LlmFormat::AnthropicMessages,
            instructions: String::new(),
        }
    }
}

/// Display name for a provider preset id.
pub fn provider_name(preset: &str) -> &'static str {
    match preset {
        "groq" => "Groq",
        "openai" => "OpenAI",
        "sarvam" => "Sarvam",
        "anthropic" => "Anthropic",
        "ollama" => "Ollama",
        _ => "Custom",
    }
}

impl CloudStt {
    /// "Sarvam · saaras:v4"
    pub fn label(&self) -> String {
        format!("{} · {}", provider_name(&self.preset), self.model.trim())
    }
}

impl Cleanup {
    /// "Anthropic · claude-haiku-5-5"
    pub fn label(&self) -> String {
        format!("{} · {}", provider_name(&self.preset), self.model.trim())
    }
}

pub fn default_hotkey() -> &'static str {
    "CommandOrControl+Shift+Space"
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey().into(),
            mic_device: None,
            sounds: true,
            restore_clipboard: true,
            trailing_space: true,
            overlay_always_visible: true,
            overlay_edge: OverlayEdge::Bottom,
            engine: Engine::Local,
            local_model: DEFAULT_MODEL.into(),
            language: "en".into(),
            vocabulary: String::new(),
            cloud: CloudStt::default(),
            cleanup: Cleanup::default(),
            onboarded: false,
        }
    }
}

impl Settings {
    /// What will transcribe: "On-device · Base (English)" or "Sarvam · saaras:v4".
    pub fn engine_label(&self) -> String {
        match self.engine {
            Engine::Local => {
                let name = crate::models::find(&self.local_model).map_or(self.local_model.as_str(), |m| m.label);
                format!("On-device · {name}")
            }
            Engine::Cloud => self.cloud.label(),
        }
    }

    /// Load from `path`; a missing or unreadable file gives the defaults.
    pub fn load(path: &Path) -> Settings {
        std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    /// Write atomically (temp file + rename), so a crash never leaves half a file.
    pub fn save(&self, path: &Path) -> crate::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    /// The language to pass to whisper: English-only models only speak English.
    pub fn whisper_language(&self, english_only_model: bool) -> Option<String> {
        if english_only_model {
            return Some("en".into());
        }
        match self.language.trim() {
            "" | "auto" => None,
            code => Some(code.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_the_engine() {
        let mut s = Settings { local_model: "base.en".into(), ..Settings::default() };
        assert_eq!(s.engine_label(), "On-device · Base (English)");
        s.engine = Engine::Cloud;
        s.cloud = CloudStt { preset: "sarvam".into(), model: "saaras:v4".into(), ..CloudStt::default() };
        assert_eq!(s.engine_label(), "Sarvam · saaras:v4");
        assert_eq!(Cleanup::default().label(), "Anthropic · claude-haiku-5-5");
    }

    #[test]
    fn old_or_partial_files_fill_in_defaults() {
        let s: Settings = serde_json::from_str(r#"{"hotkey":"Alt+Space","cleanup":{"enabled":true}}"#).unwrap();
        assert_eq!(s.hotkey, "Alt+Space");
        assert!(s.cleanup.enabled);
        assert_eq!(s.cleanup.model, Cleanup::default().model);
        assert_eq!(s.local_model, DEFAULT_MODEL);
        assert!(s.restore_clipboard);
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let s: Settings = serde_json::from_str(r#"{"someFutureThing":1}"#).unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn serialises_camel_and_kebab_case() {
        let v = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(v["localModel"], "base.en");
        assert_eq!(v["engine"], "local");
        assert_eq!(v["cloud"]["api"], "transcriptions");
        assert_eq!(v["cleanup"]["format"], "anthropic-messages");
    }

    #[test]
    fn saves_and_loads() {
        let dir = std::env::temp_dir().join(format!("voice-core-settings-{}", std::process::id()));
        let path = dir.join("settings.json");
        assert_eq!(Settings::load(&path), Settings::default());
        let s = Settings { hotkey: "F9".into(), engine: Engine::Cloud, ..Settings::default() };
        s.save(&path).unwrap();
        assert_eq!(Settings::load(&path), s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn whisper_language_rules() {
        let mut s = Settings { language: "auto".into(), ..Settings::default() };
        assert_eq!(s.whisper_language(true).as_deref(), Some("en"));
        assert_eq!(s.whisper_language(false), None);
        s.language = "de".into();
        assert_eq!(s.whisper_language(false).as_deref(), Some("de"));
    }
}
