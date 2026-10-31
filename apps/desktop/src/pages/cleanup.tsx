import { KeyField } from "@/components/key-field";
import { ProviderLogo } from "@/components/provider-logo";
import { HeroChip, SettingsHero } from "@/components/settings-hero";
import { Card, CommitInput, Notice, Row, Section, Select, Switch } from "@/components/ui";
import { cleanupPresets, providerLabel } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import type { Cleanup, LlmFormat } from "@/lib/tauri";

export function CleanupPage() {
  const { settings, update, secrets } = useSettings();
  const cleanup = settings.cleanup;
  const preset = cleanupPresets.find((p) => p.id === cleanup.preset) ?? cleanupPresets[cleanupPresets.length - 1];
  const set = (change: Partial<Cleanup>) => update((s) => ({ ...s, cleanup: { ...s.cleanup, ...change } }));

  const choosePreset = (id: string) => {
    const p = cleanupPresets.find((x) => x.id === id)!;
    void set({ preset: p.id, baseUrl: p.baseUrl, model: p.model, format: p.format });
  };

  return (
    <div className="space-y-6">
      <SettingsHero
        title="AI cleanup"
        description="Have a language model tidy each transcript before it’s pasted. Adds a moment and sends the text (not the audio) to the model."
        mood={cleanup.enabled ? "polishing" : "idle"}
      >
        <HeroChip>
          {cleanup.enabled ? (
            <>
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <ProviderLogo id={cleanup.preset} tile={false} className="size-3.5 text-foreground" />
              <span className="truncate">{providerLabel(cleanup.preset, cleanup.model)}</span>
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-muted-foreground/50" />
              Cleanup is off
            </>
          )}
        </HeroChip>
      </SettingsHero>

      <Card className="grid divide-y text-sm @md:grid-cols-2 @md:divide-x @md:divide-y-0">
        <div className="p-4">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">You say</div>
          <p className="leading-relaxed">“um so let’s meet at 3, no wait, scratch that, 4pm on uh Thursday”</p>
        </div>
        <div className="p-4">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">It pastes</div>
          <p className="leading-relaxed">So let’s meet at 4 pm on Thursday.</p>
        </div>
      </Card>

      <Section>
        <Row label="Clean up transcripts" description="If the model fails or times out, the raw transcript is pasted instead.">
          <Switch checked={cleanup.enabled} onChange={(enabled) => void set({ enabled })} label="Clean up transcripts" />
        </Row>
      </Section>

      <Section title="Model">
        <Row label="Provider">
          <Select
            className="w-64"
            label="Provider"
            value={preset.id}
            onChange={choosePreset}
            options={cleanupPresets.map((p) => ({ value: p.id, label: p.label, icon: <ProviderLogo id={p.id} /> }))}
          />
        </Row>
        <Row label="Model">
          <CommitInput className="w-60" list="cleanup-models" value={cleanup.model} onCommit={(model) => void set({ model })} />
          <datalist id="cleanup-models">
            {preset.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Row>
        {(preset.id === "custom" || preset.id === "ollama") && (
          <>
            <Row label="Base URL" stacked>
              <CommitInput value={cleanup.baseUrl} placeholder="https://api.example.com/v1" onCommit={(baseUrl) => void set({ baseUrl })} />
            </Row>
            <Row label="API format">
              <Select<LlmFormat>
                className="w-64"
                label="API format"
                value={cleanup.format}
                onChange={(format) => void set({ format })}
                options={[
                  { value: "openai-chat", label: "OpenAI chat completions" },
                  { value: "anthropic-messages", label: "Anthropic messages" },
                ]}
              />
            </Row>
          </>
        )}
        {preset.needsKey && (
          <Row label="API key" stacked>
            <KeyField name="cleanup" keyUrl={preset.keyUrl} />
          </Row>
        )}
      </Section>

      {cleanup.enabled && preset.needsKey && !secrets.cleanup && <Notice tone="warn">Add an API key above, or cleanup will fail and paste the raw text.</Notice>}

      <Section title="Your rules" description="Added to the cleanup instructions. Example: “Use British spelling. Never use exclamation marks.”">
        <div className="p-3">
          <CommitInput multiline rows={3} placeholder="Optional" value={cleanup.instructions} onCommit={(instructions) => void set({ instructions })} />
        </div>
      </Section>
    </div>
  );
}
