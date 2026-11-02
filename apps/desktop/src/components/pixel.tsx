// Pixel-art pieces in Sushi's sprite colours, shared by Home's "This week" panel and the nigiri
// cards on the other pages: bitmap numerals, the streak flame and a row of pixel stacks.
// Pixels dissolve in on mount; under reduced motion (index.css) they just appear.

import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

// Sushi's palette (components/sushi.tsx COLORS).
export const SALMON = "#e94a35";
export const STRIPE = "#ff8f73";
export const NORI = "#0f5e5c";
export const RICE = "#fff8ee";
export const RICE_SHADE = "#e3d1b8";
export const INK = "#1b2624";

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

export function PixelNumber({ value, height, color, spread = 500, className }: { value: number; height: number; color: string; spread?: number; className?: string }) {
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

export function PixelFlame({ px = 3, lit }: { px?: number; lit: boolean }) {
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

/** A column of pixel blocks per value, scaled to the largest, the last one (today) in rice. For a nori band. */
export function PixelBars({ values, labels, titles, stack = 6 }: { values: number[]; labels: string[]; titles?: string[]; stack?: number }) {
  const max = Math.max(...values, 1);
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
      {values.map((v, i) => {
        const today = i === values.length - 1;
        const n = v ? Math.max(1, Math.round((v / max) * stack)) : 0;
        return (
          <div key={i} className="flex flex-col items-center gap-1.5" title={titles?.[i]}>
            <div className="flex w-full flex-col-reverse items-center gap-[3px]" style={{ height: stack * 11 }}>
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
            <span className={cn("text-[10px] leading-none", today ? "font-bold" : "opacity-70")}>{labels[i]}</span>
          </div>
        );
      })}
    </div>
  );
}
