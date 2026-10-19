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
bun run build:mac            # macOS DMG only (sets MACOSX_DEPLOYMENT_TARGET=11.0 for whisper.cpp); see /build-dmg

cargo test --workspace
cargo test -p voice-core <name_substring>
# Real whisper inference (model + 16 kHz mono WAV):
WHISPER_MODEL=... WHISPER_WAV=... cargo test -p yammer transcribes_real_audio -- --ignored --nocapture
cargo fmt --all               # rustfmt.toml sets the house style; CI runs --check
cargo clippy -p yammer --all-targets
# What CI runs for voice-core (no whisper.cpp, so deps don't need opt-level 3):
cargo clippy -p voice-core --all-targets --config 'profile.dev.package."*".opt-level=0' -- -D warnings
cargo test -p voice-core --config 'profile.dev.package."*".opt-level=0'
```

There are no JS tests and no JS linter; `typecheck` is the TypeScript gate. Building whisper.cpp needs CMake and libclang. On Windows, set `CMAKE` and `LIBCLANG_PATH` if they aren't on PATH. Dev builds compile dependencies at `opt-level = 3`, because whisper is unusably slow without it.

CI (`.github/workflows/ci.yml`) has a 3-minute budget. It runs typecheck, the frontend build, `cargo fmt --check`, and voice-core clippy and tests on Linux. It never builds the `yammer` crate, so run `cargo test --workspace` locally. Releases are manual. Start `release.yml` from the Actions tab or with `gh workflow run release.yml`. It builds every platform and tags the release `v<version>` from `apps/desktop/src-tauri/tauri.conf.json`. Pushing a tag doesn't trigger it.

Rust formatting is enforced. `rustfmt.toml` matches the code's dense style (`max_width = 150`, `use_small_heuristics = "Max"`), so run `cargo fmt --all` after Rust edits. Clippy must be warning-free, and CI runs it with `-D warnings` on voice-core. macOS-only code (`dock.rs`, `panel.rs` and the `cfg(target_os = "macos")` arms) only compiles and lints on a Mac. Project skills: `/typecheck` (fast), `/check` (the pre-push gate that mirrors CI), `/ship` (check, commit, push) and `/build-dmg` (a local unsigned macOS DMG).

## Architecture

Yammer (formerly Larp), a product of Sush: a dictation app modelled on Sush (`../sush`), whose whisper, transcription, secrets and error code it adapts.

- **`crates/voice-core`** is pure Rust with no Tauri dependency, and it should stay that way. It holds:
  - `audio.rs`: downmix, resample to 16 kHz, silence detection, WAV encode and decode.
  - `models.rs`: the whisper model catalog, each entry pinned by size and SHA-256.
  - `settings.rs`: `settings.json`. Every field has a serde default, so old files load. Struct fields serialize as camelCase and enums as kebab-case, and `lib/tauri.ts` must use the same casing.
  - `history.rs`
  - `transcribe.rs`: cloud speech-to-text over `/audio/transcriptions` or Ollama chat.
  - `cleanup.rs`: the LLM cleanup prompt and request for OpenAI chat or Anthropic messages.
- **`apps/desktop/src-tauri`** (crate `yammer`) is the OS shell.
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
  - `commands.rs`. `error.rs`'s `AppError` serializes as a plain message string, so the UI shows it directly (`errorMessage` in `lib/tauri.ts`).
  - `state.rs`: `AppState` holds the settings and history behind mutexes, the models directory and a shared `reqwest` client.
  - `sounds.rs`: synthesized start, stop and error cues, played through cpal on a throwaway thread.
  - **Instances and windows:**
    - Single-instance: `yammer --toggle` from a second launch toggles dictation, which is the Wayland path.
    - Closing the main window hides it, and the app keeps running in the tray.
    - `--hidden` (used by autostart) skips showing the window once the user is onboarded.
- **`apps/desktop/src`**: React 19, Vite and Tailwind 4, with hand-rolled primitives in `components/ui.tsx` (no Radix) using Sush's theme tokens. Registry components from `@ui-shrushank`/`@ui-shrushank-pro` go in `components/ui/` (configured in `components.json`; the pro registry needs `SHRUSHANK_PRO_TOKEN`, which lives in the repo-root `.env`).
  - Both windows load `index.html`. `main.tsx` renders `overlay.tsx` when the window label is `overlay`, and the settings app otherwise.
  - `lib/tauri.ts` mirrors the Rust commands and serde types. **If you change a Rust command or serde type, update this file to match.**
  - `lib/settings.tsx` holds the settings context. Every change saves through `settings_set`, which rejects a hotkey it can't register.
  - `lib/models.ts` is a module-level download store.
  - `lib/presets.ts` holds the provider presets.
  - `lib/theme.ts` toggles `.dark` on `<html>` and keeps the native window theme in sync. Only the settings window applies the `theme` setting. The overlay always follows the OS.

## Gotchas

- Tauri API calls from the frontend beyond `core:default` (for example window dragging or `setTheme`) need a matching permission in `apps/desktop/src-tauri/capabilities/default.json`. That file covers both windows. Without the permission, the call fails at runtime.
- macOS Dock icon: `dock.rs` swaps it between `icons/macos-light.png` and `icons/macos-dark.png` to follow the system theme. The bundled `icon.icns` is static. On macOS 26, Finder, Launchpad and the pinned Dock icon follow the theme through `Assets.car`, compiled from `icons/AppIcon.icon` by `icons/build-mac-icon.sh`. That needs Xcode's `actool`, so `.github/workflows/mac-icon.yml` runs it on GitHub's macOS runners and commits `Assets.car` whenever the icon changes; never install Xcode for it. `tauri.macos.conf.json` bundles it; Tauri merges that file into every macOS build on its own, so no command needs a `--config` flag. Its `beforeBundleCommand` runs `icons/check-mac-icon.sh`, which stops the bundle when `Assets.car` wasn't compiled from the current `AppIcon.icon` (`Assets.car.stamp`, written by `build-mac-icon.sh`). So after an icon change, push, let the Mac icon workflow commit the new `Assets.car`, and pull before building a DMG. Regenerate every icon with `icons/source/make_icons.py`; never edit the outputs by hand. `Info.icon.plist` repeats `Info.plist`'s microphone string, so keep the two in sync. `build.rs` watches `icons/` so that a changed icon is re-embedded.

- macOS: Yammer has a Dock icon only while the main window is open (`dock::show` switches the activation policy between Regular and Accessory). With it closed, Yammer is an accessory app, which is what lets the overlay appear over other apps' full-screen Spaces. Clicking the Dock icon (`RunEvent::Reopen`) shows the hidden window. The Dock can end up with two identical "recent app" tiles for Yammer (seen after reinstalling a rebuild), so `dock::dedupe_recents` drops the extras from `com.apple.dock` at startup and restarts the Dock, only when it finds one. `Info.plist` holds the microphone usage string. `Entitlements.plist` holds audio-input. Pasting needs Accessibility permission, checked with `AXIsProcessTrusted` in `platform.rs`. Transparency needs `macos-private-api`.
- On Windows, a normal app can't send keystrokes into elevated (admin) windows. There the paste silently does nothing, but the text is still in History.
