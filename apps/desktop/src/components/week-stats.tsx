// Home's "This week" panel, built as a nigiri in Sushi's own sprite colours: a salmon top with the
// week's words in pixel numerals, a nori band of per-day pixel stacks, and a rice base with speed
// and streak. Pixels dissolve in on mount; under reduced motion (index.css) they just appear.

import { INK, NORI, PixelBars, PixelFlame, PixelNumber, RICE, RICE_SHADE, SALMON, STRIPE } from "@/components/pixel";
import { lastDays, TYPING_WPM, weekOverWeek, type Stats } from "@/lib/stats";

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

function weekNumbers(stats: Stats) {
  const days = lastDays(7);
  const perDay = (d: number) => stats.byDay.get(d) ?? 0;
  const counts = days.map(perDay);
  const total = counts.reduce((a, b) => a + b, 0);
  const delta = weekOverWeek(perDay);
  const faster = stats.wpm ? Math.round((stats.wpm / TYPING_WPM) * 10) / 10 : 0;
  const daily = stats.dayStreak > 1;
  const streak = daily ? stats.dayStreak : stats.weekStreak;
  // Typing those words at TYPING_WPM, minus the time it took to say them.
  const skipped = stats.wpm ? Math.max(Math.round(total / TYPING_WPM - total / stats.wpm), 0) : 0;
  return { days, counts, total, delta, faster, daily, streak, skipped };
}

/** The same numbers as tiles for the phone's bento Home: the week across the grid, then speed and streak side by side. Each opens Insights. */
export function WeekBento({ stats, onOpen }: { stats: Stats; onOpen: () => void }) {
  const { days, counts, total, delta, faster, daily, streak } = weekNumbers(stats);
  const tile = "min-w-0 overflow-hidden rounded-3xl text-left ring-1 ring-black/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <>
      <button type="button" onClick={onOpen} aria-label="See Insights" className={`col-span-2 ${tile}`}>
        <div className="px-5 pt-4 pb-4" style={{ color: RICE, backgroundColor: SALMON, backgroundImage: `repeating-linear-gradient(135deg, transparent 0 18px, ${STRIPE}55 18px 26px)` }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">This week</span>
            {delta !== undefined && (
              <span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums" style={{ backgroundColor: NORI }}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))}%
              </span>
            )}
          </div>
          <PixelNumber value={total} height={52} color={RICE} spread={600} className="mt-3 drop-shadow-[0_3px_0_rgb(0_0_0/0.18)]" />
          <div className="mt-2 text-sm font-semibold">{total ? "words said out loud" : "Say something. This lights up."}</div>
        </div>
        <div className="px-5 pt-3 pb-2" style={{ backgroundColor: NORI, color: RICE }}>
          <PixelBars values={counts} labels={days.map((d) => weekday.format(d))} titles={counts.map((n) => `${n.toLocaleString()} words`)} />
        </div>
      </button>
      <button type="button" onClick={onOpen} aria-label="See Insights" className={`p-4 ${tile}`} style={{ backgroundColor: RICE, color: INK }}>
        <div className="flex h-8 items-end">
          <PixelNumber value={stats.wpm} height={28} color={SALMON} spread={400} />
        </div>
        <div className="mt-2 text-xs font-bold">words / min</div>
        <div className="text-[11px] opacity-70">{faster > 1 ? `${faster}× your typing` : "speaking speed"}</div>
      </button>
      <button type="button" onClick={onOpen} aria-label="See Insights" className={`p-4 ${tile}`} style={{ backgroundColor: RICE, color: INK }}>
        <div className="flex h-8 items-end gap-2">
          <PixelFlame lit={streak > 0} />
          <PixelNumber value={streak} height={28} color={NORI} spread={400} />
        </div>
        <div className="mt-2 text-xs font-bold">{daily ? "day" : "week"} streak</div>
        <div className="text-[11px] opacity-70">{streak > 0 ? "keep it lit" : "starts today"}</div>
      </button>
    </>
  );
}

export function WeekStats({ stats, onOpen }: { stats: Stats; onOpen: () => void }) {
  const { days, counts, total, delta, faster, daily, streak, skipped } = weekNumbers(stats);

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
        <PixelBars values={counts} labels={days.map((d) => weekday.format(d))} titles={counts.map((n) => `${n.toLocaleString()} words`)} />
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
