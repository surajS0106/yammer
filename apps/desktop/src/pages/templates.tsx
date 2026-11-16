// Teach → Templates: how meeting notes are laid out. Yammer's own templates
// (settings::built_in_templates, kept in code) can be picked or copied; the
// user's own (settings.meeting.templates) can also be edited and deleted.
// The one picked here is what every meeting is written with, unless a
// meeting picks another from its Notes tab.

import { Check, Copy, PencilSimple as Pencil, Plus, Trash as Trash2, UsersThree as Users } from "@phosphor-icons/react";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { Collapse } from "@/components/motion";
import { NigiriCard, NigiriChips } from "@/components/nigiri-card";
import { Badge, Button, Card, Input, Intro, Notice, Sheet, SheetAction, Textarea } from "@/components/ui";
import { useDockAction } from "@/lib/dock";
import { useNoteTemplates } from "@/lib/meetings";
import { useSettings } from "@/lib/settings";
import type { NoteTemplate } from "@/lib/tauri";
import { cn, isAndroid } from "@/lib/utils";

const blank = (): NoteTemplate => ({ id: `own-${Date.now()}`, name: "", instructions: "" });

function Editor({ initial, onSave, onCancel }: { initial: NoteTemplate; onSave: (t: NoteTemplate) => void; onCancel: () => void }) {
  const [name, setName] = React.useState(initial.name);
  const [instructions, setInstructions] = React.useState(initial.instructions);
  const valid = name.trim() && instructions.trim();
  return (
    <form
      className="space-y-2.5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ id: initial.id, name: name.trim(), instructions: instructions.trim() });
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium">Name</span>
        <Input autoFocus placeholder="Sprint planning" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">How the notes should be laid out</span>
        <Textarea
          rows={5}
          placeholder="“## Goal (one sentence), ## Stories committed with their owners, ## Risks, then ## Action items as a checklist. Keep it under a page.”"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <span className="block text-xs text-muted-foreground">Name the headings and say what goes under each, the way you'd brief a colleague taking notes for you.</span>
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid}>
          Save template
        </Button>
      </div>
    </form>
  );
}

export function TemplatesPage({ go }: { go: (page: PageId) => void }) {
  const { settings, update } = useSettings();
  const own = settings.meeting.templates;
  const all = useNoteTemplates(own);
  const chosen = settings.meeting.summary;
  const current = all.find((t) => t.id === chosen);
  /** The id being edited, "new", or a template being copied (its id). */
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<NoteTemplate>(blank);

  const setMeeting = (change: Partial<typeof settings.meeting>) => update((s) => ({ ...s, meeting: { ...s.meeting, ...change } }));
  const startNew = (from?: NoteTemplate) => {
    setDraft(from ? { id: `own-${Date.now()}`, name: `${from.name} (mine)`, instructions: from.instructions } : blank());
    setEditing("new");
  };
  const save = async (t: NoteTemplate) => {
    const exists = own.some((x) => x.id === t.id);
    const templates = exists ? own.map((x) => (x.id === t.id ? t : x)) : [...own, t];
    if (await setMeeting({ templates })) setEditing(null);
  };
  // Deleting the template in use falls back to Minutes, as Rust does for one it can't find.
  const remove = (id: string) => void setMeeting({ templates: own.filter((t) => t.id !== id), ...(chosen === id ? { summary: "minutes" } : {}) });
  const choose = (id: string) => void setMeeting({ summary: id });
  useDockAction({ label: "Add a template", icon: Plus, run: () => startNew() });
  const editingOwn = own.find((t) => t.id === editing);

  return (
    <div className="space-y-6">
      {!isAndroid && (
        <div className="flex items-start justify-between gap-4">
          <PageHeader title="Templates" />
          <Button onClick={() => startNew()}>
            <Plus /> Add new
          </Button>
        </div>
      )}

      {!isAndroid && (
        <Intro title="Meeting notes, laid out the way you need them">
          When a meeting ends, Yammer writes its notes from the transcript and whatever you typed. A template decides their shape: minutes, a stand-up, a
          customer call. Pick the one every meeting uses here, or switch a single meeting from its Notes tab.
        </Intro>
      )}

      <NigiriCard
        label="Templates"
        value={all.length}
        caption={all.length === 1 ? "way to write up a meeting" : "ways to write up a meeting"}
        bandLabel="The one in use is lit"
        band={<NigiriChips items={all.map((t) => t.name)} highlight={current?.name} empty="Templates show up here." />}
        stats={[
          { value: all.filter((t) => t.builtIn).length, label: "built in", hint: "ready to use" },
          { value: own.filter((t) => t.instructions.trim()).length, label: "made by you", hint: "your own layouts", color: "nori" },
        ]}
        footer={current ? `Meetings are written up as ${current.name}.` : "Meetings are written up as Minutes."}
      />

      <Collapse show={!settings.cleanup.model.trim()}>
        <Notice tone="warn">
          Notes are written by your AI cleanup model, which isn't set up.{" "}
          <button type="button" className="font-medium underline" onClick={() => go("cleanup")}>
            Set up AI cleanup
          </button>
        </Notice>
      </Collapse>

      {isAndroid && (
        <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New template" : "Edit template"}>
          {editing !== null && (
            <>
              <Editor key={editing} initial={editingOwn ?? draft} onSave={(t) => void save(t)} onCancel={() => setEditing(null)} />
              {editingOwn && (
                <SheetAction
                  icon={Trash2}
                  label="Delete template"
                  danger
                  onClick={() => {
                    setEditing(null);
                    remove(editingOwn.id);
                  }}
                />
              )}
            </>
          )}
        </Sheet>
      )}

      <Collapse show={!isAndroid && editing === "new"}>
        <Card>
          <Editor key={draft.id} initial={draft} onSave={(t) => void save(t)} onCancel={() => setEditing(null)} />
        </Card>
      </Collapse>

      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-sm font-semibold">Write meeting notes as</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Used for every meeting unless you pick another one on the meeting itself.</p>
        </div>
        <div className="grid gap-3 @2xl:grid-cols-2" role="radiogroup" aria-label="Template for meeting notes">
          {all.map((t) =>
            editing === t.id && !isAndroid && !t.builtIn ? (
              <Card key={t.id} className="@2xl:col-span-2">
                <Editor initial={t} onSave={(next) => void save(next)} onCancel={() => setEditing(null)} />
              </Card>
            ) : (
              <TemplateCard
                key={t.id}
                template={t}
                checked={chosen === t.id}
                onSelect={() => choose(t.id)}
                actions={
                  t.builtIn ? (
                    <Button size="icon" variant="ghost" title="Copy to make your own" aria-label={`Copy ${t.name}`} onClick={() => startNew(t)}>
                      <Copy />
                    </Button>
                  ) : (
                    <>
                      <Button size="icon" variant="ghost" title="Edit" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t.id)}>
                        <Pencil />
                      </Button>
                      {!isAndroid && (
                        <Button size="icon" variant="ghost" title="Delete" aria-label={`Delete ${t.name}`} onClick={() => remove(t.id)}>
                          <Trash2 />
                        </Button>
                      )}
                    </>
                  )
                }
              />
            ),
          )}
        </div>
      </section>

      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Users className="size-3.5" /> Built-in templates can't be changed, but you can copy one and make it your own.
      </p>
    </div>
  );
}

/** The note's sections, from the template's "## Heading" mentions: the shape of the notes at a glance. */
function sectionsOf(instructions: string): string[] {
  const names = [...instructions.matchAll(/"##\s+([^"#][^"]*)"/g)].map((m) => m[1].trim()).filter(Boolean);
  return [...new Set(names)];
}

function TemplateCard({ template: t, checked, onSelect, actions }: { template: NoteTemplate; checked: boolean; onSelect: () => void; actions: React.ReactNode }) {
  const sections = sectionsOf(t.instructions);
  // Yammer's own say what they're for; yours show the start of what you wrote.
  const about = t.description || t.instructions;
  return (
    <div
      className={cn(
        "group relative flex rounded-xl border bg-card transition-colors",
        checked ? "border-primary/60 bg-primary/[0.04] ring-2 ring-primary/15" : "hover:border-primary/30",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-xl p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2 pr-16">
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border",
              checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
            )}
          >
            {checked && <Check className="size-3" weight="bold" />}
          </span>
          <span className="truncate text-sm font-semibold">{t.name}</span>
          {checked && <Badge tone="brand">In use</Badge>}
          {!t.builtIn && <Badge>Yours</Badge>}
        </span>
        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{about}</span>
        {sections.length > 0 && (
          <span className="flex flex-wrap gap-1" aria-label={`Sections: ${sections.join(", ")}`}>
            {sections.map((name) => (
              <span key={name} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {name}
              </span>
            ))}
          </span>
        )}
      </button>
      <div className="absolute top-2 right-2 flex transition-opacity pointer-fine:opacity-0 group-hover:opacity-100 focus-within:opacity-100">{actions}</div>
    </div>
  );
}
