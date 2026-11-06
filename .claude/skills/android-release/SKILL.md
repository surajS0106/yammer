---
name: android-release
description: Readiness checklist and steps for giving Yammer's Android app to anyone other than its developer, by signed APK or Google Play. Only when the user explicitly asks to prepare a release or share the Android app.
disable-model-invocation: true
argument-hint: "[audit|internal-test]"
---

# Prepare an Android release

A debug APK is only for the developer's own phone. This takes the app to a build someone else can install, and `audit` (the default) stops after reporting what's still in the way.

**Sections 3 and 4 are mostly untested; only the GitHub signed-APK route has run (v0.6.0).** Check them against the current Android and Play documentation, and correct this file when something differs. `release-android.yml` builds a signed arm64 APK and attaches it to the version's GitHub release (it uses the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets in the `release` environment; the keystore backup is in `~/.yammer`). The desktop updater doesn't cover Android.

Start every shell command with `. .claude/skills/build-apk/android-env.sh`.

## 1. Audit

Check each one against the code and report ✅ or ❌. Items ❌ at the time of writing may have been fixed since, so look rather than assume.

**Blocks any release:**

- **API keys encrypted:** `secrets.rs` must not use the plain `dev-secrets.json` backend on Android. Use the Android Keystore. Then update the "stored in" text in `key-field.tsx`, `settings.tsx`, `help.tsx` and the note in `CLAUDE.md`.
- **Not debuggable, no cleartext:** a release build's manifest must show neither `debuggable` nor `usesCleartextTraffic=true`. Check with `aapt2 dump xmltree --file AndroidManifest.xml <apk>`. A debuggable app lets anyone with USB debugging read its keys and History with `run-as`.
- **Accessibility scope is minimal:** in `res/xml/accessibility_service.xml`, drop `flagRetrieveInteractiveWindows` and any event types that aren't needed. Yammer only needs the focused box.
- **No paste into password fields:** `YammerAccessibility.pasteClipboard` should refuse when `node.isPassword` is true.
- **Clipboard:** dictated text shouldn't stay there indefinitely. Clear it after a successful paste, or mark it sensitive.
- **File sharing:** `res/xml/file_paths.xml` is still the template's broad config. Remove the provider if nothing uses it, or narrow it.
- **Test hooks gone:** `grep -rnE 'TEMP-TEST|TEMP_'` finds nothing, and `/android-check` passes.
- **Real-device test:** `/android-test`'s core flow on a physical phone with a real key. Try more than one manufacturer if possible.

**Should be fixed or decided:**

- **History retention:** text and the last 20 recordings are kept indefinitely, unencrypted, by default. Consider shorter defaults on mobile.
- **Privacy disclosure:** the app must tell people plainly that audio goes to their speech provider, and what Accessibility is used for. A privacy policy is needed for Play.
- **Desktop text left on Android:** parts of the Help page, History export to Downloads, and anything else reached from the sidebar.
- **Updates:** how people get a new version, since the sidebar's updater doesn't apply. Play handles this for Play installs.
- **`versionCode`:** Android compares this to allow an update. It comes from `version` in `tauri.android.conf.json` (Android's version is separate from desktop's), so bump that per release.

Report the list. If `$ARGUMENTS` is `audit` or empty, stop and offer to fix what's ❌.

## 2. Choose how it's distributed

Explain this to the user before going on:

- **Google Play internal testing (recommended):** the only route here that doesn't ask people to weaken anything, and it handles updates. It needs a Play Console account and a declaration for the Accessibility API, and Google may refuse that use. Have a fallback ready.
- **Signed APK:** quick for a person or two, but Play Protect can still block it, as it did on a OnePlus 12R in India. **Don't tell other people to turn off Play Protect.** A build without Accessibility may avoid the block, at the cost of pasting by hand.
- **An on-screen Yammer keyboard:** types without Accessibility, so it could remove that permission and its review altogether. It's a real feature to build, not a setting.

## 3. Signing (confirm with the user first)

The signing key is permanent: losing it means existing installs can't update. Google Play's App Signing can reduce that risk.

- Let the user choose where it lives, and have them run `keytool` so that they choose the password.
- **Never commit the keystore or its passwords.** `key.properties`, `keystore.properties` and `local.properties` are ignored by `gen/android/.gitignore`, but `*.jks` and `*.keystore` aren't, so check `git status` before any commit.
- Never put the password in a command line or print it.
- Wire it into `gen/android/app/build.gradle.kts`, reading from an ignored properties file.

## 4. Build

```sh
. .claude/skills/build-apk/android-env.sh
bun --filter desktop tauri android build --aab --target aarch64    # for Play
bun --filter desktop tauri android build --apk --target aarch64    # for sideloading
```

Add the other targets Play expects (`armv7`, `x86_64`) if needed. Capture the real exit code as in `/build-apk`, and run the release build through R8. The app calls Rust over JNI, so `proguard-rules.pro` must keep `YammerNative`. **Test the release build itself on a device:** debug builds skip shrinking, so a missing keep rule only fails here.

Uploading to Play and publishing are outward-facing. Confirm each one with the user.

## Report

The audit table, the chosen route, the artifact's path and size, and what was tested on it and on which device. Say plainly if anything was skipped.
