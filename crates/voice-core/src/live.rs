//! Live transcription of a call: the pause detector every engine shares, and
//! the messages of the two streaming APIs, OpenAI's Realtime transcription and
//! Sarvam's streaming speech-to-text. The WebSockets themselves are the app's.
//!
//! Neither API decides on its own where a turn ends here (`gpt-live-transcribe`
//! has no server VAD), so `Segmenter` does: it cuts 16 kHz audio into turns at
//! pauses. A streaming engine sends a turn's audio as it comes and commits (or
//! flushes) at its end; the piecewise engine transcribes each finished turn.

use std::collections::VecDeque;

use base64::Engine as _;
use serde_json::{json, Value};

use crate::audio::{self, THRESHOLD, WINDOW};
use crate::transcribe::sarvam_language;
use crate::SAMPLE_RATE;

/// Quiet windows (300 ms) kept from before speech starts, so its first sound isn't clipped.
const PRE_ROLL: usize = 15;
/// Loud windows (240 ms) a turn needs before it counts: a cough or a click doesn't.
const MIN_SPEECH: usize = 12;
/// Quiet windows (700 ms) that end a turn.
const PAUSE: usize = 35;
/// Past `SOFT_MAX` a shorter pause (200 ms) ends it, so a monologue still comes in pieces.
const SHORT_PAUSE: usize = 10;
/// 12 s.
const SOFT_MAX: usize = 600;
/// 25 s: cut here even mid-word.
const HARD_MAX: usize = 1250;

/// What `Segmenter` makes of the audio it's given.
#[derive(Debug, Clone, PartialEq)]
pub enum Turn {
    /// Someone started speaking, this long after the first sample.
    Begin { at_ms: u64 },
    /// The turn's audio, 16 kHz mono, from just before its first sound.
    Audio(Vec<f32>),
    /// They paused (or the turn ran long).
    End,
}

#[derive(Default)]
pub struct Segmenter {
    /// Samples short of a whole window.
    partial: Vec<f32>,
    /// Recent quiet windows, between turns.
    pre: VecDeque<Vec<f32>>,
    /// A turn's audio until it has `MIN_SPEECH` loud windows.
    pending: Vec<f32>,
    in_turn: bool,
    /// `Begin` was sent for the current turn.
    started: bool,
    loud: usize,
    quiet: usize,
    windows: usize,
    /// Samples seen so far, for timestamps.
    seen: u64,
    turn_start: u64,
}

impl Segmenter {
    pub fn new() -> Segmenter {
        Segmenter::default()
    }

    /// Feed 16 kHz mono audio; returns the turns it began, continued or ended.
    pub fn push(&mut self, samples: &[f32]) -> Vec<Turn> {
        self.partial.extend_from_slice(samples);
        let mut out = Vec::new();
        let whole = self.partial.len() / WINDOW * WINDOW;
        let windows: Vec<f32> = self.partial.drain(..whole).collect();
        for w in windows.chunks(WINDOW) {
            self.window(w, &mut out);
        }
        out
    }

    /// The audio has ended: finish the turn in progress, if it counts.
    pub fn flush(&mut self) -> Vec<Turn> {
        let mut out = Vec::new();
        if self.started {
            let rest = std::mem::take(&mut self.partial);
            if !rest.is_empty() {
                emit(&mut out, &rest);
            }
            out.push(Turn::End);
        }
        *self = Segmenter { seen: self.seen, ..Segmenter::default() };
        out
    }

    fn window(&mut self, w: &[f32], out: &mut Vec<Turn>) {
        let loud = audio::rms(w) > THRESHOLD;
        let at = self.seen;
        self.seen += w.len() as u64;
        if !self.in_turn {
            if !loud {
                self.pre.push_back(w.to_vec());
                if self.pre.len() > PRE_ROLL {
                    self.pre.pop_front();
                }
                return;
            }
            self.in_turn = true;
            self.started = false;
            (self.loud, self.quiet, self.windows) = (0, 0, 0);
            self.turn_start = at - (self.pre.len() * WINDOW) as u64;
            self.pending = self.pre.drain(..).flatten().collect();
        }
        self.windows += 1;
        if loud {
            self.loud += 1;
            self.quiet = 0;
        } else {
            self.quiet += 1;
        }
        if self.started {
            emit(out, w);
        } else {
            self.pending.extend_from_slice(w);
            if self.loud >= MIN_SPEECH {
                self.started = true;
                out.push(Turn::Begin { at_ms: self.turn_start * 1000 / SAMPLE_RATE as u64 });
                emit(out, &std::mem::take(&mut self.pending));
            }
        }
        let pause = if self.windows > SOFT_MAX { SHORT_PAUSE } else { PAUSE };
        if self.quiet >= pause || self.windows >= HARD_MAX {
            if self.started {
                out.push(Turn::End);
            }
            self.in_turn = false;
            self.started = false;
            self.pending.clear();
        }
    }
}

/// Add audio to `out`, joining it to the audio just before.
fn emit(out: &mut Vec<Turn>, samples: &[f32]) {
    if let Some(Turn::Audio(a)) = out.last_mut() {
        a.extend_from_slice(samples);
    } else {
        out.push(Turn::Audio(samples.to_vec()));
    }
}

/// What a streaming API said.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// More text of item `id`, still being spoken.
    Delta { id: String, text: String },
    /// Item `id`'s whole and final text.
    Final { id: String, text: String },
    /// Item `id` couldn't be transcribed; the session carries on.
    Failed { id: String, error: String },
    /// The session itself failed.
    Error(String),
    /// Nothing to act on.
    Other,
}

pub const OPENAI_URL: &str = "wss://api.openai.com/v1/realtime?intent=transcription";
/// The Realtime API takes 24 kHz PCM.
const OPENAI_RATE: u32 = 24_000;

/// The vocabulary as a list of terms, without the characters OpenAI's keywords refuse.
fn terms(vocabulary: &str) -> Vec<String> {
    vocabulary
        .split([',', '\n'])
        .map(|t| t.trim().replace(['<', '>', '\r'], ""))
        .filter(|t| !t.is_empty() && t.chars().count() <= 64)
        .take(100)
        .collect()
}

/// The first message of an OpenAI transcription session. Turns are committed
/// by the app, so there's no server VAD (`gpt-live-transcribe` has none).
pub fn openai_session(model: &str, language: Option<&str>, vocabulary: &str) -> Value {
    let mut transcription = json!({ "model": model });
    if let Some(lang) = language {
        transcription["languages"] = json!([lang]);
    }
    let words = terms(vocabulary);
    if !words.is_empty() {
        // The streaming model takes keywords; the turn-based ones a prompt.
        if model.starts_with("gpt-live") {
            transcription["keywords"] = json!(words);
        } else {
            transcription["prompt"] = json!(words.join(", "));
        }
    }
    json!({
        "type": "session.update",
        "session": {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": { "type": "audio/pcm", "rate": OPENAI_RATE },
                    "transcription": transcription,
                    "turn_detection": null,
                },
            },
        },
    })
}

/// Send 16 kHz audio, as the 24 kHz PCM16 the API takes.
pub fn openai_append(samples: &[f32]) -> Value {
    let pcm = audio::pcm16(&audio::resample(samples, SAMPLE_RATE, OPENAI_RATE));
    json!({ "type": "input_audio_buffer.append", "audio": base64::engine::general_purpose::STANDARD.encode(pcm) })
}

/// End the turn: what was appended since the last commit becomes one item.
pub fn openai_commit() -> Value {
    json!({ "type": "input_audio_buffer.commit" })
}

pub fn parse_openai(msg: &Value) -> Event {
    let id = || msg.get("item_id").and_then(Value::as_str).unwrap_or_default().to_string();
    let text = |key: &str| msg.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    match msg.get("type").and_then(Value::as_str).unwrap_or_default() {
        "conversation.item.input_audio_transcription.delta" => Event::Delta { id: id(), text: text("delta") },
        "conversation.item.input_audio_transcription.completed" => Event::Final { id: id(), text: text("transcript") },
        "conversation.item.input_audio_transcription.failed" => {
            Event::Failed { id: id(), error: error_message(msg.get("error")).unwrap_or_else(|| "transcription failed".into()) }
        }
        "error" => Event::Error(error_message(msg.get("error")).unwrap_or_else(|| "OpenAI sent an error".into())),
        _ => Event::Other,
    }
}

fn error_message(err: Option<&Value>) -> Option<String> {
    let err = err?;
    err.get("message").and_then(Value::as_str).or_else(|| err.as_str()).map(str::to_string)
}

/// Sarvam's streaming endpoint, for 16 kHz audio. `flush_signal` lets the app end a turn.
pub fn sarvam_url(model: &str, language: Option<&str>) -> String {
    format!(
        "wss://api.sarvam.ai/speech-to-text/ws?model={model}&language-code={}&sample_rate={SAMPLE_RATE}&flush_signal=true",
        sarvam_language(language)
    )
}

/// Send 16 kHz audio: each message is a small WAV file.
pub fn sarvam_audio(samples: &[f32]) -> Value {
    json!({
        "audio": {
            "data": base64::engine::general_purpose::STANDARD.encode(audio::encode_wav(samples)),
            "sample_rate": SAMPLE_RATE.to_string(),
            "encoding": "audio/wav",
        },
    })
}

/// End the turn: Sarvam transcribes what it has now instead of waiting for silence.
pub fn sarvam_flush() -> Value {
    json!({ "type": "flush" })
}

/// Sarvam sends each utterance once, finished; `seq` numbers them, as it gives no id of its own we can trust.
pub fn parse_sarvam(msg: &Value, seq: u64) -> Event {
    let data = msg.get("data");
    match msg.get("type").and_then(Value::as_str).unwrap_or_default() {
        "data" => Event::Final {
            id: format!("sarvam-{seq}"),
            text: data.and_then(|d| d.get("transcript")).and_then(Value::as_str).unwrap_or_default().to_string(),
        },
        "error" => Event::Error(
            data.and_then(|d| d.get("error").or_else(|| d.get("message")))
                .and_then(Value::as_str)
                .unwrap_or("Sarvam sent an error")
                .to_string(),
        ),
        _ => Event::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: usize = SAMPLE_RATE as usize / 1000;

    fn tone(ms: usize) -> Vec<f32> {
        (0..ms * MS).map(|i| if i % 2 == 0 { 0.1 } else { -0.1 }).collect()
    }

    fn quiet(ms: usize) -> Vec<f32> {
        vec![0.0; ms * MS]
    }

    fn feed(seg: &mut Segmenter, audio: &[f32]) -> Vec<Turn> {
        // In small, uneven pieces, as a microphone delivers it.
        audio.chunks(777).flat_map(|c| seg.push(c)).collect()
    }

    fn summary(turns: &[Turn]) -> Vec<String> {
        turns
            .iter()
            .map(|t| match t {
                Turn::Begin { at_ms } => format!("begin@{at_ms}"),
                Turn::Audio(a) => format!("audio{}", a.len() / MS),
                Turn::End => "end".into(),
            })
            .collect::<Vec<_>>()
            .into_iter()
            .fold(Vec::new(), |mut v: Vec<String>, s| {
                // Count audio once per run, so the test doesn't depend on chunking.
                if s.starts_with("audio") && v.last().is_some_and(|l| l.starts_with("audio")) {
                    let total = v.pop().unwrap()[5..].parse::<usize>().unwrap() + s[5..].parse::<usize>().unwrap();
                    v.push(format!("audio{total}"));
                } else {
                    v.push(s);
                }
                v
            })
    }

    #[test]
    fn cuts_turns_at_pauses_with_a_pre_roll() {
        let mut seg = Segmenter::new();
        let audio = [quiet(1000), tone(2000), quiet(1000), tone(1000), quiet(1000)].concat();
        let turns = feed(&mut seg, &audio);
        // Each turn starts 300 ms before its first sound and ends after a 700 ms pause.
        assert_eq!(summary(&turns), ["begin@700", "audio3000", "end", "begin@3700", "audio2000", "end"]);
        assert!(seg.flush().is_empty());
    }

    #[test]
    fn ignores_short_noises() {
        let mut seg = Segmenter::new();
        let audio = [quiet(500), tone(100), quiet(1000), tone(60), quiet(2000)].concat();
        assert!(feed(&mut seg, &audio).is_empty());
        assert!(seg.flush().is_empty());
    }

    #[test]
    fn flush_ends_a_turn_in_progress() {
        let mut seg = Segmenter::new();
        let turns = feed(&mut seg, &tone(1000));
        assert_eq!(summary(&turns), ["begin@0", "audio1000"]);
        assert_eq!(seg.flush(), [Turn::End]);
        // Timestamps carry on after a flush.
        let turns = feed(&mut seg, &[quiet(300), tone(500)].concat());
        assert_eq!(summary(&turns), ["begin@1000", "audio800"]);
    }

    #[test]
    fn long_speech_still_comes_in_pieces() {
        let mut seg = Segmenter::new();
        // 30 s without a pause: cut at 25 s.
        let turns = feed(&mut seg, &tone(30_000));
        assert_eq!(summary(&turns), ["begin@0", "audio25000", "end", "begin@25000", "audio5000"]);
        // Past 12 s, a 200 ms breath is enough.
        let mut seg = Segmenter::new();
        let turns = feed(&mut seg, &[tone(13_000), quiet(300), tone(1000)].concat());
        assert_eq!(summary(&turns), ["begin@0", "audio13200", "end", "begin@13200", "audio1100"]);
    }

    #[test]
    fn builds_openai_messages() {
        let s = openai_session("gpt-live-transcribe", Some("en"), "Sush, <Tauri>\nYammer");
        let input = &s["session"]["audio"]["input"];
        assert_eq!(s["type"], "session.update");
        assert_eq!(s["session"]["type"], "transcription");
        assert_eq!(input["format"]["rate"], 24_000);
        assert!(input["turn_detection"].is_null());
        assert_eq!(input["transcription"]["languages"], json!(["en"]));
        assert_eq!(input["transcription"]["keywords"], json!(["Sush", "Tauri", "Yammer"]));
        let s = openai_session("gpt-transcribe", None, "Sush");
        let t = &s["session"]["audio"]["input"]["transcription"];
        assert_eq!((t["prompt"].as_str(), t.get("languages")), (Some("Sush"), None));

        // 100 ms at 16 kHz is 2400 samples at 24 kHz: 4800 bytes.
        let append = openai_append(&tone(100));
        let pcm = base64::engine::general_purpose::STANDARD.decode(append["audio"].as_str().unwrap()).unwrap();
        assert_eq!((append["type"].as_str(), pcm.len()), (Some("input_audio_buffer.append"), 4800));
        assert_eq!(openai_commit()["type"], "input_audio_buffer.commit");
    }

    #[test]
    fn parses_openai_events() {
        let delta = json!({"type": "conversation.item.input_audio_transcription.delta", "item_id": "i1", "content_index": 0, "delta": "Hel"});
        assert_eq!(parse_openai(&delta), Event::Delta { id: "i1".into(), text: "Hel".into() });
        let done = json!({"type": "conversation.item.input_audio_transcription.completed", "item_id": "i1", "transcript": "Hello."});
        assert_eq!(parse_openai(&done), Event::Final { id: "i1".into(), text: "Hello.".into() });
        let failed = json!({"type": "conversation.item.input_audio_transcription.failed", "item_id": "i2", "error": {"message": "bad audio"}});
        assert_eq!(parse_openai(&failed), Event::Failed { id: "i2".into(), error: "bad audio".into() });
        let err = json!({"type": "error", "error": {"type": "invalid_request_error", "message": "Incorrect API key"}});
        assert_eq!(parse_openai(&err), Event::Error("Incorrect API key".into()));
        assert_eq!(parse_openai(&json!({"type": "session.updated"})), Event::Other);
    }

    #[test]
    fn builds_and_parses_sarvam_messages() {
        assert_eq!(
            sarvam_url("saaras:v4", Some("hi")),
            "wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v4&language-code=hi-IN&sample_rate=16000&flush_signal=true"
        );
        assert!(sarvam_url("saaras:v4", None).contains("language-code=unknown"));
        let msg = sarvam_audio(&tone(100));
        let wav = base64::engine::general_purpose::STANDARD.decode(msg["audio"]["data"].as_str().unwrap()).unwrap();
        assert_eq!(audio::decode_wav(&wav).unwrap().len(), 1600);
        assert_eq!((msg["audio"]["sample_rate"].as_str(), msg["audio"]["encoding"].as_str()), (Some("16000"), Some("audio/wav")));
        assert_eq!(sarvam_flush(), json!({"type": "flush"}));

        let data = json!({"type": "data", "data": {"request_id": "r", "transcript": "namaste", "language_code": "hi-IN"}});
        assert_eq!(parse_sarvam(&data, 3), Event::Final { id: "sarvam-3".into(), text: "namaste".into() });
        let err = json!({"type": "error", "data": {"error": "Invalid API key", "code": "401"}});
        assert_eq!(parse_sarvam(&err, 0), Event::Error("Invalid API key".into()));
        assert_eq!(parse_sarvam(&json!({"type": "events", "data": {"signal_type": "START_SPEECH"}}), 0), Event::Other);
    }
}
