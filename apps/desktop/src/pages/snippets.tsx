import { PencilSimple as Pencil, Plus, MagnifyingGlass as Search, Trash as Trash2 } from "@phosphor-icons/react";
import * as React from "react";

import { PageHeader } from "@/App";
import { Collapse } from "@/components/motion";
import { NigiriCard, NigiriChips } from "@/components/nigiri-card";
import { Button, Card, EmptyState, Input, Intro, Mapping, Sheet, SheetAction, Textarea } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { TYPING_WPM, wordCount } from "@/lib/stats";
import type { Snippet } from "@/lib/tauri";
import { useDockAction } from "@/lib/dock";
import { isPhone } from "@/lib/utils";

function Editor({ initial, onSave, onCancel }: { initial: Snippet; onSave: (s: Snippet) => Promise<boolean>; onCancel: () => void }) {
  const [trigger, setTrigger] = React.useState(initial.trigger);
  const [text, setText] = React.useState(initial.text);
  const valid = trigger.trim() && text.trim();
  return (
    <form
      className="space-y-2.5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void onSave({ trigger: trigger.trim(), text });
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium">When you say</span>
        <Input autoFocus placeholder="my linkedin" value={trigger} onChange={(e) => setTrigger(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">Paste</span>
        <Textarea rows={3} placeholder="https://www.linkedin.com/in/your-name/" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid}>
          Save snippet
        </Button>
      </div>
    </form>
  );
}

export function SnippetsPage() {
  const { settings, update, toast } = useSettings();
  const list = settings.snippets;
  // Index being edited, "new", or null.
  const [editing, setEditing] = React.useState<number | "new" | null>(null);
  const [query, setQuery] = React.useState("");

  const save = async (snippet: Snippet, at: number | "new") => {
    const key = snippet.trigger.toLowerCase();
    if (list.some((s, i) => i !== at && s.trigger.trim().toLowerCase() === key)) {
      toast(`There’s already a snippet for “${snippet.trigger}”.`);
      return false;
    }
    const snippets = at === "new" ? [...list, snippet] : list.map((s, i) => (i === at ? snippet : s));
    const ok = await update((s) => ({ ...s, snippets }));
    if (ok) setEditing(null);
    return ok;
  };

  const words = list.reduce((n, s) => n + wordCount(s.text), 0);
  useDockAction({ label: "Add a snippet", icon: Plus, run: () => setEditing("new") });
  const q = query.trim().toLowerCase();
  const shown = list.map((s, i) => [s, i] as const).filter(([s]) => !q || s.trigger.toLowerCase().includes(q) || s.text.toLowerCase().includes(q));

  if (isPhone) {
    const remove = (at: number) => {
      setEditing(null);
      void update((st) => ({ ...st, snippets: list.filter((_, j) => j !== at) }));
    };
    return (
      <div className="space-y-6">
        {list.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="The stuff you shouldn’t have to re-type"
            action={
              <Button onClick={() => setEditing("new")}>
                <Plus /> Add your first snippet
              </Button>
            }
          >
            Save an email, intro or prompt, then say its trigger to drop it in.
          </EmptyState>
        ) : (
          <NigiriCard
            label="Snippets"
            value={list.length}
            caption={list.length === 1 ? "snippet ready to say" : "snippets ready to say"}
            band={null}
            stats={[
              { value: words, label: "words on tap", hint: "never typed again" },
              { value: Math.round(words / TYPING_WPM), label: "min of typing", hint: "to write them once", color: "nori" },
            ]}
          />
        )}
        {list.length > 3 && (
          <div className="relative">
            <Search className="absolute top-3 left-4 size-5 text-muted-foreground" />
            <Input className="rounded-full pl-11" placeholder="Search snippets" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
        {shown.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {shown.map(([s, i]) => (
              <button key={i} type="button" onClick={() => setEditing(i)} className="min-w-0 rounded-3xl border bg-card p-4 text-left outline-none active:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50">
                <div className="truncate text-sm font-semibold">“{s.trigger}”</div>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{s.text}</p>
              </button>
            ))}
          </div>
        )}
        {list.length > 0 && shown.length === 0 && <EmptyState icon={Search} title={`Nothing matches “${query}”`} action={<Button variant="outline" onClick={() => setQuery("")}>Clear search</Button>} />}
        <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New snippet" : "Edit snippet"}>
          {editing !== null && (
            <>
              <Editor key={String(editing)} initial={editing === "new" ? { trigger: "", text: "" } : list[editing]} onSave={(s) => save(s, editing)} onCancel={() => setEditing(null)} />
              {editing !== "new" && <SheetAction icon={Trash2} label="Delete snippet" danger onClick={() => remove(editing)} />}
            </>
          )}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Snippets" />
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add new
        </Button>
      </div>

      <Intro
        title="The stuff you shouldn’t have to re-type"
        example={
          <>
            <Mapping from="my linkedin" to="https://www.linkedin.com/in/…" />
            <Mapping from="intro email" to="Hey, would love to find some time to chat…" />
          </>
        }
      >
        Save text you type often, like an email, intro or prompt, then say its trigger to drop it in. Say it on its own to paste just the snippet, or mid-sentence
        to expand it in place.
      </Intro>

      <NigiriCard
        label="Snippets"
        value={list.length}
        caption={list.length === 1 ? "snippet ready to say" : "snippets ready to say"}
        bandLabel="Say"
        band={<NigiriChips items={list.map((s) => `“${s.trigger}”`)} empty="Add a snippet and its trigger shows up here." />}
        stats={[
          { value: words, label: "words on tap", hint: "never typed again" },
          { value: Math.round(words / TYPING_WPM), label: "min of typing", hint: "to write them all once", color: "nori" },
        ]}
      />

      <Collapse show={editing === "new"}>
        <Card>
          <Editor initial={{ trigger: "", text: "" }} onSave={(s) => save(s, "new")} onCancel={() => setEditing(null)} />
        </Card>
      </Collapse>

      {list.length > 3 && (
        <div className="relative">
          <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search snippets" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {shown.length > 0 && (
        <Card className="divide-y">
          {shown.map(([s, i]) =>
            editing === i ? (
              <Editor key={i} initial={s} onSave={(next) => save(next, i)} onCancel={() => setEditing(null)} />
            ) : (
              <div key={i} className="group flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm font-medium">“{s.trigger}”</div>
                  <p className="line-clamp-2 text-sm whitespace-pre-wrap text-muted-foreground">{s.text}</p>
                </div>
                <div className="flex shrink-0 transition-opacity pointer-fine:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <Button size="icon" variant="ghost" title="Edit" onClick={() => setEditing(i)}>
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Delete"
                    onClick={() => void update((st) => ({ ...st, snippets: list.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ),
          )}
        </Card>
      )}
      {list.length === 0 && editing !== "new" && <p className="px-1 text-sm text-muted-foreground">No snippets yet. Add your first one above.</p>}
      {list.length > 0 && shown.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
    </div>
  );
}
