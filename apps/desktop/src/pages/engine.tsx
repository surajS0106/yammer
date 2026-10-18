import { Download, Trash2 } from "lucide-react";

import { PageHeader } from "@/App";
import { KeyField } from "@/components/key-field";
import { Badge, Button, CommitInput, Notice, Progress, Row, Section, Segmented, Select } from "@/components/ui";
import { deleteModel, downloadModel, useModels } from "@/lib/models";
import { languages, sttPresets } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import type { Engine, SttApi } from "@/lib/tauri";
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
        <Select className="w-60" value={preset.id} onChange={(e) => choosePreset(e.target.value)}>
          {sttPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
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
            <Select className="w-60" value={cloud.api} onChange={(e) => void update({ cloud: { ...cloud, api: e.target.value as SttApi } })}>
              <option value="transcriptions">/audio/transcriptions</option>
              <option value="ollama-chat">Ollama chat (audio model)</option>
              <option value="sarvam">Sarvam /speech-to-text</option>
            </Select>
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

export function EnginePage() {
  const { settings, update } = useSettings();
  const { models } = useModels();
  const englishOnly = settings.engine === "local" && !!models.find((m) => m.id === settings.localModel)?.englishOnly;

  return (
    <div className="space-y-6">
      <PageHeader title="Speech engine" description="Where your speech becomes text." />

      <Segmented<Engine>
        value={settings.engine}
        onChange={(engine) => void update({ engine })}
        options={[
          { value: "local", label: "On this computer" },
          { value: "cloud", label: "Cloud service" },
        ]}
      />

      {settings.engine === "local" ? <LocalModels /> : <CloudProvider />}

      <Section title="Recognition">
        <Row label="Language" description={englishOnly ? "English-only models always transcribe English. Pick a multilingual model for other languages." : undefined}>
          <Select className="w-56" disabled={englishOnly} value={englishOnly ? "en" : settings.language} onChange={(e) => void update({ language: e.target.value })}>
            {languages.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Row>
        <Row
          label="Vocabulary"
          description="Names, product terms or jargon you say often, separated by commas. Helps the engine spell them right."
          stacked
        >
          <CommitInput
            multiline
            rows={2}
            placeholder="Sush, Tauri, Kubernetes, Priya"
            value={settings.vocabulary}
            onCommit={(vocabulary) => void update({ vocabulary })}
          />
        </Row>
      </Section>
    </div>
  );
}
