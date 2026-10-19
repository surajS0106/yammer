# Dictation features (Dictionary, Snippets, Transforms, Insights, Scratchpad) — Design Notes

Last updated: 2026-10-19

## What changed

### 2026-10-19 (Insights redesign)
- Insights is rebuilt on the registry components in `src/components/ui/`: four `StatCard`s (speed and words with week-over-week deltas and 14-day sparklines; streak with a 14-day strip; time saved as speaking vs. typing bars), an activity `HeatMap` (26 weeks), a cleanup `PieChart` donut, a `WordCloud` of the words said most, and a weekday × time-of-day `HeatMap` in two-hour blocks (`src/pages/insights.tsx`).
- `lib/stats.ts` adds daily speaking time, the weekday × hour matrix, `weekOverWeek`, and `topWords` (stopwords removed; Dictionary words keep their spelling). `lib/use-dark.ts` reports the `.dark` class for components that take literal colours.
- `ContentCard` is used through `components/nav-cards.tsx` on Insights ("What to try next"), Home ("Explore") and Help (feature cards). The page body is a `@container`, so grids follow the content width, not the window.

### 2026-10-19
- New settings fields: `replacements`, `snippets`, `transforms` (seeded with Email, Bullet points, Concise, Formal, Casual) and `activeTransform`, all with serde defaults so older `settings.json` files load (`crates/voice-core/src/settings.rs`).
- New `text` module: whole-utterance snippet matching and a one-pass, whole-word, case-insensitive phrase replacer for dictionary corrections and inline snippets (`crates/voice-core/src/text.rs`).
- Cleanup prompt takes the active transform's instructions; new `cleanup::rewrite` for arbitrary text with its own prompt and `<text>` tags (`crates/voice-core/src/cleanup.rs`).
- Pipeline: a snippet said on its own is pasted as is; otherwise cleanup (with transform), then corrections and inline snippets. History's `cleanup` label names the transform and is set only when the model changed the text (`apps/desktop/src-tauri/src/dictation.rs`).
- New command `text_rewrite` (`apps/desktop/src-tauri/src/commands.rs`, `src/lib/tauri.ts`).
- New pages: Insights, Dictionary, Snippets, Transforms, Scratchpad, Help (`apps/desktop/src/pages/`). Shared history stats in `src/lib/stats.ts`.
- Nav: feature pages on top; Settings and Help pinned at the bottom. General, Speech engine and AI cleanup share the Settings entry with a tab strip; their page ids are unchanged (`src/App.tsx`).
- The page body spans 75% of the area beside the sidebar instead of a fixed `max-w-2xl` (672px), so wide windows aren't mostly empty space; the 12.5% on each side is the gutter (`src/App.tsx`).
- Home shows total words, wpm and streak, and groups recent dictations by day (`src/pages/home.tsx`). The engine page's vocabulary box now links to the Dictionary (`src/pages/engine.tsx`).

## Why

Yammer is modelled on Wispr Flow, whose app is organised around what you do with your voice (dictionary, snippets, transforms, notes, insights) rather than around configuration. Grouping the three configuration pages under one Settings entry frees the top of the nav for those features. Keeping the old page ids means the tray and overlay "open settings" links still work.

Corrections and snippets are deterministic string operations in voice-core, not prompt instructions. They work with cleanup off, cost no latency, and are unit-tested. Corrections run after cleanup so the model cannot undo them. The trade-off is that matching is ASCII-case-insensitive only.

A snippet spoken on its own skips cleanup entirely, because a model would otherwise "fix" a URL or a prepared paragraph. Said mid-sentence, it is expanded in place after cleanup.

Transforms reuse the cleanup model and key instead of adding a provider. One transform is active at a time because the pipeline has no per-app context to pick one automatically. The Scratchpad covers rewriting text that wasn't just dictated.

Insights are computed in the webview from local history. That keeps data on the machine and needs no new storage. Scratchpad notes use webview localStorage, with reads and writes wrapped so failures fall back to an empty list.

Notetaker (meeting capture), team invites and referrals were left out: they need system-audio capture or an account backend that Yammer doesn't have.

The registry components are painted in stone and emerald. They are re-themed from outside (`className`/`classNames`, explicit slice colours, a teal `ramp`, `--cf-r-from`/`--cf-r-to`) so the files stay as the registry ships them and can be re-pulled. Their `dark:` classes outrank plain overrides, so every override is restated under `dark:`.

## What makes it stand out

- The replacer makes one pass with the longest phrase first, so replaced text is never replaced again ("flow" → "Wispr Flow" can't loop) and overlapping triggers resolve predictably (`text.rs` tests).
- Snippet matching ignores the capitals and punctuation that STT adds ("My LinkedIn." matches `my linkedin`).
- The transform is placed before the user's own rules in the prompt, so the user's rules still take precedence (`adds_the_transform_before_user_rules`).
- Scratchpad rewrites can be undone in one step. Dictating into a note works because Yammer pastes into its own focused window.
- Streaks use calendar days (`dayKey`), not 24-hour steps, so DST changes don't break them. The heatmap uses one hue in five steps with per-cell hover titles.
