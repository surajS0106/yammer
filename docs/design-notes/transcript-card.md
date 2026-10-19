# Transcript card (dictating with no text box focused) — Design Notes

Last updated: 2026-10-19

## What changed

### 2026-10-19
- New `focus.rs`: `text_field_focused()` asks the macOS Accessibility API for the frontmost app's focused element. It returns `Some(true)` for text roles (`AXTextField`, `AXTextArea`, `AXComboBox`, `AXSearchField`) or for an element with a selection range and a settable value, and `Some(false)` when the element is something else or nothing has focus. It returns `None` when it can't tell (no Accessibility permission, an element with no role, a timeout after 0.3 s, or Windows and Linux). `prime()` sets `AXManualAccessibility` on the frontmost app when recording starts, so Electron apps expose their UI by the time of the check (`apps/desktop/src-tauri/src/focus.rs`).
- Pipeline: just before the paste, a `Some(false)` skips the paste and returns `Done::NoTextField`. The dictation is still saved to History (`dictation.rs`).
- New overlay state `Transcript { text }`, plus `overlay::dismiss` and the `overlay_dismiss` command, which hide the card only if it is still the current state (`overlay.rs`, `commands.rs`, `src/lib/tauri.ts`).
- `TranscriptCard` replaces Sushi and the pill for that state. It shows Sushi, a disclaimer, the transcript (scrolls past 120px), a close button and a Copy button. A ring around the close button drains over 12 s and then closes the card. The countdown pauses while the cursor is on the card or while it is being dragged. Copy shows "Copied" and closes the card after 0.9 s (`src/overlay.tsx`, `ring-drain` keyframes in `src/index.css`).
- New `restless` prop on `Sushi`: it does a trick every 0.7–2 s instead of every 3.5–8.5 s, and never falls asleep (`src/components/sushi.tsx`).

## Why

Before this change, a dictation with nowhere to go sent ⌘V into an empty desktop or a list view, and the text was silently lost to everything except History. Now the user sees what they said and can copy it.

Detection only blocks the paste when the OS is certain. Any doubt (`None`) keeps the old behaviour. A wrong "no" would hide text the user expected to land, which is worse than an occasional paste that does nothing. Apps that don't report a role to Accessibility therefore always get the paste.

Rust doesn't time the card. The webview owns the countdown, because hover-to-pause depends on cursor state that only the overlay tracks. `dismiss` checks the current state, so a stale timer can't close a newer dictation's card or pill. The card is keyed by a counter that goes up with every overlay change, so the countdown restarts even when two dictations in a row produce the same text.

The card uses the pill's hit-area ref. That way dragging, the right-click menu and click-through outside the card work without new plumbing. The buttons stop `mousedown` so that clicking one doesn't start a drag.

## What makes it stand out

- The check is three-valued (`Some(true)`, `Some(false)`, `None`), and only a definite "no" changes behaviour.
- Electron apps are covered by `AXManualAccessibility` at record start. Setting `AXEnhancedUserInterface` would cover more apps but has side effects on window managers.
- The overlay window still never takes focus. Hover states and the timer pause come from the cursor position that Rust polls, as the island's do.
- The timer ring is CSS (`animation-play-state`). Pausing it needs no extra timer state in JS, and its `animationend` is the only thing that closes the card.
- The card is drawn inside the existing 320px overlay window, so `overlay.rs` sizing and placement are unchanged.
