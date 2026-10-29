import { ArrowLeft, Copy, Loader2, Plus, Search, Trash2, Undo2, Wand2 } from "lucide-react";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { AnimatedList, ListRow } from "@/components/motion";
import { Button, Card, Hotkey, Input, Intro, Select, Textarea } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, type Note } from "@/lib/tauri";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// Notes are saved by Rust as scratchpad.json beside the history, so they never
// leave the computer and survive the webview's storage being cleared. Older
// versions kept them in localStorage; those move over the first time the page opens.
const LEGACY_KEY = "yammer.scratchpad";
/** Typing saves this long after the last keystroke. */
const SAVE_DELAY_MS = 400;

function legacyNotes(): Note[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadNotes(): Promise<Note[]> {
  const saved = await api.scratchpadList();
  const legacy = legacyNotes().filter((n) => !saved.some((s) => s.id === n.id));
  if (!legacy.length) return saved;
  const merged = [...saved, ...legacy].sort((a, b) => b.updatedAt - a.updatedAt);
  await api.scratchpadSave(merged);
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
  return merged;
}

function titleOf(note: Note): string {
  return note.text.trim().split("\n")[0]?.slice(0, 80) || "Untitled";
}

function NoteEditor({ note, onChange, onDelete, onBack }: { note: Note; onChange: (text: string) => void; onDelete: () => void; onBack: () => void }) {
  const { settings, toast } = useSettings();
  const [transform, setTransform] = React.useState(settings.transforms[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const [undo, setUndo] = React.useState<string | null>(null);

  const run = async () => {
    const t = settings.transforms.find((x) => x.id === transform);
    if (!t || !note.text.trim()) return;
    setBusy(true);
    try {
      const out = await api.textRewrite(note.text, t.instructions);
      if (out.trim()) {
        setUndo(note.text);
        onChange(out);
      }
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft /> All notes
        </Button>
        <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">Edited {when.format(note.updatedAt)}</span>
        <Button size="icon" variant="ghost" title="Copy" disabled={!note.text} onClick={() => void api.copyText(note.text).then(() => toast("Copied.", "info"))}>
          <Copy />
        </Button>
        <Button size="icon" variant="ghost" title="Delete note" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      <Textarea
        autoFocus
        rows={16}
        className="bg-card text-[15px]"
        placeholder="Click here, then hold the hotkey and talk. Or type, or paste something to transform."
        value={note.text}
        onChange={(e) => {
          setUndo(null);
          onChange(e.target.value);
        }}
      />
      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        <Wand2 className="ml-1 size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Transform</span>
        <Select className="w-44 min-w-0 flex-1 @md:flex-none" value={transform} onChange={(e) => setTransform(e.target.value)} aria-label="Transform">
          {settings.transforms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => void run()} disabled={busy || !note.text.trim() || !transform}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? "Rewriting…" : "Apply"}
        </Button>
        {undo !== null && (
          <Button
            size="sm"
            variant="ghost"
            className="animate-pop-in"
            onClick={() => {
              onChange(undo);
              setUndo(null);
            }}
          >
            <Undo2 /> Undo
          </Button>
        )}
        {!settings.cleanup.enabled && <span className="text-xs text-muted-foreground">Uses your AI cleanup model.</span>}
      </Card>
    </div>
  );
}

export function ScratchpadPage({ go }: { go: (page: PageId) => void }) {
  const { settings, toast } = useSettings();
  const [notes, setNotes] = React.useState<Note[] | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    loadNotes().then(setNotes, (e) => {
      setNotes([]);
      toast(errorMessage(e));
    });
  }, [toast]);

  // Saves wait for a pause in typing; one still waiting when the page closes goes straight away.
  const pending = React.useRef<{ notes: Note[]; timer: ReturnType<typeof setTimeout> } | null>(null);
  const flush = React.useCallback(() => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    const { notes } = pending.current;
    pending.current = null;
    api.scratchpadSave(notes).catch((e) => toast(`Couldn't save your notes: ${errorMessage(e)}`));
  }, [toast]);
  React.useEffect(() => flush, [flush]);

  const commit = (next: Note[]) => {
    setNotes(next);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { notes: next, timer: setTimeout(flush, SAVE_DELAY_MS) };
  };

  // Nothing to show until the saved notes load (a moment), so a new note can't race them.
  if (!notes) return <PageHeader title="Scratchpad" />;
  const create = () => {
    const note = { id: crypto.randomUUID(), text: "", updatedAt: Date.now() };
    commit([note, ...notes]);
    setOpen(note.id);
  };
  // Leaving an empty note discards it.
  const close = () => {
    commit(notes.filter((n) => n.id !== open || n.text.trim()));
    setOpen(null);
  };

  const current = notes.find((n) => n.id === open);
  if (current) {
    return (
      <NoteEditor
        note={current}
        onBack={close}
        onDelete={() => {
          commit(notes.filter((n) => n.id !== current.id));
          setOpen(null);
        }}
        onChange={(text) => commit([{ ...current, text, updatedAt: Date.now() }, ...notes.filter((n) => n.id !== current.id)])}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const shown = q ? notes.filter((n) => n.text.toLowerCase().includes(q)) : notes;

  return (
    <div className="space-y-6">
      <PageHeader title="Scratchpad" />
      <Intro
        title="For quick thoughts you want to come back to"
        example={
          <Button size="sm" onClick={create}>
            <Plus /> Start a new note
          </Button>
        }
      >
        Drop a to-do list, polish a message before you send it, brain-dump an idea. Dictate straight into a note with <Hotkey accelerator={settings.hotkey} />,
        then reshape it with a{" "}
        <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => go("transforms")}>
          transform
        </button>
        . Notes stay on this computer.
      </Intro>

      <section className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <h2 className="shrink-0 text-sm font-semibold">Recents</h2>
          <div className="relative ml-auto w-56 min-w-0">
            <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button size="icon" variant="ghost" title="New note" onClick={create}>
            <Plus />
          </Button>
        </div>
        {shown.length > 0 ? (
          <Card className="divide-y">
            <AnimatedList>
              {shown.map((n) => (
                <ListRow key={n.id}>
                  <button type="button" className="block w-full px-4 py-3 text-left transition-colors hover:bg-accent/60" onClick={() => setOpen(n.id)}>
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{titleOf(n)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{when.format(n.updatedAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{n.text.trim().split("\n").slice(1).join(" ") || " "}</p>
                  </button>
                </ListRow>
              ))}
            </AnimatedList>
          </Card>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">{q ? `Nothing matches “${query}”.` : "No notes yet."}</p>
        )}
      </section>
    </div>
  );
}
