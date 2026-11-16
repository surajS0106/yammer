# Sidebar Navigation — Design Notes

Last updated: 2026-11-16

## What changed

### 2026-11-16 (pinned brand)
- The Yammer brand (mark, name and "by Sush") and the macOS traffic-light strip above it no longer scroll with the sidebar. The `<nav>` is no longer the scroll container: the brand sits in a `shrink-0` header, and only the page list, the cards and the footer below it scroll, in their own `overflow-y-auto` box (`src/components/sidebar.tsx`).

### 2026-10-19
- Hover is now one shared background that glides between sidebar items as the pointer moves, ported from Sush's `HoverHighlight` (`src/components/ui/motion-highlight.tsx`, copied from `../sush/apps/desktop/src/components/ui/motion-highlight.tsx` with the import switched from `framer-motion` to `motion/react`). It wraps both the page list and the footer (Settings, Help). `NavButton` is marked `data-hover-item` and no longer has its own `hover:bg-*` (`src/App.tsx`).
- The selected item's background no longer slides. It was a Motion `layoutId="nav-active"` span shared by every item and is now a plain span that sits in place, as in Sush (`src/App.tsx`).

## Why

The shared `layoutId` made the selected highlight travel from the old item to the new one. The page list is at the top of the sidebar and Settings/Help are pinned to the bottom (`mt-auto`), so going from a page to Settings sent an empty pill down through the gap. In a screen recording it was visible halfway down about 100 ms after the click and looked like the sidebar scrolling.

Sush gets its smooth feel from the hover layer, not the selection. A single background follows the pointer with a fast spring (stiffness 600, damping 40), so moving down the list reads as one continuous motion, while the selected row changes instantly when you click. Yammer now works the same way. The trade-off is that clicking gives no slide from the old selection to the new one, but the hover background is already under the pointer when you click, so there is nothing for a slide to explain.

When the window is short enough for the sidebar to scroll, the whole column used to move, so the brand slid up under the traffic lights and the "Talk" label ended up beside them. The brand is also the sidebar's drag region, so scrolling it away also took away the place to drag the window from. Pinning only the header keeps both in place, at the cost of a little less height for the list when space is tight.

## What makes it stand out

- Compared with per-item `hover:` backgrounds, which blink on and off row by row, one element moves between rows and takes on each row's size and corner radius.
- It measures with `offsetLeft`/`offsetTop`, so the sidebar's own scrolling and the collapse transform don't throw it off.
- A short delay (`HIDE_DELAY`, 80 ms) bridges the gap between rows, so moving across a row boundary glides instead of fading out and back in.
- Scrolling hides it until the pointer moves again, so rows passing under a still pointer don't drag it along the list.
- It honours reduced motion through `useReducedMotion` and does no animation in that case.
- It is shared code with Sush, so the two apps' sidebars feel the same and fixes can be ported in either direction.
