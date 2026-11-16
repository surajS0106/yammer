# Meetings (live call transcription and notes) — Design Notes

Last updated: 2026-11-16

## What changed

### 2026-11-16 (Settings → Meetings redesign)
- The page now reads in the order a meeting happens: Listen to, Live transcription, Notes, Starting a meeting, Calendar. The hotkey moved from Listening into "Starting a meeting", next to call spotting (`src/pages/meeting-settings.tsx`).
- "Listen to" and the live engine are radio cards (`RadioCards`), not dropdowns. Each audio card shows the transcript labels it produces ("You", "Them"). The engine card for the speech engine names the engine in use and says "Works offline" only for local whisper. Arrow keys move the choice, and only the chosen card is in the tab order.
- The audio caveats follow the choice: the headphones advice shows only for "Both sides", the macOS and Linux notes only when the computer's sound is captured.
- A streaming engine's Model and API key rows fold in and out (`Collapse`) instead of appearing at once.
- "When a call starts" is a segmented control (Ask, Countdown, Off), and its description says what each one does, including Off.
- Notes: the template picker has an edit button that opens Teach → Templates, which replaces the separate "Your own templates" row. The missing-cleanup warning is a full-width strip with a "Set up AI cleanup" button.
- Removing an ignored app fades and shrinks its chip (150 ms) while the others slide over. The hero gains a chip for the default template.

### 2026-11-16 (calendar: phase 4)
- `crates/voice-core/src/calendar.rs` reads a calendar from its secret iCal address.
  - Parsing is our own RFC 5545 code: lines unfolded, properties with quoted parameters, text unescaped.
  - Repeats go to the `rrule` crate in the event's own time zone, with `EXDATE` exceptions. Edited occurrences (`RECURRENCE-ID`) stand in for the ones they replace, and cancelled ones drop out.
  - Times: UTC, IANA zones and Outlook's Windows zone names (`chrono-tz`), else the computer's own zone.
  - All-day events and room or resource attendees are skipped. A video call link is found in URL, LOCATION or DESCRIPTION.
  - `current` links a meeting started up to 5 minutes before an event, or during it, preferring the event that starts latest.
- `src-tauri/src/calendar.rs` keeps it fresh: at startup and every 10 minutes. A failed read keeps the last events. The address is the `calendar` secret, added to `KEY_NAMES`, and is checked before it's saved (`calendar_connect`).
- `Meeting.event` holds the event a meeting was recorded during, set by `meeting::start` with its title. `meeting_start(event)` links the event picked by "Start notes". The notes prompt gets the attendees in `<attendees>` tags, and Ask's prompt does too (`Meeting::attendees`).
- `calls.rs` names a call spotted during an event after it. When an event begins with nothing transcribed (`MeetingSettings.calendar_offer`), it offers notes with no app at all (`CallStarted { app: "", event }`). Each event occurrence is offered once.
- UI:
  - Settings → Meetings → Calendar: paste the address, then Refresh, Disconnect, and the offer switch (`components/calendar-section.tsx`).
  - The Meetings page shows "Coming up", up to four events, each with Join and Start notes.
  - A meeting shows its event's attendees.
- MCP: `get_meeting` returns `calendarEvent` (title, times, attendees with emails, join link), and `list_meetings` returns attendee names.

### 2026-11-16 (the bridge to Sush: phase 2)
- `yammer --mcp` serves the meetings as a read-only MCP server over stdio (`crates/voice-core/src/mcp.rs`). It has four tools: `list_meetings` (with a date range), `search_meetings` (`Store::search`), `get_meeting` (the transcript only when asked) and `get_live_meeting`. A live meeting is one with no end whose file was saved in the last 30 s, since the app saves every 5 s. Every result carries `yammer://meeting/<id>`.
- It runs at the top of `run()` in `src-tauri/src/lib.rs`, before Tauri and before the single-instance plugin, which would otherwise forward the launch to the running app. The meetings dir comes from `dirs::data_dir()` + the identifier, where Tauri's `app_data_dir` would put it.
- At startup the app writes `mcp.json` to its config dir (`advertise_mcp`): its own binary, or `$APPIMAGE`, plus `--mcp`. Sush finds the server through this file.
- "Ask in Sush" in a finished meeting's toolbar (`src-tauri/src/sush.rs`, shown when `sush_installed`) opens `sush://ask?meeting=<id>&title=<title>`. Sush opens a new chat with the composer prefilled: `@Yammer About my meeting “…” (yammer://meeting/<id>): `. A Sush.app built before its links (no `sush` scheme in its Info.plist) made `open` fail with exit status 1, so on macOS Yammer now checks the plist first. If the scheme is missing, or opening the link fails, it opens Sush with that same question on the clipboard and says so.
- `--open-meeting=<id>` shows the main window and opens that meeting (an `open-meeting` event, then `requestOpenMeeting` and `useOpenMeetingRequest` in `src/lib/meetings.ts`). Sush sends it when a `yammer://meeting/<id>` link in one of its answers is clicked.
- `--meeting=start` and `--meeting=stop` (`meeting::set_live`) do nothing when the meeting is already in that state, unlike `--meeting`, which toggles.

### 2026-11-16 (instant start and call end)
- `meeting::start` puts up the meeting state and plays the start cue before connecting. `open_channels` then connects every channel to the streaming engine and opens its recording at the same time (`join_all`, and `tokio::join!` per channel), where before each channel connected and then opened, one after another. If anything fails, the captures that did open are stopped and the overlay goes back (`apps/desktop/src-tauri/src/meeting.rs`).
- Call spotting polls every 500 ms instead of every 2 s (`POLL` in `apps/desktop/src-tauri/src/calls.rs`), and a call counts as over once its app has let go of the mic for 1 s instead of 6 s (`LEAVE_MS` in `crates/voice-core/src/calls.rs`). `HOLD_MS`, the 3 s before a call counts as begun, is unchanged.

### 2026-11-16 (quieter list of past meetings)
- Past meetings sit under one heading per day ("Today", "Yesterday", "Thursday, Nov 12", with the year for an earlier year), from `dayLabel` and `byDay`. Each row shows only the time and length, not the full date (`apps/desktop/src/pages/meetings.tsx`).
- The "Notes" badge is gone from rows. "Writing notes…" still shows while notes are being written. A meeting under a minute long reads "<1 min" instead of "under a minute".
- `Meeting::overview` leaves Markdown headings out of the preview, so it starts with the notes ("Shipped the beta…") rather than "Summary" (`crates/voice-core/src/meetings.rs`).

### 2026-11-16 (notes, Ask, search: phase 1 of matching Granola)
- Note templates replace the four fixed styles. Yammer's eight are `settings::built_in_templates`, held in code; the user's own are `MeetingSettings.templates`. `MeetingSettings.summary` is now the default template's id, and `migrate` (run by `Settings::load`) turns the old "custom" style's `summaryInstructions` into a template of the user's own (`crates/voice-core/src/settings.rs`).
- Each meeting carries its template from the moment it starts (`Meeting.template`, set to the default in `meeting::start`), and `meeting_set_template` changes it without writing anything, then sends `meeting-updated` so the other window follows. The live view's header has a "Notes as" picker. The overlay pill shows the template's name next to the clock as a button that opens the overlay's own menu listing just the templates (`templatesOnly`; the overlay can't take focus, so a native dropdown isn't an option), and its right-click menu has "Notes as: …", which moves to the next template on each click like the Transform item (`useLiveTemplate` in `overlay.tsx`). The final notes and "So far" use it. `meeting_summarize` takes a template, else that one, else the default, so "Write again" keeps the meeting's choice (`src-tauri/src/meeting.rs`).
- Notes can be written mid-meeting from what's been said so far. When the meeting stops, the final notes wait for any write in progress (`wait_for_notes`), then replace those notes. Writes and revisions share one busy flag per meeting (`Busy`, a drop guard over `Meetings::summarizing`).
- `cleanup::revise` rewrites the written notes by a request, and `cleanup::chat` answers questions about one meeting. The transcript and both sets of notes go in the system prompt, and the thread goes in as messages (`crates/voice-core/src/cleanup.rs`). The thread is saved as `Meeting.chat`, and only once a question is answered.
- `Meeting::delete_segments` and `meeting_delete_segments` take lines out of a transcript. `Meeting::search` and `Store::search` power the list page's search: every word must appear in some field, matches are ranked by how often they occur, and the snippet comes from the field that has the most of the words (`crates/voice-core/src/meetings.rs`).
- UI changes:
  - The finished view's tabs are Notes, Transcript and Ask.
  - Notes has an Enhanced / My notes toggle. Enhanced (`components/meeting-notes.tsx`) has a template picker, an Edit mode, and an "Ask for changes" box with one Undo.
  - Ask (`components/meeting-ask.tsx`) is a thread whose suggested prompts work as quick actions.
  - The live view's side panel is Your notes / Ask / So far.
  - Transcript has a "Remove lines" mode.
  - Settings → Meetings has a template picker and "Your templates".
- Templates have their own page, Teach → Templates (`pages/templates.tsx`), shaped like Transforms. It's a radio list of every template, picking the one in use. Built-in templates can be copied; the user's own can be edited and deleted. Each template is a card with a one-line description (`NoteTemplate.description`, only on Yammer's own) and its sections as chips, taken from the `"## Heading"` mentions in its instructions. The instructions themselves are written for the model, so they only show when editing a template of your own. The Meetings page's start card has a "Notes written as" picker and an "Edit templates" link. Settings → Meetings keeps the default picker and links to the page instead of holding the editor.
- New commands (`meeting_revise`, `meeting_ask`, `meeting_delete_segments`, `meeting_search`, `meeting_templates`) are registered for desktop and in `android::run`.

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

Every choice on Settings → Meetings was a three-option dropdown under a paragraph, so comparing options meant opening each menu, and the "You"/"Them" idea was only described in prose. Three options fit on screen, so they're cards, and the channel chips show the result. The engine page already used radio cards (`EngineChoice` in `pages/engine.tsx`), so this matches. Caveats now show only for the option they apply to, which cut most of the page's text. The hotkey and call spotting both answer "what starts a meeting", so they share a section, and Calendar comes last because it's set up once. The trade-off is height: cards take more room than a dropdown, but this page is visited rarely and read carefully.

The calendar is the cheapest way to know what a meeting is and who's in it. A secret iCal address needs no OAuth app or verification, works for Google and Outlook alike, works on Android, and stays on the device. Parsing is our own, because the format is small, but repeats are not: getting `RRULE` right is a library's job. They're expanded in the event's own zone, so a weekly 9:00 meeting stays at 9:00 across daylight saving; only a floating time (no zone, rare) repeats in UTC. Calendar offers reuse the call card instead of OS notifications: no new permission, and the card already handles queuing behind dictation.

Granola's core is that it starts from what you typed, can show it either way, and lets you reshape the result. Yammer already kept the user's notes in the prompt, but showed only one fixed layout that couldn't be edited. Built-in templates live in code rather than settings, so improving a prompt reaches existing users. The cost is that users can't edit Yammer's own templates; they write their own instead. Revising and asking reuse the cleanup model and key, so they need no setup beyond what notes already need. This work is the "Yammer captures" half of the Yammer + Sush plan: questions across many meetings belong to Sush, which will read Yammer's meetings over MCP. The template editor first sat at the bottom of Settings → Meetings, and even the developer couldn't find it. Templates are something you shape, like Transforms, so they moved to Teach, where Transforms are, and the choice that matters before a meeting (which template) moved onto the Meetings page itself. The MCP server reads the meeting files rather than asking the running app, so it works whether or not Yammer is open, and it can't interfere with a meeting being recorded. Search is a plain scan of the JSON files, which is fast enough for hundreds of meetings and needs no index to keep in sync.

Android doesn't let one app record another's call. Playback capture excludes voice-call audio, and a call app holding the microphone silences other recorders. So the phone version is for meetings in a room, where the one microphone hears everyone. Tagging that "You" would make the notes credit the user with everything said, so it gets its own label. The microphone stays in Kotlin, as for dictation, because the foreground service is what keeps microphone access with the app in the background. Audio goes to Rust as it's heard, and the return value doubles as the stop signal. That way Rust never has to call into Kotlin with the activity gone, which the Tauri plugin can't do. Starting goes through the plugin anyway: only the app's own page starts a meeting, and Android 14 only lets a microphone service start while the app is on screen.

People asked for notes from Teams calls, where most of what matters is said by the other side. The microphone alone only hears the user, so the computer's output is captured too. Each side is kept as its own channel rather than mixed. That labels who spoke, costs nothing extra, and stays accurate when people talk over each other. The trade-off is echo. With laptop speakers, the mic also hears the call, and those lines appear twice. The settings tell the user to wear headphones rather than try echo cancellation that could drop their own speech.

`gpt-live-transcribe` has no server-side voice detection, and Sarvam benefits from explicit flushes, so the app decides where turns end. One `Segmenter` drives every engine, which keeps timestamps and turn boundaries the same whichever engine is chosen, and makes the logic unit-testable without a network.

Keeping the dictation engine as the default means a meeting works offline with on-device whisper and needs no new key. Streaming engines are opt-in for lower latency. Falling back to the dictation engine when a stream is lost for good was chosen over stopping the meeting: a gap in a transcript is worse than a few seconds of extra delay.

Notes are written from the transcript plus the user's own typed notes, so the write-up stresses what the user cared about. The notes take a title line, so meetings get specific names without asking. Per-meeting files avoid rewriting every meeting each time a long call autosaves.

Each row of the past-meetings list repeated the full date and year and a "Notes" badge, and most previews began with the notes' "Summary" heading. On a day with several meetings that's the same few words on every line, with the title squeezed in between. The day headings say the date once, and the badge was on nearly every row, so it didn't single any out. Search results keep their full date and field badge, because there the rows aren't in date order.

Clicking Transcribe on the call card did nothing visible for about three seconds: two TLS WebSocket handshakes (OpenAI's also waits for `session.updated`) and two audio-device opens ran in series before Sushi changed. Recording now starts alongside the connection, and the unbounded channel holds the audio until the stream is ready, so no speech from the moment of the click is lost. The cost is that a refused key now shows the meeting state for a moment before the error. Call ends were noticed 6 to 8 s late, which read as Yammer not noticing at all. A shorter wait means an app that drops the mic for longer than a second, such as when switching devices, gets a "call ended" card. That card counts down for 10 s, and holding the mic again takes it back, so a false end costs a card rather than a stopped meeting. Polling four times as often costs little on Windows and macOS. On Linux it runs `pactl` twice a second, but only while call spotting is on.

## What makes it stand out

- The settings show the transcript labels each audio choice produces, rather than describing them, and caveats appear only for the option they apply to. The radio cards are a real radio group: arrow keys move the choice, and only the selected card is in the tab order.
- Meetings are reachable by any MCP client with no cloud and no account, and the server can't change them: it only opens the files the app writes.
- Ask works during the meeting ("What did I miss?"), from the same live transcript the page shows. Nothing has to be uploaded first.
- A note change asked for mid-call can't race the final notes: the stop waits for it, then writes from the whole transcript.
- Captures both sides of a call from any meeting app, with no bot joining the call and no virtual audio driver (cpal process tap on macOS, WASAPI loopback, PulseAudio/PipeWire monitor).
- Speaker labels come from which channel the audio arrived on, not from diarization guesses.
- Works fully offline with the on-device engine. Streaming engines reconnect, and then fall back instead of failing.
- A refused key or unknown model is reported before recording starts: the WebSocket is opened, and OpenAI's `session.update` confirmed, first.
- Writing notes never overwrites notes typed meanwhile: the result is applied to the meeting as it is on disk at that moment (`Meetings::update`).
- Markdown is rendered as React elements only (no HTML injection), and ticking an action item rewrites the saved notes.
