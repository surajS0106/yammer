// Home's "This week" panel, built as a nigiri in Sushi's own sprite colours: a salmon top with the
// week's words in pixel numerals, a nori band of per-day pixel stacks, and a rice base with speed
// and streak. Pixels dissolve in on mount; under reduced motion (index.css) they just appear.

import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { lastDays, TYPING_WPM, weekOverWeek, type Stats } from "@/lib/stats";
import { cn } from "@/lib/utils";

// Sushi's palette (components/sushi.tsx COLORS).
const SALMON = "#e94a35";
const STRIPE = "#ff8f73";
const NORI = "#0f5e5c";
const RICE = "#fff8ee";
const RICE_SHADE = "#e3d1b8";
const INK = "#1b2624";

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

// A 5×7 bitmap face for the numbers, so they're drawn in the same pixels as Sushi.
const GLYPHS: Record<string, string[]> = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ",": ["..", "..", "..", "..", "..", ".#", "#."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  k: ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"],
};

/** Up to 9,999 in full; beyond that, 12.3k, so it always fits the card. */
function pixelText(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  const k = n / 1000;
  return `${k < 100 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
}

/** A stable pseudo-random 0–1 per pixel, so the dissolve looks scattered but never reshuffles. */
const scatter = (x: number, y: number) => ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1;

function PixelNumber({ value, height, color, spread = 500, className }: { value: number; height: number; color: string; spread?: number; className?: string }) {
  const text = pixelText(value);
  const rects: React.ReactNode[] = [];
  let x = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) continue;
    g.forEach((row, y) =>
      [...row].forEach((c, dx) => {
        if (c !== "#") return;
        const px = x + dx;
        rects.push(
          <rect
            key={`${px}-${y}`}
            x={px}
            y={y}
            width={1.02}
            height={1.02}
            fill={color}
            style={{ animation: `pixel-in 260ms var(--ease-smooth) ${Math.round(scatter(px, y) * spread)}ms backwards` }}
          />,
        );
      }),
    );
    x += g[0].length + 1;
  }
  const w = Math.max(x - 1, 1);
  return (
    <svg
      key={text}
      role="img"
      aria-label={value.toLocaleString()}
      viewBox={`0 0 ${w} 7`}
      height={height}
      width={(w / 7) * height}
      shapeRendering="crispEdges"
      className={cn("block max-w-full", className)}
    >
      {rects}
    </svg>
  );
}

// The streak's flame, in the same sprite palette.
const FLAME = ["...Y....", "..YY..Y.", "..YOY.YY", ".YOOYYOY", ".YORYOOY", "YOORROOY", "YORRRROY", ".YORROY.", "..YYYY.."];
const FLAME_FILL: Record<string, string> = { Y: "#f6c945", O: "#ff9a3c", R: "#fff3d6" };

function PixelFlame({ px = 3, lit }: { px?: number; lit: boolean }) {
  const reduce = !!useReducedMotion();
  return (
    <motion.svg
      viewBox={`0 0 ${FLAME[0].length} ${FLAME.length}`}
      width={FLAME[0].length * px}
      height={FLAME.length * px}
      shapeRendering="crispEdges"
      style={{ transformOrigin: "50% 100%" }}
      className={cn("shrink-0", !lit && "opacity-35 grayscale")}
      animate={reduce || !lit ? undefined : { scaleY: [1, 1.1, 0.95, 1.05, 1], scaleX: [1, 0.96, 1.03, 0.98, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden
    >
      {FLAME.flatMap((row, y) => [...row].map((c, x) => (FLAME_FILL[c] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={FLAME_FILL[c]} /> : null)))}
    </motion.svg>
  );
}

const STACK = 6;

export function WeekStats({ stats, onOpen }: { stats: Stats; onOpen: () => void }) {
  const days = lastDays(7);
  const perDay = (d: number) => stats.byDay.get(d) ?? 0;
  const counts = days.map(perDay);
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(...counts, 1);
  const delta = weekOverWeek(perDay);
  const faster = stats.wpm ? Math.round((stats.wpm / TYPING_WPM) * 10) / 10 : 0;
  const daily = stats.dayStreak > 1;
  const streak = daily ? stats.dayStreak : stats.weekStreak;
  // Typing those words at TYPING_WPM, minus the time it took to say them.
  const skipped = stats.wpm ? Math.max(Math.round(total / TYPING_WPM - total / stats.wpm), 0) : 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      title="See Insights"
      className="group block w-full overflow-hidden rounded-2xl text-left ring-1 ring-black/10 outline-none transition-[translate,box-shadow] duration-300 hover:-translate-y-1 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0"
      style={{ boxShadow: `0 18px 40px -18px ${SALMON}aa` }}
    >
      {/* Salmon: the headline number, over the sprite's diagonal stripes. */}
      <div
        className="relative px-5 pt-5 pb-6"
        style={{
          color: RICE,
          backgroundColor: SALMON,
          backgroundImage: `repeating-linear-gradient(135deg, transparent 0 18px, ${STRIPE}55 18px 26px)`,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">This week</span>
          {delta !== undefined && (
            <span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums" style={{ backgroundColor: NORI }}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))}%
            </span>
          )}
        </div>
        <PixelNumber value={total} height={68} color={RICE} spread={600} className="mt-4 drop-shadow-[0_3px_0_rgb(0_0_0/0.18)]" />
        <div className="mt-3 text-sm font-semibold">{total ? "words said out loud" : "Say something. This lights up."}</div>
      </div>

      {/* Nori: a pixel stack per day, today in rice. */}
      <div className="px-5 pt-4 pb-3" style={{ backgroundColor: NORI, color: RICE }}>
        <div className="grid grid-cols-7 gap-2">
          {days.map((d, i) => {
            const today = i === days.length - 1;
            const n = counts[i] ? Math.max(1, Math.round((counts[i] / max) * STACK)) : 0;
            return (
              <div key={d} className="flex flex-col items-center gap-1.5" title={`${counts[i].toLocaleString()} words`}>
                <div className="flex h-[66px] w-full flex-col-reverse items-center gap-[3px]">
                  {n === 0 ? (
                    <span className="size-2 rounded-[1px]" style={{ backgroundColor: `${RICE}26` }} />
                  ) : (
                    Array.from({ length: n }, (_, level) => (
                      <span
                        key={level}
                        className="h-2 w-full max-w-5 rounded-[1px]"
                        style={{
                          backgroundColor: today ? RICE : STRIPE,
                          animation: `pixel-in 220ms var(--ease-smooth) ${200 + i * 45 + level * 55}ms backwards`,
                        }}
                      />
                    ))
                  )}
                </div>
                <span className={cn("text-[10px] leading-none", today ? "font-bold" : "opacity-70")}>{weekday.format(d)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rice: speed and streak in dark ink. */}
      <div className="px-5 pt-4 pb-4" style={{ backgroundColor: RICE, color: INK }}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex h-8 items-end">
              <PixelNumber value={stats.wpm} height={28} color={SALMON} spread={400} />
            </div>
            <div className="mt-2 text-xs font-bold">words / min</div>
            <div className="text-[11px] opacity-70">{faster > 1 ? `${faster}× your typing` : "speaking speed"}</div>
          </div>
          <div>
            <div className="flex h-8 items-end gap-2">
              <PixelFlame lit={streak > 0} />
              <PixelNumber value={streak} height={28} color={NORI} spread={400} />
            </div>
            <div className="mt-2 text-xs font-bold">{daily ? "day" : "week"} streak</div>
            <div className="text-[11px] opacity-70">{streak > 0 ? "keep it lit" : "starts today"}</div>
          </div>
        </div>
        {skipped > 0 && (
          <div className="mt-4 border-t border-dashed pt-3 text-xs font-medium" style={{ borderColor: RICE_SHADE }}>
            ≈{skipped} min of typing you skipped. Nice.
          </div>
        )}
      </div>
    </button>
  );
}
