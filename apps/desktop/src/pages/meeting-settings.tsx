// Settings → Meetings: how a meeting is heard, what transcribes it live, how its notes are
// written afterwards, and what starts one on its own (calls.rs, the calendar).
//
// The page reads in that order. Short either-or choices are cards you can see all at once rather
// than dropdowns, and each card says what you'd get ("You" and "Them", words as they're said).

import { Cpu, Headphones, Microphone, Notebook, PencilSimple, SpeakerHigh, Warning, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import type { PageId } from "@/App";
import { CalendarSection } from "@/components/calendar-section";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { KeyField } from "@/components/key-field";
import { ModelPicker } from "@/components/model-picker";
import { Collapse, ease } from "@/components/motion";
import { ProviderLogo } from "@/components/provider-logo";
import { HeroChip, SettingsHero } from "@/components/settings-hero";
import { Button, Card, Row, Section, Segmented, Select, Switch } from "@/components/ui";
import { hasKey, sttPresets, type ModelOption } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import { useNoteTemplates } from "@/lib/meetings";
import type { CallAudio, CallDetect, LiveEngine, MeetingSettings } from "@/lib/tauri";
import { cn, isAndroid, isMac } from "@/lib/utils";

const isLinux = navigator.userAgent.includes("Linux");

/** Each streaming engine: its provider (for the key), where to get one, and its models, newest first. */
export const liveEngines: Record<Exclude<LiveEngine, "dictation">, { provider: "openai" | "sarvam"; label: string; keyUrl: string; models: ModelOption[] }> = {
  "openai-realtime": {
    provider: "openai",
    label: "OpenAI Realtime",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-live-transcribe", label: "GPT Live Transcribe — words as they're said" },
      { id: "gpt-transcribe", label: "GPT Transcribe — a sentence at a time" },
    ],
  },
  "sarvam-streaming": {
    provider: "sarvam",
    label: "Sarvam streaming",
    keyUrl: "https://dashboard.sarvam.ai/key-management",
    models: [
      { id: "saaras:v4", label: "Saaras v4" },
      { id: "saaras:v3", label: "Saaras v3" },
    ],
  },
};

const audioLabels: Record<CallAudio, string> = {
  both: "Your mic and the call",
  mic: "Only your microphone",
  system: "Only the computer's sound",
};

const detectOptions: { value: CallDetect; label: string }[] = [
  { value: "ask", label: "Ask" },
  { value: "auto", label: "Countdown" },
  { value: "off", label: "Off" },
];

/** A section's title and description, for sections whose body isn't a single card. */
function SectionHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="px-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{description}</p>}
    </div>
  );
}

interface CardOption<T> {
  value: T;
  title: string;
  icon: React.ReactNode;
  body: React.ReactNode;
}

/**
 * A row of radio cards: every option and what it does, visible at once. Arrow keys move the
 * choice like a native radio group, and only the chosen card is in the tab order.
 */
function RadioCards<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: CardOption<T>[]; onChange: (value: T) => void }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const next = (i + by + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2", options.length === 3 ? "@xl:grid-cols-3" : "@md:grid-cols-2")}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => void (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "flex flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-left shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              // Press feedback, and only the properties that change: no `transition: all`.
              "transition-[border-color,background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.98]",
              isAndroid && "rounded-3xl p-4",
              on ? "border-primary bg-primary/[0.04] shadow-[0_0_0_1px_var(--brand)]" : "hover:border-foreground/20",
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn("flex shrink-0 transition-colors duration-150", on ? "text-primary" : "text-muted-foreground")}>{o.icon}</span>
              <span className="min-w-0 flex-1 text-sm font-semibold">{o.title}</span>
              {/* The dot grows in rather than popping, and never from nothing. */}
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150",
                  on ? "border-primary" : "border-muted-foreground/35",
                )}
              >
                <span className={cn("size-1.5 rounded-full bg-primary transition-[scale,opacity] duration-150 ease-out", on ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
              </span>
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">{o.body}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A transcript channel, as it's labelled in the transcript. */
function Channel({ icon: Icon, name }: { icon: React.ElementType; name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
      <Icon className="size-3" weight="bold" />
      {name}
    </span>
  );
}

export function MeetingSettingsPage({ go }: { go: (page: PageId) => void }) {
  const { settings, update, secrets } = useSettings();
  const m = settings.meeting;
  const set = (change: Partial<MeetingSettings>) => update((s) => ({ ...s, meeting: { ...s.meeting, ...change } }));
  const stream = m.engine === "dictation" ? null : liveEngines[m.engine];
  const model = m.model.trim() || stream?.models[0].id || "";
  const templates = useNoteTemplates(m.templates);
  const template = templates.find((t) => t.id === m.summary);
  const cleanupReady = !!settings.cleanup.model.trim() && (settings.cleanup.preset === "custom" || hasKey(secrets, settings.cleanup.preset, "cleanup"));
  const local = !isAndroid && settings.engine === "local";
  const speechEngine = local ? "Whisper on this computer" : (sttPresets.find((p) => p.id === settings.cloud.preset)?.label ?? "Your cloud service");

  const engineOptions: CardOption<LiveEngine>[] = [
    {
      value: "dictation",
      title: "Speech engine",
      icon: <Cpu className="size-4" />,
      body: (
        <>
          {speechEngine}. Writes each turn when there's a pause, a sentence or two behind.{local && " Works offline."}
        </>
      ),
    },
    {
      value: "openai-realtime",
      title: liveEngines["openai-realtime"].label,
      icon: <ProviderLogo id="openai" />,
      body: "Streams the words as they're said. Uses your OpenAI key.",
    },
    {
      value: "sarvam-streaming",
      title: liveEngines["sarvam-streaming"].label,
      icon: <ProviderLogo id="sarvam" />,
      body: "Streams as they're said, built for Indian languages. Uses your Sarvam key.",
    },
  ];

  return (
    <div className="space-y-6">
      <SettingsHero
        title="Meetings"
        description={
          isAndroid
            ? "Transcribe a meeting in the room as it happens, and get notes written up when it ends."
            : "Transcribe a call as it happens, both sides of it, and get notes written up when it ends."
        }
        mood="listening"
      >
        <HeroChip>{isAndroid ? "Your phone's microphone" : audioLabels[m.audio]}</HeroChip>
        <HeroChip>
          {stream ? <ProviderLogo id={stream.provider} tile={false} className="size-3.5" /> : null}
          {stream ? `${stream.label} · ${model}` : "Your speech engine"}
        </HeroChip>
        {template && (
          <HeroChip>
            <Notebook className="size-3.5" /> {template.name}
          </HeroChip>
        )}
      </SettingsHero>

      {/* 1. How it hears. */}
      {isAndroid ? (
        <Section title="Listening">
          <Row
            label="Listens with"
            description="Your phone's microphone hears everyone in the room, you included, so the transcript can't tell people apart. Android doesn't let apps hear a call on the phone itself: for a call, use Yammer on your computer."
          >
            <span className="text-sm text-muted-foreground">Microphone</span>
          </Row>
        </Section>
      ) : (
        <section className="space-y-2">
          <SectionHeader title="Listen to" description="Each side gets its own line in the transcript, so you can tell who said what." />
          <RadioCards<CallAudio>
            label="Listen to"
            value={m.audio}
            onChange={(audio) => void set({ audio })}
            options={[
              {
                value: "both",
                title: "Both sides",
                icon: <Headphones className="size-4" />,
                body: (
                  <span className="flex flex-col gap-2">
                    Your mic and whatever Teams, Zoom or Meet plays.
                    <span className="flex flex-wrap gap-1">
                      <Channel icon={Microphone} name="You" />
                      <Channel icon={SpeakerHigh} name="Them" />
                    </span>
                  </span>
                ),
              },
              {
                value: "mic",
                title: "Only your mic",
                icon: <Microphone className="size-4" />,
                body: (
                  <span className="flex flex-col gap-2">
                    For a meeting in the room, or a call on another device.
                    <span className="flex flex-wrap gap-1">
                      <Channel icon={Microphone} name="You" />
                    </span>
                  </span>
                ),
              },
              {
                value: "system",
                title: "Only the computer",
                icon: <SpeakerHigh className="size-4" />,
                body: (
                  <span className="flex flex-col gap-2">
                    For a talk or webinar you're only listening to.
                    <span className="flex flex-wrap gap-1">
                      <Channel icon={SpeakerHigh} name="Them" />
                    </span>
                  </span>
                ),
              },
            ]}
          />
          {/* The caveats that apply to what's picked, and nothing else. */}
          <p className="px-1 text-xs leading-relaxed text-pretty text-muted-foreground">
            {m.audio === "both" && "Wear headphones: through speakers your mic hears the call too, and it's written down twice. "}
            {m.audio !== "mic" && isMac && "macOS 14.6 or later asks once for permission to record the computer's sound."}
            {m.audio !== "mic" && isLinux && "Hearing the computer's sound needs parec (the pulseaudio-utils package)."}
          </p>
        </section>
      )}

      {/* 2. How it transcribes. */}
      <section className="space-y-2">
        <SectionHeader title="Live transcription" description="What turns the meeting into text while it happens." />
        <RadioCards<LiveEngine> label="Live transcription engine" value={m.engine} onChange={(engine) => void set({ engine, model: "" })} options={engineOptions} />
        <Collapse show={!!stream} gap={0}>
          <Card className="mt-1 divide-y shadow-xs">
            {stream && (
              <>
                <Row label="Model">
                  <ModelPicker models={stream.models} value={model} onChange={(model) => void set({ model })} />
                </Row>
                <Row label="API key" stacked>
                  <KeyField name={stream.provider} keyUrl={stream.keyUrl} page="Meetings" />
                </Row>
              </>
            )}
          </Card>
        </Collapse>
        {!stream && (
          <p className="px-1 text-xs text-muted-foreground">
            Change which one under{" "}
            <button type="button" className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline" onClick={() => go("engine")}>
              Speech engine
            </button>
            .
          </p>
        )}
      </section>

      {/* 3. What it writes. */}
      <Section title="Notes" description="Written by your AI cleanup model from the transcript and anything you typed during the meeting.">
        {!cleanupReady && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-amber-500/8 px-4 py-3">
            <Warning className="size-4 shrink-0 text-amber-600 dark:text-amber-400" weight="fill" />
            <p className="min-w-0 flex-1 basis-48 text-xs leading-relaxed">No AI cleanup model is set up yet, so notes can't be written.</p>
            <Button size="sm" variant="outline" onClick={() => go("cleanup")}>
              Set up AI cleanup
            </Button>
          </div>
        )}
        <Row label="Template" description="How notes are laid out. Any meeting can be written again with another from its Notes tab.">
          <div className="flex items-center gap-1.5">
            <Select
              className="w-52"
              label="Template"
              value={m.summary}
              onChange={(summary) => void set({ summary })}
              options={templates.map((t) => ({ value: t.id, label: t.name }))}
            />
            <Button size="icon" variant="ghost" title="Edit templates" aria-label="Edit templates" onClick={() => go("templates")}>
              <PencilSimple />
            </Button>
          </div>
        </Row>
        <Row label="Write notes when a meeting ends" description="Otherwise, write them from the meeting whenever you like.">
          <Switch label="Write notes when a meeting ends" checked={m.autoSummary} onChange={(autoSummary) => void set({ autoSummary })} />
        </Row>
      </Section>

      {/* 4. What starts one. */}
      {!isAndroid && (
        <Section title="Starting a meeting" description="With a hotkey, or on its own when Zoom, Teams or a browser on Meet starts using your microphone.">
          <Row label="Hotkey" description="Press once to start transcribing, and again to stop.">
            <HotkeyRecorder value={m.hotkey} onChange={(hotkey) => set({ hotkey })} onClear={() => void set({ hotkey: "" })} />
          </Row>
          <Row
            label="When a call starts"
            description={
              <>
                {m.detect === "ask" && "Sushi asks whether to transcribe it."}
                {m.detect === "auto" && "Sushi counts down from 5 and starts, unless you cancel."}
                {m.detect === "off" && "Sushi stays out of the way. Start a meeting yourself."}
                {m.detect !== "off" && " It stops 10 seconds after the call ends, unless you cancel."}
                {m.detect !== "off" && isMac && " Needs macOS 14.2 or later."}
              </>
            }
          >
            <Segmented value={m.detect} onChange={(detect) => void set({ detect })} options={detectOptions} />
          </Row>
          <Collapse show={m.ignoredApps.length > 0} gap={0}>
            <Row label="Never ask about" description="Sushi leaves calls in these apps alone. Remove one to be asked again." stacked>
              <div className="flex flex-wrap gap-1.5">
                <AnimatePresence initial={false} mode="popLayout">
                  {m.ignoredApps.map((a) => (
                    <motion.span
                      key={a.id}
                      layout
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.15, ease }}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-xs font-medium"
                    >
                      {a.name}
                      <button
                        type="button"
                        aria-label={`Ask about ${a.name} again`}
                        title="Ask again"
                        className="grid size-5 cursor-pointer place-items-center rounded-full text-muted-foreground transition-[color,background-color,scale] duration-150 hover:bg-foreground/10 hover:text-foreground active:scale-90"
                        onClick={() => void set({ ignoredApps: m.ignoredApps.filter((x) => x.id !== a.id) })}
                      >
                        <X className="size-3" weight="bold" />
                      </button>
                    </motion.span>
                  ))}
                </AnimatePresence>
              </div>
            </Row>
          </Collapse>
        </Section>
      )}

      <CalendarSection />
    </div>
  );
}
