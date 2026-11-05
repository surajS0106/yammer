import { Check, PencilSimple as Pencil, Plus, Trash as Trash2, MagicWand as Wand2 } from "@phosphor-icons/react";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { isAndroid } from "@/lib/utils";
import { AnimatedList, Collapse, ListRow } from "@/components/motion";
import { NigiriCard, NigiriChips } from "@/components/nigiri-card";
import { Badge, Button, Card, Hotkey, Input, Intro, Notice, Sheet, SheetAction, Textarea } from "@/components/ui";
import { useDockAction } from "@/lib/dock";
import { useSettings } from "@/lib/settings";
import type { Transform } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function Editor({ initial, onSave, onCancel }: { initial: Transform; onSave: (t: Transform) => void; onCancel: () => void }) {
  const [name, setName] = React.useState(initial.name);
  const [instructions, setInstructions] = React.useState(initial.instructions);
  const [hotkey, setHotkey] = React.useState(initial.hotkey);
  const valid = name.trim() && instructions.trim();
  return (
    <form
      className="space-y-2.5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ ...initial, name: name.trim(), instructions: instructions.trim(), hotkey });
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
      {!isAndroid && <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs">
          <span className="font-medium">Hotkey</span>
          <span className="text-muted-foreground"> · optional. Dictates with this transform, whichever one is active.</span>
        </span>
        {/* Kept here until the transform is saved; resolving false gives the hotkeys back meanwhile. */}
        <HotkeyRecorder
          value={hotkey}
          onChange={async (h) => {
            setHotkey(h);
            return false;
          }}
          onClear={() => setHotkey("")}
        />
      </div>}
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
  const current = list.find((t) => t.id === active);
  useDockAction({ label: "Add a transform", icon: Plus, run: () => setEditing("new") });
  const editingTransform = list.find((t) => t.id === editing);

  return (
    <div className="space-y-6">
      {!isAndroid && <div className="flex items-start justify-between gap-4">
        <PageHeader title="Transforms" />
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add new
        </Button>
      </div>}

      {!isAndroid && <Intro title="Say it once, get it in the right shape">
        A transform rewrites what you dictate before it’s pasted: into an email, bullet points, a formal note. Pick one to apply to every dictation, give one its
        own hotkey, or run any of them on a note in the Scratchpad.
      </Intro>}

      <NigiriCard
        label="Transforms"
        value={list.length}
        caption={list.length === 1 ? "way to reshape a dictation" : "ways to reshape a dictation"}
        bandLabel={current ? "The active one is lit" : "Yours"}
        band={<NigiriChips items={list.map((t) => t.name)} highlight={current?.name} empty="Add a transform and it shows up here." />}
        stats={[
          isAndroid
            ? { value: list.filter((t) => !t.id.startsWith("custom-")).length, label: "starters", hint: "ready to use" }
            : { value: list.filter((t) => t.hotkey).length, label: "with a hotkey", hint: "run on demand" },
          // The built-in ones have plain ids; ones made here are "custom-<time>".
          { value: list.filter((t) => t.id.startsWith("custom-")).length, label: "made by you", hint: "beyond the starters", color: "nori" },
        ]}
        footer={current ? `${current.name} reshapes every dictation.` : "Dictations paste as you said them."}
      />

      <Collapse show={!settings.cleanup.enabled}>
        <Notice tone="warn">
          Transforms run through the AI cleanup model, which is off.{" "}
          <button type="button" className="font-medium underline" onClick={() => go("cleanup")}>
            Set up AI cleanup
          </button>
        </Notice>
      </Collapse>

      {isAndroid && (
        <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New transform" : "Edit transform"}>
          {editing !== null && (
            <>
              <Editor key={editing} initial={editingTransform ?? { id: `custom-${Date.now()}`, name: "", instructions: "", hotkey: "" }} onSave={(t) => void save(t)} onCancel={() => setEditing(null)} />
              {editingTransform && (
                <SheetAction
                  icon={Trash2}
                  label="Delete transform"
                  danger
                  onClick={() => {
                    setEditing(null);
                    remove(editingTransform.id);
                  }}
                />
              )}
            </>
          )}
        </Sheet>
      )}

      <Collapse show={!isAndroid && editing === "new"}>
        <Card>
          <Editor initial={{ id: `custom-${Date.now()}`, name: "", instructions: "", hotkey: "" }} onSave={(t) => void save(t)} onCancel={() => setEditing(null)} />
        </Card>
      </Collapse>

      <section className="space-y-2">
        <div className="px-1">
          <h2 className="text-sm font-semibold">Apply to dictations</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">One at a time. It stays on until you pick another or choose None.</p>
        </div>
        <Card className="divide-y overflow-hidden" role="radiogroup" aria-label="Active transform">
          <Option checked={!active} onSelect={() => setActive("")} name="None" description="Paste what you said, cleaned up but not restyled." />
          <AnimatedList>
            {list.map((t) => (
              <ListRow key={t.id}>
                {editing === t.id && !isAndroid ? (
                  <Editor initial={t} onSave={(next) => void save(next)} onCancel={() => setEditing(null)} />
                ) : (
                  <Option
                    checked={active === t.id}
                    onSelect={() => setActive(t.id)}
                    name={t.name}
                    hotkey={t.hotkey}
                    description={t.instructions}
                    actions={
                      <>
                        <Button size="icon" variant="ghost" title="Edit" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t.id)}>
                          <Pencil />
                        </Button>
                        {!isAndroid && (
                          <Button size="icon" variant="ghost" title="Delete" onClick={() => remove(t.id)}>
                            <Trash2 />
                          </Button>
                        )}
                      </>
                    }
                  />
                )}
              </ListRow>
            ))}
          </AnimatedList>
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
  hotkey,
  description,
  actions,
}: {
  checked: boolean;
  onSelect: () => void;
  name: string;
  hotkey?: string;
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
            {hotkey && <Hotkey accelerator={hotkey} className="font-normal" />}
          </span>
          <span className="line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{description}</span>
        </span>
      </button>
      {actions && <div className="flex shrink-0 transition-opacity pointer-fine:opacity-0 group-hover:opacity-100 focus-within:opacity-100">{actions}</div>}
    </div>
  );
}
