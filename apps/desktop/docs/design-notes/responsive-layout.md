# Responsive Layout — Design Notes

Last updated: 2026-10-19

## What changed

### 2026-10-19
- Main window minimum size lowered from 720×520 to 480×480 (`src-tauri/tauri.conf.json`).
- Sidebar collapses to a 56px icon rail below the `md` breakpoint (768px window width). Labels become `sr-only` and each nav button gets a `title` tooltip. From `md` up it is the full 208px sidebar again (`src/App.tsx`).
- The content column no longer uses `w-3/4` of the remaining width. It now has responsive padding (`px-4`/`sm:px-6`/`lg:px-10`) and a maximum width: `max-w-6xl` for the dashboard-style pages (`widePages`: Insights, Help) and `max-w-3xl` for forms and lists (`src/App.tsx`).
- `Row` wraps its control below the label (`flex-wrap`, label `flex-1 basis-56`) when the two no longer fit on one line. Fields get `max-w-full`, so fixed-width selects (`w-56`, `w-60`) can't overflow (`src/components/ui.tsx`).
- `Segmented` scrolls horizontally instead of clipping, and its options never wrap mid-label. `Intro` uses tighter padding in narrow containers (`src/components/ui.tsx`).
- Hover-revealed actions (copy, edit, delete) use `pointer-fine:opacity-0`, so they stay visible on touch screens. Copy buttons also reveal on `focus-visible` or `focus-within` (`pages/home.tsx`, `history.tsx`, `snippets.tsx`, `transforms.tsx`, `dictionary.tsx`).
- Container-query breakpoints (`@md`) for layouts that broke in narrow panes:
  - The Corrections add form puts its button on its own row (`pages/dictionary.tsx`).
  - The "You say / It pastes" card stacks (`pages/cleanup.tsx`).
  - The "Things you can say" rows stack (`pages/help.tsx`).
  - Insights panels and stat cards get smaller padding and type (`pages/insights.tsx`).
  - The home hero gets smaller padding (`pages/home.tsx`).
- Rows that could run out of room now wrap (`flex-wrap`) or truncate:
  - History metadata (`history.tsx`), Shortcuts rows (`help.tsx`) and button groups (`snippets.tsx`, `transforms.tsx`).
  - The Scratchpad toolbar and search (`scratchpad.tsx`).
  - The API key field (`components/key-field.tsx`) and the hotkey recorder (`components/hotkey-recorder.tsx`).

## Why

Yammer is a desktop app, but people tile it next to other apps, use it on 13" laptops, on Windows at 125–150% scaling and on ultrawide monitors. Under `w-3/4`, the minimum window left a 384px column. A 2560px display gave lines over 1500px long. A fixed maximum width plus padding gives a predictable reading measure at every size. Settings and lists stay narrower than the Insights dashboard, which needs width for its 4-column stat grid and side-by-side panels (`@5xl`).

The icon rail costs the sidebar labels below 768px, which is acceptable: the window opens at 880px by default, so most people keep the full sidebar. Users who shrink the window get the space back for content.

Pages use container queries, not viewport breakpoints, because the available width depends on whether the sidebar is collapsed. The page measures its own column, not the window.

Hover-only controls can't be reached on Windows touch laptops, so they now hide only where a fine pointer exists.

## What makes it stand out

- Two content measures selected per page (`widePages`), not one global max width. Forms stay readable while Insights still reaches its 4-column layout.
- `Row` reflows on its own through flex-basis wrapping, so all settings pages adapted without per-page breakpoints.
- Page breakpoints are `@container` queries tied to the column width. They stay correct whether the sidebar is a rail or full width.
- Touch handling uses `pointer-fine`. A mouse user still gets a clean list that reveals actions on hover, and a touch user always sees them.
- The collapsed rail keeps accessible names (`sr-only` labels), shows `title` tooltips and adds a visible focus ring on nav buttons.
