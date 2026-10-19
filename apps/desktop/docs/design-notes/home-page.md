# Home page — Design Notes

Last updated: 2026-10-20

## What changed

### 2026-10-20 (revision 2)
- Hero: Sushi's column now spans all of the space to the right of the text (`auto 1fr`, replacing `auto 12rem 1fr`). A new `Stroll` wrapper (`src/pages/home.tsx`) walks Sushi and its plate shadow to a random spot in that column every 5 to 11 seconds while idle. It moves at about 60px/s with a 3px step bob and a 5° lean in the direction of travel. Sushi stays where it is while dictation is running, and stands still under reduced motion.

### 2026-10-20
- Rebuilt the "This week" panel as a nigiri in Sushi's sprite colours (`src/components/week-stats.tsx`). The salmon top has the sprite's diagonal stripes and shows the week's words in a 5×7 pixel font (`GLYPHS`, `PixelNumber`) that dissolves in pixel by pixel. A nori band holds one pixel stack per day (up to 6 blocks, today in rice, empty days as one faint block). The rice base shows wpm and the streak in pixel numerals with the flame, plus an estimate of typing minutes skipped this week.
- Dropped the brand-to-black gradient, the half-dial gauge and the count-up animation.
- Hero: Sushi's column is now a fixed `12rem` right after the text (`auto 12rem 1fr`), so it no longer drifts away on wide windows. The dot grid became one layer across the card's right two-thirds, fading in from the left, and fills the remaining space (`src/pages/home.tsx`).
- Added the `pixel-in` keyframe (`src/index.css`); the global reduced-motion rule collapses it.

### 2026-10-19 (revision 2)
- New "This week" panel (`src/components/week-stats.tsx`) fills the right column: a brand gradient card with this week's word count counting up, seven day bars that grow in (today in solid white), a week-over-week change badge, a half-dial gauge for wpm with "N× faster than typing", and a pixel-art flame for the streak, using Sushi's sprite colours. The whole card opens Insights.
- Removed the stat chips from the greeting, since the panel shows the same numbers.
- Speech engine and AI cleanup moved out of the side column into small chips next to the hero's status pill (`SetupChip` in `src/pages/home.tsx`). Explore moved to a full-width row at the bottom, three across on wide containers.
- Hero layout: the text column is `auto` width and Sushi's column is `minmax(10rem, 1fr)`, so Sushi centres in the leftover space beside the text instead of sitting at the card's far edge.
- The try-it field autofocuses and has a coral ring and mic icon, so it is visibly live and catches the first test dictation.

### 2026-10-19
- Replaced the static "Dictate anywhere" header with a time-of-day greeting and a line giving this week's word count, from `stats.byDay` over `lastDays(7)` (`src/pages/home.tsx`).
- Swapped the three-column bordered stats box for a row of compact chips (streak, total words, wpm) next to the greeting. The row is one button that opens Insights.
- Rebuilt the hotkey card as the page's one brand-tinted surface (`bg-primary/[0.06]`, `border-primary/20`). The hotkey keycaps now sit inside the headline ("Hold ⌘ ⇧ Space and talk."). A status pill above it shows Ready, Finish setup, or the live dictation phase with a pulsing dot. On wide containers, Sushi sits on a plate shadow over a masked dot grid on the right.
- Moved the "Try it" textarea into the bottom of the hero card, so the instruction and the place to practise it are together.
- Setup checklist: renamed to "Finish setting up", added an "N of M done" count and a progress bar, and made done steps filled checks with struck-through titles.
- Bottom area is now two columns at `@3xl`. On the left is a single Recent card, grouped by day with tinted day rows instead of uppercase tracked labels, with clamped text and an empty state. On the right, "Your setup" (engine, cleanup) and "Explore" (Insights, Snippets, Scratchpad) are icon list rows. These replace the Speech engine/Cleanup settings rows and the NavCards grid.
- Fix: Sushi didn't show in the hero because the dot grid's `mask-image` was on Sushi's parent, and WebKit doesn't paint animated children of a masked element. The grid is now its own absolutely positioned layer behind Sushi (`src/pages/home.tsx`).
- The home page container widened from `max-w-3xl` to `max-w-4xl` so the two columns fit (`src/App.tsx`).

## Why

The previous page gave every block the same bordered card, weight and spacing, so nothing led. The hotkey card in particular was mostly empty space around a small mascot. Competing dictation apps (Wispr Flow in particular) open with a personal greeting, light stat chips, and a flat history feed. We took those patterns and kept one committed moment: the tinted hero that teaches the single action the app exists for. Everything else is quieter in comparison.

Pinning Sushi next to the text left the rest of the dotted grid empty on wide windows. Centring Sushi there would have brought back the earlier problem of it drifting away from the text. Letting it stroll uses the whole area and keeps the mascot doing something in an idle moment. It stops during dictation so its listening and transcribing reactions stay readable. The trade-off is constant movement in the page's peripheral vision, so it rests for several seconds between walks.

Engine and cleanup are configuration rather than home content, so they shrank to summary rows that link to Settings. The trade-off: on narrow windows the side lists stack below Recent, which pushes Explore further down.

## What makes it stand out

- The hotkey is the headline, rendered from the user's actual accelerator through `Hotkey`, not a generic illustration.
- The status pill is an `aria-live` region and reflects real dictation phases from `on.dictation`, so the hero doubles as a live monitor.
- Sushi's stroll is measured against the live column width each time, so it never walks off the card when the window resizes. Each walk is long enough to read as one, and it uses motion values, so cancelling it mid-walk leaves Sushi where it stopped instead of snapping back.
- Recent has an empty state that explains what will appear, instead of the section being hidden.
- The week panel is a nigiri drawn in Sushi's palette with a pixel font matching the sprite, so it reads as Yammer's own rather than a generic stat card. It is driven entirely by `computeStats`, `lastDays` and `weekOverWeek`; the dissolve and flame flicker are static under reduced motion. Its pixel numerals carry `aria-label`s, and 10,000+ words switch to "12.3k" so the number always fits.
- The panel deliberately uses fixed sprite hex colours (it is the same in light and dark, like Sushi). Elsewhere there are no new tokens, fonts or colours: everything uses the existing `primary`, `muted`, `card` and `border` tokens, so light/dark mode and the per-accent `--brand` setting continue to work.
