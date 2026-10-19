import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/App";
import { Collapse } from "@/components/motion";
import { Button, Card, Input, Intro, Mapping, Textarea } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import type { Snippet } from "@/lib/tauri";

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

  const q = query.trim().toLowerCase();
  const shown = list.map((s, i) => [s, i] as const).filter(([s]) => !q || s.trigger.toLowerCase().includes(q) || s.text.toLowerCase().includes(q));

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
