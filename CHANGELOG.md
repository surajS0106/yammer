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
