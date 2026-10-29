// Usage numbers derived from dictation history (kept on this computer), for
// Home and Insights.

import * as React from "react";

import { languages } from "./presets";
import { api, on, type HistoryEntry } from "./tauri";

/** A typical typing speed, for "time saved". */
export const TYPING_WPM = 40;

const DAY = 86_400_000;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Local midnight of `ms`, as a day key. */
export function dayKey(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export interface Stats {
  dictations: number;
  words: number;
  /** Words per minute of speech, or 0 with no history. */
  wpm: number;
  speakingMs: number;
  /** Minutes saved against typing at TYPING_WPM. */
  minutesSaved: number;
  /** Dictations the cleanup model changed. */
  cleaned: number;
  /** Words per local day. */
  byDay: Map<number, number>;
  /** Consecutive days with a dictation, ending today (or yesterday, if today has none yet). */
  dayStreak: number;
  longestDayStreak: number;
  /** Consecutive weeks (Mon–Sun) with a dictation, ending this week. */
  weekStreak: number;
  /** Words by speech engine, most first. */
  byEngine: { label: string; words: number }[];
  /** Words per hour of day, 0–23. */
  byHour: number[];
  /** Speaking time per local day, for daily wpm. */
  msByDay: Map<number, number>;
  /** Words by weekday (0 = Monday) and hour. */
  rhythm: number[][];
}

/** The language an entry was spoken in, or null if it wasn't recorded. */
export function languageOf(entry: HistoryEntry): string | null {
  if (entry.language) return entry.language;
  // Older entries predate the field, but an English-only model ("local:base.en") can only have heard English.
  return /^local:.*\.en$/.test(entry.engine) ? "en" : null;
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" });
  } catch {
    return null;
  }
})();

/** "hi" → "Hindi", in the user's locale, falling back to the Settings list and then the code. */
export function languageName(code: string): string {
  try {
    const name = languageNames?.of(code);
    if (name && name !== code) return name;
  } catch {
    // An invalid code throws; fall through.
  }
  return languages.find(([c]) => c === code)?.[1] ?? code.toUpperCase();
}

/**
 * Words per language, most first. Past `limit` languages the rest fold into "Other",
 * so a long tail of one-off detections doesn't crowd out the ones you speak.
 */
export function languageBreakdown(entries: HistoryEntry[], limit = 5): { code: string; label: string; words: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const code = languageOf(e);
    if (code) counts.set(code, (counts.get(code) ?? 0) + wordCount(e.text));
  }
  const sorted = [...counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, sorted.length > limit ? limit - 1 : limit).map(([code, words]) => ({ code, label: languageName(code), words }));
  const rest = sorted.slice(top.length).reduce((n, [, w]) => n + w, 0);
  return rest ? [...top, { code: "other", label: "Other", words: rest }] : top;
}

export function engineLabel(entry: HistoryEntry): string {
  if (entry.engineLabel) return entry.engineLabel;
  // Older entries only have "kind:model"; the model itself may contain ":" (saaras:v4).
  const i = entry.engine.indexOf(":");
  const name = entry.engine.slice(i + 1);
  return entry.engine.slice(0, i) === "local" ? `On-device · ${name}` : `Cloud · ${name}`;
}

function weekStart(ms: number): number {
  const d = new Date(dayKey(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function computeStats(entries: HistoryEntry[], now = Date.now()): Stats {
  const byDay = new Map<number, number>();
  const engines = new Map<string, number>();
  const byHour = Array<number>(24).fill(0);
  const msByDay = new Map<number, number>();
  const rhythm = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let words = 0;
  let speakingMs = 0;
  let cleaned = 0;
  for (const e of entries) {
    const n = wordCount(e.text);
    words += n;
    speakingMs += e.durationMs;
    if (e.cleanup) cleaned++;
    const day = dayKey(e.at);
    byDay.set(day, (byDay.get(day) ?? 0) + n);
    const label = engineLabel(e);
    engines.set(label, (engines.get(label) ?? 0) + n);
    const at = new Date(e.at);
    byHour[at.getHours()] += n;
    rhythm[(at.getDay() + 6) % 7][at.getHours()] += n;
    msByDay.set(day, (msByDay.get(day) ?? 0) + e.durationMs);
  }

  const days = [...byDay.keys()].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of days) {
    // Calendar days, not 24h steps, so DST changes don't break a streak.
    run = Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const today = dayKey(now);
  let dayStreak = 0;
  for (let d = byDay.has(today) ? today : dayKey(today - DAY / 2); byDay.has(d); d = dayKey(d - DAY / 2)) dayStreak++;

  const weeks = new Set(days.map(weekStart));
  let weekStreak = 0;
  for (let w = weekStart(now); weeks.has(w); w = weekStart(w - DAY)) weekStreak++;

  const minutes = speakingMs / 60_000;
  return {
    dictations: entries.length,
    words,
    wpm: minutes > 0 ? Math.round(words / minutes) : 0,
    speakingMs,
    minutesSaved: Math.max(0, Math.round(words / TYPING_WPM - minutes)),
    cleaned,
    byDay,
    dayStreak,
    longestDayStreak: longest,
    weekStreak,
    byEngine: [...engines].map(([label, w]) => ({ label, words: w })).sort((a, b) => b.words - a.words),
    byHour,
    msByDay,
    rhythm,
  };
}

/** The last `days` local days, oldest first, ending today. */
export function lastDays(days: number, now = Date.now()): number[] {
  const out: number[] = [];
  const d = new Date(dayKey(now));
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    out.push(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Percent change of the last 7 days over the 7 before, or undefined without a baseline. */
export function weekOverWeek(perDay: (day: number) => number, combine: (values: number[]) => number = (v) => v.reduce((a, b) => a + b, 0)) {
  const days = lastDays(14);
  const before = combine(days.slice(0, 7).map(perDay));
  const after = combine(days.slice(7).map(perDay));
  if (!before) return undefined;
  return Math.round(((after - before) / before) * 1000) / 10;
}

const STOP = new Set(
  ("the and for that this with you your are was were have has had not but can could would should will just about from they them " +
    "their there then than what when where which who how all any some its it's i'm i've i'll don't didn't doesn't can't won't that's " +
    "there's let's we're you're they're our out into over also very really like going gonna want get got one two make made more much " +
    "here been being because so if to of in on at by is be do does did as or an a it me my we us he she his her him okay yeah um uh " +
    "know think thing things something need now well way said say see")
    .split(/\s+/),
);

/** The words said most often, ignoring short and common ones. Dictionary words keep their spelling. */
export function topWords(entries: HistoryEntry[], vocabulary: string[], limit = 40): { text: string; value: number }[] {
  const display = new Map(vocabulary.map((w) => [w.toLowerCase(), w]));
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const raw of e.text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
      const w = raw.replace(/['’]s$/, "").replace(/[-'’]+$/, "");
      if (w.length < 3 || STOP.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w, value]) => ({ text: display.get(w) ?? w, value }));
}

/** Put an entry that was transcribed again in place of the old one. */
export function replaceEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return list.map((e) => (e.id === entry.id ? entry : e));
}

/** The full history, kept current as dictations land, without failed ones (no text to count). */
export function useHistory(): HistoryEntry[] {
  const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
  React.useEffect(() => {
    api.historyList().then(setEntries, () => {});
    const unlisten = [
      on.historyAdded((e) => setEntries((list) => [e, ...list])),
      on.historyUpdated((e) => setEntries((list) => replaceEntry(list, e))),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, []);
  return React.useMemo(() => entries.filter((e) => !e.error), [entries]);
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
