import { BarChart3, BookA, CircleArrowUp, CircleHelp, Flame, History, Home, LoaderCircle, NotebookPen, Scissors, Settings, Wand2 } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";

import type { PageId } from "@/App";
import { HoverHighlight } from "@/components/ui/motion-highlight";
import { Hotkey } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { computeStats, dayKey, formatCompact, useHistory } from "@/lib/stats";
import { api, on, type OverlayState } from "@/lib/tauri";
import { installUpdate, useUpdate } from "@/lib/updater";
import { cn } from "@/lib/utils";

type NavItem = { id: PageId; label: string; icon: React.ElementType };

/** Talking happens on the left of the app; teaching Yammer your words and habits on the right. */
const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "Talk",
    items: [
      { id: "home", label: "Home", icon: Home },
      { id: "scratchpad", label: "Scratchpad", icon: NotebookPen },
      { id: "history", label: "History", icon: History },
      { id: "insights", label: "Insights", icon: BarChart3 },
    ],
  },
  {
    label: "Teach",
    items: [
      { id: "dictionary", label: "Dictionary", icon: BookA },
      { id: "snippets", label: "Snippets", icon: Scissors },
      { id: "transforms", label: "Transforms", icon: Wand2 },
    ],
  },
];

export const navPageIds = groups.flatMap((g) => g.items.map((i) => i.id));

const SPRING = { type: "spring", stiffness: 520, damping: 40 } as const;

export function Sidebar({
  page,
  go,
  settingsActive,
  dragStrip,
}: {
  page: PageId;
  go: (page: PageId) => void;
  settingsActive: boolean;
  /** Room for the macOS traffic lights above the brand. */
  dragStrip: boolean;
}) {
  const history = useHistory();
  const stats = React.useMemo(() => computeStats(history), [history]);
  const today = dayKey(Date.now());
  const todayCount = React.useMemo(() => history.filter((e) => dayKey(e.at) === today).length, [history, today]);

  const footer: (NavItem & { active: boolean })[] = [
    { id: "general", label: "Settings", icon: Settings, active: settingsActive },
    { id: "help", label: "Help", icon: CircleHelp, active: page === "help" },
  ];

  return (
    <nav className="relative isolate flex h-full w-56 flex-col overflow-y-auto border-r bg-sidebar p-3">
      {/* A coral wash and a pixel grid in the top corner, fading out: the same pixels Sushi and the week panel are made of. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56"
        style={{
          background: "radial-gradient(120% 70% at 0% 0%, color-mix(in oklch, var(--brand) 13%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 opacity-70"
        style={{
          backgroundImage: "radial-gradient(var(--sidebar-border) 1px, transparent 1px)",
          backgroundSize: "10px 10px",
          maskImage: "linear-gradient(to bottom, black, transparent 85%)",
        }}
      />

      {/* No native title bar: on macOS this strip sits under the traffic lights. */}
      {dragStrip && <div data-tauri-drag-region className="h-7 shrink-0" />}
      <div data-tauri-drag-region className="group/brand mb-2 flex items-center gap-2.5 px-1.5 pt-1">
        <span className="pointer-events-none flex size-9 items-center justify-center rounded-xl bg-background shadow-xs ring-1 ring-border transition-transform duration-300 group-hover/brand:-rotate-6 group-hover/brand:scale-105">
          <img src="/yammer-mark.png" alt="" className="size-6" />
        </span>
        <span className="pointer-events-none flex flex-col leading-none">
          <span className="text-lg font-semibold tracking-tight">Yammer</span>
          <span className="mt-1 text-[11px] text-muted-foreground">
            by <span className="font-medium text-primary">Sush</span>
          </span>
        </span>
      </div>

      {/* One hover background glides between items as the pointer moves, as in Sush's sidebar; the selected pill slides too. */}
      <HoverHighlight className="flex flex-1 flex-col" highlightClassName="rounded-lg bg-sidebar-accent/70">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <SectionLabel>{g.label}</SectionLabel>
            {g.items.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={page === item.id}
                onClick={() => go(item.id)}
                badge={item.id === "history" && todayCount > 0 ? todayCount : undefined}
              />
            ))}
          </div>
        ))}

        <div className="mt-auto flex flex-col gap-3 pt-6">
          <MicCard streak={stats.dayStreak} todayWords={stats.byDay.get(today) ?? 0} onClick={() => go("home")} />
          <UpdateCard />
          <div className="flex flex-col gap-0.5 border-t pt-2">
            {footer.map((item) => (
              <NavButton key={item.id} item={item} active={item.active} onClick={() => go(item.id)} />
            ))}
          </div>
        </div>
      </HoverHighlight>
    </nav>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2.5 pt-4 pb-1.5">
      <span className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-sidebar-border to-transparent" />
    </div>
  );
}

function NavButton({
  item: { label, icon: Icon },
  active,
  badge,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      data-hover-item
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={SPRING}
          className="absolute inset-0 rounded-lg bg-background shadow-xs ring-1 ring-border dark:bg-sidebar-accent"
        >
          {/* A coral notch on the sidebar's edge marks where you are. */}
          <span className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r-full bg-primary" />
        </motion.span>
      )}
      <span
        className={cn(
          "relative flex size-7 shrink-0 items-center justify-center rounded-md transition-[background-color,color,rotate,scale] duration-300",
          active
            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
            : "group-hover:-rotate-8 group-hover:scale-110 group-hover:text-primary",
        )}
      >
        <Icon className="size-4" strokeWidth={active ? 2.25 : 2} />
      </span>
      <span className="relative truncate">{label}</span>
      {badge !== undefined && (
        <span
          title={`${badge} today`}
          className="relative ml-auto rounded-full bg-primary/12 px-1.5 py-px text-[10.5px] font-semibold text-primary tabular-nums"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

const statusLabel: Partial<Record<OverlayState["phase"], string>> = {
  listening: "Listening…",
  transcribing: "Transcribing…",
  polishing: "Polishing…",
};

/** The hotkey, always in view, and a pulse of life while Yammer is listening. */
function MicCard({ streak, todayWords, onClick }: { streak: number; todayWords: number; onClick: () => void }) {
  const { settings } = useSettings();
  const [phase, setPhase] = React.useState<OverlayState["phase"]>("hidden");
  const [level, setLevel] = React.useState(0);

  React.useEffect(() => {
    api.overlayState().then((s) => setPhase(s.phase), () => {});
    const a = on.dictation((s) => setPhase(s.phase));
    const b = on.level(setLevel);
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, []);

  const busy = phase in statusLabel;
  const listening = phase === "listening";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-background/80 p-3 text-left shadow-xs transition-[border-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-card",
        busy && "border-primary/50 shadow-md shadow-primary/10",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-8 -right-8 size-24 rounded-full bg-primary/15 blur-2xl transition-opacity duration-500",
          busy ? "opacity-100" : "opacity-50",
        )}
      />
      <span className="relative flex items-center gap-2 text-xs font-medium">
        <span className="relative flex size-2">
          {busy && <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60" />}
          <span className={cn("relative size-2 rounded-full", busy ? "bg-primary" : "bg-emerald-500")} />
        </span>
        {statusLabel[phase] ?? "Ready to yap"}
        {listening && <LevelBars level={level} />}
      </span>
      <span className="relative mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        Hold
        <Hotkey accelerator={settings.hotkey} className="[&_kbd]:h-5 [&_kbd]:min-w-5 [&_kbd]:bg-background [&_kbd]:px-1 [&_kbd]:text-[10.5px]" />
        and talk
      </span>
      <span className="relative mt-3 flex items-center justify-between border-t border-dashed pt-2 text-[11px] text-muted-foreground">
        <span className={cn("flex items-center gap-1", streak > 0 && "text-foreground")}>
          <Flame className={cn("size-3.5", streak > 0 ? "fill-primary/25 text-primary" : "")} />
          {streak > 0 ? `${streak}-day streak` : "No streak yet"}
        </span>
        <span className="tabular-nums">{formatCompact(todayWords)} today</span>
      </span>
    </button>
  );
}

/** Only there when a newer release is out: one click downloads it, installs it and relaunches Yammer. */
function UpdateCard() {
  const update = useUpdate();
  if (update.phase === "idle") return null;

  const installing = update.phase === "installing";
  const pct = installing && update.progress !== null ? Math.round(update.progress * 100) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="rounded-xl border border-primary/40 bg-primary/8 p-3 text-xs"
    >
      <div className="flex items-center gap-2 font-medium">
        <CircleArrowUp className="size-4 shrink-0 text-primary" />
        Yammer {update.version} is out
      </div>
      {update.phase === "error" && (
        <p className="mt-1.5 text-[11px] text-destructive" title={update.message}>
          Couldn't update. Try again.
        </p>
      )}
      <button
        type="button"
        onClick={() => void installUpdate()}
        disabled={installing}
        className="relative mt-2.5 flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-primary px-2.5 py-1.5 font-medium text-primary-foreground shadow-sm shadow-primary/30 transition-[filter] outline-none hover:brightness-110 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:brightness-100"
      >
        {pct !== null && (
          <span aria-hidden className="absolute inset-y-0 left-0 bg-white/20 transition-[width]" style={{ width: `${pct}%` }} />
        )}
        {installing && <LoaderCircle className="relative size-3.5 animate-spin" />}
        <span className="relative">{installing ? (pct !== null ? `Updating… ${pct}%` : "Updating…") : "Upgrade now"}</span>
      </button>
    </motion.div>
  );
}

const BAR_GAIN = [0.6, 1, 0.8, 1.15, 0.7];

function LevelBars({ level }: { level: number }) {
  // The same curve Sushi bounces to.
  const v = Math.min(1, Math.sqrt(level) * 2.4);
  return (
    <span aria-hidden className="ml-auto flex h-3 items-center gap-0.5">
      {BAR_GAIN.map((g, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full bg-primary transition-[height] duration-75"
          style={{ height: `${Math.max(18, Math.min(100, v * g * 100))}%` }}
        />
      ))}
    </span>
  );
}
