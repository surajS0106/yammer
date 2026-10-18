# App Icon — Design Notes

Last updated: 2026-10-19

## What changed

### 2026-10-19 (no Xcode for the adaptive icon, duplicate Dock tiles)
- `Assets.car` is now committed instead of gitignored. `.github/workflows/mac-icon.yml` compiles it with Xcode's `actool` on a GitHub macOS runner and commits it whenever `icons/AppIcon.icon` or `build-mac-icon.sh` changes (or when run by hand). `build:mac` now always passes `tauri.macos-icon.conf.json`, so every local DMG ships the light/dark icon without Xcode installed. Sush got the same workflow and `build:mac` change.
- Larp removes duplicate Dock tiles of itself at startup. `dock::dedupe_recents` reads `com.apple.dock`'s `recent-apps`, keeps the first Larp entry, writes the list back with `defaults import` and restarts the Dock, only when a duplicate was found (`src-tauri/src/dock.rs`, called from `setup` in `src-tauri/src/lib.rs`).

### 2026-10-19 (adaptive macOS icon, transparent sidebar mark)
- The sidebar logo is now the transparent ribbon L (`public/larp-mark.png`, one `<img>` in `src/App.tsx:89`) instead of the light and dark rounded tiles. `make_icons.py` writes it from the cleaned mark and no longer writes `public/larp-icon-{light,dark}.png`, which are deleted. The favicons are unchanged.
- macOS 26 adaptive icon, ported from Sush. `make_icons.py` writes full-bleed `light.png` and `dark.png` into `src-tauri/icons/AppIcon.icon/Assets`, cutting each source with the dark source's tile alpha and filling the corners from a blurred, enlarged copy of the tile. `icons/build-mac-icon.sh` compiles the bundle to `Assets.car` with `actool`. `tauri.macos-icon.conf.json` bundles that with `Info.icon.plist` (`CFBundleIconName` plus a copy of the microphone string).
- `release.yml` runs `build-mac-icon.sh` on both macOS runners and passes `tauri.macos-icon.conf.json`, so GitHub releases ship the adaptive icon. The `/build-dmg` skill does the same locally when full Xcode is installed.

### 2026-10-19 (minimized counts as closed)
- Minimizing the main window now drops the Dock icon too, and un-minimizing brings it back. `dock::follow_minimize` listens for AppKit's `NSWindowDidMiniaturizeNotification` and `NSWindowDidDeminiaturizeNotification` on the main window, because Tauri has no minimize event (`src-tauri/src/dock.rs`, registered in `setup` in `src-tauri/src/lib.rs`). Before this, a minimized window left Larp as a `Regular` app, so Sushi and the island vanished on full-screen apps until the window was closed. A minimized window can still be restored from the tray, which un-minimizes it (`tray::show_main`).

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

The Dock had two identical "recent app" tiles for Larp: same path, same bookmark, consecutive IDs. The running app attached to one and showed the themed icon, while the other kept the static light `.icns`. Switching the activation policy does not cause it: test apps that toggled Regular/Accessory, with and without activation and icon swaps, never produced a second tile, and neither did opening and closing the real Larp. The likely trigger is replacing `/Applications/Larp.app` with a rebuilt ad-hoc-signed copy, which leaves an entry the Dock can't match to the new bundle. It couldn't be confirmed, so the fix removes duplicates whatever made them. Writing another app's preferences and restarting the Dock is heavy-handed, which is why it only happens when a duplicate exists. It was tested by restoring the duplicate and launching the fixed build: two tiles became one.

`actool` only ships with full Xcode, and no maintained tool compiles the macOS 26 `.icon` format into `Assets.car` without it. Chromium solves the same problem by committing prebuilt `.car` files. GitHub's macOS runners already have Xcode, so compiling there and committing the output means no one installs Xcode locally. The cost is about a minute of macOS CI per icon change. A local icon change shows up in local DMGs only after it's pushed and the workflow has committed the new `Assets.car`.

macOS icons follow Apple's grid: an 824px rounded square centred on a 1024px canvas, with a shadow. Icons that skip the grid look oversized and square-cornered in the Dock and Finder. The mask is a rounded square whose corners are superellipse curves (they start 30% in, with exponent 3). This keeps the corner curvature continuous like Apple's shape, and its diagonal inset matches a 22.5%-radius circle. A plain n=5 superellipse was tried first, but it looked bulgy at this size.

Windows and Linux don't put app icons on a shared tile shape, so the transparent mark is used directly, as other apps on those platforms do.

The source alpha sits at about 252 rather than 255. It is snapped to opaque so the icons don't look faintly see-through over the desktop.

Known limitation: a `.icns` file is static. To have Finder, Launchpad and Spotlight swap light and dark automatically on macOS 26, the icon must ship as a compiled asset catalog (`Assets.car` plus `CFBundleIconName`). That catalog is built by Xcode's `actool`, which is not available with Command Line Tools alone. The catalog source is `src-tauri/icons/AppIcon.icon`. `make_icons.py` writes its full-bleed `light.png` and `dark.png`, filling the sources' rounded corners with a blurred, enlarged copy of the tile so the system mask never shows a wedge. `icons/build-mac-icon.sh` compiles it to `Assets.car`, and `tauri.macos-icon.conf.json` bundles that with `Info.icon.plist`, as in Sush. `release.yml` does this on both macOS runners, so GitHub releases ship the adaptive icon. `/build-dmg` does it locally when full Xcode is installed. A plain `bun run build` still bundles only the static light `icon.icns`, which is also what macOS before 26 shows.

The sidebar showed the full app tile at 24px, a boxed icon inside a UI that already has its own surface, and needed two images to match the theme. The transparent L has no background of its own, so one image reads on both sidebar colours. The trade-off is that the sidebar no longer echoes the exact Dock tile.

`AppIcon.icon` artwork has to be a full square, because macOS 26 applies its own shape. The sources come with rounded corners baked in (transparent in dark, white in light), which would show as wedges under the system mask. Filling the corners from the tile's own blurred edge keeps the rim colours continuous. `Info.icon.plist` repeats the microphone string because Tauri's docs don't say whether an explicit `infoPlist` merges with `Info.plist` or replaces it, and losing that string would break dictation. The release job fails if `Assets.car` isn't produced, rather than quietly shipping the static icon.

Larp was moved into the Dock at the user's request. That makes a runtime swap worthwhile: the running app's Dock icon matches the theme without Xcode. The trade-off is that the swap only lasts while Larp runs. When it isn't running, a pinned Dock icon, Finder and Launchpad show the static light `.icns`.

## What makes it stand out

- One script regenerates every platform's icons from three committed sources, instead of a one-off export that drifts.
- The macOS shape uses continuous-curvature corners on Apple's 824/1024 grid, not a CSS-style circular `border-radius`.
- The transparent mark has background-removal specks removed with a morphological opening, so no stray pixels show at 16 to 32 px.
- The running Dock icon follows the system light/dark setting live, using a ~15-line AppKit call instead of a second app bundle or a restart.
- On macOS 26, released builds swap the Finder, Launchpad and pinned Dock icon with the system theme through a compiled asset catalog, not only while the app runs.
- The in-app logo is a single transparent mark that works in both themes, and the favicon follows the OS theme with no JavaScript through `media` attributes.
