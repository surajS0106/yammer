//! Cloud speech-to-text (ported from sush-core). Audio goes in as a WAV file
//! and plain text comes out, over one of two wire formats:
//! `/audio/transcriptions` (OpenAI, Groq, Azure: whisper and gpt-4o-transcribe
//! models), or Ollama's native chat with an audio-capable model.

use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use crate::error::check_status;
use crate::settings::{CloudStt, SttApi};
use crate::{Error, Result};

const OLLAMA_PROMPT: &str = "Transcribe this audio verbatim. Output only the transcription, with punctuation. \
If there is no speech, output nothing.";

pub struct Options<'a> {
    /// ISO 639-1 code; `None` lets the service detect it.
    pub language: Option<&'a str>,
    /// Terms to bias recognition toward.
    pub vocabulary: &'a str,
}

/// Transcribe a 16 kHz mono WAV clip.
pub async fn transcribe(cfg: &CloudStt, key: Option<&str>, http: &reqwest::Client, wav: Vec<u8>, opts: Options<'_>) -> Result<String> {
    if cfg.base_url.trim().is_empty() || cfg.model.trim().is_empty() {
        return Err(Error::Config("Choose a speech provider and model in Settings → Engine.".into()));
    }
    let base = cfg.base_url.trim().trim_end_matches('/');
    let text = match cfg.api {
        SttApi::Transcriptions => {
            let file = reqwest::multipart::Part::bytes(wav).file_name("audio.wav").mime_str("audio/wav")?;
            let mut form = reqwest::multipart::Form::new()
                .text("model", cfg.model.trim().to_string())
                .text("response_format", "json")
                .part("file", file);
            if let Some(lang) = opts.language {
                form = form.text("language", lang.to_string());
            }
            if !opts.vocabulary.trim().is_empty() {
                form = form.text("prompt", opts.vocabulary.trim().to_string());
            }
            let mut req = http.post(format!("{base}/audio/transcriptions")).multipart(form).timeout(Duration::from_secs(120));
            if let Some(key) = key {
                req = req.bearer_auth(key);
            }
            let resp = req.send().await.map_err(Error::sending("the speech service"))?;
            parse_transcription(&check_status("Transcription", resp).await?.json().await?)?
        }
        SttApi::OllamaChat => {
            let audio = base64::engine::general_purpose::STANDARD.encode(&wav);
            let body = json!({
                "model": cfg.model.trim(),
                "stream": false,
                // Gemma-style models think by default, which wastes time and garbles transcripts.
                "think": false,
                "options": { "temperature": 0 },
                "messages": [{ "role": "user", "content": OLLAMA_PROMPT, "images": [audio] }],
            });
            let mut req = http.post(format!("{}/api/chat", ollama_root(base))).json(&body).timeout(Duration::from_secs(120));
            if let Some(key) = key {
                req = req.bearer_auth(key);
            }
            let resp = req.send().await.map_err(Error::sending("Ollama"))?;
            parse_ollama(&check_status("Ollama", resp).await?.json().await?)?
        }
    };
    Ok(text.trim().to_string())
}

fn parse_transcription(body: &Value) -> Result<String> {
    body.get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| Error::Decode("transcription response has no `text`".into()))
}

fn parse_ollama(body: &Value) -> Result<String> {
    body.pointer("/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| Error::Decode("Ollama response has no message content".into()))
}

/// Ollama is usually configured with its OpenAI-compatible `/v1` URL; the
/// native API lives at the server root.
fn ollama_root(base_url: &str) -> &str {
    let base = base_url.trim_end_matches('/');
    base.strip_suffix("/v1").unwrap_or(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ollama_root_strips_openai_suffix() {
        assert_eq!(ollama_root("http://localhost:11434/v1"), "http://localhost:11434");
        assert_eq!(ollama_root("http://localhost:11434/v1/"), "http://localhost:11434");
        assert_eq!(ollama_root("http://localhost:11434"), "http://localhost:11434");
    }

    #[test]
    fn parses_responses() {
        assert_eq!(parse_transcription(&json!({"text": "hi there"})).unwrap(), "hi there");
        assert!(parse_transcription(&json!({"error": "x"})).is_err());
        assert_eq!(parse_ollama(&json!({"message": {"role": "assistant", "content": "hello"}})).unwrap(), "hello");
        assert!(parse_ollama(&json!({})).is_err());
    }

    #[tokio::test]
    async fn rejects_missing_config() {
        let cfg = CloudStt { base_url: "".into(), ..CloudStt::default() };
        let err = transcribe(&cfg, None, &reqwest::Client::new(), vec![], Options { language: None, vocabulary: "" }).await;
        assert!(matches!(err, Err(Error::Config(_))));
    }
}
