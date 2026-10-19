import { BarChart3, Check, Cloud, Copy, Cpu, Download, Mic, NotebookPen, Scissors, Sparkles } from "lucide-react";
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControlsWithThen } from "motion/react";
import * as React from "react";

import { PlatformContext, type PageId } from "@/App";
import { AnimatedList, Collapse, ListRow } from "@/components/motion";
import { moodOf, Sushi } from "@/components/sushi";
import { WeekStats } from "@/components/week-stats";
import { Button, Card, Hotkey, Kbd, Notice, Progress, Textarea } from "@/components/ui";
import { downloadModel, useModels } from "@/lib/models";
import { providerLabel, sttPresets } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import { api, on, type HistoryEntry, type OverlayState } from "@/lib/tauri";
import { computeStats, dayKey, lastDays, useHistory } from "@/lib/stats";
import { cn, formatBytes } from "@/lib/utils";

const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

function dayLabel(day: number): string {
  const today = dayKey(Date.now());
  if (day === today) return "Today";
  if (day === dayKey(today - 43_200_000)) return "Yesterday";
  return dateFmt.format(day);
}

function groupByDay(entries: HistoryEntry[]): [number, HistoryEntry[]][] {
  const groups = new Map<number, HistoryEntry[]>();
  for (const e of entries) {
    const d = dayKey(e.at);
    groups.set(d, [...(groups.get(d) ?? []), e]);
  }
  return [...groups];
}

function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-3.5">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          done ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className={done ? "text-sm text-muted-foreground line-through decoration-muted-foreground/40" : "text-sm font-medium"}>{title}</div>
        {!done && children}
      </div>
    </div>
  );
}

function statusText(s: OverlayState): string | null {
  switch (s.phase) {
    case "listening":
      return "Listening…";
    case "transcribing":
      return `Transcribing with ${s.engine}…`;
    case "polishing":
      return `Polishing with ${s.model}…`;
    case "message":
      return s.text;
    default:
      return null;
  }
}

/** Sushi wanders the hero's open right side while idle, with a waddle and a lean into each walk. It stays put mid-dictation. */
function Stroll({ idle, children }: { idle: boolean; children: React.ReactNode }) {
  const area = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);

  React.useEffect(() => {
    if (!idle || reduce) return;
    let alive = true;
    let timer = 0;
    let walking: AnimationPlaybackControlsWithThen[] = [];
    const rest = (ms: number) => (timer = window.setTimeout(walk, ms));
    function walk() {
      if (!alive) return;
      // Room either side of centre, less half of Sushi and its plate.
      const half = Math.max(0, (area.current?.clientWidth ?? 0) / 2 - 72);
      const from = Math.max(-half, Math.min(half, x.get()));
      let to = (Math.random() * 2 - 1) * half;
      if (Math.abs(to - from) < 48) to = -Math.sign(from || 1) * (0.4 + Math.random() * 0.6) * half;
      const dist = Math.abs(to - from);
      if (dist < 24) return void rest(4000);
      const dir = Math.sign(to - from);
      const duration = dist / 60;
      const steps = Math.max(2, Math.round(duration / 0.3));
      walking = [
        animate(x, to, { duration, ease: "easeInOut" }),
        animate(y, [0, -3, 0], { duration: duration / steps, repeat: steps - 1, ease: "easeOut" }),
        animate(rotate, [0, 5 * dir, 5 * dir, 0], { duration, times: [0, 0.15, 0.85, 1] }),
      ];
      void walking[0].then(() => rest(5000 + Math.random() * 6000));
    }
    rest(2500 + Math.random() * 2500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      for (const a of walking) a.stop();
      animate(y, 0, { duration: 0.15 });
      animate(rotate, 0, { duration: 0.15 });
    };
  }, [idle, reduce, x, y, rotate]);

  return (
    <div ref={area} className="relative hidden h-full min-h-36 items-end justify-center pb-8 @2xl:flex">
      <motion.div style={{ x, y, rotate }} className="relative flex flex-col items-center">
        {children}
      </motion.div>
    </div>
  );
}

/** A setting beside the hero's status pill; opens its settings tab. */
function SetupChip({ icon: Icon, title, onClick, children }: { icon: React.ElementType; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-background/50 px-2.5 py-1 text-xs text-muted-foreground ring-1 ring-border transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Copies a dictation; the icon pops to a green check, and stays visible, for a moment after. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn("-my-1 group-hover:opacity-100 focus-visible:opacity-100", copied ? "text-emerald-600 dark:text-emerald-400" : "pointer-fine:opacity-0")}
      title={copied ? "Copied" : "Copy"}
      aria-label={copied ? "Copied" : "Copy"}
      onClick={() => void api.copyText(text).then(() => setCopied(true), () => {})}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "check" : "copy"}
          initial={{ scale: 0.4, opacity: 0, rotate: copied ? -45 : 0 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className="flex"
        >
          {copied ? <Check strokeWidth={2.75} /> : <Copy />}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}

/** A page link in the header, with its detail as the tooltip. */
function HeaderLink({ icon: Icon, title, detail, onClick }: { icon: React.ElementType; title: string; detail: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" title={detail} onClick={onClick} className="text-muted-foreground hover:text-foreground">
      <Icon /> {title}
    </Button>
  );
}

export function HomePage({ go }: { go: (page: PageId) => void }) {
  const { settings, update, secrets } = useSettings();
  const platform = React.useContext(PlatformContext);
  const { models, downloading, error: modelError } = useModels();
  const [status, setStatus] = React.useState<OverlayState>({ phase: "hidden" });
  const history = useHistory();
  const stats = React.useMemo(() => computeStats(history), [history]);
  const weekWords = React.useMemo(() => lastDays(7).reduce((sum, d) => sum + (stats.byDay.get(d) ?? 0), 0), [stats]);
  const recent = history.slice(0, 20);
  const [hotkeyError, setHotkeyError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.hotkeyError().then(setHotkeyError, () => {});
    const unlisten = on.dictation(setStatus);
    return () => void unlisten.then((f) => f());
  }, [settings.hotkey]);

  const model = models.find((m) => m.id === settings.localModel);
  const preset = sttPresets.find((p) => p.id === settings.cloud.preset);
  const engineReady = settings.engine === "local" ? !!model?.downloaded : !(preset?.needsKey ?? true) || secrets.stt;
  const accessibilityOk = platform?.accessibility !== false;
  const ready = engineReady && accessibilityOk && !hotkeyError;

  // Once it can work, later launches at login may stay in the tray.
  React.useEffect(() => {
    if (engineReady && !settings.onboarded) void update({ onboarded: true });
  }, [engineReady, settings.onboarded, update]);

  const progress = model ? downloading[model.id] : undefined;
  const live = statusText(status);
  const busy = status.phase === "listening" || status.phase === "transcribing" || status.phase === "polishing";
  const steps = [engineReady, ...(platform?.os === "macos" ? [accessibilityOk] : [])];
  const stepsDone = steps.filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6 @3xl:h-full @3xl:gap-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-2">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{greeting(new Date().getHours())}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {weekWords > 0 ? (
              <>
                You’ve said <span className="font-medium text-foreground tabular-nums">{weekWords.toLocaleString()}</span> words this week.
              </>
            ) : (
              "Talk into any app. Yammer types it where your cursor is."
            )}
          </p>
        </div>
        <nav className="-mr-2 flex flex-wrap gap-0.5">
          <HeaderLink icon={BarChart3} title="Insights" detail="Speed, streaks, top words" onClick={() => go("insights")} />
          <HeaderLink icon={Scissors} title="Snippets" detail="Say a trigger, paste a block" onClick={() => go("snippets")} />
          <HeaderLink icon={NotebookPen} title="Scratchpad" detail="Brain-dump, then reshape" onClick={() => go("scratchpad")} />
        </nav>
      </header>

      {/* The one loud surface on the page: how to dictate, with Sushi reacting live. */}
      <Card className="shrink-0 overflow-hidden border-primary/20 bg-primary/[0.06] dark:bg-primary/[0.08]">
        {/* Sushi has the whole right side, the pixel grid, to roam. */}
        <div className="relative grid items-center @2xl:grid-cols-[auto_1fr]">
          {/* The grid is its own masked layer: WebKit drops animated children of a masked element, which hid Sushi. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-2/3 @2xl:block"
            style={{
              backgroundImage: "radial-gradient(color-mix(in oklch, var(--foreground) 14%, transparent) 1px, transparent 1.5px)",
              backgroundSize: "10px 10px",
              maskImage: "linear-gradient(to right, transparent, black 45%)",
              WebkitMaskImage: "linear-gradient(to right, transparent, black 45%)",
            }}
          />
          <div className="relative max-w-xl space-y-4 px-5 pt-5 pb-4 @md:px-7 @md:pt-6">
            <div className="flex flex-wrap items-center gap-1.5">
            <div
              aria-live="polite"
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                busy ? "bg-primary text-primary-foreground" : "bg-background/70 text-muted-foreground ring-1 ring-border",
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", busy ? "bg-primary-foreground" : ready ? "bg-emerald-500" : "bg-amber-500")}
                style={busy ? { animation: "dot-pulse 1.2s ease-in-out infinite" } : undefined}
              />
              {live ?? (ready ? "Ready when you are" : "Finish setup to start")}
            </div>
              {/* How dictation runs, one click from changing it. */}
              <SetupChip icon={settings.engine === "local" ? Cpu : Cloud} onClick={() => go("engine")} title="Change speech engine">
                {settings.engine === "local" ? `${model?.label ?? settings.localModel} · on device` : providerLabel(settings.cloud.preset, settings.cloud.model)}
              </SetupChip>
              <SetupChip icon={Sparkles} onClick={() => go("cleanup")} title="Change AI cleanup">
                {settings.cleanup.enabled ? `Cleanup · ${providerLabel(settings.cleanup.preset, settings.cleanup.model)}` : "Cleanup off"}
              </SetupChip>
            </div>
            <h2 className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-2xl font-semibold tracking-tight @md:text-[1.75rem]">
              <span>Hold</span>
              <Hotkey accelerator={settings.hotkey} className="[&_kbd]:h-9 [&_kbd]:min-w-9 [&_kbd]:rounded-lg [&_kbd]:bg-background [&_kbd]:px-2.5 [&_kbd]:text-base [&_kbd]:shadow-xs" />
              <span>and talk.</span>
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
              Release to paste where your cursor is. <span className="text-foreground">Tap</span> once to go hands-free, again to finish.{" "}
              <Kbd className="h-5 min-w-5 text-[11px]">Esc</Kbd> cancels.
            </p>
          </div>
          {/* Sushi on its plate, strolling the pixel grid that echoes the sprite. */}
          <Stroll idle={moodOf(status) === "idle"}>
            <Sushi mood={moodOf(status)} px={4} interactive className="relative z-10 text-muted-foreground" />
            <span className="-mt-2 h-3 w-28 rounded-[50%] bg-foreground/10 dark:bg-foreground/15" />
          </Stroll>
        </div>
        {/* Focused on arrival, so the hotkey works here straight away; the coral edge says it's live. */}
        <div className="border-t border-primary/15 bg-card/70 p-3">
          <div className="flex items-start gap-2.5 rounded-lg bg-background/60 px-3 py-2 ring-1 ring-primary/30 transition-shadow focus-within:ring-2 focus-within:ring-primary/60 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_12%,transparent)]">
            <Mic className="mt-1.5 size-4 shrink-0 text-primary" />
            <Textarea
              autoFocus
              rows={1}
              aria-label="Try dictating here"
              placeholder="Try it here: hold the hotkey and say something…"
              className="min-h-8 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        </div>
      </Card>

      <Collapse show={!!hotkeyError}>
        <Notice tone="error">
          {hotkeyError}{" "}
          <button type="button" className="font-medium underline" onClick={() => go("general")}>
            Pick another hotkey
          </button>
        </Notice>
      </Collapse>

      {/* Folds away once the last step is done. */}
      <Collapse show={!ready}>
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-4 px-1">
            <h2 className="text-sm font-semibold">Finish setting up</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {stepsDone} of {steps.length} done
            </span>
          </div>
          <Card className="overflow-hidden">
            <div className="h-1 bg-muted">
              <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
            </div>
            <div className="divide-y">
              {settings.engine === "local" ? (
                <Step done={engineReady} title={`Download the speech model${model ? ` (${model.label}, ${formatBytes(model.sizeBytes)})` : ""}`}>
                  <p className="text-xs text-muted-foreground">Runs on your computer, so your voice never leaves it. One-time download.</p>
                  {progress !== undefined ? (
                    <div className="flex items-center gap-3">
                      <Progress value={progress} />
                      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{Math.round(progress * 100)}%</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => model && void downloadModel(model.id)} disabled={!model}>
                        <Download /> Download
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => go("engine")}>
                        Use a cloud service instead
                      </Button>
                    </div>
                  )}
                  {modelError && <p className="text-xs text-destructive">{modelError}</p>}
                </Step>
              ) : (
                <Step done={engineReady} title={`Add your ${preset?.label ?? "speech service"} API key`}>
                  <Button size="sm" onClick={() => go("engine")}>
                    Open speech engine settings
                  </Button>
                </Step>
              )}
              {platform?.os === "macos" && (
                <Step done={accessibilityOk} title="Allow Yammer to paste (Accessibility)">
                  <p className="text-xs text-muted-foreground">
                    macOS needs your permission before an app can press ⌘V for you. Turn on Yammer under Privacy & Security → Accessibility.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => void api.openPermissionSettings("accessibility")}>
                    Open Accessibility settings
                  </Button>
                </Step>
              )}
            </div>
          </Card>
        </section>
      </Collapse>

      {platform?.wayland && (
        <Notice tone="warn">
          <p className="font-medium">You’re on Wayland.</p>
          <p className="mt-1">
            Wayland doesn’t let apps listen for global hotkeys or press keys. Bind a system shortcut (GNOME: Settings → Keyboard → Custom
            Shortcuts) to <code className="rounded bg-muted px-1">yammer --toggle</code>.{" "}
            {platform.wtype || platform.ydotool
              ? `Pasting will use ${platform.wtype ? "wtype" : "ydotool"}.`
              : "Install wtype or ydotool for auto-paste; otherwise the text is copied and you press Ctrl+V."}
          </p>
        </Notice>
      )}

      {/* The stats card sets the row's height; Recent fills it and scrolls inside. */}
      <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_18rem] @3xl:items-stretch">
        <section className="flex min-w-0 flex-col gap-2">
          <div className="flex h-7 shrink-0 items-center justify-between px-1">
            <h2 className="text-sm font-semibold">Recent</h2>
            {recent.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => go("history")}>
                See all
              </Button>
            )}
          </div>
          {/* Out of flow, so the list's length never stretches the row. */}
          <div className="relative @3xl:flex-1">
            {recent.length > 0 ? (
              <Card className="overflow-y-auto @3xl:absolute @3xl:inset-x-0 @3xl:top-0 @3xl:max-h-full">
                {groupByDay(recent).map(([day, entries]) => (
                  <div key={day} className="border-b last:border-b-0">
                    <h3 className="bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">{dayLabel(day)}</h3>
                    <div className="divide-y">
                      <AnimatedList>
                        {entries.map((e) => (
                          <ListRow key={e.id}>
                            <div className="group flex items-start gap-3 px-4 py-3 @md:gap-4">
                              <span className="w-14 shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums @md:w-16">{timeFmt.format(e.at)}</span>
                              <p className="line-clamp-3 min-w-0 flex-1 text-sm leading-relaxed">{e.text}</p>
                              <CopyButton text={e.text} />
                            </div>
                          </ListRow>
                        ))}
                      </AnimatedList>
                    </div>
                  </div>
                ))}
              </Card>
            ) : (
              <Card className="border-dashed bg-transparent px-6 py-10 text-center @3xl:absolute @3xl:inset-0 @3xl:flex @3xl:flex-col @3xl:justify-center">
                <p className="text-sm font-medium">Nothing here yet</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Everything you dictate lands here, so you can copy it again later.
                </p>
              </Card>
            )}
          </div>
        </section>

        <aside className="@3xl:pt-9">
          <WeekStats stats={stats} onOpen={() => go("insights")} />
        </aside>
      </div>
    </div>
  );
}
