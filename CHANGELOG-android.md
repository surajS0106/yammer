# What's new in Yammer for Android

<!--
Written for the people who use Yammer, not for us. The Android app shows it on its
"What's new" page and after an update, and the release-android workflow publishes the
release's section as the GitHub release notes. Android has its own versions, separate
from the desktop app's CHANGELOG.md.

- Only list changes someone would notice: what they can now do, what works
  better, what no longer goes wrong. Leave out refactors, CI and build changes.
- One plain sentence per bullet, from the user's side ("You can now…").
  No markdown inside a bullet: the app shows the text as written.
- Sections are `### New`, `### Improved` and `### Fixed`; skip empty ones.
- Add to `## Unreleased` as you go. To release, rename it to
  `## <version> — <YYYY-MM-DD>` matching the version in tauri.android.conf.json;
  the release-android workflow stops if that heading is missing. The app never
  shows Unreleased.
-->

## 0.7.0 — 2026-11-13

### New

- Meetings: put your phone on the table and Yammer transcribes the meeting as it happens, then writes minutes, a summary or a list of action items when you stop.
- While a meeting is transcribed you can type your own notes beside it, and the notes written at the end build on them.
- Meetings can stream to OpenAI Realtime or Sarvam to show words as they're said, or use your speech engine.
- A meeting keeps going with Yammer closed, and its notification shows how long it's been going and has a Stop button.
- Meeting notes can be shared from the meeting as a Markdown file.
- While Yammer listens, the island at the top of the screen shows Sushi hopping along with your voice beside a live waveform, on phones with Android 16 live updates.
- When a new version of Yammer for Android is out, Home tells you, shows what's in it, and Upgrade now downloads it for you to install.

### Improved

- An API key is now saved once per provider: paste your OpenAI, Anthropic, Groq or Sarvam key on any page and the speech engine, AI cleanup and meetings all use it. Keys you already saved carry over.
- The Model setting for the speech engine and AI cleanup is now a dropdown of each provider's current models, including GPT Transcribe, GPT-6.1, Claude 5.5 and GPT-OSS, with Other model… for anything else.
- Your API keys are now stored encrypted, with a key the Android Keystore holds. Keys you already saved are encrypted the first time you open Yammer.
- After pasting, Yammer clears what it put on the clipboard, and keeps it out of keyboards' clipboard history.
- New installs keep a month of History and the latest 10 recordings. You can change both in Settings.

### Fixed

- AI cleanup works with models that only accept their default temperature, such as OpenAI's newer GPT models, instead of failing with an HTTP 400 error.
- When AI cleanup fails, Sushi looks worried instead of cheering, and a rejected API key tells you where to update it.
- Sushi no longer goes invisible when you start dictating from the app with Sushi turned off.
- Yammer never pastes into password fields.

## 0.6.0 — 2026-11-06

### Improved

- Yammer has a new set of icons throughout the app.
- The start-up screen shows Yammer's logo.
- The back swipe now goes back a step instead of leaving the app.
- Sushi over other apps is animated again: it breathes and blinks, bounces with your voice while you speak, types on a laptop while it transcribes, and reacts when it's done or something fails.
- While Sushi is listening, Yammer shows a live update in the status bar (the island on phones that have one) with a running timer.
- Sushi is no longer cut off at the top and bottom while you're speaking.
