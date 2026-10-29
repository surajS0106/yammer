//! Scratchpad notes, newest first, kept as `scratchpad.json` in the app data
//! dir beside the history. The UI owns their order and content; this only
//! stores the list.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub text: String,
    /// Unix time in milliseconds.
    pub updated_at: u64,
}

/// The saved notes; a missing or unreadable file gives none.
pub fn load(path: &Path) -> Vec<Note> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Write atomically (temp file + rename), so a crash never leaves half a file.
pub fn save(path: &Path, notes: &[Note]) -> crate::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(notes)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_loads() {
        let dir = std::env::temp_dir().join(format!("voice-core-scratchpad-{}", std::process::id()));
        let path = dir.join("scratchpad.json");
        assert!(load(&path).is_empty());
        let notes = vec![Note { id: "a".into(), text: "To do".into(), updated_at: 5 }];
        save(&path, &notes).unwrap();
        assert_eq!(load(&path), notes);
        let v = serde_json::to_value(&notes[0]).unwrap();
        assert_eq!(v["updatedAt"], 5);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
