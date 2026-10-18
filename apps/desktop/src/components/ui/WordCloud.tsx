"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ChartTable,
  ChartTooltipCard,
  chartRamp,
  rampStop,
  useChartPaint,
  useChartReveal,
  type SeriesSpec,
} from "@/components/ui/ChartFrame";

/* ------------------------------------------------------------------ *
 * A word cloud, and what is wrong with it
 *
 * This is the weakest chart in the library and it ships because people
 * ask for it. Worth saying plainly rather than in a footnote: a reader
 * cannot compare two words in a cloud. Position carries nothing, the
 * eye has no way to compare areas of different shapes, and a word four
 * times as common looks about twice as important. The ranked table
 * underneath is the chart you actually wanted; this is the one that
 * goes on the slide.
 *
 * Given that, the two things it can still get right are worth getting
 * right.
 *
 * The first is sizing. Almost every word cloud sets the font size to
 * the frequency, which means the ink a word takes goes up with the
 * square of its frequency and again with its length, so a long common
 * word can carry twenty times the area it has earned. `area` mode
 * solves the other way round: the rendered area of the word, roughly
 * its length times the square of its size, is what tracks frequency.
 * Long words come out smaller and short ones larger, which looks wrong
 * and is right, and the preview shows both so the difference is
 * visible.
 *
 * The second is placement. Words go down largest first on an expanding
 * spiral, and each one is tested against the boxes already placed. The
 * spiral coordinates are rounded to whole pixels, because sine and
 * cosine are not bit-identical across engines and an unrounded spiral
 * would pack differently on the server than in the browser. Nothing is
 * random, so the same words always land in the same places.
 *
 * Boxes rather than pixel masks, so a word cannot nest into the hollow
 * of a taller one. Looser packing, and a collision test that cannot
 * quietly overlap two words.
 * ------------------------------------------------------------------ */

export interface WordInput {
  text: string;
  value: number;
}

export interface PlacedWord extends WordInput {
  x: number;
  y: number;
  size: number;
  w: number;
  h: number;
  rotated: boolean;
  index: number;
}

export interface CloudLayout {
  words: PlacedWord[];
  /** Words with no room left. Named rather than silently missing. */
  dropped: WordInput[];
  /** Ink each word takes, over what its frequency earns. 1 is honest. */
  worstRatio: number;
}

export type WordSizing = "area" | "font";

/**
 * How wide a word renders. Measured against the UI stack at a range of
 * sizes rather than guessed: a canvas would be exact and does not exist
 * on the server, and a layout that changes on hydration repacks the
 * whole cloud. Deliberately a little generous, so a box always covers
 * the glyphs inside it.
 */
const CHAR_RATIO = 0.55;
/** Width per unit of font size, padding included. */
const extent = (text: string) => text.length * CHAR_RATIO + 0.3;
const wordWidth = (text: string, size: number) => extent(text) * size;
const wordHeight = (size: number) => size * 1.02;

export function layoutCloud(
  input: WordInput[],
  opts: { width: number; height: number; sizing?: WordSizing; min?: number; max?: number; rotate?: boolean },
): CloudLayout {
  const { width, height, sizing = "area", min = 11, max = 64, rotate = false } = opts;
  const sorted = [...input]
    .filter((w) => w.value > 0 && w.text.length > 0)
    .sort((a, b) => b.value - a.value || a.text.localeCompare(b.text, "en"));
  if (sorted.length === 0) return { words: [], dropped: [], worstRatio: 1 };

  const top = sorted[0].value;

  // In `area` mode the size solves length * size^2 proportional to the
  // value, so the ink is the reading. In `font` mode the size is the
  // value, which is what everything else does and what makes a long
  // word shout.
  // Solving the actual box, padding and all. Dividing by the character
  // count alone leaves the fixed padding unaccounted for, which is a
  // fifth of a two letter word's width and nothing at all of a thirteen
  // letter one, so short words come out a quarter over.
  const raw = sorted.map((w) =>
    sizing === "font" ? Math.sqrt(w.value / top) : Math.sqrt(w.value / extent(w.text)),
  );
  const rawTop = Math.max(...raw, 1e-9);
  const sizes = raw.map((r) => Math.max(min, Math.round((r / rawTop) * max)));

  const placed: PlacedWord[] = [];
  const dropped: WordInput[] = [];
  const cx = width / 2;
  const cy = height / 2;

  const hits = (x: number, y: number, w: number, h: number) =>
    placed.some(
      (p) =>
        x - w / 2 < p.x + p.w / 2 + 2 &&
        x + w / 2 > p.x - p.w / 2 - 2 &&
        y - h / 2 < p.y + p.h / 2 + 1 &&
        y + h / 2 > p.y - p.h / 2 - 1,
    );

  sorted.forEach((word, i) => {
    const size = sizes[i];
    const flat = { w: wordWidth(word.text, size), h: wordHeight(size) };
    // A rotated word is harder to read, so it is only tried when the
    // upright one will not go.
    const tries: { w: number; h: number; rotated: boolean }[] = rotate
      ? [{ ...flat, rotated: false }, { w: flat.h, h: flat.w, rotated: true }]
      : [{ ...flat, rotated: false }];

    for (let step = 0; step < 4000; step++) {
      // Archimedean, stretched to the frame so a wide box fills wide.
      const t = step * 0.32;
      const r = 2.2 * t;
      const ox = Math.round(r * Math.cos(t));
      const oy = Math.round(r * Math.sin(t) * (height / width));
      const x = cx + ox;
      const y = cy + oy;
      const fit = tries.find(
        (c) =>
          x - c.w / 2 >= 0 &&
          x + c.w / 2 <= width &&
          y - c.h / 2 >= 0 &&
          y + c.h / 2 <= height &&
          !hits(x, y, c.w, c.h),
      );
      if (fit) {
        placed.push({ ...word, x, y, size, w: fit.w, h: fit.h, rotated: fit.rotated, index: i });
        return;
      }
      if (r > Math.max(width, height)) break;
    }
    dropped.push(word);
  });

  // How far the drawing is from honest, as a ratio of ink to earned ink.
  let worstRatio = 1;
  if (placed.length > 0) {
    const areaPer = placed.map((p) => (p.w * p.h) / p.value);
    const lo = Math.min(...areaPer);
    const hi = Math.max(...areaPer);
    worstRatio = lo > 0 ? Math.round((hi / lo) * 100) / 100 : 1;
  }

  return { words: placed, dropped, worstRatio };
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface WordCloudProps {
  words: WordInput[];
  label: string;
  summary?: string;
  sizing?: WordSizing;
  rotate?: boolean;
  width?: number;
  height?: number;
  minSize?: number;
  maxSize?: number;
  /** What one value is, for the tooltip. */
  unit?: string;
  className?: string;
}

const NO_SERIES: SeriesSpec[] = [];

export function WordCloud({
  words,
  label,
  summary,
  sizing = "area",
  rotate = false,
  width = 620,
  height = 340,
  minSize = 11,
  maxSize = 64,
  unit = "",
  className = "",
}: WordCloudProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { inView, reduceMotion } = useChartReveal(wrapRef);
  const { uid, style: paletteStyle } = useChartPaint(NO_SERIES);

  const cloud = useMemo(
    () => layoutCloud(words, { width, height, sizing, min: minSize, max: maxSize, rotate }),
    [words, width, height, sizing, minSize, maxSize, rotate],
  );

  const top = useMemo(() => words.reduce((m, w) => Math.max(m, w.value), 0) || 1, [words]);
  const ramp = chartRamp(
    uid,
    cloud.words.map((w) => rampStop(0.25 + 0.75 * (w.value / top))),
  );

  const [active, setActive] = useState<string | null>(null);
  const activeWord = cloud.words.find((w) => w.text === active);
  const ranked = useMemo(
    () => [...words].sort((a, b) => b.value - a.value || a.text.localeCompare(b.text, "en")),
    [words],
  );
  const total = useMemo(() => words.reduce((a, w) => a + w.value, 0), [words]);

  const rankOf = useCallback((t: string) => ranked.findIndex((w) => w.text === t) + 1, [ranked]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!fwd && !back || ranked.length === 0) return;
    e.preventDefault();
    const at = active ? ranked.findIndex((w) => w.text === active) : -1;
    const step = fwd ? 1 : -1;
    setActive(ranked[at < 0 ? 0 : (at + step + ranked.length) % ranked.length].text);
  }

  return (
    <div ref={wrapRef} data-cf={uid} className={`w-full ${className}`}>
      {paletteStyle}
      {ramp.style}

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={label}
          aria-describedby={`wc-hint-${uid}`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          className="block w-full rounded-lg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          {cloud.words.map((w, i) => (
            // Placement on a plain g, the reveal on the motion element
            // inside it: a transform attribute and an animated transform
            // on one node means the attribute loses.
            <g key={w.text} transform={`translate(${w.x},${w.y})${w.rotated ? " rotate(-90)" : ""}`}>
              <motion.text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={w.size}
                fontWeight={w.value / top > 0.5 ? 600 : 500}
                fill={ramp.fill(i)}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
                animate={inView ? { opacity: 1, scale: 1 } : undefined}
                transition={{ duration: 0.4, delay: 0.03 + i * 0.02, ease: [0.22, 1, 0.36, 1] }}
                style={{ cursor: "pointer" }}
                onPointerEnter={() => setActive(w.text)}
              >
                {w.text}
              </motion.text>
              {activeWord?.text === w.text && (
                <rect
                  x={-w.w / 2}
                  y={-w.h / 2}
                  width={w.w}
                  height={w.h}
                  rx={3}
                  ry={3}
                  fill="none"
                  stroke="var(--cf-strong)"
                  strokeWidth={1}
                  pointerEvents="none"
                />
              )}
            </g>
          ))}
        </svg>

        {activeWord && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
            style={{
              left: `${(activeWord.x / width) * 100}%`,
              top: `${((activeWord.y - activeWord.h / 2 - 6) / height) * 100}%`,
            }}
          >
            <ChartTooltipCard
              reduceMotion={reduceMotion}
              title={activeWord.text}
              rows={[
                { label: unit || "Count", value: `${activeWord.value}`, swatch: ramp.fill(activeWord.index) },
                { label: "Rank", value: `${rankOf(activeWord.text)} of ${ranked.length}` },
                { label: "Of total", value: `${Math.round((activeWord.value / Math.max(1, total)) * 1000) / 10}%` },
              ]}
            />
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-500">
        <span>
          {cloud.words.length} of {words.length} words placed
        </span>
        <span>
          {sizing === "area"
            ? cloud.worstRatio > 1.1
              ? `ink tracks the count, within ${cloud.worstRatio} times`
              : "ink tracks the count"
            : `size tracks the count, so ink runs up to ${cloud.worstRatio} times over`}
        </span>
        {cloud.dropped.length > 0 && (
          <span>
            no room for {cloud.dropped.slice(0, 3).map((w) => w.text).join(", ")}
            {cloud.dropped.length > 3 ? ` and ${cloud.dropped.length - 3} more` : ""}
          </span>
        )}
      </div>

      <p id={`wc-hint-${uid}`} className="sr-only">
        {summary ? `${summary} ` : ""}
        A cloud cannot be read off, so the ranked list is the chart. Arrow keys walk the words from
        the most common to the least and Escape clears the selection. Every word follows as a table.
      </p>

      <span className="sr-only" aria-live="polite">
        {activeWord
          ? `${activeWord.text}, ${activeWord.value} ${unit}, ranked ${rankOf(activeWord.text)} of ${ranked.length}.`
          : ""}
      </span>

      <ChartTable
        caption={label}
        columns={["Word", unit || "Count", "Rank", "Share"]}
        rows={ranked.map((w, i) => ({
          head: w.text,
          cells: [`${w.value}`, `${i + 1}`, `${Math.round((w.value / Math.max(1, total)) * 1000) / 10}%`],
        }))}
      />
    </div>
  );
}
