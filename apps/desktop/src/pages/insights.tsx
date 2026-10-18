import { Flame, Gauge, Hourglass, Type } from "lucide-react";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { NavCards } from "@/components/nav-cards";
import { Button, Card } from "@/components/ui";
import { FunnelChart } from "@/components/ui/FunnelChart";
import { HeatMap } from "@/components/ui/HeatMap";
import { PieChart } from "@/components/ui/PieChart";
import { StatCard } from "@/components/ui/StatCard";
import { WordCloud } from "@/components/ui/WordCloud";
import { parseWords } from "@/pages/dictionary";
import { useSettings } from "@/lib/settings";
import {
  computeStats,
  dayKey,
  languageBreakdown,
  languageOf,
  lastDays,
  TYPING_WPM,
  topWords,
  useHistory,
  weekOverWeek,
  type Stats,
} from "@/lib/stats";
import { useDark } from "@/lib/use-dark";
import { cn } from "@/lib/utils";

const WEEKS = 26;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "short" });
const sinceFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Sush coral, from the empty-day surface to the busiest day. Hex because HeatMap interpolates literal colours. */
const RAMP = {
  light: ["#feeeeb", "#fcc0b8", "#f7857c", "#f14445", "#a12f2f"],
  dark: ["#241a19", "#642724", "#a83634", "#f75d59", "#febfb6"],
};

/* ------------------------------------------------------------------ */

function Panel({ title, caption, aside, className, children }: { title: string; caption?: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <Card className={cn("flex min-w-0 flex-col p-4 @md:p-5", className)}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
        </div>
        {aside}
      </header>
      {children}
    </Card>
  );
}

function RampLegend({ stops }: { stops: string[] }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      Less
      {stops.map((c) => (
        <span key={c} className="size-2.5 rounded-[3px]" style={{ background: c }} />
      ))}
      More
    </div>
  );
}

/** "x,y" pairs in StatCard's 100×24 sparkline box. */
function sparkline(values: number[]): string {
  const max = Math.max(1, ...values);
  const step = 100 / Math.max(1, values.length - 1);
  return values.map((v, i) => `${Math.round(i * step * 10) / 10},${Math.round((22 - (v / max) * 20) * 10) / 10}`).join(" ");
}

/** StatCard, repainted with the app's tokens instead of its stone/emerald. */
function Stat(props: React.ComponentProps<typeof StatCard>) {
  return (
    <StatCard
      {...props}
      // StatCard's own dark: classes outrank plain overrides, so each one is restated under dark: too.
      className="rounded-xl border-border bg-card p-4 @md:p-5 dark:border-border dark:bg-card [&_svg]:text-primary dark:[&_svg]:text-primary"
      classNames={{
        label: "text-muted-foreground dark:text-muted-foreground",
        value: "text-foreground dark:text-foreground text-3xl @md:text-4xl @6xl:text-5xl",
        icon: "size-10 border-primary/15 bg-primary/10 text-primary dark:text-primary [&_svg]:size-[18px]",
        description: "mt-3 text-sm text-muted-foreground dark:text-muted-foreground",
        delta: "text-xs",
        divider: "border-border dark:border-border",
      }}
    />
  );
}

/* ------------------------------------------------------------------ */

function Activity({ stats, ramp }: { stats: Stats; ramp: string[] }) {
  const today = dayKey(Date.now());
  // Columns are weeks (Mon–Sun) ending with this one; rows are weekdays.
  const start = new Date(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const weeks = Array.from({ length: WEEKS }, (_, w) => {
    const d = new Date(start);
    d.setDate(d.getDate() + w * 7);
    return d;
  });
  const dateAt = (row: number, col: number) => {
    const d = new Date(weeks[col]);
    d.setDate(d.getDate() + row);
    return d.getTime();
  };
  const data = WEEKDAYS.map((_, row) => weeks.map((_, col) => (dateAt(row, col) > today ? null : (stats.byDay.get(dateAt(row, col)) ?? 0))));

  // HeatMap draws no axes, so the labels sit on the same grid it uses:
  // cells of `size` with a 4-unit pad round the viewBox.
  const size = 24;
  const pad = 4;
  const x = (col: number) => `${((pad + size / 2 + col * size) / (WEEKS * size + pad * 2)) * 100}%`;
  const y = (row: number) => `${((pad + size / 2 + row * size) / (7 * size + pad * 2)) * 100}%`;

  return (
    <div className="grid grid-cols-[2rem_1fr] gap-x-2">
      <span />
      <div className="relative mb-1.5 h-4 text-[11px] text-muted-foreground">
        {weeks.map((w, col) =>
          (w.getDate() <= 7 && col > 0) || (col === 0 && !weeks.slice(1, 4).some((n) => n.getDate() <= 7)) ? (
            <span key={col} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(col) }}>
              {monthFmt.format(w)}
            </span>
          ) : null,
        )}
      </div>
      <div className="relative text-[11px] text-muted-foreground">
        {WEEKDAYS.map((d, row) =>
          row % 2 === 0 ? (
            <span key={d} className="absolute -translate-y-1/2" style={{ top: y(row) }}>
              {d}
            </span>
          ) : null,
        )}
      </div>
      <HeatMap
        data={data}
        label="Words dictated per day, by week"
        ramp={ramp}
        floor={0}
        shape="square"
        size={size}
        gap={4}
        legend={false}
        xLabels={weeks.map((w) => `week of ${dayFmt.format(w)}`)}
        yLabels={WEEKDAYS}
        formatValue={(v) => `${v.toLocaleString()} words`}
      />
    </div>
  );
}

function Rhythm({ stats, ramp }: { stats: Stats; ramp: string[] }) {
  // Two-hour blocks: 24 single hours make dots too small to read in a third of the page.
  const blocks = 12;
  const hour = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? "am" : "pm");
  const data = stats.rhythm.map((row) => Array.from({ length: blocks }, (_, b) => row[b * 2] + row[b * 2 + 1]));
  const size = 22;
  const pad = 4;
  const x = (col: number) => `${((pad + size / 2 + col * size) / (blocks * size + pad * 2)) * 100}%`;
  const y = (row: number) => `${((pad + size / 2 + row * size) / (7 * size + pad * 2)) * 100}%`;
  return (
    <div className="grid grid-cols-[2rem_1fr] gap-x-2">
      <div className="relative text-[11px] text-muted-foreground">
        {WEEKDAYS.map((d, row) => (
          <span key={d} className="absolute -translate-y-1/2" style={{ top: y(row) }}>
            {d}
          </span>
        ))}
      </div>
      <HeatMap
        data={data}
        label="Words dictated by weekday and time of day"
        ramp={ramp}
        floor={0}
        shape="dot"
        size={size}
        gap={3}
        legend={false}
        xLabels={Array.from({ length: blocks }, (_, b) => `${hour(b * 2)}–${hour(b * 2 + 2)}`)}
        yLabels={WEEKDAYS}
        formatValue={(v) => `${v.toLocaleString()} words`}
      />
      <span />
      <div className="relative mt-2 h-4 text-[11px] text-muted-foreground">
        {[0, 3, 6, 9].map((b) => (
          <span key={b} className="absolute -translate-x-1/2" style={{ left: x(b) }}>
            {hour(b * 2)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function InsightsPage({ go }: { go: (page: PageId) => void }) {
  const { settings } = useSettings();
  const entries = useHistory();
  const dark = useDark();
  const stats = React.useMemo(() => computeStats(entries), [entries]);
  const vocabulary = parseWords(settings.vocabulary);
  const words = React.useMemo(() => topWords(entries, vocabulary, 40), [entries, settings.vocabulary]); // eslint-disable-line react-hooks/exhaustive-deps
  const spoken = React.useMemo(() => languageBreakdown(entries), [entries]);
  const unrecorded = React.useMemo(() => entries.filter((e) => !languageOf(e)).length, [entries]);

  if (entries.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Insights" description="How you use your voice, from your dictation history on this computer." />
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-sm font-medium">Nothing to show yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">Dictate a few times and your speed, streaks and habits show up here.</p>
          <Button size="sm" variant="outline" onClick={() => go("home")}>
            How to dictate
          </Button>
        </Card>
      </div>
    );
  }

  const ramp = dark ? RAMP.dark : RAMP.light;
  const days = lastDays(14);
  const wordsOn = (d: number) => stats.byDay.get(d) ?? 0;
  const wpmOn = (d: number) => {
    const ms = stats.msByDay.get(d) ?? 0;
    return ms ? (wordsOn(d) / ms) * 60_000 : 0;
  };
  const avg = (v: number[]) => {
    const real = v.filter(Boolean);
    return real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
  };
  const thisWeek = days.slice(7).reduce((n, d) => n + wordsOn(d), 0);
  const savedHours = stats.minutesSaved >= 60;
  const big = stats.words >= 1000;
  const polished = stats.dictations ? Math.round((stats.cleaned / stats.dictations) * 100) : 0;
  const active = settings.transforms.find((t) => t.id === settings.activeTransform);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        description={`${stats.dictations.toLocaleString()} dictations since ${sinceFmt.format(Math.min(...entries.map((e) => e.at)))}. Kept on this computer only.`}
      />

      <div className="grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-4">
        <Stat
          label="Speed"
          icon={<Gauge />}
          value={stats.wpm}
          valueSuffix=""
          valueDecimals={0}
          delta={weekOverWeek(wpmOn, avg)}
          sparklinePoints={sparkline(days.map(wpmOn))}
          description={`words per minute, ${(stats.wpm / TYPING_WPM).toFixed(1)}× your typing`}
        />
        <Stat
          label="Words dictated"
          icon={<Type />}
          value={big ? stats.words / 1000 : stats.words}
          valueSuffix={big ? "k" : ""}
          valueDecimals={big ? 1 : 0}
          delta={weekOverWeek(wordsOn)}
          sparklinePoints={sparkline(days.map(wordsOn))}
          description={`words in total, ${thisWeek.toLocaleString()} in the last 7 days`}
        />
        <Stat
          label="Streak"
          icon={<Flame />}
          value={stats.dayStreak}
          valueSuffix={stats.dayStreak === 1 ? " day" : " days"}
          valueDecimals={0}
          description={`Longest ${stats.longestDayStreak} days · ${stats.weekStreak} ${stats.weekStreak === 1 ? "week" : "weeks"} running`}
        >
          <div className="flex items-center justify-between gap-1" aria-label="Last 14 days">
            {days.map((d) => (
              <span
                key={d}
                title={`${dayFmt.format(d)}: ${wordsOn(d).toLocaleString()} words`}
                className={cn("h-2 flex-1 rounded-full", wordsOn(d) ? "bg-primary" : "bg-muted", d === days[days.length - 1] && "ring-2 ring-primary/25")}
              />
            ))}
          </div>
        </Stat>
        <Stat
          label="Time saved"
          icon={<Hourglass />}
          value={savedHours ? stats.minutesSaved / 60 : stats.minutesSaved}
          valueSuffix={savedHours ? "h" : "m"}
          valueDecimals={savedHours ? 1 : 0}
          description={`vs. typing it all at ${TYPING_WPM} wpm`}
        >
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {[
              ["Speaking", Math.round(stats.speakingMs / 60_000)],
              ["Typing", Math.round(stats.words / TYPING_WPM)],
            ].map(([what, min]) => (
              <div key={what} className="flex items-center gap-2">
                <span className="w-14">{what}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn("block h-full rounded-full", what === "Speaking" ? "bg-primary" : "bg-muted-foreground/40")}
                    style={{ width: `${Math.max(2, ((min as number) / Math.max(1, Math.round(stats.words / TYPING_WPM))) * 100)}%` }}
                  />
                </span>
                <span className="w-12 text-right tabular-nums">{(min as number).toLocaleString()} min</span>
              </div>
            ))}
          </div>
        </Stat>
      </div>

      <div className="grid gap-4 @5xl:grid-cols-3">
        <Panel title="Activity" caption={`Words per day, last ${WEEKS} weeks`} aside={<RampLegend stops={ramp} />} className="@5xl:col-span-2">
          <Activity stats={stats} ramp={ramp} />
        </Panel>
        <Panel title="AI cleanup" caption="Dictations the model polished">
          <div className="flex flex-1 flex-col items-center justify-center">
            <PieChart
              label="Dictations polished by AI cleanup"
              variant="donut"
              size={188}
              innerRatio={0.7}
              padAngle={stats.cleaned && stats.cleaned < stats.dictations ? 2 : 0}
              centre={{ value: `${polished}%`, caption: "polished" }}
              data={[
                { id: "polished", label: "Polished", value: stats.cleaned, color: "var(--primary)" },
                { id: "raw", label: "As transcribed", value: stats.dictations - stats.cleaned, color: "color-mix(in oklch, var(--muted-foreground) 22%, var(--card))" },
              ]}
              className="[&>div:nth-of-type(2)]:justify-center"
            />
            {!settings.cleanup.enabled && (
              <button type="button" className="mt-3 text-xs font-medium text-primary hover:underline" onClick={() => go("cleanup")}>
                Turn on AI cleanup
              </button>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 @5xl:grid-cols-3">
        <Panel title="Your words" caption="What you say most, without the filler" className="@5xl:col-span-2">
          {words.length >= 5 ? (
            <div style={{ ["--cf-r-from" as string]: ramp[2], ["--cf-r-to" as string]: ramp[4] }}>
              <WordCloud words={words} label="Words you dictate most often" unit="times" width={640} height={260} maxSize={52} className="[&>div.mt-4]:hidden" />
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">A few more dictations and your most-used words show up here.</p>
          )}
        </Panel>
        <Panel title="Rhythm" caption="When in the week you talk">
          <div className="flex flex-1 flex-col justify-center">
            <Rhythm stats={stats} ramp={ramp} />
          </div>
        </Panel>
      </div>

      <Panel
        title="Languages"
        caption={
          spoken.length === 0
            ? "Which languages you dictate in"
            : spoken.length === 1
              ? `Every recorded dictation was in ${spoken[0].label}`
              : `${spoken[0].label} is your most spoken language, by words dictated`
        }
      >
        {spoken.length > 0 ? (
          <div style={{ ["--cf-r-from" as string]: ramp[1], ["--cf-r-to" as string]: ramp[4] }}>
            <FunnelChart
              label="Words dictated per language"
              summary={spoken.map((l) => `${l.label}: ${l.words.toLocaleString()} words`).join(", ") + "."}
              data={spoken.map((l) => ({ id: l.code, label: l.label, value: l.words }))}
              shape="pill"
              stat="share"
              width={560}
              formatValue={(v) => `${v.toLocaleString()} words`}
              className="mx-auto max-w-[560px]"
            />
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Your next dictations will show which languages you speak.</p>
        )}
        {unrecorded > 0 && (
          <p className="mt-4 text-xs text-muted-foreground">
            {unrecorded.toLocaleString()} {unrecorded === 1 ? "dictation isn’t" : "dictations aren’t"} counted: older ones, or ones a cloud service
            detected the language of. Set a language in Settings → Speech engine to record it.
          </p>
        )}
      </Panel>

      <section className="space-y-3 pt-2">
        <h2 className="px-1 text-sm font-semibold tracking-tight">What to try next</h2>
        <NavCards
          go={go}
          cards={[
            {
              to: "dictionary",
              title: vocabulary.length ? `${vocabulary.length} words in your Dictionary` : "Teach it your words",
              description: "Names and jargon it mishears go here once, then come out right in every dictation.",
            },
            {
              to: "snippets",
              title: settings.snippets.length ? `${settings.snippets.length} snippets saved` : "Stop re-typing yourself",
              description: "Say “my linkedin” or “intro email” and paste the whole thing.",
            },
            {
              to: "transforms",
              title: active ? `${active.name} is on` : "Shape what you say",
              description: active ? "Every dictation is restyled before it’s pasted. Switch styles or turn it off." : "Turn a rambling thought into an email or a tidy list as you speak.",
            },
          ]}
        />
      </section>
    </div>
  );
}
