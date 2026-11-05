import { ArrowLeft, Copy, CircleNotch as Loader2, Plus, MagnifyingGlass as Search, Trash as Trash2, ArrowUUpLeft as Undo2, MagicWand as Wand2 } from "@phosphor-icons/react";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { AnimatedList, ListRow } from "@/components/motion";
import { NigiriCard } from "@/components/nigiri-card";
import { PixelBars } from "@/components/pixel";
import { Button, Card, EmptyState, Hotkey, Input, Intro, Select, Textarea } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { dayKey, lastDays, wordCount } from "@/lib/stats";
import { api, errorMessage, type Note } from "@/lib/tauri";
import { useBackKey } from "@/lib/back";
import { useDockAction } from "@/lib/dock";
import { deviceName, isAndroid } from "@/lib/utils";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

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

let newNoteWanted = false;

/** Opens a new note the next time this page loads: Home's "+" lands in one. */
export function requestNewNote() {
  newNoteWanted = true;
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
        // On a phone focus brings up the keyboard, which would cover a note you only opened to read.
        autoFocus={!isAndroid || !note.text}
        rows={16}
        className="bg-card text-[15px]"
        placeholder={isAndroid ? "Tap Sushi and talk. Or type, or paste something to transform." : "Click here, then hold the hotkey and talk. Or type, or paste something to transform."}
        value={note.text}
        onChange={(e) => {
          setUndo(null);
          onChange(e.target.value);
        }}
      />
      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        <Wand2 className="ml-1 size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Transform</span>
        <Select
          className="w-44 min-w-0 flex-[1_1_8rem] @md:flex-none"
          label="Transform"
          align="start"
          value={transform}
          onChange={setTransform}
          options={settings.transforms.map((t) => ({ value: t.id, label: t.name }))}
        />
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

/** The notes as a nigiri: how many, which days this week they were last edited, and their words. */
function NotesCard({ notes }: { notes: Note[] }) {
  const days = lastDays(7);
  const edited = days.map((d) => notes.filter((n) => dayKey(n.updatedAt) === d).length);
  const counts = notes.map((n) => wordCount(n.text));
  return (
    <NigiriCard
      label="Scratchpad"
      value={notes.length}
      caption={`${notes.length === 1 ? "note" : "notes"}, only on this ${deviceName}`}
      bandLabel="Last edited, this week"
      band={<PixelBars values={edited} labels={days.map((d) => weekday.format(d))} titles={edited.map((n) => `${n} ${n === 1 ? "note" : "notes"}`)} stack={5} />}
      stats={[
        { value: counts.reduce((a, b) => a + b, 0), label: "words jotted", hint: "across every note" },
        { value: Math.max(0, ...counts), label: "longest note", hint: "in words", color: "nori" },
      ]}
    />
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

  const create = () => {
    const note = { id: crypto.randomUUID(), text: "", updatedAt: Date.now() };
    commit([note, ...(notes ?? [])]);
    setOpen(note.id);
  };
  const current = notes?.find((n) => n.id === open);
  useDockAction(notes && !current ? { label: "New note", icon: Plus, run: create } : null);
  const loaded = !!notes;
  React.useEffect(() => {
    if (loaded && newNoteWanted) {
      newNoteWanted = false;
      create();
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving an empty note discards it.
  const close = () => {
    commit((notes ?? []).filter((n) => n.id !== open || n.text.trim()));
    setOpen(null);
  };
  useBackKey(current ? 1 : 0, close);

  // Nothing to show until the saved notes load (a moment), so a new note can't race them.
  if (!notes) return <PageHeader title="Scratchpad" />;

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

  if (isAndroid) {
    return (
      <div className="space-y-6">
        <PageHeader title="Scratchpad" />
        {notes.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="For quick thoughts you want to come back to"
            action={
              <Button onClick={create}>
                <Plus /> Start a new note
              </Button>
            }
          >
            Drop a to-do list, polish a message, brain-dump an idea. Tap Sushi to dictate into a note, then reshape it with a transform.
          </EmptyState>
        ) : (
          <>
            <NotesCard notes={notes} />
            {notes.length > 3 && (
              <div className="relative">
                <Search className="absolute top-3 left-4 size-5 text-muted-foreground" />
                <Input className="rounded-full pl-11" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            )}
            {shown.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {shown.map((n, i) => (
                  // The newest gets the whole row, and the rest pair up beneath it.
                  <button key={n.id} type="button" onClick={() => setOpen(n.id)} className={`min-w-0 rounded-3xl border bg-card p-4 text-left outline-none active:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 ${i === 0 ? "col-span-2" : ""}`}>
                    <div className="truncate text-sm font-semibold">{titleOf(n)}</div>
                    <p className="mt-1 line-clamp-3 min-h-[3.75em] text-xs leading-relaxed text-muted-foreground">{n.text.trim().split("\n").slice(1).join(" ")}</p>
                    <div className="mt-2 truncate text-[11px] text-muted-foreground">{when.format(n.updatedAt)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon={Search} title={`Nothing matches “${query}”`} action={<Button variant="outline" onClick={() => setQuery("")}>Clear search</Button>} />
            )}
          </>
        )}
      </div>
    );
  }

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

      <NotesCard notes={notes} />

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
