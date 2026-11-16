// Settings → Meetings: how a meeting is heard, what happens when a call starts
// (calls.rs), what transcribes it live, and how its notes are written afterwards.

import { X } from "@phosphor-icons/react";

import type { PageId } from "@/App";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { KeyField } from "@/components/key-field";
import { ModelPicker } from "@/components/model-picker";
import { ProviderLogo } from "@/components/provider-logo";
import { HeroChip, SettingsHero } from "@/components/settings-hero";
import { Button, CommitInput, Notice, Row, Section, Select, Switch } from "@/components/ui";
import { hasKey, type ModelOption } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import type { CallAudio, CallDetect, LiveEngine, MeetingSettings, SummaryStyle } from "@/lib/tauri";
import { isAndroid, isMac } from "@/lib/utils";

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

const audioOptions: { value: CallAudio; label: string }[] = [
  { value: "both", label: "Your mic and the call" },
  { value: "mic", label: "Only your microphone" },
  { value: "system", label: "Only the computer's sound" },
];

const detectOptions: { value: CallDetect; label: string }[] = [
  { value: "ask", label: "Ask to transcribe it" },
  { value: "auto", label: "Transcribe it after a countdown" },
  { value: "off", label: "Do nothing" },
];

const styleOptions: { value: SummaryStyle; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "summary", label: "Brief summary" },
  { value: "action-items", label: "Action items only" },
  { value: "custom", label: "Your own format" },
];

const styleHelp: Record<SummaryStyle, string> = {
  minutes: "A summary, decisions, action items with owners, the discussion topic by topic, and open questions.",
  summary: "A paragraph, the key points, and any action items.",
  "action-items": "Just who does what by when, and what was decided.",
  custom: "Describe the layout you want below.",
};

export function MeetingSettingsPage({ go }: { go: (page: PageId) => void }) {
  const { settings, update, secrets } = useSettings();
  const m = settings.meeting;
  const set = (change: Partial<MeetingSettings>) => update((s) => ({ ...s, meeting: { ...s.meeting, ...change } }));
  const stream = m.engine === "dictation" ? null : liveEngines[m.engine];
  const model = m.model.trim() || stream?.models[0].id || "";
  const cleanupReady = !!settings.cleanup.model.trim() && (settings.cleanup.preset === "custom" || hasKey(secrets, settings.cleanup.preset, "cleanup"));

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
        <HeroChip>{isAndroid ? "Your phone's microphone" : audioOptions.find((o) => o.value === m.audio)?.label}</HeroChip>
        <HeroChip>
          {stream ? <ProviderLogo id={stream.provider} tile={false} className="size-3.5" /> : null}
          {stream ? `${stream.label} · ${model}` : "Your speech engine"}
        </HeroChip>
      </SettingsHero>

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
      <Section title="Listening">
        <Row label="Hotkey" description="Press once to start transcribing a meeting, and again to stop.">
          <HotkeyRecorder value={m.hotkey} onChange={(hotkey) => set({ hotkey })} onClear={() => void set({ hotkey: "" })} />
        </Row>
        <Row
          label="Listen to"
          description={
            <>
              Your microphone is “You” in the transcript; what the computer plays (Teams, Zoom, Meet) is “Them”. Wear headphones, or your microphone
              hears the call too and it's written down twice.
              {isMac && " macOS 14.6 or later asks once for permission to record the computer's sound."}
              {isLinux && " Hearing the computer's sound needs parec (the pulseaudio-utils package)."}
            </>
          }
        >
          <Select className="w-60" label="Listen to" value={m.audio} onChange={(audio) => void set({ audio })} options={audioOptions} />
        </Row>
      </Section>
      )}

      {!isAndroid && (
        <Section
          title="Calls"
          description="Yammer notices when another app, like Zoom, Teams or a browser on Meet, starts using your microphone, and Sushi offers to transcribe the call."
        >
          <Row
            label="When a call starts"
            description={
              <>
                {m.detect === "auto"
                  ? "Sushi counts down from 5 and starts the transcript, unless you cancel. "
                  : m.detect === "ask"
                    ? "Sushi asks whether to transcribe it. "
                    : null}
                {m.detect !== "off" && "When the call ends, the transcript stops after a 10-second countdown you can cancel."}
                {m.detect !== "off" && isMac && " Needs macOS 14.2 or later."}
              </>
            }
          >
            <Select className="w-64" label="When a call starts" value={m.detect} onChange={(detect) => void set({ detect })} options={detectOptions} />
          </Row>
          {m.ignoredApps.length > 0 && (
            <Row label="Never ask about" description="Sushi leaves calls in these apps alone. Remove one to be asked again." stacked>
              <div className="flex flex-wrap gap-1.5">
                {m.ignoredApps.map((a) => (
                  <span key={a.id} className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-xs font-medium">
                    {a.name}
                    <button
                      type="button"
                      aria-label={`Ask about ${a.name} again`}
                      title="Ask again"
                      className="grid size-5 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                      onClick={() => void set({ ignoredApps: m.ignoredApps.filter((x) => x.id !== a.id) })}
                    >
                      <X className="size-3" weight="bold" />
                    </button>
                  </span>
                ))}
              </div>
            </Row>
          )}
        </Section>
      )}

      <Section
        title="Live transcription"
        description={
          isAndroid
            ? "A streaming engine shows the words as they're said. Your speech engine writes each one down when there's a pause, a sentence or two behind."
            : "A streaming engine shows the words as they're said. Your speech engine works offline with an on-device model, a sentence or two behind."
        }
      >
        <Row label="Engine">
          <Select<LiveEngine>
            className="w-64"
            label="Engine"
            value={m.engine}
            onChange={(engine) => void set({ engine, model: "" })}
            options={[
              { value: "dictation", label: "Your speech engine" },
              ...(Object.entries(liveEngines) as [Exclude<LiveEngine, "dictation">, (typeof liveEngines)["openai-realtime"]][]).map(([value, e]) => ({
                value,
                label: e.label,
                icon: <ProviderLogo id={e.provider} />,
              })),
            ]}
          />
        </Row>
        {stream ? (
          <>
            <Row label="Model">
              <ModelPicker models={stream.models} value={model} onChange={(model) => void set({ model })} />
            </Row>
            <Row label="API key" stacked>
              <KeyField name={stream.provider} keyUrl={stream.keyUrl} page="Meetings" />
            </Row>
          </>
        ) : (
          <Row label="Transcribes with" description="Change it under Speech engine. Each pause in the conversation sends what came before it.">
            <Button size="sm" variant="ghost" onClick={() => go("engine")}>
              Speech engine
            </Button>
          </Row>
        )}
      </Section>

      <Section title="Notes" description="Written by your AI cleanup model from the transcript and anything you typed during the meeting.">
        {!cleanupReady && (
          <div className="px-4 py-3">
            <Notice tone="warn">
              Set up a model under AI cleanup to have notes written.{" "}
              <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => go("cleanup")}>
                Open AI cleanup
              </button>
            </Notice>
          </div>
        )}
        <Row label="Write notes when a meeting ends" description="Otherwise, write them from the meeting whenever you like.">
          <Switch label="Write notes when a meeting ends" checked={m.autoSummary} onChange={(autoSummary) => void set({ autoSummary })} />
        </Row>
        <Row label="Style" description={styleHelp[m.summary]}>
          <Select className="w-56" label="Style" value={m.summary} onChange={(summary) => void set({ summary })} options={styleOptions} />
        </Row>
        {m.summary === "custom" && (
          <Row label="Your format" stacked>
            <CommitInput
              multiline
              rows={4}
              value={m.summaryInstructions}
              placeholder={"“## Summary in three bullets, then ## Next steps as a checklist with owners. Keep it under 200 words.”"}
              onCommit={(summaryInstructions) => void set({ summaryInstructions })}
            />
          </Row>
        )}
      </Section>
    </div>
  );
}
