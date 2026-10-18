"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ChartTable,
  ChartTooltipCard,
  chartRamp,
  formatFull,
  rampStop,
  useChartPaint,
  useChartReveal,
  type SeriesSpec,
} from "@/components/ui/ChartFrame";

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

export interface FunnelStage {
  id: string;
  label: string;
  value: number;
  color?: string;
}

/**
 * Width is the encoding, in both shapes.
 *
 * This is the one decision a funnel chart has to state out loud. A
 * trapezoid has two widths and an area, and the reader has no way to know
 * which one carries the number. Encoding the area is the tempting choice
 * and it is wrong: area falls off far faster than the value does, so a
 * funnel that loses a third of its traffic looks like it lost two thirds,
 * and every funnel drawn that way flatters whatever comes after it. Width
 * is linear in the value, so a band half as wide is half as many people.
 * The band's own area means nothing here and is not offered as an option.
 */
export function stageWidths(stages: FunnelStage[], maxWidth: number): number[] {
  const max = stages.reduce((m, s) => Math.max(m, Math.max(0, s.value)), 0) || 1;
  return stages.map((s) => (Math.max(0, s.value) / max) * maxWidth);
}

/** 12px Manrope, near enough to size a gutter without measuring text. */
const CHAR_W = 6.6;
const DIGIT_W = 7;

function gutterFor(labels: string[], per: number, min: number, max: number): number {
  const longest = labels.reduce((m, s) => Math.max(m, s.length), 0);
  return Math.round(Math.min(max, Math.max(min, longest * per + 12)));
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

/**
 * `pill` draws each stage as its own rounded bar, centred, with the
 * stages separated. `band` joins them into the classic tapering funnel,
 * where the slope between two bands is the drop between them.
 *
 * They answer different questions. A band funnel is about the *journey*:
 * the taper is the story and the shape only makes sense read top to
 * bottom. Pills are about the *stages*: they compare cleanly, they
 * survive equal or out-of-order values, and a stage can carry its own
 * reading without the eye having to unpick which edge belongs to it.
 */
export type FunnelShape = "pill" | "band";

/**
 * What each stage prints beside its own bar. A funnel has three
 * defensible percentages and they answer different questions, so the
 * component asks rather than picking one and hoping.
 */
export type FunnelStat = "of-first" | "from-previous" | "share" | "none";

export interface FunnelChartProps {
  data: FunnelStage[];
  label: string;
  summary?: string;
  shape?: FunnelShape;
  /**
   * `down` narrows towards the bottom, the usual conversion funnel.
   * `up` flips it into a pyramid, for data that accumulates rather than
   * leaks: the same geometry read the other way.
   */
  direction?: "down" | "up";
  stat?: FunnelStat;
  width?: number;
  stageHeight?: number;
  gap?: number;
  formatValue?: (v: number) => string;
  className?: string;
}

export function FunnelChart({
  data,
  label,
  summary,
  shape = "pill",
  direction = "down",
  stat = "of-first",
  width = 420,
  stageHeight,
  gap,
  formatValue,
  className = "",
}: FunnelChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { inView, reduceMotion } = useChartReveal(wrapRef);

  const series: SeriesSpec[] = useMemo(
    () => data.map((d) => ({ id: d.id, label: d.label, color: d.color })),
    [data],
  );
  const { uid, style: paletteStyle } = useChartPaint(series);

  const [active, setActive] = useState<number | null>(null);
  const fmt = useCallback((v: number) => (formatValue ? formatValue(v) : formatFull(v)), [formatValue]);

  const pill = shape === "pill";
  // Pills are their own objects and read better tighter and shorter than
  // bands, which have to be tall enough for a taper to be visible.
  const rowH = stageHeight ?? (pill ? 36 : 56);
  const rowGap = gap ?? (pill ? 8 : 6);

  // A pyramid is a funnel read upwards, so the stages are reversed once
  // here rather than every geometry line branching on direction.
  const stages = useMemo(() => (direction === "up" ? [...data].reverse() : data), [data, direction]);

  const max = useMemo(
    () => stages.reduce((m, s) => Math.max(m, Math.max(0, s.value)), 0) || 1,
    [stages],
  );
  const total = useMemo(() => stages.reduce((t, s) => t + Math.max(0, s.value), 0), [stages]);

  // Colour is a second reading of the same number, not a category: the
  // widest stage sits at the faint end of the ramp and the narrowest at
  // the strong end, so the bars that have the least ink are handed the
  // most contrast. Two stages of equal size get the same colour, which
  // is the point of tying the ramp to the value rather than the row.
  const ramp = chartRamp(
    uid,
    stages.map((s) => rampStop(1 - Math.max(0, s.value) / max)),
  );
  const fillOf = (i: number) => stages[i].color ?? ramp.fill(i);

  const values = stages.map((s) => fmt(s.value));
  const labelW = pill ? gutterFor(stages.map((s) => s.label), CHAR_W, 56, 180) : 0;
  const valueW = pill ? gutterFor(values, DIGIT_W, 48, 140) : 0;
  const plotW = pill ? Math.max(80, width - labelW - valueW - 24) : width * 0.94;

  const pitch = rowH + rowGap;
  const height = stages.length * pitch - rowGap;
  const cx = pill ? labelW + 12 + plotW / 2 : width / 2;

  const widths = useMemo(() => stageWidths(stages, plotW), [stages, plotW]);

  const conversion = useCallback(
    (i: number) => {
      const prev = stages[i - 1];
      if (!prev || prev.value <= 0) return null;
      return (stages[i].value / prev.value) * 100;
    },
    [stages],
  );

  const statOf = useCallback(
    (i: number): number | null => {
      const v = stages[i]?.value ?? 0;
      if (stat === "none") return null;
      if (stat === "from-previous") return conversion(i);
      if (stat === "share") return total > 0 ? (v / total) * 100 : null;
      const first = stages[0]?.value ?? 0;
      return first > 0 ? (v / first) * 100 : null;
    },
    [stages, stat, total, conversion],
  );

  const statLabel =
    stat === "from-previous" ? "From previous" : stat === "share" ? "Share of total" : "Of first";

  // A tenth of a percent is noise at 20 percent and the whole reading at
  // half a percent, so the precision follows the size of the number
  // rather than being fixed at one or the other.
  const pct = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}%`;

  const describe = useCallback(
    (i: number) => {
      const s = stages[i];
      if (!s) return "";
      const c = conversion(i);
      const first = stages[0]?.value ?? 0;
      const overall = first > 0 ? Math.round((s.value / first) * 1000) / 10 : 0;
      return `${s.label}, ${fmt(s.value)}, ${overall} percent of the first stage${
        c === null ? "" : `, ${Math.round(c * 10) / 10} percent carried from the previous stage`
      }`;
    },
    [stages, fmt, conversion],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (stages.length === 0) return;
    const at = active ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = Math.min(stages.length - 1, at + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = stages.length - 1;
    else if (e.key === "Escape") { setActive(null); return; }
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  }

  return (
    <div ref={wrapRef} data-cf={uid} className={`relative w-full ${className}`}>
      {paletteStyle}
      {ramp.style}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={label}
        aria-describedby={`fc-hint-${uid}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="block h-auto max-w-full rounded-lg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400"
      >
        {stages.map((stage, i) => {
          const top = i * pitch;
          const mid = top + rowH / 2;
          const isActive = active === i;
          const dim = active !== null && !isActive;
          const s = statOf(i);

          if (pill) {
            // A stage worth almost nothing still happened, so a non-zero
            // value keeps a visible sliver instead of dropping out of the
            // chart entirely. Zero draws nothing, because zero is nothing.
            const raw = widths[i];
            const w = stage.value > 0 ? Math.max(3, raw) : 0;
            const x = Math.round((cx - w / 2) * 100) / 100;
            // Both radii, not just rx. SVG clamps rx to half the width on
            // its own but leaves ry alone, so a bar narrower than it is
            // tall comes out as an ellipse rather than a bar with rounded
            // ends. Animating the pair alongside the width keeps the caps
            // circular at every frame instead of only the last one.
            const r = Math.min(rowH / 2, w / 2);
            // The stat only goes inside the pill while the pill can hold
            // it with room to spare; otherwise it steps out to the right,
            // in body colour, rather than spilling over its own edge.
            const inside = s !== null && w > pct(s).length * DIGIT_W + 28;

            return (
              <g key={stage.id} onPointerEnter={() => setActive(i)}>
                {/* Widened hit area, so hovering the row works in the
                    gutters too rather than only on the bar itself. */}
                <rect x={0} y={top} width={width} height={rowH} fill="transparent" />

                <text
                  x={labelW}
                  y={mid}
                  textAnchor="end"
                  dominantBaseline="central"
                  fontSize={12}
                  fill="var(--cf-text)"
                  fillOpacity={dim ? 0.5 : 1}
                >
                  {stage.label}
                </text>

                {/* attrX, not x: on a motion element `x` is the transform,
                    and framer would stack a translate on top of the
                    attribute instead of animating it. Growing from the
                    centre needs both edges to move, so the attribute is
                    the only honest way to do it: scaling a rounded rect
                    would squash its caps into ellipses on the way. */}
                <motion.rect
                  y={top}
                  height={rowH}
                  fill={fillOf(i)}
                  fillOpacity={dim ? 0.4 : 1}
                  stroke={stage.color ? undefined : ramp.edge(i)}
                  strokeWidth={1}
                  initial={reduceMotion ? false : { attrX: cx, width: 0, rx: 0, ry: 0 }}
                  animate={inView ? { attrX: x, width: w, rx: r, ry: r } : undefined}
                  transition={{ duration: 0.55, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] }}
                />

                {s !== null && (
                  <motion.text
                    x={inside ? cx : cx + w / 2 + 8}
                    y={mid}
                    textAnchor={inside ? "middle" : "start"}
                    dominantBaseline="central"
                    fontSize={12}
                    fontWeight={600}
                    fill={inside && !stage.color ? ramp.text(i) : "var(--cf-text)"}
                    fillOpacity={dim ? 0.5 : 1}
                    className="tabular-nums"
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={inView ? { opacity: 1 } : undefined}
                    transition={{ duration: 0.3, delay: 0.06 * i + 0.25 }}
                  >
                    {pct(s)}
                  </motion.text>
                )}

                <text
                  x={width}
                  y={mid}
                  textAnchor="end"
                  dominantBaseline="central"
                  fontSize={12}
                  fill="var(--cf-strong)"
                  fillOpacity={dim ? 0.5 : 1}
                  className="tabular-nums"
                >
                  {values[i]}
                </text>
              </g>
            );
          }

          const wTop = widths[i];
          // The band tapers towards whatever comes next, so the slope
          // between two stages is the drop between them. The last band
          // keeps its own width rather than tapering to nothing, which
          // would draw a loss that is not in the data.
          const wBottom = widths[i + 1] ?? wTop;
          const d =
            `M${Math.round((cx - wTop / 2) * 100) / 100},${top}` +
            ` L${Math.round((cx + wTop / 2) * 100) / 100},${top}` +
            ` L${Math.round((cx + wBottom / 2) * 100) / 100},${top + rowH}` +
            ` L${Math.round((cx - wBottom / 2) * 100) / 100},${top + rowH} Z`;

          // Labels sit at the band's vertical centre, so they have to be
          // placed against the width *there*, not against the top edge. On
          // a steeply tapering band the two differ by enough that a label
          // inset from the top width lands outside the shape and, being
          // white, disappears into the page.
          const wMid = (wTop + wBottom) / 2;
          // Measured against this band's own text rather than a fixed
          // number, so a short label stays inside a band that a long one
          // would have to step out of.
          const fits = wMid > stage.label.length * CHAR_W + values[i].length * DIGIT_W + 44;

          return (
            <motion.g
              key={stage.id}
              initial={reduceMotion ? false : { opacity: 0, scaleY: 0.4 }}
              animate={inView ? { opacity: 1, scaleY: 1 } : undefined}
              transition={{ duration: 0.5, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformBox: "fill-box", transformOrigin: "top" }}
              onPointerEnter={() => setActive(i)}
            >
              <path
                d={d}
                fill={fillOf(i)}
                fillOpacity={dim ? 0.4 : 1}
                stroke={stage.color ? undefined : ramp.edge(i)}
                strokeWidth={1}
              />

              {/* The label sits inside the band while the band is wide
                  enough to hold it, and steps outside when it is not, so a
                  narrow final stage stays readable instead of overflowing
                  its own shape. */}
              {fits ? (
                <>
                  <text
                    x={cx - wMid / 2 + 16}
                    y={mid}
                    dominantBaseline="central"
                    fontSize={12}
                    fill={stage.color ? "#ffffff" : ramp.text(i)}
                    fillOpacity={0.92}
                  >
                    {stage.label}
                  </text>
                  <text
                    x={cx + wMid / 2 - 16}
                    y={mid}
                    textAnchor="end"
                    dominantBaseline="central"
                    fontSize={12}
                    fontWeight={600}
                    fill={stage.color ? "#ffffff" : ramp.text(i)}
                    className="tabular-nums"
                  >
                    {values[i]}
                  </text>
                </>
              ) : (
                <text
                  x={cx + wMid / 2 + 12}
                  y={mid}
                  dominantBaseline="central"
                  fontSize={12}
                  fill="var(--cf-text)"
                  className="tabular-nums"
                >
                  {stage.label} {values[i]}
                </text>
              )}

              {s !== null && (
                <text
                  x={cx - wTop / 2 - 12}
                  y={top + 2}
                  textAnchor="end"
                  dominantBaseline="hanging"
                  fontSize={11}
                  fill="var(--cf-text)"
                  className="tabular-nums"
                >
                  {pct(s)}
                </text>
              )}
            </motion.g>
          );
        })}
      </svg>

      {active !== null && stages[active] && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2"
          style={{ top: `${active * pitch + rowH + 4}px`, left: `${cx}px` }}
        >
          <ChartTooltipCard
            reduceMotion={reduceMotion}
            title={stages[active].label}
            rows={[
              { label: "Value", value: values[active], swatch: fillOf(active) },
              {
                label: "Of first",
                value: pct(
                  stages[0].value > 0 ? (stages[active].value / stages[0].value) * 100 : 0,
                ),
              },
              ...(conversion(active) === null
                ? []
                : [{ label: "From previous", value: pct(conversion(active)!) }]),
            ]}
          />
        </div>
      )}

      <p id={`fc-hint-${uid}`} className="sr-only">
        {summary ? `${summary} ` : ""}
        Bar width is proportional to the value, not bar area, and colour repeats the same reading.
        Use the arrow keys to move between stages and Escape to dismiss the reading. The full data
        follows as a table.
      </p>

      <span className="sr-only" aria-live="polite">
        {active !== null ? describe(active) : ""}
      </span>

      <ChartTable
        caption={label}
        columns={["Stage", "Value", "From previous", "Of first"]}
        rows={stages.map((s, i) => {
          const c = conversion(i);
          const first = stages[0]?.value ?? 0;
          return {
            head: s.label,
            cells: [
              values[i],
              c === null ? "" : pct(c),
              first > 0 ? pct((s.value / first) * 100) : "",
            ],
          };
        })}
      />

      <span className="sr-only">{statLabel} is printed beside each bar.</span>
    </div>
  );
}
