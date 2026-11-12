# Model picker (speech engine and AI cleanup) — Design Notes

Last updated: 2026-11-12

## What changed

### 2026-11-12
- New `ModelPicker` component: a `Select` of the provider's known models plus an "Other model…" entry that shows a text field for any other ID (`src/components/model-picker.tsx`).
- Preset model lists are now `ModelOption[]` (`{ id, label? }`) instead of `string[]`, with a readable label per model (`src/lib/presets.ts`).
- Model lists refreshed to the providers' current catalogs as of November 2026:
  - Speech: OpenAI defaults to `gpt-transcribe`; `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and `whisper-1` stay listed but marked "retiring". Sarvam adds `saarika:v2.5` (legacy). Groq keeps both Whisper Large v3 models.
  - Cleanup: OpenAI defaults to `gpt-6.1-terra` and lists `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra`. Groq defaults to `openai/gpt-oss-120b` and lists `openai/gpt-oss-20b` and both Llama models. Anthropic adds `claude-opus-5-5`.
- The Model rows in `src/pages/engine.tsx` and `src/pages/cleanup.tsx` use `ModelPicker` in place of a text input with a `<datalist>`.

## Why

The Model setting was a text input with a `<datalist>` of suggestions. In the macOS webview (WKWebView) a datalist gives no visible dropdown affordance, and the OpenAI and Groq cleanup presets had empty lists, so users saw a bare text box and had to know model IDs by heart. A real dropdown makes switching models a single choice. The trade-off is that the lists must be kept current by hand; "Other model…" keeps any ID reachable, so a stale list never blocks a user.

Defaults only apply when a provider is picked, so existing users keep whatever model they saved. A saved model that is no longer listed shows as "Other model…" with its ID in the field, instead of silently changing.

OpenAI has announced the removal of `whisper-1` and the gpt-4o transcribe models on 2027-02-26, so they are labeled "retiring" rather than dropped, to keep current setups working until then.

## What makes it stand out

- Uses the app's own `Select` (keyboard navigation, type-ahead, flip-to-fit, a bottom sheet on Android) instead of a native datalist whose UI differs per platform and is invisible in WKWebView.
- Never loses a custom ID: an unknown saved model is detected and shown in the "Other" field, and the empty-field commit is ignored.
- Providers without a catalog (Custom) fall back to the plain text field, so the component covers every preset with one API: `models`, `value`, `onChange`.
- Labels carry guidance ("fast", "cheapest", "most capable", "retiring") while the stored value stays the exact API ID.
