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
    /// The template they were written with (`NoteTemplate::id`); `None` before any were.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    /// The calendar event it was recorded during, if there was one: its title and who was invited.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<crate::calendar::Event>,
    /// Questions asked about this meeting, and their answers, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chat: Vec<ChatTurn>,
    /// Why writing the notes failed, if it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Something that went wrong while transcribing, which may have left gaps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChatRole {
    User,
    Assistant,
}

/// One message of a meeting's Ask thread.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurn {
    pub role: ChatRole,
    pub text: String,
    /// Unix time in milliseconds.
    pub at: u64,
}

/// A meeting that matches a search, and where.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub id: u64,
    pub title: String,
    pub started_at: u64,
    /// Where the best match is: "title", "notes" (the user's), "summary" (the written notes) or "transcript".
    pub field: &'static str,
    /// The text around that match, on one line.
    pub snippet: String,
    /// How many times the search's words appear in the meeting.
    pub score: usize,
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
    /// Who was invited, from its calendar event: names only.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub attendees: Vec<String>,
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
            template: None,
            event: None,
            chat: Vec::new(),
            error: None,
            notice: None,
        }
    }

    /// Take these segments out of the transcript. Returns how many went.
    pub fn delete_segments(&mut self, ids: &[String]) -> usize {
        let before = self.segments.len();
        self.segments.retain(|s| !ids.contains(&s.id));
        before - self.segments.len()
    }

    /// Whether every word of `query` is somewhere in this meeting, and if so the best place to show.
    /// Case-insensitive; `None` for an empty query.
    pub fn search(&self, query: &str) -> Option<Hit> {
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        if words.is_empty() {
            return None;
        }
        let transcript = self.segments.iter().map(|s| s.text.trim()).collect::<Vec<_>>().join(" ");
        let summary = self.summary.as_deref().map(strip_markdown).unwrap_or_default();
        // In the order a match is worth showing: a title says the most, the transcript the least.
        let fields =
            [("title", self.title.as_str()), ("summary", summary.as_str()), ("notes", self.notes.as_str()), ("transcript", transcript.as_str())];
        let lower: Vec<String> = fields.iter().map(|(_, text)| text.to_lowercase()).collect();
        if !words.iter().all(|w| lower.iter().any(|l| l.contains(w.as_str()))) {
            return None;
        }
        let score = words.iter().map(|w| lower.iter().map(|l| l.matches(w.as_str()).count()).sum::<usize>()).sum();
        // The first field holding the most of the words; its first match centres the snippet.
        let (i, _) = lower
            .iter()
            .enumerate()
            .max_by_key(|(i, l)| (words.iter().filter(|w| l.contains(w.as_str())).count(), std::cmp::Reverse(*i)))
            .expect("four fields");
        let at = words.iter().filter_map(|w| lower[i].find(w.as_str())).min().unwrap_or(0);
        Some(Hit {
            id: self.id,
            title: self.title.clone(),
            started_at: self.started_at,
            field: fields[i].0,
            snippet: snippet(fields[i].1, lower[i][..at].chars().count()),
            score,
        })
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

    /// Who was invited, as the notes prompt lists them: "Ana Lopez (ana@example.com)", one a line.
    pub fn attendees(&self) -> String {
        let people = self.event.iter().flat_map(|e| &e.attendees);
        people
            .map(|a| match &a.email {
                Some(email) if *email != a.name => format!("{} ({email})", a.name),
                _ => a.name.clone(),
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn words(&self) -> usize {
        self.segments.iter().map(|s| s.text.split_whitespace().count()).sum()
    }

    pub fn overview(&self) -> Overview {
        let source = match &self.summary {
            // Headings like "## Summary" say nothing a preview line can use.
            Some(s) => strip_markdown(&s.lines().filter(|l| !l.trim_start().starts_with('#')).collect::<Vec<_>>().join("\n")),
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
            attendees: self.event.iter().flat_map(|e| e.attendees.iter().map(|a| a.name.clone())).collect(),
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

/// About 140 characters of `text` around its `at`th character, on one line, with "…" where it was cut.
fn snippet(text: &str, at: usize) -> String {
    const BEFORE: usize = 40;
    const LEN: usize = 140;
    let chars: Vec<char> = text.chars().map(|c| if c.is_whitespace() { ' ' } else { c }).collect();
    let start = at.min(chars.len()).saturating_sub(BEFORE);
    let end = (start + LEN).min(chars.len());
    let mut out: String = chars[start..end].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out
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

    /// The saved meetings that have every word of `query`, best first (then newest).
    pub fn search(&self, query: &str) -> Vec<Hit> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return Vec::new() };
        let mut hits: Vec<Hit> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| read(&e.path()))
            .filter_map(|m| m.search(query))
            .collect();
        sort_hits(&mut hits);
        hits
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

/// Best match first, then newest.
pub fn sort_hits(hits: &mut [Hit]) {
    hits.sort_by_key(|h| (std::cmp::Reverse(h.score), std::cmp::Reverse(h.started_at)));
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
        assert_eq!((o.preview.as_str(), o.has_summary, o.words), ("Shipped the beta Ana: send notes", true, 2));
    }

    #[test]
    fn deletes_segments() {
        let mut m = Meeting::new(1, "x".into());
        m.upsert(seg("a", 0, Speaker::You, "Keep."));
        m.upsert(seg("b", 1, Speaker::Them, "Off the record."));
        assert_eq!(m.delete_segments(&["b".into(), "zz".into()]), 1);
        assert_eq!(m.transcript(), "[00:00] You: Keep.");
    }

    #[test]
    fn searches_a_meeting() {
        let mut m = Meeting { title: "Pricing sync".into(), ..Meeting::new(5, "x".into()) };
        m.upsert(seg("a", 0, Speaker::Them, "We could raise the price of the Pro plan next quarter."));
        m.notes = "ask about the budget".into();
        assert!(m.search("  ").is_none());
        // Every word has to be there, in any field and any case.
        assert!(m.search("budget unicorn").is_none());
        let hit = m.search("PRO budget").unwrap();
        assert_eq!((hit.field, hit.snippet.as_str(), hit.score), ("notes", "ask about the budget", 2));
        assert!(m.search("raise quarter").unwrap().snippet.starts_with("We could raise"));
        // The title outranks the rest when it has as many of the words.
        assert_eq!(m.search("pricing").unwrap().field, "title");
        m.summary = Some("## Summary\n- **Pricing** moves to Pro".into());
        let hit = m.search("pricing pro").unwrap();
        assert_eq!((hit.field, hit.snippet.as_str()), ("summary", "Summary Pricing moves to Pro"));
        assert_eq!(hit.score, 4);
    }

    #[test]
    fn snippets_are_cut_around_the_match() {
        let text = format!("{} needle {}", "a ".repeat(60), "b ".repeat(80));
        let s = snippet(&text, 120);
        assert!(s.starts_with('…') && s.ends_with('…') && s.contains("needle"));
        assert_eq!(snippet("short\ntext", 0), "short text");
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
        assert!(v.get("chat").is_none() && v.get("template").is_none());
        assert_eq!(store.search("budget").iter().map(|h| h.id).collect::<Vec<_>>(), [100]);
        assert_eq!(store.search("standup")[0].field, "title");
        store.delete(100).unwrap();
        store.delete(100).unwrap();
        assert_eq!(store.list().len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
