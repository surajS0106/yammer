"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ChartLegend,
  ChartTable,
  ChartTooltipCard,
  arcPath,
  formatFull,
  polarPoint,
  useChartPaint,
  useChartReveal,
  type SeriesSpec,
} from "@/components/ui/ChartFrame";

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

/**
 * `pie` and `donut` vary the angle at a fixed radius. `semi` is the same
 * over a half turn. `nightingale` inverts it: every slice takes an equal
 * angle and the radius carries the value.
 *
 * All four are the same arc, and the difference is only which of its two
 * dimensions the data drives, which is why they are one component.
 */
export type PieVariant = "pie" | "donut" | "semi" | "nightingale";

/**
 * How a nightingale slice turns a value into a radius.
 *
 * `area` is the default and the honest one. A wedge's area grows with the
 * square of its radius, so a value twice as large drawn at twice the
 * radius puts four times the ink on the page. Florence Nightingale got
 * this right in 1858 and most modern rose charts get it wrong, which is
 * why the option exists at all: `radius` is offered so the exaggeration
 * is something you choose and can be named, rather than the default
 * nobody noticed.
 */
export type RoseScale = "area" | "radius";

export interface PieSlice {
  id: string;
  label: string;
  value: number;
  color?: string;
}

export interface Wedge {
  slice: PieSlice;
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  /** Share of the total, 0 to 1. Meaningless for a nightingale. */
  share: number;
}

const TAU = Math.PI * 2;

export function layoutWedges(
  slices: PieSlice[],
  variant: PieVariant,
  radius: number,
  innerRatio: number,
  rose: RoseScale,
): { wedges: Wedge[]; startAngle: number; sweep: number } {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const semi = variant === "semi";
  const sweep = semi ? Math.PI : TAU;
  // A semi-circle reads left to right, so it starts at nine o'clock.
  const startAngle = semi ? -Math.PI / 2 : 0;
  const r0 = variant === "pie" ? 0 : radius * innerRatio;

  if (variant === "nightingale") {
    const max = slices.reduce((m, s) => Math.max(m, s.value), 0) || 1;
    const step = TAU / Math.max(1, slices.length);
    return {
      startAngle: 0,
      sweep: TAU,
      wedges: slices.map((slice, i) => {
        const t = Math.max(0, slice.value) / max;
        const scaled = rose === "area" ? Math.sqrt(t) : t;
        return {
          slice,
          a0: i * step,
          a1: (i + 1) * step,
          r0,
          // Never let the smallest petal collapse into the hub: a zero
          // radius is indistinguishable from a missing category.
          r1: r0 + (radius - r0) * (0.08 + 0.92 * scaled),
          share: Math.max(0, slice.value) / total,
        };
      }),
    };
  }

  let cursor = startAngle;
  return {
    startAngle,
    sweep,
    wedges: slices.map((slice) => {
      const share = Math.max(0, slice.value) / total;
      const a0 = cursor;
      const a1 = cursor + share * sweep;
      cursor = a1;
      return { slice, a0, a1, r0, r1: radius, share };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface PieChartProps {
  data: PieSlice[];
  label: string;
  summary?: string;
  variant?: PieVariant;
  rose?: RoseScale;
  /** Hole size as a share of the radius. Ignored by `pie`. */
  innerRatio?: number;
  size?: number;
  /** Gap between slices, in degrees. Zero for a continuous ring. */
  padAngle?: number;
  legend?: boolean;
  /** Big number in the hole. Donut and semi only, and only when there is a hole. */
  centre?: { value: string; caption?: string };
  formatValue?: (v: number) => string;
  className?: string;
}

export function PieChart({
  data,
  label,
  summary,
  variant = "donut",
  rose = "area",
  innerRatio = 0.58,
  size = 260,
  padAngle = 1.2,
  legend = true,
  centre,
  formatValue,
  className = "",
}: PieChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { inView, reduceMotion } = useChartReveal(wrapRef);

  const series: SeriesSpec[] = useMemo(
    () => data.map((d) => ({ id: d.id, label: d.label, color: d.color })),
    [data],
  );
  const { uid, color, dash, style: paletteStyle } = useChartPaint(series);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState<number | null>(null);

  const visible = useMemo(() => data.filter((d) => !hidden.has(d.id)), [data, hidden]);
  const fmt = useCallback((v: number) => (formatValue ? formatValue(v) : formatFull(v)), [formatValue]);

  const semi = variant === "semi";
  // A half turn only uses the top half of the box, so the drawing is not
  // asked to reserve height it will never paint into.
  const height = semi ? size / 2 + 16 : size;
  const cx = size / 2;
  const cy = semi ? size / 2 : size / 2;
  const radius = size / 2 - 8;

  const { wedges } = useMemo(
    () => layoutWedges(visible, variant, radius, innerRatio, rose),
    [visible, variant, radius, innerRatio, rose],
  );

  const pad = (padAngle * Math.PI) / 180;
  const total = visible.reduce((a, s) => a + Math.max(0, s.value), 0);

  const describe = useCallback(
    (i: number) => {
      const w = wedges[i];
      if (!w) return "";
      const pct = Math.round(w.share * 1000) / 10;
      return `${w.slice.label}, ${fmt(w.slice.value)}, ${pct} percent of the total`;
    },
    [wedges, fmt],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (wedges.length === 0) return;
    const at = active ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (at + 1) % wedges.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (at - 1 + wedges.length) % wedges.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = wedges.length - 1;
    else if (e.key === "Escape") { setActive(null); return; }
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  }

  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const activeWedge = active !== null ? wedges[active] : undefined;
  // The tooltip takes the corner of the chart's own box diagonally opposite
  // the active slice, the pie's version of the cartesian frame's "side with
  // the most room". Inside the box nothing clips it and no legend collides
  // with it; opposite the slice it is as far as the box allows from the
  // pointer and from the neighbouring slivers the pointer goes to next; and a
  // corner of a box around a circle is mostly empty, so it covers little of
  // the ring and none of the centre. A slice on the right puts it at the
  // left, a slice below puts it at the top.
  const anchor = (() => {
    if (!activeWedge) return null;
    const mid = (activeWedge.a0 + activeWedge.a1) / 2;
    const rim = polarPoint(cx, cy, activeWedge.r1, mid);
    const right = rim.x >= cx;
    const below = rim.y >= cy;
    return { x: right ? 0 : size, y: below ? 0 : height, tx: right ? 0 : -100, ty: below ? 0 : -100 };
  })();

  return (
    <div ref={wrapRef} data-cf={uid} className={`relative w-full ${className}`}>
      {paletteStyle}

      <div className="flex justify-center">
        <div className="relative">
          <svg
            width={size}
            height={height}
            viewBox={`0 0 ${size} ${height}`}
            role="img"
            aria-label={label}
            aria-describedby={`pc-hint-${uid}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="block max-w-full rounded-lg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400"
          >
            {wedges.map((w, i) => {
              // The gap is taken out of the slice, never added to it, so
              // padding a pie cannot make the wedges sum past a full turn.
              const room = Math.abs(w.a1 - w.a0);
              const trim = Math.min(pad, room * 0.4) / 2;
              const isActive = active === i;
              const lift = isActive ? 6 : 0;
              const mid = (w.a0 + w.a1) / 2;
              const off = polarPoint(0, 0, lift, mid);

              return (
                <motion.g
                  key={w.slice.id}
                  // Slices fade in ordered by angle rather than by array
                  // index, so the chart reads as one sweep around the dial
                  // instead of six shapes appearing in data order.
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.82 }}
                  animate={inView ? { opacity: 1, scale: 1 } : undefined}
                  transition={{
                    duration: 0.5,
                    delay: 0.05 + (mid / TAU) * 0.55,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  // Slices grow out of the middle of the pie, not out of
                  // their own centres, so the reveal reads as one dial
                  // opening. The origin has to be given as `originX` and
                  // `originY`: a plain `transformOrigin` in user units is
                  // overwritten by the animation library and silently falls
                  // back to the shape's own bounding-box centre, which
                  // still looks plausible and is not what was asked for.
                  style={{ originX: `${cx}px`, originY: `${cy}px` }}
                >
                  <motion.path
                    d={arcPath(cx, cy, w.r0, w.r1, w.a0 + trim, w.a1 - trim)}
                    fill={color(w.slice.id)}
                    // Past the sixth slice the palette starts over, and a
                    // filled wedge cannot show the dash the paint contract
                    // falls back to. Drawing it as an outline in the surface
                    // colour keeps two same-coloured slices told apart
                    // instead of the promise quietly lapsing.
                    stroke={dash(w.slice.id) ? "var(--cf-dot-ring)" : undefined}
                    strokeDasharray={dash(w.slice.id)}
                    strokeWidth={dash(w.slice.id) ? 1.5 : undefined}
                    animate={{ x: off.x, y: off.y }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 460, damping: 34, mass: 0.5 }
                    }
                    onPointerEnter={() => setActive(i)}
                    style={{ cursor: "default" }}
                  />
                </motion.g>
              );
            })}

            {centre && variant !== "pie" && (
              <g aria-hidden="true">
                <text
                  x={cx}
                  y={semi ? cy - 6 : cy - (centre.caption ? 4 : 0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-stone-900 tabular-nums dark:fill-white"
                  fontSize={Math.round(size * 0.13)}
                  fontWeight={600}
                >
                  {centre.value}
                </text>
                {centre.caption && (
                  <text
                    x={cx}
                    y={semi ? cy + 14 : cy + Math.round(size * 0.1)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--cf-text)"
                    fontSize={11}
                  >
                    {centre.caption}
                  </text>
                )}
              </g>
            )}
          </svg>

          {activeWedge && anchor && (
            <div
              className="pointer-events-none absolute z-10"
              style={{ left: `${anchor.x}px`, top: `${anchor.y}px`, transform: `translate(${anchor.tx}%, ${anchor.ty}%)` }}
            >
              <ChartTooltipCard
                reduceMotion={reduceMotion}
                title={activeWedge.slice.label}
                rows={[
                  { label: "Value", value: fmt(activeWedge.slice.value), swatch: color(activeWedge.slice.id) },
                  { label: "Share", value: `${Math.round(activeWedge.share * 1000) / 10}%` },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      {legend && data.length > 1 && (
        <ChartLegend
          series={series}
          hidden={hidden}
          onToggle={toggle}
          color={color}
          inView={inView}
          reduceMotion={reduceMotion}
        />
      )}

      <p id={`pc-hint-${uid}`} className="sr-only">
        {summary ? `${summary} ` : ""}
        Use the arrow keys to move between slices and Escape to dismiss the reading. The full data
        follows as a table.
      </p>

      <span className="sr-only" aria-live="polite">
        {active !== null ? describe(active) : ""}
      </span>

      <ChartTable
        caption={label}
        columns={["Category", "Value", "Share"]}
        rows={data.map((d) => ({
          head: d.label,
          cells: [
            fmt(d.value),
            total > 0 && !hidden.has(d.id)
              ? `${Math.round((Math.max(0, d.value) / total) * 1000) / 10}%`
              : "hidden",
          ],
        }))}
      />
    </div>
  );
}
