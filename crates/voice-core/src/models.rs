//! The whisper.cpp models offered for local transcription. Each is pinned
//! by size and SHA-256 so a partial or tampered download is never loaded.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    pub size_bytes: u64,
    #[serde(skip)]
    pub sha256: &'static str,
    /// English-only models are faster and more accurate for English, but can't do other languages.
    pub english_only: bool,
    pub description: &'static str,
}

pub const DEFAULT_MODEL: &str = "base.en";

pub const MODELS: &[Model] = &[
    Model {
        id: "tiny.en",
        label: "Tiny (English)",
        file: "ggml-tiny.en.bin",
        size_bytes: 77_704_715,
        sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
        english_only: true,
        description: "Fastest. Good for short notes on slower machines.",
    },
    Model {
        id: "base.en",
        label: "Base (English)",
        file: "ggml-base.en.bin",
        size_bytes: 147_964_211,
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        english_only: true,
        description: "Recommended. Fast and accurate on most computers.",
    },
    Model {
        id: "small.en",
        label: "Small (English)",
        file: "ggml-small.en.bin",
        size_bytes: 487_614_201,
        sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
        english_only: true,
        description: "More accurate, about three times slower than Base.",
    },
    Model {
        id: "base",
        label: "Base (multilingual)",
        file: "ggml-base.bin",
        size_bytes: 147_951_465,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        english_only: false,
        description: "99 languages, fast.",
    },
    Model {
        id: "small",
        label: "Small (multilingual)",
        file: "ggml-small.bin",
        size_bytes: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        english_only: false,
        description: "99 languages, more accurate.",
    },
    Model {
        id: "large-v3-turbo-q5",
        label: "Large v3 Turbo (multilingual)",
        file: "ggml-large-v3-turbo-q5_0.bin",
        size_bytes: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        english_only: false,
        description: "Best accuracy. Wants a fast CPU or Apple Silicon.",
    },
];

pub fn find(id: &str) -> Option<&'static Model> {
    MODELS.iter().find(|m| m.id == id)
}

impl Model {
    pub fn url(&self) -> String {
        format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", self.file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_is_in_the_catalog() {
        assert!(find(DEFAULT_MODEL).is_some());
        assert!(find("nope").is_none());
    }

    #[test]
    fn catalog_entries_are_well_formed() {
        for m in MODELS {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(m.file.ends_with(".bin"), "{}", m.id);
            assert_eq!(m.english_only, m.id.contains(".en"), "{}", m.id);
        }
        let mut ids: Vec<_> = MODELS.iter().map(|m| m.id).collect();
        ids.dedup();
        assert_eq!(ids.len(), MODELS.len());
    }
}
