# API Keys — Design Notes

Last updated: 2026-11-12

## What changed

### 2026-11-12
- Keys are saved per provider instead of per feature. The names are `openai`, `anthropic`, `groq`, `sarvam`, `custom-stt` and `custom-cleanup` (`KEY_NAMES` in `crates/voice-core/src/settings.rs`). Before, they were `stt`, `cleanup` and `live`.
- `CloudStt::key_name` and `Cleanup::key_name` map a preset to its key: `None` for Ollama, and the feature's custom slot for `custom` or any unknown preset. `LiveEngine::provider` already names the streaming engine's provider (`crates/voice-core/src/settings.rs`).
- `secrets::stt`, `secrets::cleanup` and `secrets::live` take the settings and return that feature's key. Every caller uses them now (`pipeline.rs`, `meeting.rs`, `commands.rs`), and meetings no longer needs `live_key`'s fallback from `live` to `stt` (`apps/desktop/src-tauri/src/secrets.rs`, `meeting.rs`).
- `secrets::migrate` runs at startup on desktop (`lib.rs`) and Android (`android/mod.rs`). It moves each old per-feature key to the provider that feature is set to. A provider that already has a key keeps it. A legacy key is left in place when its feature points at Ollama, so it can move on a later launch.
- On the frontend, `keyName`, `hasKey` and `keyUsers` in `lib/presets.ts` mirror the Rust mapping. `SecretName` in `lib/tauri.ts` lists the provider names.
- `KeyField` takes the provider's key name and an optional `page`. Under the field it says which other pages use the same key, e.g. "Also used for AI cleanup and Meetings." (`components/key-field.tsx`).
- Speech engine, AI cleanup, Meetings, Home and onboarding all check and show the provider's key (`pages/*.tsx`). Meetings drops the "Using the key from Speech engine" note because the field now shows that key directly.

## Why

People who used OpenAI for speech, cleanup and meetings had to paste the same key three times. Meetings borrowed the speech key only when both features used the same provider, and cleanup never shared at all. Who can use a key depends on the provider, not on which page it was pasted into, so it is now stored by provider. Custom servers are the exception. Each feature keeps its own custom key because a custom speech server and a custom cleanup server are usually different services.

The migration runs on every launch rather than once behind a flag. When there are no legacy keys it does three reads of entries that don't exist, which is cheap. This also lets a key that couldn't move yet (its feature was set to Ollama) move later. If two features shared a provider but had different keys saved, the speech key wins and the other is dropped. Both were keys for the same account type, so this was accepted.

## What makes it stand out

- The obvious alternative was one global "API key" box. That breaks as soon as speech and cleanup use different providers, such as Groq for speech and Anthropic for cleanup. Keying by provider shares a key exactly where it can be used.
- The mapping lives in `voice-core`, which CI tests (`features_on_one_provider_share_its_key`), and the TypeScript mirrors it. The backend, not the UI, decides which key a request sends.
- The UI tells people about the sharing at the point they enter a key ("Also used for …"), so a key that appears on a page they never visited has an explanation.
- Existing installs keep working. Old keys move to the right provider on first launch, so nobody has to paste them again.
