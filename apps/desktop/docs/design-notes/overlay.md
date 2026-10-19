# Overlay (Sushi and the pill) — Design Notes

Last updated: 2026-10-19

## What changed

### 2026-10-19 (hover island)
- Hovering the idle pill or Sushi opens the pill into an island with three buttons. Dictate toggles dictation, History opens the settings window on History, and Settings opens it on General (`ISLAND` and `IslandButtons` in `apps/desktop/src/overlay.tsx`). The pill grows from 48x8 to 120x40 on the same element, so the existing `ResizeObserver` keeps its hit area current.
- A tooltip above the hovered button names it. Dictate's tooltip also shows the hotkey from the new `hotkey_label` command, refreshed on `settings-changed`. The tooltip uses the `tip-in` keyframe in `src/index.css`.
- New commands `overlay_toggle_dictation` (sends `Input::Toggle`), `overlay_open` (shows the main window and emits `navigate` to it) and `hotkey_label` (`src-tauri/src/commands.rs`). `App.tsx` listens for `navigate` and switches page.
- `watch_cursor` now also emits the cursor position in CSS px as `overlay-cursor` whenever it changes, or `null` once the cursor leaves the window (`src-tauri/src/overlay.rs`). The island decides hover from that position: it opens within 10px of the pill or Sushi and stays open within 4px. The buttons' highlight and tooltip use the same position instead of CSS `:hover`.
- Buttons stop `mousedown` from reaching the container, so clicking one does not start a window drag.

### 2026-10-19 (accessory app while the window is closed)
- The panel and occlusion changes were not enough on their own. The overlay was confirmed to be a `YammerOverlayPanel` with collection behavior 337 and the non-activating style, but it still stayed off full-screen VS Code while Yammer was a `Regular` app. Yammer now drops its Dock icon (`Accessory`) whenever the main window is closed (`dock::show`, see `app-icon.md`). While the settings window is open, Sushi still can't appear on full-screen apps. Entering a full-screen Space still shows a short blink, because macOS adds auxiliary windows only after the transition.

### 2026-10-19 (no blink on Space switch)
- The overlay's `WKWebView` has window occlusion detection turned off through WebKit's private `_setWindowOcclusionDetectionEnabled:`, guarded by `respondsToSelector:` (`panel::keep_rendering` in `apps/desktop/src-tauri/src/panel.rs`, called from `overlay::create`). macOS briefly reports the overlay as occluded during every Space switch. WebKit then treated the page as hidden and dropped its contents, so Sushi vanished and reappeared. The cost is that the overlay webview keeps rendering while it is actually covered, which is cheap because it is small and mostly idle.

### 2026-10-19 (Sushi off screen)
- Sushi goes still while its page is hidden. A `usePageVisible` hook follows `visibilitychange`. While hidden, Sushi stops its current animation, comes to rest at full opacity, and drops floating effects. Its blink, trick, sleep, voice-level and frame timers also pause (`apps/desktop/src/components/sushi.tsx`).
- Back on screen it carries on from rest. It doesn't replay the entrance or a one-off reaction (hop, backflip, shake), and only restarts the looping acts: typing, polishing and swinging while held.

### 2026-10-19
- New `panel.rs` (macOS only) turns the overlay's window into a non-activating `NSPanel` at runtime. It registers a `YammerOverlayPanel` subclass of `NSPanel`, copies tao's `focusable` ivar and its `canBecomeKeyWindow`, `canBecomeMainWindow` and `sendEvent:` overrides onto it, then swaps the window's class with `object_setClass` (`apps/desktop/src-tauri/src/panel.rs`).
- The panel gets the `NonactivatingPanel` style mask, `setFloatingPanel(true)` and `setHidesOnDeactivate(false)`. Its collection behavior adds `CanJoinAllSpaces`, `FullScreenAuxiliary`, `Stationary` and `IgnoresCycle`.
- `overlay::create` calls `panel::make_panel` right after building the window (`apps/desktop/src-tauri/src/overlay.rs`).

## Why

Removing `LSUIElement` so that Yammer has a Dock icon made it a regular app. macOS keeps a regular app's ordinary windows out of other apps' full-screen Spaces, so Sushi disappeared whenever you switched to a full-screen editor, even though the window was already set to show on all Spaces. A non-activating panel marked as a full-screen auxiliary can appear there, and it still never takes focus. That matters because the overlay must never take focus, or the paste lands in the wrong app. The cost is a runtime class swap that relies on tao internals: the `focusable` ivar name and the window class layout.

WebKit gives a hidden webview no animation frames but keeps its timers running. This happens when the window is hidden, covered, or on another Space. The main window starts hidden, so Sushi's fade-in entrance could stall at opacity 0 on Home. On the overlay, tricks queued while it was hidden and running animations jumped ahead when it came back, which looked like Sushi glitching on every Space or app switch. Resting while hidden costs only the act that was interrupted.

The island first relied on DOM `mouseenter`, and it opened only on click. macOS sends no mouse-moved events to a window that never becomes key, and the overlay must never become key. Yammer already polled the cursor to toggle click-through, so the island reuses that position rather than adding a tracking area or making the panel key. The cost is up to 40 ms of hover latency. The 10px slack is there because the idle pill is only 8px tall. The two other buttons map to History and Settings because Yammer has no meeting recorder or notes.

## What makes it stand out

- Keeps the Dock icon. The usual fix is to go back to `LSUIElement` or the Accessory activation policy, which removes it.
- Adds no dependency. `tauri-nspanel` does the same job, but it is a git dependency that tracks Tauri versions.
- Keeps tao's behavior working on the swapped class. Its focusability check and its drag-on-mouse-down override are copied over, so `startDragging` and tao's `set_focusable` keep working.
- Checks the memory layout before swapping. If the panel class's instance size or `focusable` ivar offset differs from tao's class, the class is not swapped and the window stays a plain window. On macOS 26, `NSWindow` and `NSPanel` are both 520 bytes.
- Hover works on a window that never takes focus. DOM hover events and CSS `:hover` do not fire there on macOS, so the island hit-tests against the polled cursor position instead.
- Clicking an island button keeps focus in the app being dictated into, so Dictate behaves like the hotkey.
- `Stationary` and `IgnoresCycle` keep the pet still during Space-switch animations and out of the Cmd+` window cycle.
