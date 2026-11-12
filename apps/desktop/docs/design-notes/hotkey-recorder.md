# Hotkey recorder — Design Notes

Last updated: 2026-11-12

## What changed

### 2026-11-12
- While listening, the recorder shows the held modifiers as keycaps as they go down and up, with a dashed `…` cap for the key still to come (`src/components/hotkey-recorder.tsx`).
- A combination the OS or every app already uses is refused with its owner named ("⌘ Space is already your Mac's shortcut for Spotlight"). Listening continues so the user can try another (`src/lib/reserved-hotkeys.ts`, `reservedBy`).
- Per-OS tables cover macOS, Windows and Linux (GNOME-style): system shortcuts (Spotlight, app switchers, screenshots, lock screen, Win+H voice typing, workspace switching) plus Copy, Paste, Undo and the other editing shortcuts every app shares.
- When the window loses focus while modifiers are held, the recorder stops and says the system took that shortcut. This catches the ones that never reach the webview, such as ⌘ Space, ⌘ Tab and Win+L.
- A bare key without a modifier now explains why it was ignored instead of doing nothing.
- The reason stays below the recorder after listening ends, until the next Change. A new `align` prop centres it in onboarding (`src/pages/onboarding.tsx`).

## Why

Before this, pressing a combination showed nothing until it was saved, and a combination the OS owns was either never seen (the recorder sat waiting) or saved and then never fired. The registration error from Rust only covers shortcuts another app registered through the same API. It can't see OS-owned ones, and it doesn't stop a hotkey like ⌘ C, which registers and then breaks Copy everywhere (and Edit by voice, which copies with it). The table lives in the frontend because it is UX advice, not a registration rule. The trade-off is a hand-kept list that can't be complete: users remap shortcuts and desktops differ. Rust's "Another app may already be using it" toast still covers the rest.

## What makes it stand out

- The obvious recorder captures one `keydown` and saves it. This one shows the modifiers as they are held, so a user can see which keys the app actually received.
- Refusals name what owns the shortcut, in the platform's own terms ("Task Manager", "Mission Control"), instead of a generic "invalid shortcut".
- Shortcuts the OS swallows are caught through focus loss with modifiers held, which a keydown-only recorder can't detect.
- A refused combination keeps the recorder listening, so trying another doesn't need a second click on Change.
- The reason is announced through `role="alert"`, and the live keycaps through `aria-live="polite"`.
