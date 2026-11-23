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
    /// Select text, then hold this and say how to change it. Empty for none.
    pub edit_hotkey: String,
    /// Input device name; `None` follows the system default.
    pub mic_device: Option<String>,
    pub sounds: bool,
    /// What happens to the computer's own sound while recording, so music or a video doesn't end up in it.
    pub other_audio: OtherAudio,
    /// What `other_audio` was before it could be anything but muted. Read from old files, never written.
    #[serde(skip_serializing)]
    pub mute_audio: bool,
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
    /// How many of the newest dictations keep their audio, so they can be transcribed again. 0 keeps none.
    pub keep_recordings: u32,
    /// Delete dictations older than this many days. 0 keeps them forever.
    pub history_days: u32,
    /// Set once the first-run walkthrough is finished or skipped.
    pub onboarded: bool,
    /// The newest version whose "What's new" the user has seen; empty before the first.
    pub seen_changelog: String,
    /// Live transcription of calls and meetings, and the notes made from them.
    pub meeting: MeetingSettings,
}

/// What a meeting transcript listens to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CallAudio {
    /// The microphone ("You") and the computer's sound output ("Them").
    #[default]
    Both,
    Mic,
    /// Only the sound output: a call, webinar or video you're listening to.
    System,
}

/// What turns a meeting's audio into text as it happens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LiveEngine {
    /// Cut at pauses, and each piece transcribed with the dictation engine (on-device or cloud).
    #[default]
    Dictation,
    /// OpenAI's Realtime transcription over a WebSocket: words appear while they're spoken.
    OpenaiRealtime,
    /// Sarvam's streaming speech-to-text over a WebSocket.
    SarvamStreaming,
}

impl LiveEngine {
    /// The model used when none is chosen.
    pub fn default_model(self) -> &'static str {
        match self {
            LiveEngine::Dictation => "",
            LiveEngine::OpenaiRealtime => "gpt-live-transcribe",
            LiveEngine::SarvamStreaming => "saaras:v4",
        }
    }

    /// The provider preset whose speech key also works here, if any.
    pub fn provider(self) -> Option<&'static str> {
        match self {
            LiveEngine::Dictation => None,
            LiveEngine::OpenaiRealtime => Some("openai"),
            LiveEngine::SarvamStreaming => Some("sarvam"),
        }
    }
}

/// How a meeting's notes are laid out: one of Yammer's own, or the user's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTemplate {
    pub id: String,
    pub name: String,
    /// The layout, as the notes prompt tells it to the model.
    pub instructions: String,
    /// What it's for, in a line, for the Templates page. Only Yammer's own have one. Never read from settings.
    #[serde(default, skip_deserializing, skip_serializing_if = "String::is_empty")]
    pub description: String,
    /// Shipped with Yammer, so it can't be changed. Never read from settings.
    #[serde(default, skip_deserializing, skip_serializing_if = "std::ops::Not::not")]
    pub built_in: bool,
}

/// The template notes are written with when nothing else is chosen.
pub const DEFAULT_TEMPLATE: &str = "minutes";

/// Yammer's own templates. Kept in code, not settings, so improving one reaches everyone.
pub fn built_in_templates() -> Vec<NoteTemplate> {
    let t = |id: &str, name: &str, description: &str, instructions: &str| NoteTemplate {
        id: id.into(),
        name: name.into(),
        instructions: instructions.into(),
        description: description.into(),
        built_in: true,
    };
    vec![
        t(
            "minutes",
            "Minutes",
            "The full record: what was decided, who does what, and what's still open.",
            "Meeting minutes: \"## Summary\" (two or three sentences), \"## Decisions\", \"## Action items\" (\"- [ ] Who: what, by \
when\" where the transcript says), \"## Discussion\" (the topics in the order they came up, a few bullets each) and \"## Open questions\".",
        ),
        t(
            "summary",
            "Brief summary",
            "A short paragraph and the key points, for a quick catch-up.",
            "A brief summary: \"## Summary\" (one short paragraph), then \"## Key points\" as bullets, then \"## Action items\" if there are any.",
        ),
        t(
            "action-items",
            "Action items",
            "Only what happens next, and what was decided.",
            "Only what happens next: \"## Action items\" (\"- [ ] Who: what, by when\" where the transcript says), then \"## Decisions\". \
Nothing else.",
        ),
        t(
            "one-on-one",
            "1:1",
            "How they're doing, what you talked about, and feedback both ways.",
            "Notes of a one-to-one: \"## How they're doing\" (mood, wins, worries, in their words where it helps), \"## Topics\" (a few \
bullets each), \"## Feedback\" (given either way), \"## Action items\" (\"- [ ] Who: what\") and \"## For next time\".",
        ),
        t(
            "stand-up",
            "Stand-up",
            "What each person did, does next and is stuck on.",
            "A stand-up: \"## Updates\" with a \"### Name\" for each person (or \"### Team\" where people can't be told apart), each with \
\"Done\", \"Next\" and \"Blocked\" bullets. Then \"## Blockers\" gathered together, and \"## Action items\". Keep it terse.",
        ),
        t(
            "customer-call",
            "Customer call",
            "Their situation, pain points, objections and the next steps.",
            "A call with a customer or prospect: \"## Summary\", \"## Their situation\" (who they are, what they use today), \"## Pain \
points\" (in their words where possible), \"## What they asked about\", \"## Objections and concerns\", \"## Budget, timeline and \
decision makers\" (only what was said) and \"## Next steps\" as \"- [ ] \" items.",
        ),
        t(
            "interview",
            "Interview",
            "Each question with the gist of the answer, then strengths and concerns.",
            "A job interview: \"## Candidate\" (role and background, as said), \"## Questions and answers\" (each question asked as a \
bullet with the gist of the answer beneath it), \"## Strengths\", \"## Concerns\" and \"## Follow-ups\". Report what was said; don't \
judge the candidate.",
        ),
        t(
            "lecture",
            "Lecture or class",
            "Study notes by topic, with the questions raised and what to review.",
            "Study notes of a lecture or talk: \"## Overview\" (two sentences), then a \"## \" section per topic in the order taught, with \
definitions, key facts and examples as bullets, \"## Questions raised\", and \"## To review\" as \"- [ ] \" items.",
        ),
    ]
}

/// What happens when another app starts a call (`calls.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CallDetect {
    Off,
    /// Sushi asks whether to transcribe it.
    #[default]
    Ask,
    /// Sushi counts down, then starts transcribing unless told not to.
    Auto,
}

/// An app Sushi never offers to transcribe a call from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IgnoredApp {
    /// `calls::MicUser::id`.
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MeetingSettings {
    /// Starts and stops a meeting transcript. Empty for none.
    pub hotkey: String,
    pub audio: CallAudio,
    /// No live transcript, only notes when it ends: the (cheaper) dictation engine transcribes it, whatever `engine` says.
    pub notes_only: bool,
    pub engine: LiveEngine,
    /// The streaming engine's model; empty for its default.
    pub model: String,
    /// Id of the template notes are written with, unless a meeting picks another.
    /// Older builds kept a style here ("minutes", "action-items", "custom"); the first three are template ids.
    pub summary: String,
    /// The user's own templates, after Yammer's.
    pub templates: Vec<NoteTemplate>,
    /// Older builds' layout for the "custom" style. `migrate` makes it a template.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub summary_instructions: String,
    /// Write the notes as soon as the meeting ends, with the AI cleanup model.
    pub auto_summary: bool,
    /// When another app starts using the microphone for a call, offer to transcribe it.
    pub detect: CallDetect,
    pub ignored_apps: Vec<IgnoredApp>,
    /// When an event on the calendar begins and no meeting is being transcribed, offer to take notes.
    pub calendar_offer: bool,
}

impl Default for MeetingSettings {
    fn default() -> Self {
        Self {
            hotkey: String::new(),
            audio: CallAudio::Both,
            notes_only: false,
            engine: LiveEngine::Dictation,
            model: String::new(),
            summary: DEFAULT_TEMPLATE.into(),
            templates: Vec::new(),
            summary_instructions: String::new(),
            auto_summary: true,
            detect: CallDetect::Ask,
            ignored_apps: Vec::new(),
            calendar_offer: true,
        }
    }
}

impl MeetingSettings {
    /// The streaming engine's model, or its default.
    pub fn model(&self) -> &str {
        match self.model.trim() {
            "" => self.engine.default_model(),
            m => m,
        }
    }

    /// Every template: Yammer's, then the user's own that have a layout.
    pub fn all_templates(&self) -> Vec<NoteTemplate> {
        let mut all = built_in_templates();
        let own = self.templates.iter().filter(|t| !t.instructions.trim().is_empty() && !all.iter().any(|b| b.id == t.id));
        let own: Vec<NoteTemplate> = own.map(|t| NoteTemplate { built_in: false, description: String::new(), ..t.clone() }).collect();
        all.extend(own);
        all
    }

    /// The template with this id, else the default one, else Minutes.
    pub fn template(&self, id: Option<&str>) -> NoteTemplate {
        let all = self.all_templates();
        let find = |id: &str| all.iter().find(|t| t.id == id).cloned();
        id.and_then(find).or_else(|| find(&self.summary)).or_else(|| find(DEFAULT_TEMPLATE)).expect("Minutes is built in")
    }

    /// Settings from before templates: the "custom" style's layout becomes a template of the user's own.
    pub fn migrate(&mut self) {
        let custom = std::mem::take(&mut self.summary_instructions);
        if !custom.trim().is_empty() && !self.templates.iter().any(|t| t.id == "custom") {
            self.templates.push(NoteTemplate {
                id: "custom".into(),
                name: "My layout".into(),
                instructions: custom.trim().into(),
                description: String::new(),
                built_in: false,
            });
        }
        if !self.all_templates().iter().any(|t| t.id == self.summary) {
            self.summary = DEFAULT_TEMPLATE.into();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverlayPosition {
    pub x: i32,
    pub y: i32,
}

/// What the computer plays while a dictation records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum OtherAudio {
    #[default]
    Leave,
    /// Mute the output until recording stops.
    Mute,
    /// Let it play, and take it out of the recording (`echo`).
    Ignore,
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
    /// xAI's `POST {base}/stt` (Grok voice transcription), multipart with a bearer key.
    Xai,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CloudStt {
    /// Which preset the UI shows ("groq", "openai", "sarvam", "xai", "ollama", "custom"). Informational.
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
    /// A hotkey that dictates with this transform, whichever one is active. Empty for none.
    pub hotkey: String,
}

pub fn default_transforms() -> Vec<Transform> {
    let t = |id: &str, name: &str, instructions: &str| Transform {
        id: id.into(),
        name: name.into(),
        instructions: instructions.into(),
        hotkey: String::new(),
    };
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
        self.active().map(|t| t.instructions.trim())
    }

    /// The active transform, if one is chosen and has instructions.
    pub fn active(&self) -> Option<&Transform> {
        self.transform(&self.active_transform)
    }

    /// The transform with this id, if it has instructions.
    pub fn transform(&self, id: &str) -> Option<&Transform> {
        self.transforms.iter().find(|t| !id.is_empty() && t.id == id && !t.instructions.trim().is_empty())
    }
}

/// The languages offered in Settings and the tray, as (ISO 639-1 code, name).
/// `languages` in the UI's `lib/presets.ts` is the same list; keep the two in sync.
pub const LANGUAGES: &[(&str, &str)] = &[
    ("auto", "Detect automatically"),
    ("en", "English"),
    ("es", "Spanish"),
    ("fr", "French"),
    ("de", "German"),
    ("it", "Italian"),
    ("pt", "Portuguese"),
    ("nl", "Dutch"),
    ("hi", "Hindi"),
    ("ta", "Tamil"),
    ("te", "Telugu"),
    ("kn", "Kannada"),
    ("ml", "Malayalam"),
    ("bn", "Bengali"),
    ("mr", "Marathi"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("zh", "Chinese"),
    ("ar", "Arabic"),
    ("ru", "Russian"),
    ("tr", "Turkish"),
    ("pl", "Polish"),
    ("uk", "Ukrainian"),
];

/// Display name for a provider preset id.
pub fn provider_name(preset: &str) -> &'static str {
    match preset {
        "groq" => "Groq",
        "openai" => "OpenAI",
        "sarvam" => "Sarvam",
        "xai" => "xAI",
        "anthropic" => "Anthropic",
        "ollama" => "Ollama",
        _ => "Custom",
    }
}

/// Every name an API key is saved under. Keys belong to a provider, not a feature, so one
/// OpenAI key serves speech, cleanup and meetings alike. A custom server's key stays with the
/// feature that points at it, since the speech and cleanup servers are rarely the same.
/// `calendar` isn't a provider's: it's the calendar's secret iCal address, which works like a password.
pub const KEY_NAMES: &[&str] = &["openai", "anthropic", "groq", "sarvam", "xai", "custom-stt", "custom-cleanup", "calendar"];

/// The key a provider preset uses: `None` when it needs none (Ollama), `custom` for anything unknown.
fn key_name(preset: &str, custom: &'static str) -> Option<&'static str> {
    match preset {
        "ollama" => None,
        "openai" => Some("openai"),
        "anthropic" => Some("anthropic"),
        "groq" => Some("groq"),
        "sarvam" => Some("sarvam"),
        "xai" => Some("xai"),
        _ => Some(custom),
    }
}

impl CloudStt {
    /// The saved key this provider uses.
    pub fn key_name(&self) -> Option<&'static str> {
        key_name(&self.preset, "custom-stt")
    }

    /// "Sarvam · saaras:v4"
    pub fn label(&self) -> String {
        format!("{} · {}", provider_name(&self.preset), self.model.trim())
    }
}

impl Cleanup {
    /// The saved key this provider uses.
    pub fn key_name(&self) -> Option<&'static str> {
        key_name(&self.preset, "custom-cleanup")
    }

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
            edit_hotkey: String::new(),
            mic_device: None,
            sounds: true,
            other_audio: OtherAudio::default(),
            mute_audio: false,
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
            keep_recordings: 20,
            history_days: 0,
            onboarded: false,
            seen_changelog: String::new(),
            meeting: MeetingSettings::default(),
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

    /// The settings a meeting runs with: one for notes only doesn't stream, so `meeting.engine` is the dictation engine.
    pub fn for_meeting(&self) -> Settings {
        let mut settings = self.clone();
        if settings.meeting.notes_only {
            settings.meeting.engine = LiveEngine::Dictation;
        }
        settings
    }

    /// What transcribes a meeting: "OpenAI Realtime · gpt-live-transcribe", or the dictation engine's label.
    pub fn meeting_engine_label(&self) -> String {
        match self.meeting.engine {
            LiveEngine::Dictation => self.engine_label(),
            LiveEngine::OpenaiRealtime => format!("OpenAI Realtime · {}", self.meeting.model()),
            LiveEngine::SarvamStreaming => format!("Sarvam streaming · {}", self.meeting.model()),
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
        let mut settings: Settings = std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        settings.meeting.migrate();
        if std::mem::take(&mut settings.mute_audio) && settings.other_audio == OtherAudio::Leave {
            settings.other_audio = OtherAudio::Mute;
        }
        settings
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
    fn features_on_one_provider_share_its_key() {
        let stt = CloudStt { preset: "openai".into(), ..CloudStt::default() };
        let cleanup = Cleanup { preset: "openai".into(), ..Cleanup::default() };
        assert_eq!(stt.key_name(), Some("openai"));
        assert_eq!(stt.key_name(), cleanup.key_name());
        assert_eq!(LiveEngine::OpenaiRealtime.provider(), stt.key_name());
        assert_eq!(Cleanup { preset: "ollama".into(), ..Cleanup::default() }.key_name(), None);
        // Custom servers keep their own keys, as do unknown presets.
        assert_eq!(CloudStt { preset: "custom".into(), ..CloudStt::default() }.key_name(), Some("custom-stt"));
        assert_eq!(CloudStt { preset: "xai".into(), ..CloudStt::default() }.key_name(), Some("xai"));
        assert_eq!(Cleanup { preset: "mystery".into(), ..Cleanup::default() }.key_name(), Some("custom-cleanup"));
        for name in [stt.key_name(), Cleanup::default().key_name(), LiveEngine::SarvamStreaming.provider()].into_iter().flatten() {
            assert!(KEY_NAMES.contains(&name), "{name}");
        }
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
        assert_eq!((s.edit_hotkey.as_str(), s.other_audio, s.keep_recordings, s.history_days), ("", OtherAudio::Leave, 20, 0));
        assert_eq!(s.seen_changelog, "");
    }

    #[test]
    fn finds_the_active_transform() {
        let mut s = Settings::default();
        assert_eq!(s.transform_instructions(), None);
        s.active_transform = "bullets".into();
        assert!(s.transform_instructions().unwrap().contains("bulleted list"));
        s.active_transform = "gone".into();
        assert_eq!(s.transform_instructions(), None);
        assert_eq!(s.transform("formal").map(|t| t.name.as_str()), Some("Formal"));
        s.transforms[0].instructions = " ".into();
        assert!(s.transform("email").is_none() && s.transform("").is_none());
    }

    #[test]
    fn muting_moves_to_other_audio() {
        let path = std::env::temp_dir().join(format!("yammer-settings-{}.json", std::process::id()));
        std::fs::write(&path, r#"{"muteAudio":true}"#).unwrap();
        let s = Settings::load(&path);
        let _ = std::fs::remove_file(&path);
        assert_eq!((s.other_audio, s.mute_audio), (OtherAudio::Mute, false));
        assert!(serde_json::to_value(&s).unwrap().get("muteAudio").is_none());
    }

    #[test]
    fn notes_only_meetings_use_the_dictation_engine() {
        let mut s: Settings = serde_json::from_str(r#"{"meeting":{"engine":"openai-realtime"}}"#).unwrap();
        assert!(!s.meeting.notes_only);
        assert_eq!(s.for_meeting().meeting.engine, LiveEngine::OpenaiRealtime);
        s.meeting.notes_only = true;
        let running = s.for_meeting();
        assert_eq!(running.meeting.engine, LiveEngine::Dictation);
        assert_eq!(running.meeting_engine_label(), s.engine_label());
        // Kept, for when the live transcript is turned back on.
        assert_eq!(s.meeting.engine, LiveEngine::OpenaiRealtime);
        assert_eq!(serde_json::to_value(&s).unwrap()["meeting"]["notesOnly"], true);
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
        assert_eq!((v["editHotkey"].as_str(), v["otherAudio"].as_str()), (Some(""), Some("leave")));
        assert_eq!((v["keepRecordings"].as_u64(), v["historyDays"].as_u64()), (Some(20), Some(0)));
        assert_eq!(v["transforms"][0]["hotkey"], "");
        assert_eq!(v["seenChangelog"], "");
        assert_eq!((v["meeting"]["audio"].as_str(), v["meeting"]["engine"].as_str()), (Some("both"), Some("dictation")));
        assert_eq!((v["meeting"]["summary"].as_str(), v["meeting"]["autoSummary"].as_bool()), (Some("minutes"), Some(true)));
        let m: MeetingSettings = serde_json::from_str(r#"{"engine":"openai-realtime","summary":"action-items"}"#).unwrap();
        assert_eq!((m.engine, m.summary.as_str(), m.audio), (LiveEngine::OpenaiRealtime, "action-items", CallAudio::Both));
        assert!(v["meeting"].get("summaryInstructions").is_none() && v["meeting"]["templates"].as_array().is_some_and(Vec::is_empty));
        // Settings from before call detection ask, and ignore nothing.
        assert_eq!((m.detect, m.ignored_apps.len(), m.calendar_offer), (CallDetect::Ask, 0, true));
        assert_eq!((v["meeting"]["detect"].as_str(), v["meeting"]["ignoredApps"].as_array().map(Vec::len)), (Some("ask"), Some(0)));
        let m: MeetingSettings = serde_json::from_str(r#"{"detect":"auto","ignoredApps":[{"id":"zoom","name":"Zoom"}]}"#).unwrap();
        assert_eq!((m.detect, m.ignored_apps), (CallDetect::Auto, vec![IgnoredApp { id: "zoom".into(), name: "Zoom".into() }]));
    }

    #[test]
    fn note_templates_and_their_migration() {
        // An old custom style becomes a template of the user's own, and stays the default.
        let mut m: MeetingSettings = serde_json::from_str(r###"{"summary":"custom","summaryInstructions":" ## Next steps only "}"###).unwrap();
        m.migrate();
        assert_eq!((m.summary.as_str(), m.summary_instructions.as_str()), ("custom", ""));
        assert_eq!(m.template(None).instructions, "## Next steps only");
        assert!(!m.template(None).built_in);
        // An old custom style with nothing in it falls back to Minutes.
        let mut m: MeetingSettings = serde_json::from_str(r#"{"summary":"custom"}"#).unwrap();
        m.migrate();
        assert_eq!((m.summary.as_str(), m.templates.len()), ("minutes", 0));
        // Old built-in styles are template ids already.
        let mut m: MeetingSettings = serde_json::from_str(r#"{"summary":"summary"}"#).unwrap();
        m.migrate();
        assert_eq!(m.template(None).name, "Brief summary");
        // A meeting's own pick wins; an unknown one falls back to the default.
        assert_eq!(m.template(Some("stand-up")).name, "Stand-up");
        assert_eq!(m.template(Some("gone")).id, "summary");
        // A user template can't shadow a built-in, and an empty one is left out.
        m.templates = vec![
            NoteTemplate { id: "minutes".into(), name: "Mine".into(), instructions: "x".into(), description: String::new(), built_in: false },
            NoteTemplate { id: "blank".into(), name: "Blank".into(), instructions: " ".into(), description: String::new(), built_in: false },
        ];
        assert_eq!(m.all_templates().len(), built_in_templates().len());
        assert_eq!(m.template(Some("minutes")).name, "Minutes");
        // `builtIn` goes out to the UI but is never read back.
        let t: NoteTemplate = serde_json::from_str(r#"{"id":"a","name":"A","instructions":"x","builtIn":true,"description":"d"}"#).unwrap();
        assert!(!t.built_in && t.description.is_empty());
        assert!(built_in_templates().iter().all(|t| !t.description.is_empty()));
        assert_eq!(serde_json::to_value(&built_in_templates()[0]).unwrap()["builtIn"], true);
    }

    #[test]
    fn meeting_models_default_per_engine() {
        let mut s = Settings::default();
        assert_eq!(s.meeting_engine_label(), s.engine_label());
        s.meeting.engine = LiveEngine::OpenaiRealtime;
        assert_eq!(s.meeting.model(), "gpt-live-transcribe");
        assert_eq!(s.meeting_engine_label(), "OpenAI Realtime · gpt-live-transcribe");
        s.meeting.model = " gpt-transcribe ".into();
        assert_eq!(s.meeting.model(), "gpt-transcribe");
        assert_eq!(LiveEngine::SarvamStreaming.provider(), Some("sarvam"));
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
