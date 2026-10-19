# Yammer

A product of Sush.

Dictate anywhere. Hold a hotkey, speak, let go: your words are transcribed and pasted wherever the cursor is. It's like Wispr Flow, for Windows, macOS and Linux.

- **Hold to talk** (release to paste), or **tap** to start and tap again to finish. **Esc** cancels.
- **Private by default:** whisper.cpp runs on your machine. Alternatively, use a cloud service (Groq, OpenAI, Ollama or any OpenAI-compatible API).
- **Optional AI cleanup:** an LLM removes "um"s, applies "scratch that" corrections and fixes punctuation. If it fails, the raw transcript is pasted instead.
- **Restores your clipboard** after pasting. History stays on your machine, and API keys are kept in the OS keychain.

The default hotkey is `Ctrl+Shift+Space` (`⌘⇧Space` on macOS). You can change it under General.

## Install

Download the installer for your platform from the GitHub releases page:

| Platform | File |
| --- | --- |
| Windows | `.msi` or `-setup.exe` |
| macOS (Apple Silicon / Intel) | `.dmg` (`aarch64` / `x64`) |
| Ubuntu / Debian | `.deb` (`sudo apt install ./yammer_*.deb`) |
| Other Linux | `.AppImage` |

On first launch, download a speech model (Base, 148 MB, is recommended) or add a cloud API key.

### macOS

Grant **Microphone** access when asked. Then turn on Yammer under System Settings → Privacy & Security → **Accessibility**, which it needs in order to press ⌘V for you. The app lives in the menu bar.

### Linux

X11 sessions work fully. **Wayland** (the Ubuntu default) doesn't let apps grab global hotkeys or send keystrokes, so:

1. Bind a system shortcut (GNOME: Settings → Keyboard → Custom Shortcuts) to `yammer --toggle`. Press it once to start and again to stop.
2. For auto-paste, install `wtype` (wlroots or KDE) or `ydotool` (any compositor, including GNOME, with `ydotoold` running). Without either, the text is copied to the clipboard and you press Ctrl+V yourself.

## Develop

Prerequisites:

- Rust (stable) and Bun.
- CMake and libclang, which whisper.cpp needs (via `whisper-rs`).
- **Windows:** VS 2022 Build Tools with "Desktop development with C++". Set `CMAKE` and `LIBCLANG_PATH` if they aren't on PATH, as described in Sush's README.
- **macOS:** Xcode Command Line Tools.
- **Linux:** `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libasound2-dev libxdo-dev libssl-dev cmake libclang-dev`.

```sh
bun install
bun run dev                 # tauri dev (Vite on port 1430)
bun run typecheck
cargo test --workspace
bun run build               # installers for this platform
```

Releases: push a `v*` tag matching the version in `apps/desktop/src-tauri/tauri.conf.json`. `.github/workflows/release.yml` then builds every platform.
