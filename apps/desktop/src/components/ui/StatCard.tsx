"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

function Counter({
  to,
  decimals = 1,
  prefix = "",
  suffix = "",
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-10% 0px" });
  const shouldReduceMotion = useReducedMotion();
  const motionValue = useMotionValue(shouldReduceMotion ? to : 0);
  const spring = useSpring(motionValue, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => `${prefix}${v.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    if (isInView && !shouldReduceMotion) motionValue.set(to);
  }, [isInView, to, motionValue, shouldReduceMotion]);

  return <motion.span ref={ref}>{display}</motion.span>;
}

const SURFACE = {
  ambient: {
    card: "border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900",
    label: "text-stone-500 dark:text-stone-400",
    value: "text-emerald-700 dark:text-emerald-400",
    icon: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    description: "text-stone-900 dark:text-stone-100",
    divider: "border-stone-200 dark:border-stone-700",
    up: "text-green-700 dark:text-green-400",
    down: "text-red-600 dark:text-red-400",
  },
  light: {
    card: "border-stone-200 bg-white",
    label: "text-stone-500",
    value: "text-emerald-700",
    icon: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
    description: "text-stone-900",
    divider: "border-stone-200",
    up: "text-green-700",
    down: "text-red-600",
  },
  dark: {
    card: "border-white/10 bg-stone-900",
    label: "text-stone-500",
    value: "text-emerald-400",
    icon: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    description: "text-white",
    divider: "border-stone-700",
    up: "text-green-400",
    down: "text-red-400",
  },
} as const;

export function StatCard({
  label,
  value,
  valueSuffix = "k",
  valueDecimals = 1,
  delta,
  deltaSuffix = "%",
  sparklinePoints: points,
  description,
  icon,
  variant = "ambient",
  className,
  classNames,
  children,
}: {
  /** The eyebrow above the number. */
  label: string;
  value: number;
  valueSuffix?: string;
  valueDecimals?: number;
  delta?: number;
  deltaSuffix?: string;
  sparklinePoints?: string;
  /** One line under the number that says what it counts. */
  description?: ReactNode;
  /** A lucide icon: it is drawn in a disc beside the value. */
  icon?: ReactNode;
  variant?: "ambient" | "light" | "dark";
  /** Merged onto the card, so a host page can repaint the surface in its own palette. */
  className?: string;
  /** Per-part overrides, for when the label or value should take the host's type and colour. */
  classNames?: {
    label?: string;
    value?: string;
    delta?: string;
    icon?: string;
    description?: string;
    divider?: string;
  };
  /** Footer under a divider: a caption, a link, a CTA. */
  children?: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  const deltaUp = delta !== undefined && delta >= 0;
  const tone = SURFACE[variant];

  return (
    <motion.div
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={cn(
        "flex flex-col rounded-2xl border p-6 transition-colors duration-150",
        tone.card,
        className,
      )}
    >
      <span
        className={cn("text-[11px] font-medium uppercase tracking-[0.08em]", tone.label, classNames?.label)}
      >
        {label}
      </span>

      <div className="mt-4 flex items-center gap-3">
        {icon && (
          <span
            aria-hidden
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border",
              tone.icon,
              classNames?.icon,
            )}
          >
            {icon}
          </span>
        )}
        <div className="flex items-baseline gap-2">
          <span
            className={cn("text-5xl font-semibold leading-none tabular-nums tracking-tight", tone.value, classNames?.value)}
          >
            <Counter to={value} decimals={valueDecimals} suffix={valueSuffix} />
          </span>
          {delta !== undefined && (
            <span className={cn("text-sm font-medium", deltaUp ? tone.up : tone.down, classNames?.delta)}>
              <Counter to={Math.abs(delta)} decimals={valueDecimals} prefix={deltaUp ? "+" : "-"} suffix={deltaSuffix} />
            </span>
          )}
        </div>
      </div>

      {description && (
        <p className={cn("mt-4 text-base leading-snug", tone.description, classNames?.description)}>{description}</p>
      )}

      {points && (
        // The line takes the delta's colour, so a falling series is not drawn
        // in green under a red number.
        <svg
          viewBox="0 0 100 24"
          className={cn("mt-4 h-6 w-full", delta === undefined || deltaUp ? tone.up : tone.down)}
          fill="none"
          preserveAspectRatio="none"
        >
          <motion.polyline
            points={points}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={shouldReduceMotion ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }
            }
          />
        </svg>
      )}

      {children && <div className={cn("mt-5 border-t pt-4", tone.divider, classNames?.divider)}>{children}</div>}
    </motion.div>
  );
}
