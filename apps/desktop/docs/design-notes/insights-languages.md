# Insights: Languages — Design Notes

Last updated: 2026-10-19

## What changed

### 2026-10-19
- History entries record the language spoken as an ISO 639-1 code. The field is optional, and older files still load (`crates/voice-core/src/history.rs`, `src/lib/tauri.ts`).
- `whisper::run` returns the language with the text. That is the one passed in or, when set to auto, the one whisper detected (`full_lang_id_from_state`) (`src-tauri/src/whisper.rs`).
- The dictation pipeline stores that language for local dictations, and the language set in Settings for cloud dictations (`src-tauri/src/dictation.rs`).
- `languageOf`, `languageName` and `languageBreakdown` count words per language, most first. Past five languages, the rest fold into "Other". Older `*.en` local entries count as English (`src/lib/stats.ts`).
- Insights has a new "Languages" panel: a pill `FunnelChart` of words per language, with each language's share of all words, centred and capped at 560px. Dictations without a recorded language are counted in a note below the chart (`src/pages/insights.tsx`).

## Why

History never stored a language, so the chart needed the backend to record one. Whisper already detects the language when set to auto, so a local dictation records what was actually spoken, not just the setting. Cloud services detect too, but the transcription call only returns text. Reading their responses was left for later, so cloud dictations on auto record nothing rather than a guess.

Words, not dictation counts, measure "most spoken": one long note outweighs several one-word ones. The pill shape suits this because languages are categories to compare, not stages of a journey, and "share" is the only meaningful percentage for categories.

## What makes it stand out

- Detected language, not the configured one, for local whisper. Mixed-language users see a real split.
- No invented data: unknown entries are left out and counted in a visible note, except English-only models, which can only produce English.
- Language names come from `Intl.DisplayNames` in the user's locale, falling back to the Settings list.
- The chart is accessible: a screen-reader summary, arrow-key navigation and a data table.
