---
name: providers
description: Checklist for adding, removing or changing an AI provider (OpenAI, Anthropic, Groq, Sarvam, xAI, Ollama, …) or its models in Yammer. A provider change always covers both the Speech engine and AI cleanup, plus Meetings where the provider streams. Use whenever a task touches lib/presets.ts, provider keys, provider logos, or asks to "add <provider>", "support <model>" or "update models".
---

# Providers

**Rule: a provider is never added to just one feature.** If a provider offers both speech-to-text and a chat/LLM API, add it to the Speech engine (`sttPresets`) *and* AI cleanup (`cleanupPresets`) in the same change. If it streams live transcription, consider Meetings (`liveEngines`) too. If it genuinely lacks one of these (e.g. Anthropic has no speech-to-text), say so in your reply rather than skipping it silently. The same goes for removing a provider or updating its model list: check every feature it appears in.

## Where a provider lives

1. **`apps/desktop/src/lib/presets.ts`**
   - `sttPresets`: base URL, default model, `api` (`SttApi`), `keyUrl`, `models` (newest recommended first).
   - `cleanupPresets`: base URL, default model, `format` (`openai-chat` for anything OpenAI-compatible, `anthropic-messages` for Anthropic), `keyUrl`, `models`. Prefer a fast, non-reasoning model as the default: cleanup runs on every dictation.
   - `keyName` and `providerNames`.
2. **`crates/voice-core/src/settings.rs`**: `provider_name`, `KEY_NAMES` and `key_name` must list the provider the same way as `presets.ts`. One key per provider serves every feature, so don't add a per-feature key.
3. **`apps/desktop/src/lib/tauri.ts`**: `SecretName` (and `SttApi` if you add a speech API) must match the Rust enums.
4. **New wire formats**: a speech API that isn't `/audio/transcriptions` needs an `SttApi` variant and a branch in `crates/voice-core/src/transcribe.rs`, plus an option in `pages/engine.tsx`'s API picker. A chat API that isn't OpenAI- or Anthropic-compatible needs an `LlmFormat` variant and handling in `cleanup.rs`.
5. **`apps/desktop/src/components/provider-logo.tsx`**: a single-colour `currentColor` mark keyed by preset id (LobeHub's icon set, or the provider's own brand mark).
6. **`pages/meeting-settings.tsx`** `liveEngines`: only for streaming engines, which also need code in `live.rs` and `meeting.rs`.
7. **Changelogs**: a user-facing bullet under `## Unreleased` in `CHANGELOG.md`, and in `CHANGELOG-android.md` too (Android shares the presets).
8. **Docs**: the provider lists in `README.md` and the `transcribe.rs`/`cleanup.rs` lines of `CLAUDE.md`, if they name providers.

## Models

Look up current model ids on the provider's docs before you write them. Don't take them from memory, since providers retire models often. Mark retiring models in their label, as the OpenAI speech presets do.

## Verify

Run `/typecheck`. If Rust changed, run `cargo test -p voice-core` (`settings.rs` has `key_name` tests; extend them for a new provider).
