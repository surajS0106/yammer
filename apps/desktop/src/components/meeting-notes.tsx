// A meeting's written ("Enhanced") notes: read them with ticking checkboxes,
// edit them by hand, have them changed by asking ("make it shorter"), or
// write them again with another template. The user's own notes are the
// other tab, in pages/meetings.tsx.

import { ArrowClockwise as Rewrite, ArrowUUpLeft as Undo, CircleNotch as Loader2, MagicWand, PencilSimple, Sparkle as Sparkles } from "@phosphor-icons/react";
import * as React from "react";

import type { PageId } from "@/App";
import { Composer } from "@/components/composer";
import { checks, Markdown, sections, toggleCheck } from "@/components/markdown";
import { Button, Card, EmptyState, Notice, Select, Textarea } from "@/components/ui";
import { useNoteTemplates } from "@/lib/meetings";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, type Meeting } from "@/lib/tauri";
import { cn, isAndroid } from "@/lib/utils";

export function EnhancedNotes({
  meeting,
  writing,
  canWrite,
  onChange,
  go,
  copy,
}: {
  meeting: Meeting;
  /** Its notes are being written or revised. */
  writing: boolean;
  /** There's a transcript or notes of your own to write from. */
  canWrite: boolean;
  onChange: (m: Meeting) => void;
  go: (page: PageId) => void;
  /** Copies the notes. */
  copy: React.ReactNode;
}) {
  const { settings, toast } = useSettings();
  const templates = useNoteTemplates(settings.meeting.templates);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [request, setRequest] = React.useState("");
  const [revising, setRevising] = React.useState(false);
  /** The notes before the last change asked for, until it's undone or the notes change otherwise. */
  const [before, setBefore] = React.useState<string | null>(null);
  const template = templates.find((t) => t.id === meeting.template) ?? templates.find((t) => t.id === settings.meeting.summary);

  const write = (templateId?: string) => {
    setBefore(null);
    setEditing(null);
    api.meetingSummarize(meeting.id, templateId).then(onChange, (e) => toast(errorMessage(e)));
  };
  const save = (summary: string) => {
    onChange({ ...meeting, summary });
    api.meetingUpdate(meeting.id, { summary }).catch((e) => toast(errorMessage(e)));
  };
  const revise = async () => {
    const asked = request.trim();
    if (!asked || !meeting.summary) return;
    const previous = meeting.summary;
    setRevising(true);
    try {
      onChange(await api.meetingRevise(meeting.id, asked));
      setBefore(previous);
      setRequest("");
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setRevising(false);
    }
  };

  const picker = templates.length > 0 && (
    <Select
      className="w-44 text-foreground"
      label="Template"
      title="Write the notes with another template"
      value={template?.id ?? null}
      disabled={writing}
      onChange={(id) => write(id)}
      options={templates.map((t) => ({ value: t.id, label: t.name }))}
    />
  );

  if (writing && !revising) {
    return (
      <Card className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" />
        Writing the notes with {settings.cleanup.model}
        {template ? `, as ${template.name}` : ""}…
      </Card>
    );
  }

  if (!meeting.summary) {
    return (
      <div className="space-y-3">
        {meeting.error && <Notice tone="error">{meeting.error}</Notice>}
        <EmptyState
          icon={Sparkles}
          title={meeting.error ? "The notes weren't written" : "No notes yet"}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {picker}
              <Button onClick={() => write(template?.id)} disabled={!canWrite}>
                <Sparkles /> {meeting.error ? "Try again" : "Write notes"}
              </Button>
              {meeting.error && (
                <Button variant="outline" onClick={() => go("cleanup")}>
                  AI cleanup settings
                </Button>
              )}
            </div>
          }
        >
          Your AI cleanup model turns the transcript and your own notes into notes laid out by the template you pick.
        </EmptyState>
      </div>
    );
  }

  return (
    <Card className={cn(!isAndroid && "flex min-h-0 flex-1 flex-col overflow-hidden")}>
      {/* Stays in view as long notes scroll: below it on a computer, under it on a phone, where the page scrolls. */}
      <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-t-[inherit] border-b bg-card px-4 py-2 text-xs text-muted-foreground">
        {editing !== null ? (
          <>
            <span>Markdown: ## headings, - bullets, - [ ] action items.</span>
            <span className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  save(editing);
                  setEditing(null);
                  setBefore(null);
                }}
              >
                Save
              </Button>
            </span>
          </>
        ) : (
          <>
            {picker}
            {meeting.summaryBy && <span className="hidden min-w-0 truncate @3xl:block">Written by {meeting.summaryBy}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-1">
              <Button className="text-foreground" variant="ghost" disabled={revising} onClick={() => setEditing(meeting.summary ?? "")}>
                <PencilSimple weight="bold" /> Edit
              </Button>
              <Button className="text-foreground" variant="ghost" disabled={revising} onClick={() => write(template?.id)}>
                <Rewrite weight="bold" /> Write again
              </Button>
              {copy}
            </span>
          </>
        )}
      </div>
      {editing !== null ? (
        <Textarea
          autoFocus
          className={cn("rounded-none border-0 bg-transparent p-6 font-mono text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent", isAndroid ? "min-h-80" : "min-h-0 flex-1 resize-none")}
          aria-label="Edit the notes"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
        />
      ) : (
        <Page source={meeting.summary} dimmed={revising} onToggle={(line) => save(toggleCheck(meeting.summary ?? "", line))} />
      )}

      {editing === null && (
        <div className="shrink-0 border-t bg-card p-3">
          <Composer
            label="Ask for changes to the notes"
            placeholder={revising ? "Changing the notes…" : "Ask for changes: shorter, more on pricing…"}
            sendLabel="Change the notes"
            icon={<MagicWand />}
            value={request}
            onChange={setRequest}
            busy={revising}
            onSubmit={() => void revise()}
            actions={
              before !== null &&
              !revising && (
                <Button
                  variant="ghost"
                  title="Put back the notes from before that change"
                  onClick={() => {
                    save(before);
                    setBefore(null);
                  }}
                >
                  <Undo /> Undo
                </Button>
              )
            }
          />
        </div>
      )}
    </Card>
  );
}

/** The notes at a comfortable reading width, with an outline beside them where there's room. */
function Page({ source, dimmed, onToggle }: { source: string; dimmed: boolean; onToggle: (line: number) => void }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [current, setCurrent] = React.useState(0);
  const titles = React.useMemo(() => sections(source), [source]);
  const { done, total } = React.useMemo(() => checks(source), [source]);

  // The section being read: the last whose heading has reached the top, or the very last at the end.
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = () => {
      const marks = [...el.querySelectorAll<HTMLElement>("[data-section]")];
      const top = el.getBoundingClientRect().top + 64;
      const at = marks.filter((m) => m.getBoundingClientRect().top <= top).length - 1;
      const ended = el.scrollTop > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 8;
      setCurrent(ended ? marks.length - 1 : Math.max(0, at));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    return () => el.removeEventListener("scroll", read);
  }, [source]);

  const jump = (i: number) => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.current?.querySelector(`[data-section="${i}"]`)?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  };
  const outline = !isAndroid && (titles.length > 2 || total > 0);

  return (
    <div className={cn(!isAndroid && "flex min-h-0 flex-1")}>
      <div
        ref={scroller}
        role="region"
        aria-label="Notes"
        tabIndex={isAndroid ? undefined : 0}
        className={cn(
          "min-w-0 flex-1 transition-opacity",
          isAndroid ? "p-5" : "overflow-y-auto px-6 py-8 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
          dimmed && "opacity-50",
        )}
      >
        <Markdown document className="mx-auto max-w-2xl" source={source} onToggle={dimmed ? undefined : onToggle} />
      </div>
      {outline && (
        <aside className="hidden w-60 shrink-0 space-y-6 overflow-y-auto border-l px-5 py-8 @4xl:block">
          {total > 0 && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">Action items</span>
                <span className="text-muted-foreground tabular-nums">
                  {done} of {total}
                </span>
              </div>
              <div role="progressbar" aria-label="Action items done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(done / total) * 100}%` }} />
              </div>
            </div>
          )}
          {titles.length > 2 && (
            <nav aria-label="Sections of the notes" className="space-y-2">
              <p className="text-xs font-medium">In these notes</p>
              <ul className="border-l">
                {titles.map((t, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      aria-current={i === current ? "location" : undefined}
                      onClick={() => jump(i)}
                      className={cn(
                        "-ml-px block w-full border-l-2 px-3 py-1 text-left text-[13px] leading-5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        i === current ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>
      )}
    </div>
  );
}
