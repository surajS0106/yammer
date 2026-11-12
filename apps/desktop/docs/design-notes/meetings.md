# Meetings (live call transcription and notes) — Design Notes

Last updated: 2026-11-12

## What changed

### 2026-11-12
- New Meetings feature: transcribe a call live and write notes from it when it ends (`src-tauri/src/meeting.rs`, `src/pages/meetings.tsx`).
- Two capture channels per meeting: the microphone, labelled "You", and the computer's sound output, labelled "Them". `recorder::live` hands over 16 kHz audio every 50 ms. System audio comes from cpal loopback on the output device (macOS 14.6+, Windows) and from `parec` reading `@DEFAULT_MONITOR@` on Linux (`src-tauri/src/recorder.rs`). `NSAudioCaptureUsageDescription` was added to `Info.plist` and `Info.icon.plist`.
- `live::Segmenter` cuts audio into turns at pauses: a 300 ms pre-roll, at least 240 ms of speech, a 700 ms pause (200 ms once a turn passes 12 s) and a hard cut at 25 s (`crates/voice-core/src/live.rs`).
- Three live engines (`settings::LiveEngine`):
  - The dictation engine transcribes each finished turn with `pipeline::transcribe`.
  - OpenAI Realtime streams over a WebSocket (`?intent=transcription`, 24 kHz PCM16, `turn_detection: null`) and commits each turn.
  - Sarvam streaming (`/speech-to-text/ws`, `flush_signal=true`) sends WAV chunks and flushes each turn.
- A streaming channel reconnects up to 3 times with backoff. If that fails, it falls back to the dictation engine for the rest of the call and records a `notice` on the meeting.
- A meeting is stored as `meetings/<id>.json`, through `meetings::Store`, with segments, the user's typed notes, the written notes, `error` (writing the notes failed) and `notice` (a problem while transcribing) (`crates/voice-core/src/meetings.rs`). It is saved every 5 s while it runs, on stop, and on app exit.
- `cleanup::summarize` writes Markdown notes in one of four styles (Minutes, Brief summary, Action items, Custom), starting with a `# Title` line that becomes the meeting's title (`crates/voice-core/src/cleanup.rs`). It uses the AI cleanup provider, with a 180 s timeout and 8192 max tokens.
- Ways to start and stop:
  - A meeting hotkey (`hotkey::Action::Meeting`; `--meeting` on GNOME).
  - A tray item.
  - The overlay's right-click menu.
  - Buttons in the app.
- The overlay's idle state becomes `Meeting { started_at }` while a meeting runs: a red dot with a running clock (`overlay.rs`, `overlay.tsx`). Dictation keeps working during a meeting and skips "Mute other audio".
- New `live` secret for the streaming key. It falls back to the `stt` key when the speech engine is the same provider (`secrets.rs`, `meeting.rs::live_key`).
- New UI:
  - Settings → Meetings tab (`src/pages/meeting-settings.tsx`).
  - Meetings page with a live view (transcript beside your own notes, a level meter for each channel) and a finished view (Notes / Transcript / Your notes tabs, export to Markdown).
  - A small Markdown renderer whose action-item checkboxes can be ticked (`src/components/markdown.tsx`).

## Why

People asked for notes from Teams calls, where most of what matters is said by the other side. The microphone alone only hears the user, so the computer's output is captured too. Each side is kept as its own channel rather than mixed. That labels who spoke, costs nothing extra, and stays accurate when people talk over each other. The trade-off is echo. With laptop speakers, the mic also hears the call, and those lines appear twice. The settings tell the user to wear headphones rather than try echo cancellation that could drop their own speech.

`gpt-live-transcribe` has no server-side voice detection, and Sarvam benefits from explicit flushes, so the app decides where turns end. One `Segmenter` drives every engine, which keeps timestamps and turn boundaries the same whichever engine is chosen, and makes the logic unit-testable without a network.

Keeping the dictation engine as the default means a meeting works offline with on-device whisper and needs no new key. Streaming engines are opt-in for lower latency. Falling back to the dictation engine when a stream is lost for good was chosen over stopping the meeting: a gap in a transcript is worse than a few seconds of extra delay.

Notes are written from the transcript plus the user's own typed notes, so the write-up stresses what the user cared about. The notes take a title line, so meetings get specific names without asking. Per-meeting files avoid rewriting every meeting each time a long call autosaves.

## What makes it stand out

- Captures both sides of a call from any meeting app, with no bot joining the call and no virtual audio driver (cpal process tap on macOS, WASAPI loopback, PulseAudio/PipeWire monitor).
- Speaker labels come from which channel the audio arrived on, not from diarization guesses.
- Works fully offline with the on-device engine. Streaming engines reconnect, and then fall back instead of failing.
- A refused key or unknown model is reported before recording starts: the WebSocket is opened, and OpenAI's `session.update` confirmed, first.
- Writing notes never overwrites notes typed meanwhile: the result is applied to the meeting as it is on disk at that moment (`Meetings::update`).
- Markdown is rendered as React elements only (no HTML injection), and ticking an action item rewrites the saved notes.
