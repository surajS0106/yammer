# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The repo has a Bun workspace (`apps/*`) and a Cargo workspace (`crates/voice-core`, `apps/desktop/src-tauri`).

```sh
bun install
bun run dev                  # tauri dev; Vite on fixed port 1430 (Sush uses 1420, so both can run)
bun run typecheck            # tsc
bun --filter desktop build   # tsc + vite build; also needed before `cargo test` on a clean checkout (generate_context! wants dist/)
bun run build                # release installers for this platform

cargo test --workspace
cargo test -p voice-core <name_substring>
# Real whisper inference (model + 16 kHz mono WAV):
WHISPER_MODEL=... WHISPER_WAV=... cargo test -p larp transcribes_real_audio -- --ignored --nocapture
```

There are no JS tests and no linter; `typecheck` is the TypeScript gate. Building whisper.cpp needs CMake and libclang. Dev builds compile dependencies at `opt-level = 3`, because whisper is unusably slow without it.

## Architecture

Larp, a product of Sush: a dictation app modelled on Sush (`../sush`), whose whisper, transcription, secrets and error code it adapts.

- **`crates/voice-core`** is pure Rust with no Tauri dependency, and it should stay that way. It holds:
  - `audio.rs`: downmix, resample to 16 kHz, silence detection, WAV encode and decode.
  - `models.rs`: the whisper model catalog, each entry pinned by size and SHA-256.
  - `settings.rs`: `settings.json`. Every field has a serde default, so old files load.
  - `history.rs`
  - `transcribe.rs`: cloud speech-to-text over `/audio/transcriptions` or Ollama chat.
  - `cleanup.rs`: the LLM cleanup prompt and request for OpenAI chat or Anthropic messages.
- **`apps/desktop/src-tauri`** (crate `larp`) is the OS shell.
  - `dictation.rs` is the heart of the app. A single task consumes `Input`s (hotkey Down/Up, Toggle, Cancel, Cap, Finished) in order:
    - **Hold vs. tap:** a release within 300 ms latches into toggle mode.
    - **Pipeline:** stop recording → resample → whisper or cloud → optional cleanup (falls back to the raw text) → paste → history.
  - `hotkey.rs`: the `tauri-plugin-global-shortcut` handler only forwards events. Registering a shortcut blocks on the main thread, so never do real work in the handler. Esc is registered only while recording.
  - `recorder.rs`: cpal capture on its own thread, because the stream isn't `Send`.
  - `paste.rs`: arboard clipboard plus an enigo Ctrl/⌘+V, then restores the clipboard. On Wayland it falls back to `wtype` or `ydotool`, and otherwise the text is copied only.
  - `overlay.rs`: a transparent, non-focusable, click-through pill window. It must never take focus, or the paste lands in the wrong app. On macOS, `panel.rs` turns it into a non-activating `NSPanel`, which lets it appear over other apps' full-screen Spaces.
  - `whisper.rs`: model download with SHA check, a cached context, and inference.
  - `tray.rs`
  - `secrets.rs`: the OS keyring for the `stt` and `cleanup` keys. Debug builds use `dev-secrets.json` instead.
  - `commands.rs`
  - **Instances and windows:**
    - Single-instance: `larp --toggle` from a second launch toggles dictation, which is the Wayland path.
    - Closing the main window hides it, and the app keeps running in the tray.
    - `--hidden` (used by autostart) skips showing the window once the user is onboarded.
- **`apps/desktop/src`**: React 19, Vite and Tailwind 4, with hand-rolled primitives in `components/ui.tsx` (no shadcn or Radix) using Sush's theme tokens.
  - Both windows load `index.html`. `main.tsx` renders `overlay.tsx` when the window label is `overlay`, and the settings app otherwise.
  - `lib/tauri.ts` mirrors the Rust commands and serde types. **If you change a Rust command or serde type, update this file to match.**
  - `lib/settings.tsx` holds the settings context. Every change saves through `settings_set`, which rejects a hotkey it can't register.
  - `lib/models.ts` is a module-level download store.
  - `lib/presets.ts` holds the provider presets.

## Gotchas

- macOS: Larp has a Dock icon only while the main window is open (`dock::show` switches the activation policy between Regular and Accessory). With it closed, Larp is an accessory app, which is what lets the overlay appear over other apps' full-screen Spaces. Clicking the Dock icon (`RunEvent::Reopen`) shows the hidden window. `Info.plist` holds the microphone usage string. `Entitlements.plist` holds audio-input. Pasting needs Accessibility permission, checked with `AXIsProcessTrusted` in `platform.rs`. Transparency needs `macos-private-api`.
- On Windows, a normal app can't send keystrokes into elevated (admin) windows. There the paste silently does nothing, but the text is still in History.
