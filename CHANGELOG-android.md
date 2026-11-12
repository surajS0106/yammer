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

## Unreleased

### Improved

- An API key is now saved once per provider: paste your OpenAI, Anthropic, Groq or Sarvam key on any page and the speech engine, AI cleanup and meetings all use it. Keys you already saved carry over.
- The Model setting for the speech engine and AI cleanup is now a dropdown of each provider's current models, including GPT Transcribe, GPT-6.1, Claude 5.5 and GPT-OSS, with Other model… for anything else.

## 0.6.0 — 2026-11-06

### Improved

- Yammer has a new set of icons throughout the app.
- The start-up screen shows Yammer's logo.
- The back swipe now goes back a step instead of leaving the app.
- Sushi over other apps is animated again: it breathes and blinks, bounces with your voice while you speak, types on a laptop while it transcribes, and reacts when it's done or something fails.
- While Sushi is listening, Yammer shows a live update in the status bar (the island on phones that have one) with a running timer.
- Sushi is no longer cut off at the top and bottom while you're speaking.
