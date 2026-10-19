# macOS App Lifecycle — Design Notes

Last updated: 2026-10-19

## What changed

### 2026-10-19
- `Whisper::unload` drops the cached `WhisperContext` (`apps/desktop/src-tauri/src/whisper.rs`), and `RunEvent::Exit` calls it (`apps/desktop/src-tauri/src/lib.rs`).
- The `allow(unused_variables)` on the run closure's `app` is gone, since `app` is now used on every platform (`apps/desktop/src-tauri/src/lib.rs`).
- On macOS targets, `build.rs` asks `cc --print-runtime-dir` for clang's runtime directory and links `libclang_rt.osx.a` (`apps/desktop/src-tauri/build.rs`).

## Why

**Quit crash and duplicate Dock tiles.** Every quit (Dock Quit, tray Quit, a quit AppleEvent) aborted with `ggml-metal-device.m:608: GGML_ASSERT([rsets->data count] == 0)`. ggml's Metal device is a C++ static, and its destructor runs inside `exit()`. That destructor asserts that no GPU residency sets are left, but the speech model stays cached for the life of the app and was never freed. The crash also made the Dock misbehave. While ReportCrash wrote its report, the aborting process lingered and kept its Dock tile. Clicking Yammer again started a new process with its own tile, so two or more Yammer icons appeared side by side. Freeing the model in `RunEvent::Exit` fixes both, because Tauri emits that event on every exit path before `exit()` runs the static destructors. The trade-off: if a transcription is in progress at quit, it holds its own `Arc` to the context, which can outlive the cache. That window is a quit during the moments whisper is running.

**Release link.** ggml's Metal backend uses Objective-C `@available`, which compiles to a call to `__isPlatformVersionAtLeast` in clang's runtime library. rustc links with `-nodefaultlibs`, so `bun run build:mac` failed with an undefined symbol. The previous DMG had been built with a hand-set `RUSTFLAGS=-C link-arg=.../libclang_rt.osx.a`, which nothing in the repo recorded. Putting the link in `build.rs` makes the documented command work by itself and leaves the cargo cache alone (changing `RUSTFLAGS` rebuilds every crate).

## What makes it stand out

- The fix is at the cause (an unfreed GPU context at exit), not a workaround such as `_exit()`, which would also skip the single-instance socket cleanup and other `Exit` handlers.
- One hook covers every way out, because `RunEvent::Exit` sits upstream of AppKit's `terminate:`, `AppHandle::exit` and logout alike.
- `unload` recovers a poisoned mutex (`into_inner`), so a panic elsewhere can't bring back the exit-time abort.
- The runtime path is found through the active toolchain (`cc --print-runtime-dir`) rather than a hard-coded clang version, so it keeps working after a Command Line Tools update, and it does nothing if the library isn't there.
- Checked against the release DMG: the old binary exits 134 with the assertion; the new one exits 0 with no crash report.
