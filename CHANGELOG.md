# What's new in Yammer

<!--
Written for the people who use Yammer, not for us. The app shows it on its
"What's new" page and after an update, and the release workflow publishes the
release's section as the GitHub release notes (which "Upgrade now" shows too).

- Only list changes someone would notice: what they can now do, what works
  better, what no longer goes wrong. Leave out refactors, CI and build changes.
- One plain sentence per bullet, from the user's side ("You can now…").
  No markdown inside a bullet: the app shows the text as written.
- Sections are `### New`, `### Improved` and `### Fixed`; skip empty ones.
- Add to `## Unreleased` as you go. To release, rename it to
  `## <version> — <YYYY-MM-DD>` matching tauri.conf.json; the release workflow
  stops if that heading is missing. The app never shows Unreleased.
-->

## 0.10.0 — 2026-11-16

### New

- Meeting notes now come from templates: Minutes, Brief summary, Action items, 1:1, Stand-up, Customer call, Interview and Lecture, plus your own on the new Templates page under Teach.
- Pick which template your meetings are written with right on the Meetings page, before you start.
- While a meeting is going on, the floating pill shows which template its notes will be written with, and you can click it there to pick another, or change it from the top of the meeting.
- You can write any meeting's notes again with a different template, straight from the meeting.
- A meeting's notes now have an Enhanced and a My notes side, so you can switch between the written notes and what you typed.
- You can edit the written notes by hand, or ask for changes such as "make it shorter" and undo them if you don't like the result.
- Ask questions about a meeting, or have a follow-up email or the action items drafted from it, and the answers stay with the meeting.
- While a meeting is going on you can ask "What did I miss?" or write notes of what's been said so far, without stopping it.
- You can take lines out of a meeting's transcript, such as something said off the record.
- Search your meetings by their titles, notes and transcripts from the top of the Meetings page.
- When Sush links one of your meetings in an answer, clicking the link opens that meeting in Yammer.
- If you have Sush, Ask in Sush on a meeting opens a chat about it there, where you can also ask across all your meetings.
- Connect your calendar under Settings → Meetings with its secret iCal address from Google Calendar or Outlook: a meeting recorded during an event takes its name, shows who was invited, and its notes spell their names right.
- The Meetings page shows what's coming up on your calendar, with Start notes for each event and Join for its video call.
- When an event on your calendar begins, Sushi offers to take notes, and a call it spots during an event is named after the event.
- Sush can now read your meetings, so you can ask it about them, such as what you promised someone last week. Claude Desktop, Cursor and other apps that take MCP servers can read them too with yammer --mcp.

### Improved

- Error messages are now plain sentences that say what went wrong and what to do, instead of technical codes like HTTP 503 or os error 2.
- Meeting settings are easier to scan: what to listen to and which engine transcribes are cards you can compare at a glance, and the tips shown match what you picked.
- Past meetings are grouped by day, so each one shows just its time and length, and its preview starts with the notes rather than their heading.
- A meeting starts transcribing as soon as you click Transcribe, and Yammer notices a call has ended within about a second instead of several.

### Fixed

- The floating pill and Sushi's cards no longer have a grey box around them.
- On Sushi's call offer, "Don't ask for Zoom again" is spelled out in full instead of cut off.
- On a Mac you can now drag Sushi all the way up to the top of the screen, instead of it stopping partway down.

## 0.9.0 — 2026-11-16

### New

- AI cleanup can now use xAI's Grok: pick xAI under AI cleanup, and the xAI key you saved for speech works there too.

## 0.8.0 — 2026-11-16

### New

- When Zoom, Teams, Meet or another app starts a call, Sushi offers to transcribe it, and when the call ends it counts down to stopping the transcript.
- You can have calls transcribed by themselves after a short countdown, or turn the offer off, under Settings → Meetings → Calls.
- Choose "Never for Zoom" (or any app) on Sushi's offer to stop being asked about calls in that app.

## 0.7.1 — 2026-11-15

### New

- You can now dictate with xAI's Grok speech-to-text: pick xAI under Speech engine and add your xAI API key.

## 0.7.0 — 2026-11-12

### New

- Meetings: transcribe a Teams, Zoom or Meet call as it happens, with what you say and what everyone else says side by side, and get minutes, a summary or a list of action items written when you stop.
- While a meeting is transcribed you can type your own notes beside it, and the notes written at the end build on them.
- Meetings can stream to OpenAI Realtime or Sarvam to show words as they're said, or use your own speech engine, which works offline with an on-device model.
- A meeting hotkey, the tray and the floating pill start and stop a meeting, and the pill shows how long it's been going.

### Improved

- An API key is now saved once per provider: paste your OpenAI, Anthropic, Groq or Sarvam key on any page and the speech engine, AI cleanup and meetings all use it. Keys you already saved carry over.
- The Model setting for the speech engine and AI cleanup is now a dropdown of each provider's current models, including GPT Transcribe, GPT-6.1, Claude 5.5 and GPT-OSS, with Other model… for anything else.
- Yammer has a new set of icons throughout the app.
- Changing a hotkey shows the keys as you press them, and a shortcut your system already uses (like ⌘ Space for Spotlight or Win+L) is turned down with the reason instead of saved.

### Fixed

- AI cleanup and meeting notes work with models that only accept their default temperature, such as OpenAI's newer GPT models, instead of failing with an HTTP 400 error.
- When AI cleanup fails, the message now shows as a warning instead of a green check, and a rejected API key tells you where to update it.

## 0.5.0 — 2026-11-02

### New

- Insights, History, Dictionary, Snippets, Transforms and Scratchpad now open with a pixel-art summary card, like the one on Home.

### Improved

- The "Get an API key" button opens your browser straight at the provider's API key page.

## 0.4.1 — 2026-10-31

### Improved

- Speech engine and AI cleanup providers now show each provider's logo.
- Settings has a fresh look, with Sushi at the top of each tab acting out what it's about.
- The Speech engine page now makes it clear whether dictation runs on this computer or in the cloud, and which model or provider it uses.
- Dropdowns in Settings have a cleaner look, and you can pick from them with the keyboard or by typing the first letters of an option.

## 0.4.0 — 2026-10-29

### New

- Edit by voice: select some text, hold the edit hotkey and say how to change it, like "make this friendlier" or "turn this into a list".
- Give any transform its own hotkey, to dictate in that style without switching to it first.
- Mute other audio while recording, so music or a video doesn't end up in your dictation. Turn it on in Settings → General.
- Transcribe a dictation again from History, and retry one that failed. Yammer keeps the audio of your 20 newest dictations for this; you can change how many.
- Export your History as Markdown or as a CSV for a spreadsheet.
- Clear out old History automatically after a number of days you choose.
- Switch the language and the speech engine from the tray menu.
- See what changed in each version on the new What's new page, under Help. After an update, the sidebar points you to it, and the Upgrade card shows what's coming before you install.

### Improved

- Scratchpad notes are now saved with the rest of your data, so they're kept safely between updates.

### Fixed

- The cards on the Help and Insights pages open their page in Yammer instead of in your web browser.

## 0.3.0 — 2026-10-26

### New

- A setup guide on first launch walks you through choosing a speech engine, granting permissions, picking a hotkey and trying your first dictation. Run it again any time from Help.
- After a dictation, Yammer offers to add new names, acronyms and jargon it heard to your Dictionary, so they're spelled right next time.

### Improved

- Long dictations with Sarvam no longer stop at 30 seconds.

## 0.2.1 — 2026-10-20

### New

- Dictation now works on GNOME with Wayland: the hotkey, the overlay and pasting. Tap the hotkey to start and tap again to finish.

## 0.2.0 — 2026-10-20

### New

- When a new version of Yammer is out, an "Upgrade now" card appears in the sidebar. One click installs it and restarts Yammer.
- When there's no text box to paste into, the overlay shows your transcript in a card with a Copy button.

### Improved

- A redesigned sidebar and a Home page that fits on one screen, with your streak and today's word count always in view.
- On macOS, Yammer stays out of the Dock while its window is closed, and its icon follows light and dark mode.

## 0.1.0 — 2026-10-18

### New

- The first release of Yammer: hold a hotkey, talk, and your words are typed wherever you're working. Transcribe on your computer or with a cloud engine, tidy up with AI cleanup, and teach Yammer your words with the Dictionary, Snippets and Transforms.
