# Meetings (live call transcription and notes) — Design Notes

Last updated: 2026-11-13

## What changed

### 2026-11-13 (Android)
- Meetings run on Android. `meeting.rs` is shared; the desktop-only parts (cpal capture, sounds, tray, the whisper model check) are `cfg(desktop)`, and `channels`/`open` pick the capture per platform.
- A phone records one channel, the microphone, tagged with the new `Speaker::Room` ("Room" in the transcript). The notes prompt says Room is one microphone that heard everyone, the reader included (`crates/voice-core/src/meetings.rs`, `cleanup.rs`).
- Kotlin records it: `LiveRecorder` (`Recorder.kt`) hands each 100 ms to `YammerNative.meetingAudio`, which returns false once Rust has stopped the meeting. Rust starts it through the plugin's `startMeeting`, which brings up `YammerService` without Sushi if it was off (`forMeeting`, `onlyForMeeting`) and resolves once the microphone is open. The notification shows a timer and a Stop button (`meetingStop`). Losing the microphone, or the service going, stops the meeting so what was heard is saved.
- Dictation is refused while a meeting runs, from Sushi and from the dock.
- `tokio-tungstenite` uses rustls with webpki roots on Android, like reqwest, so the streaming engines work there.
- The phone opens Meetings from a tile on Home, and Meeting settings from the Meetings page. The page's dock button starts and stops a meeting. Exports go to the share sheet.

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

Android doesn't let one app record another's call. Playback capture excludes voice-call audio, and a call app holding the microphone silences other recorders. So the phone version is for meetings in a room, where the one microphone hears everyone. Tagging that "You" would make the notes credit the user with everything said, so it gets its own label. The microphone stays in Kotlin, as for dictation, because the foreground service is what keeps microphone access with the app in the background. Audio goes to Rust as it's heard, and the return value doubles as the stop signal. That way Rust never has to call into Kotlin with the activity gone, which the Tauri plugin can't do. Starting goes through the plugin anyway: only the app's own page starts a meeting, and Android 14 only lets a microphone service start while the app is on screen.

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
