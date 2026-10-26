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
    /// Where the pill was dragged to: the overlay window's top-left in physical
    /// screen pixels. `None` puts it centred above the bottom of the screen.
    pub overlay_position: Option<OverlayPosition>,
    pub engine: Engine,
    pub local_model: String,
    /// ISO 639-1 code, or "auto" (multilingual models only).
    pub language: String,
    /// Names and terms to bias recognition toward, e.g. "Sush, Tauri, Kubernetes".
    pub vocabulary: String,
    /// After a dictation, offer to add names and jargon it heard to the vocabulary.
    pub suggest_words: bool,
    /// Suggested words the user turned down, so they aren't offered again.
    pub ignored_words: Vec<String>,
    pub cloud: CloudStt,
    pub cleanup: Cleanup,
    /// The settings window's colour scheme.
    pub theme: Theme,
    /// Dictionary corrections applied to every transcript: "wisper flow" → "Wispr Flow".
    pub replacements: Vec<Replacement>,
    /// Say the trigger, get the text: "my linkedin" → "https://linkedin.com/in/…".
    pub snippets: Vec<Snippet>,
    /// Named rewrite styles. The active one is added to the cleanup prompt.
    pub transforms: Vec<Transform>,
    /// Id of the transform applied to dictations; empty for none.
    pub active_transform: String,
    /// Set once the first-run walkthrough is finished or skipped.
    pub onboarded: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverlayPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Theme {
    /// Follow the OS light/dark setting.
    #[default]
    System,
    Light,
    Dark,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Replacement {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Snippet {
    pub trigger: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Transform {
    pub id: String,
    pub name: String,
    pub instructions: String,
}

pub fn default_transforms() -> Vec<Transform> {
    let t = |id: &str, name: &str, instructions: &str| Transform { id: id.into(), name: name.into(), instructions: instructions.into() };
    vec![
        t("email", "Email", "Format the text as an email: a short greeting, the body in paragraphs, and a sign-off. Don't invent a name."),
        t("bullets", "Bullet points", "Restructure the text as a concise bulleted list, one idea per bullet."),
        t("concise", "Concise", "Make the text shorter and clearer. Keep every fact and request; drop repetition and hedging."),
        t("formal", "Formal", "Rewrite the text in a professional, formal tone."),
        t("casual", "Casual", "Rewrite the text as a friendly, casual chat message."),
    ]
}

impl Settings {
    /// The instructions of the active transform, if one is chosen and has any.
    pub fn transform_instructions(&self) -> Option<&str> {
        self.transforms
            .iter()
            .find(|t| !self.active_transform.is_empty() && t.id == self.active_transform)
            .map(|t| t.instructions.trim())
            .filter(|i| !i.is_empty())
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

fn parse_words(s: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    s.split([',', '\n'])
        .map(str::trim)
        .filter(|w| !w.is_empty() && seen.insert(w.to_lowercase()))
        .map(String::from)
        .collect()
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
            overlay_position: None,
            engine: Engine::Local,
            local_model: DEFAULT_MODEL.into(),
            language: "en".into(),
            vocabulary: String::new(),
            suggest_words: true,
            ignored_words: Vec::new(),
            cloud: CloudStt::default(),
            cleanup: Cleanup::default(),
            theme: Theme::System,
            replacements: Vec::new(),
            snippets: Vec::new(),
            transforms: default_transforms(),
            active_transform: String::new(),
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

    /// The vocabulary as a list: split on commas and newlines, trimmed, with
    /// repeats (ignoring case) dropped. Matches `parseWords` in the UI.
    pub fn vocabulary_words(&self) -> Vec<String> {
        parse_words(&self.vocabulary)
    }

    /// Add `words` to the end of the vocabulary, skipping ones already in it.
    pub fn add_vocabulary(&mut self, words: &[String]) {
        self.vocabulary = parse_words(&format!("{},{}", self.vocabulary, words.join(","))).join(", ");
    }

    /// Remember turned-down suggestions, skipping ones already remembered.
    pub fn ignore_words(&mut self, words: &[String]) {
        for w in words.iter().map(|w| w.trim()).filter(|w| !w.is_empty()) {
            if !self.ignored_words.iter().any(|i| i.eq_ignore_ascii_case(w)) {
                self.ignored_words.push(w.to_string());
            }
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
        assert!(s.replacements.is_empty() && s.snippets.is_empty());
        assert_eq!(s.transforms, default_transforms());
        assert_eq!(s.active_transform, "");
    }

    #[test]
    fn finds_the_active_transform() {
        let mut s = Settings::default();
        assert_eq!(s.transform_instructions(), None);
        s.active_transform = "bullets".into();
        assert!(s.transform_instructions().unwrap().contains("bulleted list"));
        s.active_transform = "gone".into();
        assert_eq!(s.transform_instructions(), None);
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
        assert_eq!(v["theme"], "system");
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
    fn adds_and_ignores_words_without_repeats() {
        let mut s = Settings { vocabulary: "Sush,\n Tauri, sush".into(), ..Settings::default() };
        assert_eq!(s.vocabulary_words(), ["Sush", "Tauri"]);
        s.add_vocabulary(&["tauri".into(), " Wispr Flow ".into()]);
        assert_eq!(s.vocabulary, "Sush, Tauri, Wispr Flow");
        s.ignore_words(&["Monday".into(), "monday".into(), " ".into()]);
        assert_eq!(s.ignored_words, ["Monday"]);
        assert!(Settings::default().suggest_words);
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
