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

### New

- Turn off Live transcript on the Meetings page, or in its settings, to just get notes when a meeting ends: your speech engine writes it down in the background, which usually costs less than streaming, and the transcript is still kept.

## 0.11.0 — 2026-11-16

### New

- Meeting notes now come from templates: Minutes, Brief summary, Action items, 1:1, Stand-up, Customer call, Interview and Lecture, plus your own on the new Templates page under Teach.
- Pick which template your meetings are written with right on the Meetings page, before you start.
- While a meeting is going on, you can change the template its notes will be written with from the top of the meeting.
- You can write any meeting's notes again with a different template, straight from the meeting.
- A meeting's notes now have an Enhanced and a My notes side, so you can switch between the written notes and what you typed.
- You can edit the written notes by hand, or ask for changes such as "make it shorter" and undo them if you don't like the result.
- Ask questions about a meeting, or have a follow-up email or the action items drafted from it, and the answers stay with the meeting.
- While a meeting is going on you can ask "What did I miss?" or write notes of what's been said so far, without stopping it.
- You can take lines out of a meeting's transcript, such as something said off the record.
- Search your meetings by their titles, notes and transcripts from the top of the Meetings page.
- Connect your calendar under Meetings → Settings with its secret iCal address from Google Calendar or Outlook: a meeting recorded during an event takes its name, shows who was invited, and its notes spell their names right.
- The Meetings page shows what's coming up on your calendar, with Start notes for each event and Join for its video call.

### Improved

- Error messages are now plain sentences that say what went wrong and what to do, instead of technical codes.
- Past meetings are grouped by day, so each one shows just its time and length, and its preview starts with the notes rather than their heading.
- A meeting starts transcribing as soon as you tap to start it.

## 0.10.0 — 2026-11-16

### New

- AI cleanup can now use xAI's Grok: pick xAI under AI cleanup, and the xAI key you saved for speech works there too.

## 0.9.0 — 2026-11-16

### New

- You can now dictate with xAI's Grok speech-to-text: pick xAI under Speech engine and add your xAI API key.
- You can now hide Sushi by dragging it onto the ✕ that appears at the bottom of the screen, from any app or game.
- You can now turn off Paste for you in one tap, from Sushi's notification or Settings, so Google Pay lets you pay; Yammer warns you about this before you turn it on.

### Fixed

- Sushi no longer comes back on by itself when you open Yammer after turning it off from its notification.

## 0.8.0 — 2026-11-13

### Improved

- The island at the top of the screen now shows a smooth equaliser beside Sushi while Yammer listens, instead of a jumpy waveform. On OnePlus phones, turn Yammer on under Settings, Notifications & status bar, Live Alerts to see it.

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
