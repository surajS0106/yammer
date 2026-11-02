// A page's headline numbers as a nigiri, lying on its side: Home's "This week" panel (week-stats.tsx)
// stretched into a banner. Salmon holds the big pixel number, nori a band (pixel stacks or chips)
// and rice two smaller stats. Wide containers lay the three out in a row; narrow ones stack them.

import * as React from "react";

import { INK, NORI, PixelFlame, PixelNumber, RICE, RICE_SHADE, SALMON, STRIPE } from "@/components/pixel";

export interface NigiriStat {
  value: number;
  label: string;
  hint?: string;
  /** Salmon numerals by default; nori for the second stat reads as a pair. */
  color?: "salmon" | "nori";
  /** A pixel flame before the number, lit unless the value is 0. */
  flame?: boolean;
}

export function NigiriCard({
  label,
  value,
  caption,
  badge,
  bandLabel,
  band,
  stats,
  footer,
}: {
  label: string;
  value: number;
  caption: string;
  badge?: string;
  /** A small heading over the band, saying what it shows. */
  bandLabel?: string;
  band: React.ReactNode;
  stats: [NigiriStat, NigiriStat];
  footer?: React.ReactNode;
}) {
  return (
    <section
      className="grid overflow-hidden rounded-2xl ring-1 ring-black/10 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,5fr)]"
      style={{ boxShadow: `0 18px 40px -22px ${SALMON}99` }}
    >
      {/* Salmon: the headline number, over the sprite's diagonal stripes. */}
      <div
        className="flex flex-col px-5 pt-4 pb-5"
        style={{
          color: RICE,
          backgroundColor: SALMON,
          backgroundImage: `repeating-linear-gradient(135deg, transparent 0 18px, ${STRIPE}55 18px 26px)`,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{label}</span>
          {badge && (
            <span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums" style={{ backgroundColor: NORI }}>
              {badge}
            </span>
          )}
        </div>
        <PixelNumber value={value} height={52} color={RICE} spread={600} className="mt-3 drop-shadow-[0_3px_0_rgb(0_0_0/0.18)]" />
        <div className="mt-auto pt-3 text-sm font-semibold">{caption}</div>
      </div>

      {/* Nori: the page's band. */}
      <div className="flex flex-col gap-3 px-5 pt-4 pb-3" style={{ backgroundColor: NORI, color: RICE }}>
        {bandLabel && <span className="text-[11px] font-semibold opacity-70">{bandLabel}</span>}
        <div className="mt-auto">{band}</div>
      </div>

      {/* Rice: two smaller numbers in dark ink. */}
      <div className="flex flex-col justify-center px-5 py-4" style={{ backgroundColor: RICE, color: INK }}>
        <div className="grid grid-cols-2 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <div className="flex h-7 items-end gap-2">
                {s.flame && <PixelFlame px={2.5} lit={s.value > 0} />}
                <PixelNumber value={s.value} height={24} color={s.color === "nori" ? NORI : SALMON} spread={400} />
              </div>
              <div className="mt-2 text-xs font-bold">{s.label}</div>
              {s.hint && <div className="truncate text-[11px] opacity-70">{s.hint}</div>}
            </div>
          ))}
        </div>
        {footer && (
          <div className="mt-3 border-t border-dashed pt-2.5 text-xs font-medium" style={{ borderColor: RICE_SHADE }}>
            {footer}
          </div>
        )}
      </div>
    </section>
  );
}

/** Words or names as pixel-edged tags, for a nori band. Past `limit` the rest fold into "+N". */
export function NigiriChips({ items, highlight, limit = 8, empty }: { items: string[]; highlight?: string; limit?: number; empty: string }) {
  if (!items.length) return <p className="pb-1 text-xs opacity-70">{empty}</p>;
  const shown = items.slice(0, limit);
  return (
    <div className="flex flex-wrap gap-1.5 pb-1">
      {shown.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="max-w-full truncate rounded-[3px] px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: item === highlight ? RICE : `${STRIPE}33`,
            color: item === highlight ? NORI : RICE,
            animation: `pixel-in 220ms var(--ease-smooth) ${150 + i * 50}ms backwards`,
          }}
        >
          {item}
        </span>
      ))}
      {items.length > limit && (
        <span className="rounded-[3px] px-2 py-0.5 text-xs font-bold" style={{ color: STRIPE }}>
          +{items.length - limit}
        </span>
      )}
    </div>
  );
}
