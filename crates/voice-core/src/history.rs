//! Past dictations, newest first, kept as `history.json` in the app data dir.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const MAX_ENTRIES: usize = 500;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u64,
    /// Unix time in milliseconds.
    pub at: u64,
    /// What was pasted.
    pub text: String,
    /// The transcript before cleanup, when cleanup changed it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    pub duration_ms: u64,
    /// "local:base.en", "cloud:whisper-large-v3-turbo", …
    pub engine: String,
}

pub struct History {
    path: PathBuf,
    entries: Vec<Entry>,
}

impl History {
    pub fn load(path: &Path) -> History {
        let entries = std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        History { path: path.to_path_buf(), entries }
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// Add an entry (its id is assigned here) and save. Returns the entry.
    pub fn push(&mut self, mut entry: Entry) -> crate::Result<Entry> {
        entry.id = self.entries.iter().map(|e| e.id).max().map_or(1, |id| id + 1);
        self.entries.insert(0, entry.clone());
        self.entries.truncate(MAX_ENTRIES);
        self.save()?;
        Ok(entry)
    }

    pub fn delete(&mut self, id: u64) -> crate::Result<()> {
        self.entries.retain(|e| e.id != id);
        self.save()
    }

    pub fn clear(&mut self) -> crate::Result<()> {
        self.entries.clear();
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
        Entry { id: 0, at: 1, text: text.into(), raw: None, duration_ms: 1000, engine: "local:base.en".into() }
    }

    #[test]
    fn pushes_newest_first_caps_and_persists() {
        let dir = std::env::temp_dir().join(format!("voice-core-history-{}", std::process::id()));
        let path = dir.join("history.json");
        let mut h = History::load(&path);
        assert!(h.entries().is_empty());

        let first = h.push(entry("one")).unwrap();
        let second = h.push(entry("two")).unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(h.entries()[0].text, "two");

        let reloaded = History::load(&path);
        assert_eq!(reloaded.entries(), h.entries());

        h.delete(first.id).unwrap();
        assert_eq!(h.entries().len(), 1);

        for i in 0..MAX_ENTRIES + 5 {
            h.push(entry(&i.to_string())).unwrap();
        }
        assert_eq!(h.entries().len(), MAX_ENTRIES);

        h.clear().unwrap();
        assert!(History::load(&path).entries().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
