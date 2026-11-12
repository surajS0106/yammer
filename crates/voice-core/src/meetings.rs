//! Meetings: a call's live transcript, the notes the user typed during it, and
//! the notes written from both once it ends. Each one is `meetings/<id>.json`
//! in the app data dir, so saving one mid-call doesn't rewrite all the others.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Who said it. The transcript can't tell the other people on a call apart,
/// nor the people around one microphone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Speaker {
    /// The microphone: the person running Yammer.
    You,
    /// The computer's sound output: everyone else on the call.
    Them,
    /// One microphone that hears everyone, the user included: a phone on the
    /// table, which can't hear a call's audio the way a computer can.
    Room,
}

impl Speaker {
    /// How the transcript names them.
    pub fn label(self) -> &'static str {
        match self {
            Speaker::You => "You",
            Speaker::Them => "Them",
            Speaker::Room => "Room",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// Unique within the meeting: a streaming item, or a turn.
    pub id: String,
    /// When it was said, from the start of the meeting.
    pub at_ms: u64,
    pub speaker: Speaker,
    pub text: String,
    /// Still being spoken: more text will replace this.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub partial: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    /// Unix time in milliseconds it started; also its file name.
    pub id: u64,
    /// Empty until the user or the notes give it one.
    #[serde(default)]
    pub title: String,
    pub started_at: u64,
    /// `None` while it's still being transcribed (or if Yammer quit mid-call).
    #[serde(default)]
    pub ended_at: Option<u64>,
    /// What transcribed it: "OpenAI Realtime · gpt-live-transcribe".
    #[serde(default)]
    pub engine: String,
    #[serde(default)]
    pub segments: Vec<Segment>,
    /// What the user typed during the call.
    #[serde(default)]
    pub notes: String,
    /// The notes written from the transcript (Markdown).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// The model that wrote them: "Anthropic · claude-haiku-5-5".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_by: Option<String>,
    /// Why writing the notes failed, if it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Something that went wrong while transcribing, which may have left gaps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

/// A meeting as the list shows it, without the whole transcript.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub id: u64,
    pub title: String,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub words: usize,
    /// The start of the notes, or of the transcript.
    pub preview: String,
    pub has_summary: bool,
}

/// "03:07", or "1:02:07" past an hour.
pub fn clock(ms: u64) -> String {
    let s = ms / 1000;
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
    } else {
        format!("{:02}:{:02}", s / 60, s % 60)
    }
}

impl Meeting {
    pub fn new(id: u64, engine: String) -> Meeting {
        Meeting {
            id,
            title: String::new(),
            started_at: id,
            ended_at: None,
            engine,
            segments: Vec::new(),
            notes: String::new(),
            summary: None,
            summary_by: None,
            error: None,
            notice: None,
        }
    }

    /// Add a segment, or replace the one with its id. Kept in order of when it was said.
    pub fn upsert(&mut self, segment: Segment) {
        match self.segments.iter_mut().find(|s| s.id == segment.id) {
            Some(s) => *s = segment,
            None => {
                let at = self.segments.partition_point(|s| s.at_ms <= segment.at_ms);
                self.segments.insert(at, segment);
            }
        }
    }

    /// Transcription is over: what's left partial counts as said, and empty segments go.
    pub fn finish(&mut self, ended_at: u64) {
        self.segments.retain(|s| !s.text.trim().is_empty());
        for s in &mut self.segments {
            s.partial = false;
        }
        self.ended_at = Some(ended_at);
    }

    /// One line per segment, "[03:07] Them: …", with a speaker's consecutive lines kept apart.
    pub fn transcript(&self) -> String {
        self.segments
            .iter()
            .filter(|s| !s.text.trim().is_empty())
            .map(|s| format!("[{}] {}: {}", clock(s.at_ms), s.speaker.label(), s.text.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn words(&self) -> usize {
        self.segments.iter().map(|s| s.text.split_whitespace().count()).sum()
    }

    pub fn overview(&self) -> Overview {
        let source = match &self.summary {
            Some(s) => strip_markdown(s),
            None => self.segments.iter().map(|s| s.text.trim()).collect::<Vec<_>>().join(" "),
        };
        let preview: String = source.chars().take(160).collect();
        Overview {
            id: self.id,
            title: self.title.clone(),
            started_at: self.started_at,
            ended_at: self.ended_at,
            words: self.words(),
            preview: preview.trim().to_string(),
            has_summary: self.summary.is_some(),
        }
    }
}

/// The text of Markdown notes on one line, without headings' and bullets' marks.
fn strip_markdown(md: &str) -> String {
    md.lines()
        .map(|l| l.trim().trim_start_matches(['#', '-', '*', '>', ' ']).trim_start_matches("[ ] ").trim_start_matches("[x] "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .replace("**", "")
}

/// Split the title off notes that start with a "# Title" line.
pub fn split_title(notes: &str) -> (Option<String>, String) {
    let trimmed = notes.trim_start();
    if let Some(rest) = trimmed.strip_prefix("# ") {
        let (title, body) = rest.split_once('\n').unwrap_or((rest, ""));
        let title = title.trim().trim_matches('*').trim();
        if !title.is_empty() {
            return (Some(title.to_string()), body.trim().to_string());
        }
    }
    (None, notes.trim().to_string())
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Store {
        Store { dir }
    }

    fn path(&self, id: u64) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    /// Every saved meeting, newest first.
    pub fn list(&self) -> Vec<Overview> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return Vec::new() };
        let mut list: Vec<Overview> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| read(&e.path()))
            .map(|m| m.overview())
            .collect();
        list.sort_by_key(|o| std::cmp::Reverse(o.started_at));
        list
    }

    pub fn get(&self, id: u64) -> Option<Meeting> {
        read(&self.path(id))
    }

    /// Write atomically (temp file + rename), so a crash mid-call never leaves half a file.
    pub fn save(&self, meeting: &Meeting) -> crate::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let path = self.path(meeting.id);
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(meeting)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn delete(&self, id: u64) -> crate::Result<()> {
        match std::fs::remove_file(self.path(id)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }
}

fn read(path: &Path) -> Option<Meeting> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, at_ms: u64, speaker: Speaker, text: &str) -> Segment {
        Segment { id: id.into(), at_ms, speaker, text: text.into(), partial: false }
    }

    #[test]
    fn keeps_segments_in_order_and_replaces_partials() {
        let mut m = Meeting::new(1_000, "x".into());
        m.upsert(seg("b", 5_000, Speaker::Them, "Sounds good."));
        m.upsert(Segment { partial: true, ..seg("a", 1_000, Speaker::You, "Shall we") });
        m.upsert(seg("c", 5_000, Speaker::You, "Great."));
        m.upsert(seg("a", 1_000, Speaker::You, "Shall we start?"));
        m.upsert(seg("d", 9_000, Speaker::Them, " "));
        assert_eq!(m.segments.iter().map(|s| s.id.as_str()).collect::<String>(), "abcd");
        assert_eq!(m.transcript(), "[00:01] You: Shall we start?\n[00:05] Them: Sounds good.\n[00:05] You: Great.");
        assert_eq!(m.words(), 6);
        m.finish(20_000);
        assert_eq!((m.segments.len(), m.ended_at), (3, Some(20_000)));
        assert!(m.segments.iter().all(|s| !s.partial));
    }

    #[test]
    fn formats_clocks() {
        assert_eq!(clock(0), "00:00");
        assert_eq!(clock(187_400), "03:07");
        assert_eq!(clock(3_727_000), "1:02:07");
    }

    #[test]
    fn splits_titles_off_notes() {
        assert_eq!(split_title("# Q3 planning\n\n## Summary\nWe met."), (Some("Q3 planning".into()), "## Summary\nWe met.".into()));
        assert_eq!(split_title("## Summary\nWe met."), (None, "## Summary\nWe met.".into()));
        assert_eq!(split_title("# **Sync**"), (Some("Sync".into()), String::new()));
    }

    #[test]
    fn previews_the_notes_or_the_transcript() {
        let mut m = Meeting::new(1, "x".into());
        m.upsert(seg("a", 0, Speaker::You, "Hello there."));
        assert_eq!(m.overview().preview, "Hello there.");
        m.summary = Some("## Summary\n- **Shipped** the beta\n- [ ] Ana: send notes".into());
        let o = m.overview();
        assert_eq!((o.preview.as_str(), o.has_summary, o.words), ("Summary Shipped the beta Ana: send notes", true, 2));
    }

    #[test]
    fn saves_lists_and_deletes() {
        let dir = std::env::temp_dir().join(format!("voice-core-meetings-{}", std::process::id()));
        let store = Store::new(dir.clone());
        assert!(store.list().is_empty());
        let mut a = Meeting::new(100, "x".into());
        a.notes = "ask about budget".into();
        let b = Meeting { title: "Standup".into(), ..Meeting::new(200, "y".into()) };
        store.save(&a).unwrap();
        store.save(&b).unwrap();
        assert_eq!(store.list().iter().map(|o| o.id).collect::<Vec<_>>(), [200, 100]);
        assert_eq!(store.get(100), Some(a));
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!((v["startedAt"].as_u64(), v.get("summary")), (Some(200), None));
        store.delete(100).unwrap();
        store.delete(100).unwrap();
        assert_eq!(store.list().len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
