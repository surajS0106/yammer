import { Cloud, Cpu, Download, Trash2 } from "lucide-react";
import type * as React from "react";

import type { PageId } from "@/App";
import { KeyField } from "@/components/key-field";
import { ProviderLogo } from "@/components/provider-logo";
import { SettingsHero } from "@/components/settings-hero";
import { Badge, Button, CommitInput, Notice, Progress, Row, Section, Select } from "@/components/ui";
import { parseWords } from "@/pages/dictionary";
import { deleteModel, downloadModel, useModels } from "@/lib/models";
import { languages, providerLabel, sttPresets } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import type { SttApi } from "@/lib/tauri";
import { cn, formatBytes } from "@/lib/utils";

function LocalModels() {
  const { settings, update } = useSettings();
  const { models, downloading, error } = useModels();

  return (
    <Section title="Model" description="Bigger models are more accurate and slower. English-only models are best for English.">
      {models.map((m) => {
        const progress = downloading[m.id];
        const selected = settings.localModel === m.id;
        return (
          <label key={m.id} className={cn("flex cursor-pointer items-center gap-3 px-4 py-3", !m.downloaded && "cursor-default")}>
            <input
              type="radio"
              name="model"
              className="accent-[var(--brand)]"
              checked={selected}
              onChange={() => void update({ localModel: m.id })}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {m.label}
                {m.id === "base.en" && <Badge tone="brand">Recommended</Badge>}
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
            {progress === undefined &&
              (m.downloaded ? (
                <Button size="icon" variant="ghost" title="Delete download" onClick={(e) => (e.preventDefault(), void deleteModel(m.id))}>
                  <Trash2 />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  onClick={(e) => {
                    e.preventDefault();
                    void downloadModel(m.id).then((ok) => ok && update({ localModel: m.id }));
                  }}
                >
                  <Download /> Download
                </Button>
              ))}
          </label>
        );
      })}
      {error && (
        <div className="px-4 py-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Section>
  );
}

function CloudProvider() {
  const { settings, update } = useSettings();
  const cloud = settings.cloud;
  const preset = sttPresets.find((p) => p.id === cloud.preset) ?? sttPresets[sttPresets.length - 1];

  const choosePreset = (id: string) => {
    const p = sttPresets.find((x) => x.id === id)!;
    void update({ cloud: { preset: p.id, baseUrl: p.baseUrl, model: p.model, api: p.api } });
  };

  return (
    <Section title="Cloud service" description="Your audio is sent to this service for each dictation.">
      <Row label="Provider">
        <Select
          className="w-64"
          label="Provider"
          value={preset.id}
          onChange={choosePreset}
          options={sttPresets.map((p) => ({ value: p.id, label: p.label, icon: <ProviderLogo id={p.id} /> }))}
        />
      </Row>
      <Row label="Model">
        <CommitInput className="w-60" list="stt-models" value={cloud.model} onCommit={(model) => void update({ cloud: { ...cloud, model } })} />
        <datalist id="stt-models">
          {preset.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Row>
      {preset.id === "custom" || preset.id === "ollama" ? (
        <>
          <Row label="Base URL" stacked>
            <CommitInput
              value={cloud.baseUrl}
              placeholder="https://api.example.com/v1"
              onCommit={(baseUrl) => void update({ cloud: { ...cloud, baseUrl } })}
            />
          </Row>
          <Row label="API">
            <Select<SttApi>
              className="w-64"
              label="API"
              value={cloud.api}
              onChange={(api) => void update({ cloud: { ...cloud, api } })}
              options={[
                { value: "transcriptions", label: "/audio/transcriptions" },
                { value: "ollama-chat", label: "Ollama chat (audio model)" },
                { value: "sarvam", label: "Sarvam /speech-to-text" },
              ]}
            />
          </Row>
        </>
      ) : null}
      {preset.needsKey && (
        <Row label="API key" stacked>
          <KeyField name="stt" keyUrl={preset.keyUrl} />
        </Row>
      )}
    </Section>
  );
}

/** One of the two engines, as a radio card: which one dictation uses is what's selected, and each says what it would run. */
function EngineChoice({
  selected,
  icon: Icon,
  title,
  detail,
  onSelect,
  children,
}: {
  selected: boolean;
  icon: React.ElementType;
  title: string;
  detail: React.ReactNode;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-[border-color,box-shadow,background-color] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-primary bg-primary/[0.04] shadow-[0_0_0_1px_var(--brand)]" : "hover:border-foreground/20",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-primary" : "border-muted-foreground/40",
          )}
        >
          {selected && <span className="size-1.5 rounded-full bg-primary" />}
        </span>
        <Icon className={cn("size-4", selected ? "text-primary" : "text-muted-foreground")} />
        <span className="text-sm font-semibold">{title}</span>
        {selected && (
          <span className="ml-auto">
            <Badge tone="brand">In use</Badge>
          </span>
        )}
      </div>
      <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>
      <div className={cn("flex min-w-0 items-center gap-1.5 text-xs font-medium", selected ? "text-foreground" : "text-muted-foreground")}>
        {detail}
      </div>
    </button>
  );
}

export function EnginePage({ go }: { go: (page: PageId) => void }) {
  const { settings, update } = useSettings();
  const { models } = useModels();
  const englishOnly = settings.engine === "local" && !!models.find((m) => m.id === settings.localModel)?.englishOnly;

  return (
    <div className="space-y-6">
      <SettingsHero title="Speech engine" description="Where your speech becomes text: privately on this computer, or with a cloud service." mood="transcribing" />

      <div role="radiogroup" aria-label="Speech engine" className="grid gap-3 @md:grid-cols-2">
        <EngineChoice
          selected={settings.engine === "local"}
          icon={Cpu}
          title="On this computer"
          onSelect={() => void update({ engine: "local" })}
          detail={<span className="truncate">{models.find((m) => m.id === settings.localModel)?.label ?? settings.localModel}</span>}
        >
          Private and works offline.
        </EngineChoice>
        <EngineChoice
          selected={settings.engine === "cloud"}
          icon={Cloud}
          title="Cloud service"
          onSelect={() => void update({ engine: "cloud" })}
          detail={
            <>
              <ProviderLogo id={settings.cloud.preset} tile={false} className="size-3.5" />
              <span className="truncate">{providerLabel(settings.cloud.preset, settings.cloud.model)}</span>
            </>
          }
        >
          Audio is sent to your provider.
        </EngineChoice>
      </div>

      {settings.engine === "local" ? <LocalModels /> : <CloudProvider />}

      <Section title="Recognition">
        <Row label="Language" description={englishOnly ? "English-only models always transcribe English. Pick a multilingual model for other languages." : undefined}>
          <Select
            className="w-56"
            label="Language"
            disabled={englishOnly}
            value={englishOnly ? "en" : settings.language}
            onChange={(language) => void update({ language })}
            options={languages.map(([code, name]) => ({ value: code, label: name }))}
          />
        </Row>
        <Row
          label="Vocabulary"
          description={(() => {
            const n = parseWords(settings.vocabulary).length;
            return n ? `${n} word${n === 1 ? "" : "s"} from your Dictionary help the engine spell names and jargon right.` : "Add names and jargon to your Dictionary so the engine spells them right.";
          })()}
        >
          <Button size="sm" variant="ghost" onClick={() => go("dictionary")}>
            Open Dictionary
          </Button>
        </Row>
      </Section>
    </div>
  );
}
