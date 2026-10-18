import { CheckCircle2, Circle, Copy, Download } from "lucide-react";
import * as React from "react";

import { PageHeader, PlatformContext, type PageId } from "@/App";
import { Button, Card, Hotkey, Kbd, Notice, Progress, Textarea } from "@/components/ui";
import { downloadModel, useModels } from "@/lib/models";
import { sttPresets } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import { api, on, type HistoryEntry, type OverlayState } from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";

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
      return "Transcribing…";
    case "polishing":
      return "Polishing…";
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
  const [recent, setRecent] = React.useState<HistoryEntry[]>([]);
  const [hotkeyError, setHotkeyError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.historyList().then((h) => setRecent(h.slice(0, 3)), () => {});
    api.hotkeyError().then(setHotkeyError, () => {});
    const a = on.dictation(setStatus);
    const b = on.historyAdded((e) => setRecent((r) => [e, ...r].slice(0, 3)));
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
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

      <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <Hotkey accelerator={settings.hotkey} className="[&_kbd]:h-8 [&_kbd]:min-w-8 [&_kbd]:text-sm" />
        <p className="text-sm">
          <span className="font-medium">Hold</span> to talk and release to paste, or <span className="font-medium">tap</span> once to start and
          again to finish.
        </p>
        <p className="text-xs text-muted-foreground">
          <Kbd>Esc</Kbd> cancels. You can also start from the tray icon.
        </p>
        <div className="h-5 text-xs text-primary" aria-live="polite">
          {live}
        </div>
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
                  <div className="flex gap-2">
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
              <Step done={accessibilityOk} title="Allow Sush Voice to paste (Accessibility)">
                <p className="text-xs text-muted-foreground">
                  macOS needs your permission before an app can press ⌘V for you. Turn on Sush Voice under Privacy & Security → Accessibility.
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
            Shortcuts) to <code className="rounded bg-muted px-1">sush-voice --toggle</code>.{" "}
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
          <Card className="divide-y">
            {recent.map((e) => (
              <div key={e.id} className="group flex items-start gap-3 px-4 py-3">
                <p className="min-w-0 flex-1 text-sm leading-relaxed">{e.text}</p>
                <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100" title="Copy" onClick={() => void api.copyText(e.text)}>
                  <Copy />
                </Button>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
