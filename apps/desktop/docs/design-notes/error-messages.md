# Error messages — Design Notes

Last updated: 2026-11-16

## What changed

### 2026-11-16
- `crates/voice-core/src/error.rs`: `Error` now writes its own `Display` (no longer derived with thiserror), worded for the user. The cause is kept as `source()`.
  - A request with no answer says it took too long, sent back something unreadable, or couldn't be reached ("check your internet connection"), by reqwest's error kind.
  - `refused` words an HTTP error by what it means: API key turned down (401/403), not found (404), too slow (408/504), busy or limit used up (429), having trouble (5xx), else not accepted.
  - The service's own message is quoted only when it's a short sentence, never a web page or JSON.
  - `file_problem` words file errors by kind (missing, not allowed, disk full). JSON errors become one plain sentence.
  - The services are named the way a sentence needs them: "your AI cleanup model", "the speech service", "your calendar".
- `apps/desktop/src-tauri/src/error.rs`: keychain, file, JSON and window errors show sentences. `AppError::because("Couldn't …")` maps any third-party error to that sentence and logs the cause.
- Call sites that put a library's text in a message now say what failed in plain words, with the detail going to the log:
  - opening System Settings, autostart, the clipboard, copying the selection, GNOME shortcuts
  - the microphone and the computer's sound
  - the speech model's download, load and transcription
  - the streaming services' connection errors
  - Android plugin calls (a Kotlin rejection is already a sentence, so it passes through), the Android update check
  - "Ask in Sush"
  - background task failures (`join_err`)
- voice-core's leftover developer messages ("transcription response has no `text`", "audio is not a 16-bit PCM WAV") are sentences now.
- `errorMessage` in `src/lib/tauri.ts` is the last guard:
  - A JavaScript exception, or text matching `TECHNICAL` (os error, exit status, HTTP codes, tcp/tls, deserialize, `::`, …), is logged to the console and replaced with a fallback sentence.
  - Callers can give a better fallback; the updater does.

## Why

Errors went straight from libraries to the screen, for example `Launcher "/usr/bin/open" … failed with ExitStatus(unix_wait_status(256))` on "Ask in Sush". Those mean nothing to the person using Yammer, and don't say what to do. The fix sits in the error types rather than at each place a message is built, so new code is readable by default. The technical detail still reaches the log, so nothing is lost for debugging. The `TECHNICAL` pattern is case-sensitive, because with `/i` the error-code rule (`EACCES`) matched words like "engine". Each rule was checked against the app's real messages for false positives.

## What makes it stand out

- One rule, enforced in the types: a message is a sentence that says what went wrong and, where possible, what to do. A raw code or library string only gets through if someone formats it into a message on purpose, and `CLAUDE.md` says not to.
- HTTP failures say what they mean ("turned down the API key", "busy, or your plan's limit is used up"), not their number.
- Logging is kept: `because` and `errorMessage` both write the original error to stderr or the console.
- Tested: voice-core and the app check that `os error`, JSON line numbers and HTML bodies never appear, and the frontend pattern was checked against real messages for false positives and misses.
