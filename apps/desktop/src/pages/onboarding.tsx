// First-run setup: a full-window walk through choosing a speech engine (and
// getting its API key), the macOS permissions, the hotkey, and a first
// dictation. Shown while `settings.onboarded` is false; finishing or skipping sets it.
// Each step fits the default 880×640 window without scrolling; keep it that way.

import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowRight, Check, Cloud, Cpu, Download, ExternalLink, Keyboard, Mic, MousePointerClick, PlugZap, ShieldCheck, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { PlatformContext, type PageId } from "@/App";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { KeyField } from "@/components/key-field";
import { smooth } from "@/components/motion";
import { moodOf, Sushi } from "@/components/sushi";
import { Badge, Button, Card, CommitInput, Hotkey, Kbd, Notice, Progress, Segmented, Select, Textarea } from "@/components/ui";
import { downloadModel, useModels } from "@/lib/models";
import { languages, sttPresets } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import { api, on, type Engine, type OverlayState } from "@/lib/tauri";
import { cn, formatBytes, isMac } from "@/lib/utils";

type StepId = "welcome" | "engine" | "connect" | "permissions" | "hotkey" | "try";

/** Languages Sarvam handles better than whisper; picking one recommends the cloud. */
const indianLanguages = new Set(["hi", "ta", "te", "kn", "ml", "bn", "mr"]);

/** On-device models to offer, smallest download that works well first. */
const englishModels = ["base.en", "tiny.en", "small.en"];
const multilingualModels = ["base", "small", "large-v3-turbo-q5"];

const providerBlurbs: Record<string, string> = {
  groq: "Very fast, with a free tier.",
  openai: "Pay as you go.",
  sarvam: "Built for Indian languages.",
  ollama: "Your own Ollama server, no key needed.",
  custom: "Any OpenAI-compatible speech-to-text API.",
};

/** "Sarvam AI (Indian languages)" → "Sarvam AI" */
const shortLabel = (label: string) => label.replace(/ \(.*\)$/, "");

/** Whether dictation can run now: the model is downloaded, or the cloud key is saved. */
function useEngineReady() {
  const { settings, secrets } = useSettings();
  const { models, downloading } = useModels();
  const model = models.find((m) => m.id === settings.localModel);
  const preset = sttPresets.find((p) => p.id === settings.cloud.preset);
  const ready = settings.engine === "local" ? !!model?.downloaded : !(preset?.needsKey ?? true) || secrets.stt;
  const progress = settings.engine === "local" && model ? downloading[model.id] : undefined;
  return { ready, progress };
}

export function Onboarding({ onDone }: { onDone: (page?: PageId) => void }) {
  const { settings, update } = useSettings();
  const platform = React.useContext(PlatformContext);
  const { ready, progress } = useEngineReady();
  const [index, setIndex] = React.useState(0);
  const [dir, setDir] = React.useState(1);

  const steps: StepId[] = [
    "welcome",
    "engine",
    "connect",
    ...(platform?.os === "macos" || platform?.wayland ? ["permissions" as const] : []),
    "hotkey",
    "try",
  ];
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  const finish = async (page?: PageId) => {
    if (await update({ onboarded: true })) onDone(page);
  };
  const move = (by: number) => {
    setDir(by);
    setIndex((i) => Math.max(0, Math.min(steps.length - 1, i + by)));
  };

  // Each step decides what moving on means.
  const next: { label: string; disabled?: boolean } = (() => {
    switch (step) {
      case "welcome":
        return { label: "Get started" };
      case "connect":
        if (ready) return { label: "Continue" };
        if (progress !== undefined) return { label: "Continue while it downloads" };
        return { label: "Continue", disabled: true };
      case "permissions":
        return { label: platform?.accessibility === false ? "Skip for now" : "Continue" };
      case "try":
        return { label: "Finish" };
      default:
        return { label: "Continue" };
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 px-6">
        {step !== "welcome" && (
          <div className="flex flex-1 items-center gap-1.5" aria-label={`Step ${index} of ${steps.length - 1}`}>
            {steps.slice(1).map((s, i) => (
              <span key={s} className="h-1 max-w-16 flex-1 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full bg-primary transition-[width] duration-500", i < index ? "w-full" : "w-0")} />
              </span>
            ))}
          </div>
        )}
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => void finish()}>
          Skip setup
        </Button>
      </header>

      {/* Steps sit centred in the space; a window smaller than the default scrolls instead of clipping. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="@container mx-auto flex min-h-full w-full max-w-xl flex-col px-6 py-3">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              className="my-auto"
              initial={{ opacity: 0, x: 24 * dir }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 * dir }}
              transition={smooth}
            >
              {step === "welcome" && <WelcomeStep steps={steps} />}
              {step === "engine" && <EngineStep />}
              {step === "connect" && (settings.engine === "local" ? <LocalSetup /> : <CloudSetup />)}
              {step === "permissions" && <PermissionsStep />}
              {step === "hotkey" && <HotkeyStep />}
              {step === "try" && <TryStep onCleanup={() => void finish("cleanup")} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t px-6 py-3">
        {index > 0 && (
          <Button variant="ghost" onClick={() => move(-1)}>
            <ArrowLeft /> Back
          </Button>
        )}
        {step === "connect" && next.disabled && (
          <span className="text-xs text-muted-foreground">{settings.engine === "local" ? "Download a model to continue." : "Save your API key to continue."}</span>
        )}
        <Button className="ml-auto" disabled={next.disabled} onClick={() => (last ? void finish() : move(1))}>
          {next.label} {last ? <Check /> : <ArrowRight />}
        </Button>
      </footer>
    </div>
  );
}

function StepHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      {description && <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>}
    </header>
  );
}

function WelcomeStep({ steps }: { steps: StepId[] }) {
  const coming: Record<Exclude<StepId, "welcome">, [React.ElementType, string]> = {
    engine: [Cpu, "Choose how your speech becomes text"],
    connect: [PlugZap, "Download a model or add an API key"],
    permissions: [ShieldCheck, "Let Yammer hear you and paste for you"],
    hotkey: [Keyboard, "Learn your hotkey"],
    try: [Mic, "Try your first dictation"],
  };
  return (
    <div className="flex flex-col items-center text-center">
      <Sushi mood="idle" px={4} interactive className="text-muted-foreground" />
      <span className="-mt-2 h-3 w-28 rounded-[50%] bg-foreground/10 dark:bg-foreground/15" />
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">Welcome to Yammer</h1>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground">
        Talk into any app, and Yammer types what you said where your cursor is. Setup takes about two minutes.
      </p>
      <Card className="mt-6 w-full divide-y text-left">
        {steps.slice(1).map((s, i) => {
          const [Icon, label] = coming[s as Exclude<StepId, "welcome">];
          return (
            <div key={s} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary tabular-nums">{i + 1}</span>
              <span className="flex-1">{label}</span>
              <Icon className="size-4 text-muted-foreground" />
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/** A large selectable card. */
function Choice({
  selected,
  icon: Icon,
  title,
  badge,
  onClick,
  children,
}: {
  selected: boolean;
  icon: React.ElementType;
  title: string;
  badge?: string | false;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-[border-color,box-shadow,background-color] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-primary bg-primary/[0.04] shadow-[0_0_0_1px_var(--brand)]" : "hover:border-foreground/20",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", selected ? "text-primary" : "text-muted-foreground")} />
        <span className="text-sm font-semibold">{title}</span>
        {badge && (
          <span className="ml-auto">
            <Badge tone="brand">{badge}</Badge>
          </span>
        )}
      </div>
      <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>
    </button>
  );
}

function EngineStep() {
  const { settings, update, secrets } = useSettings();
  const indian = indianLanguages.has(settings.language);

  // English-only models can't hear other languages; swap to the multilingual one of the same size.
  const setLanguage = (language: string) =>
    void update((s) => ({ ...s, language, localModel: language === "en" ? s.localModel : s.localModel.replace(/\.en$/, "") }));
  // Picking the cloud preselects the provider recommended for the language, unless a key is already saved for one.
  const chooseEngine = (engine: Engine) =>
    void update((s) => {
      if (engine === "local" || secrets.stt) return { ...s, engine };
      const p = sttPresets.find((x) => x.id === (indianLanguages.has(s.language) ? "sarvam" : "groq"))!;
      return { ...s, engine, cloud: { preset: p.id, baseUrl: p.baseUrl, model: p.model, api: p.api } };
    });

  return (
    <div>
      <StepHeader title="How should Yammer hear you?" description="Pick where your speech turns into text. You can change this later in Settings." />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label htmlFor="onboarding-language" className="text-sm font-medium">
          What language will you speak?
        </label>
        <Select id="onboarding-language" className="w-56" value={settings.language} onChange={(e) => setLanguage(e.target.value)}>
          {languages.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-3 @md:grid-cols-2">
        <Choice selected={settings.engine === "local"} icon={Cpu} title="On this computer" badge={!indian && "Recommended"} onClick={() => chooseEngine("local")}>
          Private and free: your voice never leaves your computer, and it works offline. One-time download.
        </Choice>
        <Choice selected={settings.engine === "cloud"} icon={Cloud} title="Cloud service" badge={indian && "Recommended"} onClick={() => chooseEngine("cloud")}>
          Fast on any computer{indian ? ", and much better at Indian languages" : ""}. Needs an API key from the provider.
        </Choice>
      </div>
    </div>
  );
}

function LocalSetup() {
  const { settings, update } = useSettings();
  const { models, downloading, error } = useModels();
  const ids = settings.language === "en" ? englishModels : multilingualModels;
  const offered = ids.map((id) => models.find((m) => m.id === id)).filter((m) => m !== undefined);

  return (
    <div>
      <StepHeader title="Download a speech model" description="It runs on your computer. Bigger models are more accurate but slower; more sizes are in Settings." />
      <Card className="divide-y">
        {offered.map((m, i) => {
          const progress = downloading[m.id];
          const selected = settings.localModel === m.id;
          return (
            <label key={m.id} className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <input type="radio" name="onboarding-model" className="accent-[var(--brand)]" checked={selected} onChange={() => void update({ localModel: m.id })} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {m.label}
                  {i === 0 && <Badge tone="brand">Recommended</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {m.description} {formatBytes(m.sizeBytes)}.
                </div>
                {progress !== undefined && (
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={progress} />
                    <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{Math.round(progress * 100)}%</span>
                  </div>
                )}
              </div>
              {m.downloaded ? (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <Check className="size-3.5" strokeWidth={3} /> Downloaded
                </span>
              ) : (
                progress === undefined && (
                  <Button
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    onClick={(e) => {
                      e.preventDefault();
                      void update({ localModel: m.id });
                      void downloadModel(m.id);
                    }}
                  >
                    <Download /> Download
                  </Button>
                )
              )}
            </label>
          );
        })}
      </Card>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}

function CloudSetup() {
  const { settings, update, secrets } = useSettings();
  const cloud = settings.cloud;
  const preset = sttPresets.find((p) => p.id === cloud.preset) ?? sttPresets[sttPresets.length - 1];
  const name = shortLabel(preset.label);
  const recommended = indianLanguages.has(settings.language) ? "sarvam" : "groq";

  const choose = (id: string) => {
    const p = sttPresets.find((x) => x.id === id)!;
    void update({ cloud: { preset: p.id, baseUrl: p.baseUrl, model: p.model, api: p.api } });
  };

  return (
    <div>
      <StepHeader title="Connect a cloud service" description="Your audio goes to this service for each dictation." />

      <Segmented value={preset.id} options={sttPresets.map((p) => ({ value: p.id, label: shortLabel(p.label) }))} onChange={choose} />
      <p className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
        {providerBlurbs[preset.id]}
        {preset.id === recommended && <Badge tone="brand">Recommended</Badge>}
      </p>

      {(preset.id === "custom" || preset.id === "ollama") && (
        <div className="mt-4 grid gap-3 @md:grid-cols-[3fr_2fr]">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Base URL</span>
            <CommitInput value={cloud.baseUrl} placeholder="https://api.example.com/v1" onCommit={(baseUrl) => void update({ cloud: { ...cloud, baseUrl } })} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Model</span>
            <CommitInput value={cloud.model} placeholder="whisper-1" onCommit={(model) => void update({ cloud: { ...cloud, model } })} />
          </label>
        </div>
      )}

      {preset.needsKey && (
        <Card className="mt-4 divide-y">
          <KeyStep n={1} done={secrets.stt} title={preset.keyUrl ? `Sign in to ${name}` : "Open your provider’s dashboard"} detail="Create a free account if you don’t have one.">
            {preset.keyUrl && (
              <Button size="sm" variant="outline" onClick={() => void openUrl(preset.keyUrl!)}>
                Open {name} <ExternalLink />
              </Button>
            )}
          </KeyStep>
          <KeyStep n={2} done={secrets.stt} title="Create an API key and copy it" detail="Some sites show the key only once, so copy it straight away." />
          <KeyStep n={3} done={secrets.stt} title="Paste it here" stacked>
            <KeyField name="stt" />
          </KeyStep>
        </Card>
      )}
    </div>
  );
}

/** A numbered instruction; `children` sit to the right, or below it when `stacked`. */
function KeyStep({ n, done, title, detail, stacked, children }: { n: number; done: boolean; title: string; detail?: React.ReactNode; stacked?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("flex gap-3 px-4 py-3", !stacked && "items-center")}>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center self-start rounded-full text-xs font-semibold tabular-nums transition-colors",
          done ? "bg-primary text-primary-foreground" : "bg-primary/12 text-primary",
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
        <div className="text-sm font-medium">{title}</div>
        {detail && <div className="text-xs leading-relaxed text-muted-foreground">{detail}</div>}
        {stacked && <div className="pt-2">{children}</div>}
      </div>
      {!stacked && children}
    </div>
  );
}

function PermissionsStep() {
  const platform = React.useContext(PlatformContext);

  if (platform?.wayland) {
    return (
      <div>
        <StepHeader title="One more thing for Wayland" description="Wayland doesn’t let apps listen for global hotkeys or press keys, so Yammer needs a little help." />
        <Card className="divide-y">
          <KeyStep
            n={1}
            done={false}
            title="Bind a system shortcut"
            detail={
              <>
                In your keyboard settings (GNOME: Settings → Keyboard → Custom Shortcuts), add one that runs{" "}
                <code className="rounded bg-muted px-1">yammer --toggle</code>. Press it to start dictating and again to finish.
              </>
            }
          />
          <KeyStep
            n={2}
            done={platform.wtype || platform.ydotool}
            title="Install a paste helper"
            detail={
              platform.wtype || platform.ydotool
                ? `Found ${platform.wtype ? "wtype" : "ydotool"}; Yammer will paste with it.`
                : "Install wtype or ydotool so Yammer can paste for you. Without one, the text is copied and you press Ctrl+V."
            }
          />
        </Card>
      </div>
    );
  }

  const allowed = platform?.accessibility === true;
  return (
    <div>
      <StepHeader title="Two permissions" description="macOS asks before any app can use the microphone or type for you." />
      <Card className="divide-y">
        <div className="flex gap-3 px-4 py-3.5">
          <Mic className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-sm font-medium">Microphone</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              So Yammer can hear you. macOS asks the first time you dictate, so click <span className="font-medium text-foreground">Allow</span>. If you clicked
              Don’t Allow before, turn Yammer on here.
            </p>
            <Button size="sm" variant="outline" className="mt-1.5" onClick={() => void api.openPermissionSettings("microphone")}>
              Open Microphone settings
            </Button>
          </div>
        </div>
        <div className="flex gap-3 px-4 py-3.5">
          <MousePointerClick className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              Accessibility
              {allowed ? <Badge tone="brand">Allowed</Badge> : <Badge tone="warn">Not yet</Badge>}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              So Yammer can paste for you by pressing ⌘V. Find Yammer in the list and switch it on; if it’s already on, switch it off and on again. This page
              updates when you come back.
            </p>
            {!allowed && (
              <Button size="sm" className="mt-1.5" onClick={() => void api.openPermissionSettings("accessibility")}>
                Open Accessibility settings
              </Button>
            )}
          </div>
        </div>
      </Card>
      {!allowed && <p className="mt-3 px-1 text-xs text-muted-foreground">Without Accessibility, Yammer copies what you said and you press ⌘V yourself.</p>}
    </div>
  );
}

function HotkeyStep() {
  const { settings, update } = useSettings();
  const platform = React.useContext(PlatformContext);
  const [hotkeyError, setHotkeyError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.hotkeyError().then(setHotkeyError, () => {});
  }, [settings.hotkey]);

  return (
    <div>
      <StepHeader
        title="Your dictation hotkey"
        description={platform?.wayland ? "Use the system shortcut you bound to yammer --toggle; this one only reaches X11 apps." : "It works in every app, even with this window closed."}
      />
      <Card className="flex flex-col items-center gap-4 px-6 py-6">
        <Hotkey accelerator={settings.hotkey} className="[&_kbd]:h-11 [&_kbd]:min-w-11 [&_kbd]:rounded-lg [&_kbd]:bg-background [&_kbd]:px-3 [&_kbd]:text-lg [&_kbd]:shadow-xs" />
        <HotkeyRecorder value={settings.hotkey} onChange={(hotkey) => update({ hotkey })} />
      </Card>
      {hotkeyError && (
        <div className="mt-3">
          <Notice tone="error">{hotkeyError} Click Change and pick another.</Notice>
        </div>
      )}
      <div className="mt-3 grid gap-3 @md:grid-cols-3">
        {(
          [
            ["Hold and talk", "Let go and it pastes where your cursor is."],
            ["Or tap once", "Talk hands-free, then tap again to finish."],
            [
              "Cancel",
              <>
                Press <Kbd className="h-5 min-w-5 text-[11px]">Esc</Kbd> to throw it away.
              </>,
            ],
          ] as const
        ).map(([title, detail]) => (
          <Card key={title} className="space-y-1 p-3.5">
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">{detail}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TryStep({ onCleanup }: { onCleanup: () => void }) {
  const { settings } = useSettings();
  const { ready, progress } = useEngineReady();
  const [status, setStatus] = React.useState<OverlayState>({ phase: "hidden" });
  const [heard, setHeard] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unlisten = [on.dictation(setStatus), on.historyAdded((e) => setHeard(e.text))];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, []);

  const live =
    status.phase === "listening"
      ? "Listening… let go when you’re done."
      : status.phase === "transcribing"
        ? "Turning it into text…"
        : status.phase === "polishing"
          ? "Polishing…"
          : status.phase === "message" && status.error
            ? status.text
            : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center text-center">
        <Sushi mood={heard && status.phase !== "listening" ? "done" : moodOf(status)} px={3} interactive className="text-muted-foreground" />
        <span className="-mt-1.5 h-2.5 w-20 rounded-[50%] bg-foreground/10 dark:bg-foreground/15" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{heard ? "You’re all set" : "Try it out"}</h1>
        <p className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted-foreground">
          {heard ? (
            "That’s all there is to it. It works the same in any app."
          ) : (
            <>
              Click the box below, hold <Hotkey accelerator={settings.hotkey} /> and say something.
            </>
          )}
        </p>
      </div>

      {!ready && (
        <Notice tone="warn">
          {progress !== undefined
            ? `The speech model is still downloading (${Math.round(progress * 100)}%). You can try it as soon as it finishes.`
            : "The speech engine isn’t set up yet. Go back a few steps to finish it."}
        </Notice>
      )}

      <div>
        <div className="flex items-start gap-2.5 rounded-lg bg-card px-3 py-2 ring-1 ring-primary/30 transition-shadow focus-within:ring-2 focus-within:ring-primary/60 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_12%,transparent)]">
          <Mic className="mt-1.5 size-4 shrink-0 text-primary" />
          <Textarea
            autoFocus
            rows={2}
            aria-label="Try dictating here"
            placeholder="Your words appear here…"
            className="min-h-14 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
        <p aria-live="polite" className={cn("mt-1.5 min-h-4 text-center text-xs", status.phase === "message" && status.error ? "text-destructive" : "text-muted-foreground")}>
          {live}
        </p>
      </div>

      <Card className="divide-y">
        <div className="flex items-center gap-3 px-4 py-3">
          <Keyboard className="size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Yammer keeps running in the {isMac ? "menu bar" : "tray"}</span> when you close this window, so the
            hotkey always works.
          </p>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Want tidier text?</span> AI cleanup fixes punctuation and drops “um”s.
          </p>
          <Button size="sm" variant="outline" onClick={onCleanup}>
            Set up AI cleanup
          </Button>
        </div>
      </Card>
    </div>
  );
}
