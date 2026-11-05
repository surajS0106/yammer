---
name: build-apk
description: Build a debug APK of Yammer's Android app and hand it over for sideloading on a phone or emulator. Only when the user explicitly asks to build an APK or a phone build.
disable-model-invocation: true
argument-hint: "[phone|emulator]"
---

# Build an APK

Builds a debug-signed APK for testing. This is not a release: nothing is tagged, pushed or signed for distribution. Before anyone but the developer gets a build, use `/android-release`.

`$ARGUMENTS` picks the target. `phone` (the default) builds arm64 only, about 42 MB, which is what real phones need. `emulator` builds arm64 and x86_64, about 109 MB, because emulators on PCs are x86_64.

Run everything from the repo root. Start every shell command with:

```sh
. .claude/skills/build-apk/android-env.sh
```

## 1. Preconditions

- **Toolchain:** check that `"$JAVA_HOME/bin/java" -version` runs, and that `$ANDROID_HOME/platforms` and `$NDK_HOME` exist. If not, stop and tell the user what's missing. Android Studio's SDK Manager installs them.
- **Rust targets:** `rustup target list --installed` needs `aarch64-linux-android`, and `x86_64-linux-android` for an emulator build. `rustup target add` installs them.
- **The Android project:** `apps/desktop/src-tauri/gen/android` must exist. If it doesn't, stop. **Never run `tauri android init` over an existing project:** `gen/android` holds hand-written Kotlin, manifest entries and icons.
- **Uncommitted changes:** mention any from `git status --short`. They go into the build.

## 2. Build

Run in the background, because a cold build compiles every Rust dependency. Send output to a log and capture the real exit code. **Never pipe the build into `tail`:** that reports `tail`'s exit code, so a failed build looks like a success.

```sh
. .claude/skills/build-apk/android-env.sh
LOG="${TEMP:-${TMPDIR:-/tmp}}/yammer-apk.log"
# phone:
bun --filter desktop tauri android build --debug --apk --target aarch64 > "$LOG" 2>&1; echo "EXIT $?"
# emulator (instead):
bun run build:android > "$LOG" 2>&1; echo "EXIT $?"
```

Tauri's `beforeBuildCommand` runs the tsc and Vite build first.

## 3. If it fails

Quote the first real error: `grep -nE '^e: |^error|FAILURE|What went wrong' "$LOG" | head`. Cut long lines, because Tauri's final error prints the whole environment.

- **`Downloading ... gradle-*-bin.zip failed: timeout`, while `curl` reaches the same URL:** Java's networking, seen on Windows. Retry with `export JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true`. If the wrapper still can't fetch it:
  1. Download the zip with `curl` into the folder under `~/.gradle/wrapper/dists/gradle-<version>-bin/<hash>/`.
  2. Compare it with the published `<url>.sha256`.
  3. Delete the `.lck` and `.part` files there, and build again.
- **`e: file:///...`:** a Kotlin compile error. Fix it in `gen/android/app/src/main/java/com/sush/yammer/`, not under its `generated/` folder, which every build overwrites.
- **`error[E...]` in Rust:** usually desktop-only code reached from an Android path. See the `#[cfg(desktop)]` gates in `lib.rs` and `commands.rs`.
- **A permission "not found" while building:** a desktop-only plugin's permission is in `capabilities/default.json`. It belongs in `capabilities/desktop.json`, which is limited to desktop platforms.

Warnings about `source value 8` and deprecated `onBackPressed` come from the template and Tauri's own Kotlin. Ignore them.

## 4. Verify before handing it over

```sh
. .claude/skills/build-apk/android-env.sh
apksigner verify --verbose --min-sdk-version 26 "$YAMMER_APK" | grep -E 'Verifies|v2 scheme|DOES NOT|ERROR'
aapt2 dump badging "$YAMMER_APK" | grep -E '^package|native-code'
unzip -tq "$YAMMER_APK" | tail -1
grep -rlE 'TEMP-TEST|TEMP_' apps/desktop/src-tauri/gen/android/app/src apps/desktop/src-tauri/src
```

The signature must say `Verifies`, `native-code` must include `arm64-v8a` for a phone, and the last `grep` must find nothing, because test hooks must never reach a build someone installs.

For a phone, copy it to a version-named file, so it isn't confused with an older one:

```sh
cp "$YAMMER_APK" "$HOME/Downloads/Yammer-<version>-arm64-debug.apk"
```

## 5. Report

Give the full path, the exact size in bytes, and the install steps:

- **Copy it by USB file transfer or Google Drive, not a messaging app.** Check that the size on the phone matches, then install from the Files app.
- **"App not installed" is a generic message.** Check the size first. To get the real reason, run `adb install <apk>` over USB debugging and read the `INSTALL_FAILED_...` line.
- **"App blocked to protect your device" is Play Protect,** not a damaged APK. It blocks sideloaded apps that request sensitive permissions, most likely Accessibility in our case, and it has been seen on a OnePlus 12R in India. On the developer's own phone, they can pause scanning under Play Store → profile → Play Protect → gear, install, and turn it straight back on. Say what that lowers. **Don't suggest this for other people's phones:** use `/android-release`.
- **Accessibility may be greyed out on a sideloaded app.** Use App info → ⋮ → Allow restricted settings, then try again.

Also say it's debug-signed and debuggable, and needs a real speech-service key in the app.

## Icons

Android's launcher icons are in `gen/android/app/src/main/res/mipmap-*`, generated from `icons/source/yammer-light.png`. If the source changes, generate them to a temporary folder and copy only the `android/` output:

```sh
bun --filter desktop tauri icon src-tauri/icons/source/yammer-light.png --output <temp folder>
```

`tauri icon` without `--output` would overwrite the desktop icons, which only `icons/source/make_icons.py` may write.
