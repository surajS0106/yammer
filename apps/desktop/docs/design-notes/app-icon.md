# App Icon — Design Notes

Last updated: 2026-10-19

## What changed

### 2026-10-19 (Dock only while the window is open)
- When the Dock icon comes back, `dock::show` applies the themed icon again 300 ms and 1.2 s later, and `set_icon` now calls `dockTile().display()`. The Dock creates the new tile, with the binary's own icon ("exec" in dev builds), a moment after the policy changes, so an icon set right away was lost. Re-applying it with a redraw on the running app confirmed the fix.
- The Dock icon now shows only while the main window is open. `dock::show` sets the `Regular` activation policy in `tray::show_main` and `Accessory` when the window closes and at startup, then puts the themed icon back (`src-tauri/src/dock.rs`). macOS keeps a Dock app's windows off other apps' full-screen Spaces, even a non-activating panel marked as a full-screen auxiliary, so Sushi could not follow you onto full-screen apps while Larp was always in the Dock. This was confirmed on the running app, where switching it to `Accessory` brought Sushi onto full-screen VS Code. See `overlay.md`.

### 2026-10-19 (Dock)
- Larp is now a regular Dock app on macOS: the `Accessory` activation policy and `LSUIElement` (`Info.plist`) are gone. Clicking the Dock icon shows the hidden window (`RunEvent::Reopen` in `src-tauri/src/lib.rs`).
- While Larp runs, the Dock icon follows the system theme. `src-tauri/src/dock.rs` sets `NSApplication.applicationIconImage` from the embedded `macos-light.png` / `macos-dark.png`, on `RunEvent::Ready` and on every `WindowEvent::ThemeChanged`. It has to be `Ready`, not `setup`: Tauri dev builds set their own Dock icon on `Ready`, which would overwrite one set earlier.

### 2026-10-19
- Replaced the Sush mark with Larp's ribbon "L" as the app icon on every platform.
- The three source images now live in `src-tauri/icons/source/` as `larp-light.png`, `larp-dark.png` and `larp-mark.png`. They were moved out of `public/` so the ~4 MB originals are not shipped in `dist/`.
- `src-tauri/icons/source/make_icons.py` regenerates every icon from those sources:
  - macOS: a 1024px canvas with an 824px body, a rounded-square mask and a soft drop shadow. It writes `icon.icns` (light, the bundled default), `icon-dark.icns`, and `macos-light.png` / `macos-dark.png` masters.
  - Windows and Linux: the transparent L, cleaned of background-removal specks and trimmed to a square with a 6% margin. It writes `icon.png`, `icon.ico` (16 to 256 px), the `NNxNN.png` sizes and the Windows `Square*Logo.png` / `StoreLogo.png` tiles.
  - In-app: `public/larp-icon-{light,dark}.png` and `public/favicon-{light,dark}.png`.
- The sidebar logo switches with the theme through the existing `.dark` class (`src/App.tsx:41-42`).
- The favicon switches through `prefers-color-scheme` media queries (`index.html:6-7`).
- Removed `public/sush-mark*.png` and `public/favicon.png`.

## Why

macOS icons follow Apple's grid: an 824px rounded square centred on a 1024px canvas, with a shadow. Icons that skip the grid look oversized and square-cornered in the Dock and Finder. The mask is a rounded square whose corners are superellipse curves (they start 30% in, with exponent 3). This keeps the corner curvature continuous like Apple's shape, and its diagonal inset matches a 22.5%-radius circle. A plain n=5 superellipse was tried first, but it looked bulgy at this size.

Windows and Linux don't put app icons on a shared tile shape, so the transparent mark is used directly, as other apps on those platforms do.

The source alpha sits at about 252 rather than 255. It is snapped to opaque so the icons don't look faintly see-through over the desktop.

Known limitation: a `.icns` file is static. To have Finder, Launchpad and Spotlight swap light and dark automatically on macOS 26, the icon must ship as a compiled asset catalog (`Assets.car` plus `CFBundleIconName`). That catalog is built by Xcode's `actool`, which is not available with Command Line Tools alone. Until it is set up, `icon.icns` (light) is the bundled icon, and `icon-dark.icns` and `macos-dark.png` are ready for the catalog.

Larp was moved into the Dock at the user's request. That makes a runtime swap worthwhile: the running app's Dock icon matches the theme without Xcode. The trade-off is that the swap only lasts while Larp runs. When it isn't running, a pinned Dock icon, Finder and Launchpad show the static light `.icns`.

## What makes it stand out

- One script regenerates every platform's icons from three committed sources, instead of a one-off export that drifts.
- The macOS shape uses continuous-curvature corners on Apple's 824/1024 grid, not a CSS-style circular `border-radius`.
- The transparent mark has background-removal specks removed with a morphological opening, so no stray pixels show at 16 to 32 px.
- The running Dock icon follows the system light/dark setting live, using a ~15-line AppKit call instead of a second app bundle or a restart.
- Both the in-app logo and the favicon follow the OS theme with no JavaScript: the logo uses the existing Tailwind `dark:` variant, and the favicon uses `media` attributes.
