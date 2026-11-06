---
name: android-check
description: Compile and consistency gate for Yammer's Android app. /check and CI never compile Android code, so run this after changing src-tauri/src/android, gen/android, pipeline.rs, commands.rs, shared Rust, or anything branching on isAndroid. Use when asked "does Android still build" or before an APK or /ship that touches those.
---

# Android check

CI and `/check` only compile for the machine they run on, so **nothing checks the Android code unless this runs.** The reverse is also true: a change here can break desktop, so finish with `/check` when shared code changed.

Run from the repo root. Start every shell command with `. .claude/skills/build-apk/android-env.sh`. Stop at the first blocking failure, and report it.

## 1. Compile (blocking)

```sh
. .claude/skills/build-apk/android-env.sh
bun run typecheck
bun --filter desktop build     # generate_context! needs dist/
cargo fmt --all --check
cargo clippy -p yammer --target x86_64-linux-android -- -D warnings
```

This covers TypeScript and Rust in seconds to a minute, but **it doesn't compile Kotlin**. If `gen/android` changed, or a `YammerNative` signature did, also compile it with a real build:

```sh
. .claude/skills/build-apk/android-env.sh
bun --filter desktop tauri android build --debug --apk --target x86_64 > "${TEMP:-${TMPDIR:-/tmp}}/yammer-apk.log" 2>&1; echo "EXIT $?"
```

Don't pipe it into `tail`, which hides the exit code. `/build-apk` covers failures.

## 2. Things no compiler catches (blocking)

These only fail at runtime on a device.

- **JNI names:** each `external fun` in `YammerNative.kt` needs a Rust function called `Java_com_sush_yammer_YammerNative_<name>` in `src/android/mod.rs`, with matching parameters. A mismatch is an `UnsatisfiedLinkError` when it's first called.
- **The JSON from `process`:** the `Dictated` enum in `src/mobile/mod.rs` (`kind`: `text`, `nothing`, `failed`) must match `YammerService.finished`.
- **The bridge to Kotlin:** each name in `ACTIONS` in `src/android/mod.rs` needs a `@Command` method in `YammerPlugin.kt` and an entry in `PhoneAction` in `lib/tauri.ts`. `Status` must match what `YammerPlugin.status` returns and `PhoneStatus`.
- **Commands the UI calls:** `android::run` has its own `generate_handler!` list. A new `#[tauri::command]` the Android UI uses must be added there too, or the call fails at runtime. Desktop-only commands rejecting on Android is fine only where the UI catches it.
- **Settings the phone can't honour:** new engine, hotkey or pill settings need hiding behind `isPhone` in the pages, and `mobile::cloud_only` must keep settings off on-device speech. Its Sarvam values must match the preset in `lib/presets.ts`.
- **New Tauri plugins:** a desktop-only plugin goes under the `not(any(target_os = "android", target_os = "ios"))` dependencies in `src-tauri/Cargo.toml`, with its permissions in `capabilities/desktop.json`.
- **TLS:** `reqwest` features are set per target in `crates/voice-core/Cargo.toml`. Don't add `native-tls` to the workspace dependency: it needs OpenSSL on Android.

## 3. Manifest and leftovers (blocking)

If the manifest or a service changed, read `gen/android/app/src/main/AndroidManifest.xml`:

- `YammerService` and `YammerAccessibility` must have `android:exported="false"`. A test may flip the service to `true`. That must never stay.
- `android:allowBackup` must stay `false`, because the keys are in the app's private files.
- A new `uses-permission` needs a reason. Sensitive ones change what Play Protect and Play review do. Say so in the report.
- Text the UI shows about key storage must stay true for Android. It's in `key-field.tsx`, `settings.tsx` and `help.tsx`.

Then look for leftover test hooks:

```sh
grep -rnE 'TEMP-TEST|TEMP_' apps/desktop/src-tauri/gen/android/app/src apps/desktop/src-tauri/src
```

## 4. Lifecycle rules (advisory)

If the diff touches `MainActivity`, `YammerService` or `android::run`, check these still hold, then test them with `/android-test`:

- The foreground service starts only with the app on screen.
- `android::run` still prevents Tauri's exit when the window goes, or Sushi dies with the screen.
- Back still only backgrounds the app, and `restartWhenIdle` still handles reopening after a swipe from Recents.
- Sushi's window keeps `FLAG_NOT_FOCUSABLE`, or the paste lands in the wrong place.

## Report

One row per step: ✅, ❌ or ⚠️. List each failure with `file:line` and a one-line cause, then a verdict. Say plainly if Kotlin wasn't compiled, and that this check doesn't prove behaviour on a device.

Don't fix anything unless asked. Offer to.
