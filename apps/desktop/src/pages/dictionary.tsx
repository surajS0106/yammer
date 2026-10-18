import { ArrowRight, Plus, Trash2, X } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/App";
import { Button, Input, Intro, Mapping, Section } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import type { Replacement } from "@/lib/tauri";

/** The vocabulary setting is one comma- or newline-separated string. */
export function parseWords(vocabulary: string): string[] {
  const seen = new Set<string>();
  return vocabulary
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter((w) => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
}

function Words() {
  const { settings, update } = useSettings();
  const words = parseWords(settings.vocabulary);
  const [draft, setDraft] = React.useState("");
  const save = (list: string[]) => void update({ vocabulary: list.join(", ") });

  const add = () => {
    const added = parseWords(draft);
    if (!added.length) return;
    save(parseWords([...words, ...added].join(",")));
    setDraft("");
  };

  return (
    <Section title="Words" description="Names, jargon and acronyms to listen for. Larp spells them exactly as written here.">
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input placeholder="Add a word, or several separated by commas" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" disabled={!draft.trim()}>
          <Plus /> Add
        </Button>
      </form>
      {words.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 p-3">
          {words.map((w) => (
            <span key={w} className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pr-1 pl-2.5 text-sm">
              {w}
              <button
                type="button"
                title={`Remove ${w}`}
                aria-label={`Remove ${w}`}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => save(words.filter((x) => x !== w))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-muted-foreground">No words yet.</p>
      )}
    </Section>
  );
}

function Corrections() {
  const { settings, update } = useSettings();
  const list = settings.replacements;
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const save = (replacements: Replacement[]) => update((s) => ({ ...s, replacements }));

  const add = async () => {
    const f = from.trim();
    if (!f || !to.trim()) return;
    const rest = list.filter((r) => r.from.trim().toLowerCase() !== f.toLowerCase());
    if (await save([...rest, { from: f, to: to.trim() }])) {
      setFrom("");
      setTo("");
    }
  };

  return (
    <Section
      title="Corrections"
      description="When a word keeps coming out wrong, replace it every time. Matches whole words, ignoring capitals, after AI cleanup."
    >
      <form
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-3 @md:grid-cols-[1fr_auto_1fr_5rem]"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input placeholder="It hears…" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="It hears" />
        <ArrowRight className="size-4 text-muted-foreground" />
        <Input placeholder="Write it as…" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Write it as" />
        <Button type="submit" className="col-span-3 w-full @md:col-span-1" disabled={!from.trim() || !to.trim()}>
          <Plus /> Add
        </Button>
      </form>
      {list.map((r, i) => (
        <div key={`${r.from}-${i}`} className="group grid grid-cols-[1fr_auto_1fr_2rem] items-center gap-2 px-4 py-2.5 text-sm @md:grid-cols-[1fr_auto_1fr_5rem]">
          <span className="truncate text-muted-foreground">{r.from}</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="truncate font-medium">{r.to}</span>
          <Button size="icon" variant="ghost" title="Delete" className="justify-self-end pointer-fine:opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void save(list.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
    </Section>
  );
}

export function DictionaryPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Dictionary" />
      <Intro
        title="Teach Larp your words"
        example={
          <>
            <Mapping from="wisper flow" to="Wispr Flow" />
            <Mapping from="sush pack" to="sush-pack" />
          </>
        }
      >
        Add the <span className="font-medium text-foreground">names, company jargon and uncommon terms</span> you use, so they come out right in every
        dictation. They’re also passed to AI cleanup.
      </Intro>
      <Words />
      <Corrections />
    </div>
  );
}
