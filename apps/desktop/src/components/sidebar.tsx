import { ChartBar as BarChart3, BookOpenText as BookA, ArrowCircleUp as CircleArrowUp, Question as CircleHelp, Fire as Flame, ClockCounterClockwise as History, House as Home, CircleNotch as LoaderCircle, NotePencil as NotebookPen, Scissors, GearSix as Settings, Sparkle as Sparkles, UsersThree as Users, MagicWand as Wand2, Notebook, X } from "@phosphor-icons/react";
import { motion } from "motion/react";
import * as React from "react";

import { PlatformContext, type PageId } from "@/App";
import { HoverHighlight } from "@/components/ui/motion-highlight";
import { Hotkey } from "@/components/ui";
import { releaseOf } from "@/lib/changelog";
import { useSettings } from "@/lib/settings";
import { computeStats, dayKey, formatCompact, useHistory } from "@/lib/stats";
import { api, on, type OverlayState } from "@/lib/tauri";
import { installUpdate, useUpdate } from "@/lib/updater";
import { useMeetingStatus } from "@/lib/meetings";
import { cn, isAndroid } from "@/lib/utils";

type NavItem = { id: PageId; label: string; icon: React.ElementType };

/** Talking happens on the left of the app; teaching Yammer your words and habits on the right. */
const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "Talk",
    items: [
      { id: "home", label: "Home", icon: Home },
      { id: "scratchpad", label: "Scratchpad", icon: NotebookPen },
      { id: "meetings", label: "Meetings", icon: Users },
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
      { id: "templates", label: "Templates", icon: Notebook },
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
  const meetingLive = !!useMeetingStatus()?.live;

  const footer: (NavItem & { active: boolean })[] = [
    { id: "general", label: "Settings", icon: Settings, active: settingsActive },
    { id: "help", label: "Help", icon: CircleHelp, active: page === "help" },
  ];

  return (
    <nav className="relative isolate flex h-full w-56 flex-col border-r border-border/60 bg-background">
      {/* The same canvas as the pages, with their glow carried into the corner. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72"
        style={{
          background: "radial-gradient(120% 80% at 0% 0%, color-mix(in oklch, var(--brand) 9%, transparent), transparent 70%)",
        }}
      />

      {/* The brand stays put; only the nav below it scrolls. */}
      <div className="shrink-0 px-3 pt-3">
        {/* No native title bar: on macOS this strip sits under the traffic lights. */}
        {dragStrip && <div data-tauri-drag-region className="h-7" />}
        <div data-tauri-drag-region className="mb-2 flex h-11 items-center gap-2.5 px-2">
          {/* 28px wide from 8px in, so it sits centred over the icons below. */}
          <img src="/yammer-mark.png" alt="" className="pointer-events-none size-7" />
          <span className="pointer-events-none flex flex-col leading-none">
            <span className="text-base leading-5 font-semibold tracking-tight">Yammer</span>
            <span className="text-[11px] leading-4 text-muted-foreground">by Sush</span>
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
        {/* One hover background glides between items as the pointer moves, as in Sush's sidebar; the selected pill slides too. */}
        <HoverHighlight className="flex flex-1 flex-col" highlightClassName="rounded-lg bg-foreground/[0.04] dark:bg-foreground/[0.06]">
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
                  recording={item.id === "meetings" && meetingLive}
                />
              ))}
            </div>
          ))}

          <div className="mt-auto flex flex-col gap-2 pt-6">
            <MicCard streak={stats.dayStreak} todayWords={stats.byDay.get(today) ?? 0} onClick={() => go("home")} />
            <UpdateCard onNotes={() => go("changelog")} />
            <WhatsNewCard onOpen={() => go("changelog")} />
            <div className="flex flex-col gap-0.5">
              {footer.map((item) => (
                <NavButton key={item.id} item={item} active={item.active} onClick={() => go(item.id)} />
              ))}
            </div>
          </div>
        </HoverHighlight>
      </div>
    </nav>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1 text-xs font-medium text-muted-foreground">{children}</div>
  );
}

function NavButton({
  item: { label, icon: Icon },
  active,
  badge,
  recording,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  /** A meeting is being transcribed: a pulsing red dot. */
  recording?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      data-hover-item
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg h-9 px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={SPRING}
          className="absolute inset-0 rounded-lg bg-primary/10 dark:bg-primary/15"
        />
      )}
      <Icon
        className={cn("relative size-5 shrink-0 transition-colors", active ? "text-primary" : "group-hover:text-foreground")}
        weight={active ? "fill" : "regular"}
      />
      <span className="relative truncate">{label}</span>
      {recording && (
        <span title="Transcribing a meeting" className="relative ml-auto flex size-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative size-2 rounded-full bg-red-500" />
        </span>
      )}
      {badge !== undefined && (
        <span
          title={`${badge} today`}
          className="relative ml-auto text-xs font-normal text-muted-foreground tabular-nums"
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
    api.overlayState().then(
      (s) => setPhase(s.phase),
      () => {}
    );
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
        "relative overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.05] p-3 text-left transition-colors outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-primary/[0.08]",
        busy && "border-primary/50"
      )}
    >
      <span className="relative flex items-center gap-2 text-sm font-medium">
        <span className="relative flex size-2">
          {busy && <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60" />}
          <span className={cn("relative size-2 rounded-full", busy ? "bg-primary" : "bg-emerald-500")} />
        </span>
        {statusLabel[phase] ?? "Ready to yap"}
        {listening && <LevelBars level={level} />}
      </span>
      <span className="relative mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        Hold
        <Hotkey accelerator={settings.hotkey} className="[&_kbd]:h-5 [&_kbd]:min-w-5 [&_kbd]:bg-background [&_kbd]:px-1 [&_kbd]:text-[11px]" />
        and talk
      </span>
      <span className="relative mt-3 flex items-center justify-between border-t border-primary/15 pt-2 text-xs text-muted-foreground">
        <span className={cn("flex items-center gap-1", streak > 0 && "text-foreground")}>
          <Flame className={cn("size-3.5", streak > 0 && "text-primary")} weight={streak > 0 ? "fill" : "regular"} />
          {streak > 0 ? `${streak}-day streak` : "No streak yet"}
        </span>
        <span className="tabular-nums">{formatCompact(todayWords)} today</span>
      </span>
    </button>
  );
}

/**
 * Only there when a newer release is out: one click downloads it, installs it and relaunches Yammer.
 * On a phone (Home) it opens the APK's download instead, and Android's installer takes it from there.
 */
export function UpdateCard({ onNotes }: { onNotes: () => void }) {
  const update = useUpdate();
  if (update.phase === "idle") return null;

  const installing = update.phase === "installing";
  const pct = installing && update.progress !== null ? Math.round(update.progress * 100) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className={cn("rounded-xl border border-primary/40 bg-primary/8 p-3 text-xs", isAndroid && "rounded-3xl p-4")}
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
        className={cn(
          "relative mt-2.5 flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-primary px-2.5 py-1.5 font-medium text-primary-foreground shadow-sm shadow-primary/30 transition-[filter] outline-none hover:brightness-110 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:brightness-100",
          isAndroid && "min-h-11 rounded-xl"
        )}
      >
        {pct !== null && <span aria-hidden className="absolute inset-y-0 left-0 bg-white/20 transition-[width]" style={{ width: `${pct}%` }} />}
        {installing && <LoaderCircle className="relative size-3.5 animate-spin" />}
        <span className="relative">{installing ? (pct !== null ? `Updating… ${pct}%` : "Updating…") : "Upgrade now"}</span>
      </button>
      {isAndroid && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          It downloads in your browser. Open the download to install it, and your History, notes and keys stay as they are.
        </p>
      )}
      {update.notes.length > 0 && (
        <button
          type="button"
          onClick={onNotes}
          className={cn(
            "mt-1.5 w-full rounded-md py-0.5 text-[11px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            isAndroid && "min-h-11"
          )}
        >
          What's in it?
        </button>
      )}
    </motion.div>
  );
}

/** After an update, until the user opens "What's new" or dismisses this: what changed in the version they now have. */
export function WhatsNewCard({ onOpen }: { onOpen: () => void }) {
  const { settings, update } = useSettings();
  const version = React.useContext(PlatformContext)?.version;
  const pending = useUpdate();
  // An "Upgrade now" card already sits here; one card at a time.
  if (!version || settings.seenChangelog === version || !releaseOf(version) || pending.phase !== "idle") return null;

  // In the sidebar it's one row, in line with the nav below it.
  if (!isAndroid) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} data-hover-item className="relative flex h-9 items-center rounded-lg">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg pr-9 pl-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Sparkles className="size-5 shrink-0 text-primary" weight="fill" />
          <span className="truncate">New in {version}</span>
        </button>
        <button
          type="button"
          onClick={() => void update({ seenChangelog: version })}
          title="Dismiss"
          aria-label="Dismiss what's new"
          className="absolute right-2 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="relative rounded-xl border bg-background/80 p-3 text-xs shadow-xs dark:bg-card"
    >
      <button
        type="button"
        onClick={() => void update({ seenChangelog: version })}
        title="Dismiss"
        aria-label="Dismiss"
        className="absolute top-2 right-2 rounded-md p-0.5 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <X className="size-3.5" />
      </button>
      <div className="flex items-center gap-2 pr-5 font-medium">
        <Sparkles className="size-4 shrink-0 text-primary" />
        Updated to {version}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2.5 w-full rounded-lg border bg-background px-2.5 py-1.5 font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        See what's new
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
