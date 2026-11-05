# Android build environment for Yammer's skills. Source it from the repo root, at the start of every
# shell command: shell state doesn't carry over between commands.
#
#   . .claude/skills/build-apk/android-env.sh
#
# It sets JAVA_HOME, ANDROID_HOME and NDK_HOME (keeping any you've already set), the C compiler for
# Android cross-checks, and the adb, aapt2 and apksigner helpers.

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    : "${JAVA_HOME:=C:/Program Files/Android/Android Studio/jbr}"
    : "${ANDROID_HOME:=$LOCALAPPDATA/Android/Sdk}"
    _ndk_host=windows-x86_64
    _clang_suffix=.cmd
    ;;
  Darwin)
    : "${JAVA_HOME:=/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
    : "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
    _ndk_host=darwin-x86_64
    _clang_suffix=
    ;;
  *)
    : "${ANDROID_HOME:=$HOME/Android/Sdk}"
    _ndk_host=linux-x86_64
    _clang_suffix=
    ;;
esac
export JAVA_HOME ANDROID_HOME

# The newest installed NDK and stable build-tools. `sort -V` so that 36.0.0 beats 9.0.0.
: "${NDK_HOME:=$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1)}"
export NDK_HOME
_build_tools="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" 2>/dev/null | grep -v rc | sort -V | tail -1)"

# For `cargo check` and `cargo clippy` against Android, which ring compiles C for. Tauri's own build
# sets these itself. API 26 matches minSdk in gen/android/app/build.gradle.kts.
_ndk_bin="$NDK_HOME/toolchains/llvm/prebuilt/$_ndk_host/bin"
export CC_x86_64_linux_android="$_ndk_bin/x86_64-linux-android26-clang$_clang_suffix"
export AR_x86_64_linux_android="$_ndk_bin/llvm-ar"

# What Tauri builds. Its name says "universal" whichever targets were asked for.
YAMMER_APK=apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk

# MSYS_NO_PATHCONV stops Git Bash turning device paths like /sdcard into C:/Program Files/Git/sdcard.
# It's set per call: exported, it breaks `git -C /c/...` and other tools that do need the conversion.
adb() { MSYS_NO_PATHCONV=1 "$ANDROID_HOME/platform-tools/adb" "$@"; }
aapt2() { MSYS_NO_PATHCONV=1 "$_build_tools/aapt2" "$@"; }
# Run the jar directly: apksigner.bat rejects a Git Bash style JAVA_HOME and prints nothing useful.
apksigner() { "$JAVA_HOME/bin/java" -jar "$_build_tools/lib/apksigner.jar" "$@"; }
