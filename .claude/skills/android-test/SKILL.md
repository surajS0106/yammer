---
name: android-test
description: Install Yammer's Android app on an emulator, drive it with adb, and confirm a change works by looking at the screen and asking Android. Use when asked to run, try or test the Android app, or after changing Android behaviour.
argument-hint: "[what to test]"
---

# Test on Android

Tests `$ARGUMENTS`, or the whole flow below if that's empty. Compiling proves little here: the bugs that mattered, like Sushi dying with the screen and a blank page on reopen, only showed up by running the app.

Run from the repo root. Start every shell command with `. .claude/skills/build-apk/android-env.sh`, which provides `adb` and the other helpers.

## 1. Set up

Check `adb devices -l`. If there's no emulator, list them with `"$ANDROID_HOME/emulator/emulator" -list-avds` and start one in the background with `-no-snapshot-save -no-boot-anim`. Then wait until `adb shell getprop sys.boot_completed` prints `1`. An x86_64 emulator needs the emulator build from `/build-apk`.

Before installing, tell the user **not to click in the emulator window during a test.** It's a real window on their desktop, and stray clicks look exactly like bugs. Run these before each session:

```sh
. .claude/skills/build-apk/android-env.sh
adb shell input keyevent KEYCODE_WAKEUP    # an asleep emulator screenshots as solid black
adb shell settings put system screen_off_timeout 1800000
adb install -r "$YAMMER_APK"
```

- For a first-run test, add `adb shell pm clear com.sush.yammer`. That wipes the settings, key and History.
- `adb install -r` kills the service and can turn off Accessibility. After it, re-run `adb shell settings put secure enabled_accessibility_services com.sush.yammer/com.sush.yammer.YammerAccessibility` and restart the app.

## 2. Drive it, carefully

```sh
adb shell am start -n com.sush.yammer/.MainActivity
adb shell input tap <x> <y>
adb exec-out screencap -p > "<scratchpad>/name.png"   # then Read the image
```

- **Wait for a cold start:** allow about 12 seconds on the emulator before the first tap. Taps during loading miss, and a Back key then exits the app.
- **Convert coordinates:** taps use physical pixels. The Read tool says when it scales an image: for 1080×2400 it shows 900×2000, so multiply what you see by 1.2.
- **Take a screenshot after each step,** and don't chain several taps blind. A layout shift means a later tap lands somewhere else.
- **Know the bubble's position:** with no saved position, Sushi's centre is about (89, 1289) on a 1080×2400 screen.
- **Watch the Back key:** with the keyboard up it only closes the keyboard. To close the keyboard safely, tap the chevron at the bottom of the screen.
- **Remember toasts:** a toast sits over Continue for about 4 seconds, and a tap lands on the toast.
- **Run-as with a relative path only:** `adb shell run-as com.sush.yammer cat settings.json` works. Don't use `sh -c`, because the quoting breaks and `find` then runs from `/`, producing megabytes of output.

Permissions the test doesn't need to prove can be granted directly:

```sh
adb shell pm grant com.sush.yammer android.permission.RECORD_AUDIO
adb shell pm grant com.sush.yammer android.permission.POST_NOTIFICATIONS
adb shell settings put secure enabled_accessibility_services com.sush.yammer/com.sush.yammer.YammerAccessibility
```

## 3. Ask Android, not just the screen

| Question | Command | Want |
|---|---|---|
| Is the mic really on? | `adb shell dumpsys audio \| grep -E 'rec (start\|stop\|update)' \| tail -3` | `pack:com.sush.yammer` and `not silenced` |
| Is the service foreground? | `adb shell dumpsys activity services com.sush.yammer \| grep -E 'YammerService\|isForeground'` | `isForeground=true`, `types=0x00000080` |
| Is the process alive? | `adb shell pidof com.sush.yammer` | A stable number. A new one means it died and restarted |
| Did it crash? | `adb logcat -d \| grep -E 'FATAL EXCEPTION\|panicked\|Fatal signal\|crashed service' -A5` | Nothing |
| What's saved? | `adb shell run-as com.sush.yammer cat settings.json` or `history.json` | The expected values |

Run `adb logcat -c` before a test, so old lines don't count. `Scheduling restart of crashed service` for `YammerAccessibility` means the whole process exited, even if `pidof` looks fine afterwards.

## 4. The core flow

Run all of these after any change to the service, the activity or `android::run`:

1. **Setup:** clear data, walk through onboarding, and reach Home with Sarvam selected.
2. **Sushi from another app:** turn on Sushi, press Home, and tap Sushi. The mic must be `not silenced`. One tap must add exactly one recording: compare the count of `rec (start|update)` lines before and after.
3. **Back:** press Back, then tap Sushi. The process and service must survive, and the mic must open.
4. **Swipe from Recents:** run `adb shell am stack list`, take the Yammer `taskId`, and run `adb shell am stack remove <taskId>`. The process and service must survive, and Sushi must still work.
5. **Reopen after that:** the page must load rather than stay blank, with Sushi back on. The process ID changes here, which is expected.

## 5. What the emulator can't test

The emulator's microphone is silent, so a real dictation ends at "Didn't catch that". That proves recording works, not transcription. **Don't turn on the host microphone without asking:** it records the user's room.

To reach further, add a temporary hook to `YammerService.onStartCommand`, and temporarily set the service to `android:exported="true"`:

- **`TEMP_NOISE`:** run `YammerNative.process` on random samples. With a fake key, Sarvam must answer `HTTP 403`, which proves TLS, the request and the failure path. Check for a History entry too.
- **`TEMP_DELIVER`:** call `deliver("Hello from Yammer", null)` with a text box focused. Tap the launcher's search bar first, and check the text lands there.

Start one with `adb shell am start-foreground-service -n com.sush.yammer/.YammerService -a TEMP_DELIVER`.

Mark every added line `// TEMP-TEST`. **Afterwards, delete them, set `exported` back to `false`, and confirm with `grep -rnE 'TEMP-TEST|TEMP_'`.** Only ever use an obviously fake key. Never read or copy the user's real key, including from `dev-secrets.json`.

Only a real phone and key can prove these, so report them as untested:

- Real speech and transcription quality.
- Overlay and background rules on the maker's Android version. Samsung, Xiaomi and OnePlus differ.
- Play Protect and restricted settings, because `adb` installs skip both.

## Report

A table of what was tested and how it was proven, with the screenshot or command behind each row. Then list what wasn't tested. Remove any test hooks before reporting, and say so. Point out anything left on the emulator, such as a fake key.
