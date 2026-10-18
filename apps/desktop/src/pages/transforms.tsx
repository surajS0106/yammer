import { Check, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { Badge, Button, Card, Input, Intro, Notice, Textarea } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import type { Transform } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function Editor({ initial, onSave, onCancel }: { initial: Transform; onSave: (t: Transform) => void; onCancel: () => void }) {
  const [name, setName] = React.useState(initial.name);
  const [instructions, setInstructions] = React.useState(initial.instructions);
  const valid = name.trim() && instructions.trim();
  return (
    <form
      className="space-y-2.5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ ...initial, name: name.trim(), instructions: instructions.trim() });
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium">Name</span>
        <Input autoFocus placeholder="Slack update" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">Instructions for the model</span>
        <Textarea
          rows={3}
          placeholder="Rewrite as a short Slack status update: what I did, what’s next, any blockers."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid}>
          Save transform
        </Button>
      </div>
    </form>
  );
}

export function TransformsPage({ go }: { go: (page: PageId) => void }) {
  const { settings, update } = useSettings();
  const list = settings.transforms;
  const active = settings.activeTransform;
  const [editing, setEditing] = React.useState<string | null>(null);

  const save = async (t: Transform) => {
    const exists = list.some((x) => x.id === t.id);
    const transforms = exists ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t];
    if (await update((s) => ({ ...s, transforms }))) setEditing(null);
  };
  const remove = (id: string) =>
    void update((s) => ({ ...s, transforms: list.filter((x) => x.id !== id), activeTransform: s.activeTransform === id ? "" : s.activeTransform }));
  const setActive = (id: string) => void update({ activeTransform: id });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Transforms" />
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add new
        </Button>
      </div>

      <Intro title="Say it once, get it in the right shape">
        A transform rewrites what you dictate before it’s pasted: into an email, bullet points, a formal note. Pick one to apply to every dictation, or run any of
        them on a note in the Scratchpad.
      </Intro>

      {!settings.cleanup.enabled && (
        <Notice tone="warn">
          Transforms run through the AI cleanup model, which is off.{" "}
          <button type="button" className="font-medium underline" onClick={() => go("cleanup")}>
            Set up AI cleanup
          </button>
        </Notice>
      )}

      {editing === "new" && (
        <Card>
          <Editor initial={{ id: `custom-${Date.now()}`, name: "", instructions: "" }} onSave={(t) => void save(t)} onCancel={() => setEditing(null)} />
        </Card>
      )}

      <section className="space-y-2">
        <div className="px-1">
          <h2 className="text-sm font-semibold">Apply to dictations</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">One at a time. It stays on until you pick another or choose None.</p>
        </div>
        <Card className="divide-y" role="radiogroup" aria-label="Active transform">
          <Option checked={!active} onSelect={() => setActive("")} name="None" description="Paste what you said, cleaned up but not restyled." />
          {list.map((t) =>
            editing === t.id ? (
              <Editor key={t.id} initial={t} onSave={(next) => void save(next)} onCancel={() => setEditing(null)} />
            ) : (
              <Option
                key={t.id}
                checked={active === t.id}
                onSelect={() => setActive(t.id)}
                name={t.name}
                description={t.instructions}
                actions={
                  <>
                    <Button size="icon" variant="ghost" title="Edit" onClick={() => setEditing(t.id)}>
                      <Pencil />
                    </Button>
                    <Button size="icon" variant="ghost" title="Delete" onClick={() => remove(t.id)}>
                      <Trash2 />
                    </Button>
                  </>
                }
              />
            ),
          )}
        </Card>
      </section>

      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Wand2 className="size-3.5" /> To transform text you’ve already written, paste it into a Scratchpad note.
      </p>
    </div>
  );
}

function Option({
  checked,
  onSelect,
  name,
  description,
  actions,
}: {
  checked: boolean;
  onSelect: () => void;
  name: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn("group flex items-start gap-3 px-4 py-3", checked && "bg-primary/5")}>
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-md"
      >
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
            checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
          )}
        >
          {checked && <Check className="size-3" />}
        </span>
        <span className="min-w-0 space-y-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            {name}
            {checked && <Badge tone="brand">Active</Badge>}
          </span>
          <span className="line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{description}</span>
        </span>
      </button>
      {actions && <div className="flex shrink-0 transition-opacity pointer-fine:opacity-0 group-hover:opacity-100 focus-within:opacity-100">{actions}</div>}
    </div>
  );
}
