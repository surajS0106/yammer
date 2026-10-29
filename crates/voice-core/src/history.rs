//! Past dictations, newest first, kept as `history.json` in the app data dir.
//! The newest few keep their audio, as `recordings/<id>.wav` beside it, so
//! they can be transcribed again.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::audio;

pub const MAX_ENTRIES: usize = 500;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u64,
    /// Unix time in milliseconds.
    pub at: u64,
    /// What was pasted. Empty when the dictation failed (`error`).
    pub text: String,
    /// The transcript before cleanup, when cleanup changed it. For an edit, the spoken instruction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    pub duration_ms: u64,
    /// "local:base.en", "cloud:whisper-large-v3-turbo", …
    pub engine: String,
    /// For display: "On-device · Base (English)", "Sarvam · saaras:v4". Older entries lack it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine_label: Option<String>,
    /// The cleanup model ("Sarvam · sarvam-105b"), when cleanup changed the text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cleanup: Option<String>,
    /// ISO 639-1 code of the language spoken ("en", "hi"): the one whisper detected, or the one set in
    /// Settings. None when a cloud engine auto-detected it, and on older entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Id of the transform its hotkey dictated with, rather than the active one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
    /// An edit by voice: the selected text it rewrote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<String>,
    /// Why the dictation failed; it can be retried while it has its audio.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Its recording is kept (`History::audio`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub audio: bool,
}

pub struct History {
    path: PathBuf,
    audio_dir: PathBuf,
    entries: Vec<Entry>,
}

impl History {
    pub fn load(path: &Path) -> History {
        let entries = std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        History { path: path.to_path_buf(), audio_dir: path.with_file_name("recordings"), entries }
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn get(&self, id: u64) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id == id)
    }

    fn audio_path(&self, id: u64) -> PathBuf {
        self.audio_dir.join(format!("{id}.wav"))
    }

    /// Add an entry (its id is assigned here) and save. `samples` is its 16 kHz
    /// recording, kept if it's among the newest `keep`. Returns the entry.
    pub fn push(&mut self, mut entry: Entry, samples: Option<&[f32]>, keep: usize) -> crate::Result<Entry> {
        entry.id = self.entries.iter().map(|e| e.id).max().map_or(1, |id| id + 1);
        entry.audio = false;
        if let Some(samples) = samples.filter(|_| keep > 0) {
            std::fs::create_dir_all(&self.audio_dir)?;
            std::fs::write(self.audio_path(entry.id), audio::encode_wav(samples))?;
            entry.audio = true;
        }
        self.entries.insert(0, entry);
        for gone in self.entries.split_off(self.entries.len().min(MAX_ENTRIES)) {
            self.drop_audio(&gone);
        }
        self.keep_audio(keep);
        self.save()?;
        Ok(self.entries[0].clone())
    }

    /// Replace the entry with `entry.id`, keeping its time and audio, and save.
    pub fn update(&mut self, mut entry: Entry) -> crate::Result<Entry> {
        let Some(old) = self.entries.iter_mut().find(|e| e.id == entry.id) else {
            return Err(crate::Error::Config("That dictation is no longer in your history.".into()));
        };
        (entry.at, entry.audio) = (old.at, old.audio);
        *old = entry.clone();
        self.save()?;
        Ok(entry)
    }

    /// The entry's recording, if it was kept.
    pub fn audio(&self, id: u64) -> Option<Vec<f32>> {
        self.get(id).filter(|e| e.audio)?;
        audio::decode_wav(&std::fs::read(self.audio_path(id)).ok()?).ok()
    }

    /// Delete recordings beyond the newest `keep`. Doesn't save.
    fn keep_audio(&mut self, keep: usize) {
        let extra: Vec<Entry> = self.entries.iter().filter(|e| e.audio).skip(keep).cloned().collect();
        for e in &extra {
            self.drop_audio(e);
        }
        for e in self.entries.iter_mut().filter(|e| extra.iter().any(|x| x.id == e.id)) {
            e.audio = false;
        }
    }

    fn drop_audio(&self, entry: &Entry) {
        if entry.audio {
            let _ = std::fs::remove_file(self.audio_path(entry.id));
        }
    }

    /// Apply the retention settings: drop entries older than `days` (0 keeps
    /// them all) and recordings beyond the newest `keep`. Saves if anything went.
    pub fn prune(&mut self, now_ms: u64, days: u32, keep: usize) -> crate::Result<()> {
        let before = self.entries.clone();
        if days > 0 {
            let cutoff = now_ms.saturating_sub(days as u64 * DAY_MS);
            let (kept, old): (Vec<Entry>, Vec<Entry>) = std::mem::take(&mut self.entries).into_iter().partition(|e| e.at >= cutoff);
            self.entries = kept;
            for e in &old {
                self.drop_audio(e);
            }
        }
        self.keep_audio(keep);
        if self.entries != before {
            self.save()?;
        }
        Ok(())
    }

    pub fn delete(&mut self, id: u64) -> crate::Result<()> {
        if let Some(e) = self.get(id) {
            self.drop_audio(e);
        }
        self.entries.retain(|e| e.id != id);
        self.save()
    }

    pub fn clear(&mut self) -> crate::Result<()> {
        self.entries.clear();
        let _ = std::fs::remove_dir_all(&self.audio_dir);
        self.save()
    }

    fn save(&self) -> crate::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(&self.entries)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(text: &str) -> Entry {
        Entry {
            id: 0,
            at: 1,
            text: text.into(),
            raw: None,
            duration_ms: 1000,
            engine: "local:base.en".into(),
            engine_label: None,
            cleanup: None,
            language: None,
            transform: None,
            selection: None,
            error: None,
            audio: false,
        }
    }

    fn temp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("voice-core-{name}-{}", std::process::id()))
    }

    #[test]
    fn pushes_newest_first_caps_and_persists() {
        let dir = temp("history");
        let path = dir.join("history.json");
        let mut h = History::load(&path);
        assert!(h.entries().is_empty());

        let first = h.push(entry("one"), None, 0).unwrap();
        let second = h.push(entry("two"), None, 0).unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(h.entries()[0].text, "two");

        let reloaded = History::load(&path);
        assert_eq!(reloaded.entries(), h.entries());

        h.delete(first.id).unwrap();
        assert_eq!(h.entries().len(), 1);

        for i in 0..MAX_ENTRIES + 5 {
            h.push(entry(&i.to_string()), None, 0).unwrap();
        }
        assert_eq!(h.entries().len(), MAX_ENTRIES);

        h.clear().unwrap();
        assert!(History::load(&path).entries().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_the_newest_recordings() {
        let dir = temp("history-audio");
        let mut h = History::load(&dir.join("history.json"));
        let clip = vec![0.25; 1600];
        let a = h.push(entry("a"), Some(&clip), 2).unwrap();
        let b = h.push(entry("b"), Some(&clip), 2).unwrap();
        assert!(a.audio && b.audio);
        let decoded = h.audio(a.id).unwrap();
        assert_eq!(decoded.len(), clip.len());
        assert!((decoded[0] - 0.25).abs() < 1e-3);

        let c = h.push(entry("c"), Some(&clip), 2).unwrap();
        assert!(h.audio(c.id).is_some() && h.audio(b.id).is_some());
        assert!(h.audio(a.id).is_none() && !h.get(a.id).unwrap().audio);
        assert!(!dir.join("recordings").join(format!("{}.wav", a.id)).exists());
        assert!(!h.push(entry("d"), Some(&clip), 0).unwrap().audio);

        h.delete(c.id).unwrap();
        assert!(!dir.join("recordings").join(format!("{}.wav", c.id)).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn updates_in_place_and_prunes_old_entries() {
        let dir = temp("history-prune");
        let mut h = History::load(&dir.join("history.json"));
        let old = h.push(Entry { at: 0, ..entry("old") }, Some(&[0.0; 160]), 5).unwrap();
        let new = h.push(Entry { at: 10 * DAY_MS, error: Some("offline".into()), ..entry("") }, None, 5).unwrap();

        let fixed = h.update(Entry { id: new.id, at: 0, text: "fixed".into(), ..entry("") }).unwrap();
        assert_eq!((fixed.at, fixed.error), (10 * DAY_MS, None));
        assert_eq!(h.get(new.id).unwrap().text, "fixed");
        assert!(h.update(Entry { id: 999, ..entry("") }).is_err());

        h.prune(10 * DAY_MS, 30, 5).unwrap();
        assert_eq!(h.entries().len(), 2);
        h.prune(10 * DAY_MS, 7, 5).unwrap();
        assert_eq!(h.entries().len(), 1);
        assert!(h.get(old.id).is_none());
        assert!(!dir.join("recordings").join(format!("{}.wav", old.id)).exists());
        assert_eq!(History::load(&dir.join("history.json")).entries().len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
