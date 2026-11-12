# Yammer privacy policy

Last updated: 13 November 2026

Yammer turns what you say into text. This policy covers the Yammer apps for Android, Windows, macOS and Linux.

## What stays on your device

Yammer has no servers and no account. It doesn't collect analytics, crash reports or anything else about you. Everything Yammer keeps is stored on your device:

- History: your dictations, and the audio of the most recent ones so they can be transcribed again.
- Meetings: their transcripts, the notes you type during them, and the notes written from them.
- Scratchpad notes, your dictionary, snippets, transforms and settings.
- Your API keys. On Android they're encrypted with a key held by the Android Keystore. On a computer they're in the system keychain.

On Android, Yammer's data is excluded from device backups. You can delete any of it in the app, and uninstalling Yammer deletes all of it.

## What leaves your device

Yammer sends data only to the services you choose in Settings, using your own API key with each one. Your agreement with that service, and its privacy policy, cover what it does with the data.

- **Speech engine:** the audio of each dictation, and of a meeting while it's being transcribed, goes to your speech service (for example Sarvam, OpenAI or Groq). On a computer, an on-device model can be used instead, and then audio never leaves the computer.
- **AI cleanup:** if you turn it on, the text of each dictation goes to your AI cleanup service (for example OpenAI or Anthropic). Writing a meeting's notes sends its transcript and your typed notes there too.
- **Updates:** the desktop app checks GitHub for a newer version.

## Permissions on Android

- **Microphone:** only while you're dictating or a meeting is being transcribed. A notification shows whenever it's on.
- **Display over other apps:** to show Sushi, the button that starts dictation from any app.
- **Notifications:** to show that Yammer is ready or listening.
- **Accessibility ("Paste for you"), optional:** when a dictation finishes, Yammer finds the text box you're in and pastes your words into it. It never pastes into password fields. It doesn't read, record or send anything else on your screen. Without it, your words are copied for you to paste.

## Meetings

A meeting transcript records everyone who speaks. Tell the people present that you're transcribing, and follow the law where you are.

## Children

Yammer isn't directed at children under 13.

## Changes and contact

Changes to this policy will be posted with a new date above. Questions: open an issue at the project's GitHub repository.
