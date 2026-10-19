import { CheckCircle2, Circle, Copy, Download } from "lucide-react";
import * as React from "react";

import { PageHeader, PlatformContext, type PageId } from "@/App";
import { NavCards } from "@/components/nav-cards";
import { moodOf, Sushi } from "@/components/sushi";
import { Badge, Button, Card, Hotkey, Kbd, Notice, Progress, Row, Textarea } from "@/components/ui";
import { downloadModel, useModels } from "@/lib/models";
import { providerLabel, sttPresets } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import { api, on, type HistoryEntry, type OverlayState } from "@/lib/tauri";
import { computeStats, dayKey, formatCompact, useHistory } from "@/lib/stats";
import { formatBytes } from "@/lib/utils";

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

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-3.5">
      {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1 space-y-2">
        <div className={done ? "text-sm text-muted-foreground" : "text-sm font-medium"}>{title}</div>
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

export function HomePage({ go }: { go: (page: PageId) => void }) {
  const { settings, update, secrets } = useSettings();
  const platform = React.useContext(PlatformContext);
  const { models, downloading, error: modelError } = useModels();
  const [status, setStatus] = React.useState<OverlayState>({ phase: "hidden" });
  const history = useHistory();
  const stats = React.useMemo(() => computeStats(history), [history]);
  const recent = history.slice(0, 5);
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

  return (
    <div className="space-y-6">
      <PageHeader title="Dictate anywhere" description="Speak into any app: your words are transcribed and pasted where the cursor is." />

      {history.length > 0 && (
        <button
          type="button"
          onClick={() => go("insights")}
          title="See Insights"
          className="grid w-full grid-cols-3 divide-x rounded-xl border bg-card text-left transition-colors hover:bg-accent/40"
        >
          {[
            [formatCompact(stats.words), "total words"],
            [String(stats.wpm), "words per minute"],
            [String(stats.weekStreak), `week streak${stats.dayStreak > 1 ? ` · ${stats.dayStreak} days` : ""}`],
          ].map(([value, label]) => (
            <div key={label} className="min-w-0 px-3 py-3 @md:px-4">
              <div className="text-xl font-semibold tracking-tight tabular-nums">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </button>
      )}

      <Card className="flex flex-col items-center gap-3 px-4 pt-8 pb-6 text-center @md:px-6 @md:pt-12 @md:pb-8">
        <Sushi mood={moodOf(status)} px={3} interactive className="mb-2 text-muted-foreground" />
        <Hotkey accelerator={settings.hotkey} className="[&_kbd]:h-8 [&_kbd]:min-w-8 [&_kbd]:text-sm" />
        <p className="max-w-md text-sm text-balance">
          <span className="font-medium">Hold</span> to talk and release to paste, or <span className="font-medium">tap</span> once to start and
          again to finish.
        </p>
        <p className="text-xs text-muted-foreground">
          <Kbd>Esc</Kbd> cancels. You can also start from the tray icon.
        </p>
        <div className="min-h-5 text-xs text-primary" aria-live="polite">
          {live}
        </div>
      </Card>

      <Card className="divide-y">
        <Row
          label={
            <span className="flex items-center gap-2">
              Speech engine
              <Badge tone={settings.engine === "local" ? "muted" : "brand"}>{settings.engine === "local" ? "On this computer" : "Cloud"}</Badge>
            </span>
          }
          description={
            settings.engine === "local"
              ? `${model?.label ?? settings.localModel}. Your voice never leaves this computer.`
              : `${providerLabel(settings.cloud.preset, settings.cloud.model)}. Audio is sent to this service.`
          }
        >
          <Button size="sm" variant="ghost" onClick={() => go("engine")}>
            Change
          </Button>
        </Row>
        <Row
          label="Cleanup"
          description={settings.cleanup.enabled ? `${providerLabel(settings.cleanup.preset, settings.cleanup.model)} polishes each transcript.` : "Off. Text is pasted as transcribed."}
        >
          <Button size="sm" variant="ghost" onClick={() => go("cleanup")}>
            Change
          </Button>
        </Row>
      </Card>

      {hotkeyError && (
        <Notice tone="error">
          {hotkeyError}{" "}
          <button type="button" className="font-medium underline" onClick={() => go("general")}>
            Pick another hotkey
          </button>
        </Notice>
      )}

      {!ready && (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-semibold">Get set up</h2>
          <Card className="divide-y">
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
          </Card>
        </section>
      )}

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

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold">Try it</h2>
        <Textarea
          rows={4}
          placeholder="Click here, then hold the hotkey and say something…"
          className="bg-card"
        />
      </section>

      {recent.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold">Recent</h2>
            <Button size="sm" variant="ghost" onClick={() => go("history")}>
              See all
            </Button>
          </div>
          {groupByDay(recent).map(([day, entries]) => (
            <div key={day} className="space-y-1.5">
              <h3 className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{dayLabel(day)}</h3>
              <Card className="divide-y">
                {entries.map((e) => (
                  <div key={e.id} className="group flex items-start gap-3 px-4 py-3 @md:gap-4">
                    <span className="w-14 shrink-0 pt-0.5 text-xs @md:w-16 text-muted-foreground tabular-nums">{timeFmt.format(e.at)}</span>
                    <p className="min-w-0 flex-1 text-sm leading-relaxed">{e.text}</p>
                    <Button size="icon" variant="ghost" className="pointer-fine:opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title="Copy" onClick={() => void api.copyText(e.text)}>
                      <Copy />
                    </Button>
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold">Explore</h2>
        <NavCards
          go={go}
          cards={[
            { to: "insights", title: "See your insights", description: "Your speaking speed, streaks, and the words you use most." },
            { to: "snippets", title: "Save a snippet", description: "Say a short trigger and paste a link, an intro, or a whole prompt." },
            { to: "scratchpad", title: "Open the Scratchpad", description: "Brain-dump by voice, then reshape it with a transform." },
          ]}
        />
      </section>
    </div>
  );
}
