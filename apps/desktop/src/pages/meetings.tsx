// Meetings: start transcribing a call, watch it written down as it happens
// (you and everyone else, side by side with your own notes), and read the
// notes written from it once it ends. A phone can't hear another app's call,
// so there it transcribes the room: one microphone hearing everyone.

import {
  ArrowLeft,
  CalendarBlank,
  CaretRight,
  Clock,
  CheckSquare,
  Copy,
  DownloadSimple as Download,
  GearSix as Settings2,
  CircleNotch as Loader2,
  MagnifyingGlass,
  Notebook,
  Microphone as Mic,
  MicrophoneSlash,
  Record as RecordIcon,
  SpeakerHigh as Speaker,
  Sparkle as Sparkles,
  Stop,
  TextAlignLeft,
  Trash as Trash2,
  UsersThree as Users,
  VideoCamera,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { Markdown } from "@/components/markdown";
import { MeetingAsk } from "@/components/meeting-ask";
import { EnhancedNotes } from "@/components/meeting-notes";
import { Sushi, SushiIcon } from "@/components/sushi";
import { Badge, Button, Card, Checkbox, CommitInput, EmptyState, Hotkey, Input, Notice, Segmented, Select, Switch, Textarea } from "@/components/ui";
import { useBackKey } from "@/lib/back";
import { useDockAction } from "@/lib/dock";
import { useCalendar, useMeetingStatus, useNoteTemplates, useOpenMeetingRequest, useSushInstalled } from "@/lib/meetings";
import { useSettings } from "@/lib/settings";
import {
  api,
  errorMessage,
  on,
  eventKey,
  type CalendarEvent,
  type Meeting,
  type MeetingHit,
  type MeetingOverview,
  type MeetingStatus,
  type Segment,
  type Speaker as Who,
} from "@/lib/tauri";
import { cn, isAndroid } from "@/lib/utils";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayOf = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const timeOf = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
/** Typing in your notes saves this long after the last keystroke. */
const SAVE_DELAY_MS = 600;

/** "03:07", or "1:02:07" past an hour. Matches `meetings::clock` in Rust. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "<1 min";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

const dayWithYear = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });

/** "Today", "Yesterday", "Thursday, Nov 12", with the year once it's not this year's. */
function dayLabel(at: number): string {
  const day = new Date(at).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  if (day === today) return "Today";
  if (day === new Date(today).setDate(new Date(today).getDate() - 1)) return "Yesterday";
  return new Date(at).getFullYear() === new Date().getFullYear() ? dayOf.format(at) : dayWithYear.format(at);
}

/** Meetings in a row under one heading per day, keeping their order. */
function byDay<T extends { startedAt: number }>(items: T[]): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.startedAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function titleOf(m: { title: string; startedAt: number }): string {
  return m.title.trim() || `Meeting, ${dayOf.format(m.startedAt)} at ${timeOf.format(m.startedAt)}`;
}

const speakerName = (s: Who) => ({ you: "You", them: "Them", room: "Room" })[s];
const speakerSource = (s: Who) => ({ you: "Your microphone", them: "The computer's sound", room: "Your phone's microphone" })[s];

function SpeakerIcon({ speaker, className }: { speaker: Who; className?: string }) {
  const Icon = { you: Mic, them: Speaker, room: Users }[speaker];
  return <Icon className={className} weight="fill" />;
}

/** Ticks every second while `on`, for a running clock. */
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Each channel's level, smoothed a little so the meter doesn't flicker. */
function useLevels(active: boolean): Record<Who, number> {
  const [levels, setLevels] = React.useState<Record<Who, number>>({ you: 0, them: 0, room: 0 });
  React.useEffect(() => {
    if (!active) return;
    const unlisten = on.meetingLevel((e) => setLevels((l) => ({ ...l, [e.speaker]: l[e.speaker] * 0.4 + e.level * 0.6 })));
    return () => void unlisten.then((f) => f());
  }, [active]);
  return levels;
}

/** Add a segment, or replace the one with its id, keeping them in order of when they were said. */
function upsert(segments: Segment[], s: Segment): Segment[] {
  const i = segments.findIndex((x) => x.id === s.id);
  if (i >= 0) return segments.map((x, j) => (j === i ? s : x));
  const at = segments.findIndex((x) => x.atMs > s.atMs);
  return at < 0 ? [...segments, s] : [...segments.slice(0, at), s, ...segments.slice(at)];
}

function transcriptText(segments: Segment[]): string {
  return segments
    .filter((s) => s.text.trim())
    .map((s) => `[${clock(s.atMs)}] ${speakerName(s.speaker)}: ${s.text.trim()}`)
    .join("\n");
}

function markdownExport(m: Meeting): string {
  const out = [`# ${titleOf(m)}`, "", `${when.format(m.startedAt)}${m.endedAt ? ` · ${duration(m.endedAt - m.startedAt)}` : ""}`, ""];
  if (m.summary) out.push("## Notes", "", m.summary, "");
  if (m.notes.trim()) out.push("## Your notes", "", m.notes.trim(), "");
  if (m.chat?.length) {
    out.push("## Questions", "");
    for (const t of m.chat) out.push(t.role === "user" ? `**${t.text.trim()}**` : t.text.trim(), "");
  }
  out.push("## Transcript", "");
  for (const s of m.segments.filter((s) => s.text.trim())) out.push(`**[${clock(s.atMs)}] ${speakerName(s.speaker)}:** ${s.text.trim()}`, "");
  return out.join("\n");
}

/** A small level meter: five bars that grow with the voice. */
function Meter({ level, className }: { level: number; className?: string }) {
  const v = Math.min(1, Math.sqrt(level) * 2.4);
  return (
    <span aria-hidden className={cn("flex h-3 items-center gap-0.5", className)}>
      {[0.6, 1, 0.8, 1.15, 0.7].map((g, i) => (
        <span key={i} className="w-0.5 rounded-full bg-current transition-[height] duration-75" style={{ height: `${Math.max(18, Math.min(100, v * g * 100))}%` }} />
      ))}
    </span>
  );
}

function LiveDot() {
  return (
    <span className="relative flex size-2.5 shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
      <span className="relative size-2.5 rounded-full bg-red-500" />
    </span>
  );
}

/** The transcript, with each speaker's consecutive lines run together, unless `apart` (a search's lines, each with its time). `query`'s words are marked. */
function Transcript({ segments, live, query = "", apart }: { segments: Segment[]; live: boolean; query?: string; apart?: boolean }) {
  const end = React.useRef<HTMLDivElement>(null);
  const follow = React.useRef(true);
  const shown = segments.filter((s) => s.text.trim() || s.partial);

  // While it's live, keep the newest line in view, unless you've scrolled up to read.
  React.useEffect(() => {
    const el = end.current?.parentElement;
    if (!el) return;
    const onScroll = () => (follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  React.useEffect(() => {
    if (live && follow.current) end.current?.scrollIntoView({ block: "end" });
  }, [live, shown.length, shown[shown.length - 1]?.text]);

  const groups: { speaker: Who; atMs: number; lines: Segment[] }[] = [];
  for (const s of shown) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === s.speaker && !apart) last.lines.push(s);
    else groups.push({ speaker: s.speaker, atMs: s.atMs, lines: [s] });
  }

  if (!groups.length) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {live ? "Listening… what's said appears here, a moment after it's said." : "Nothing was transcribed."}
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const other = g.speaker === "them";
        return (
          <div key={g.lines[0].id} className="flex gap-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", other ? "bg-chart-1/15 text-chart-3 dark:text-chart-1" : "bg-primary/12 text-primary")}>
              <SpeakerIcon speaker={g.speaker} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex h-8 items-center gap-2 text-xs">
                <span className="font-semibold">{speakerName(g.speaker)}</span>
                <span className="text-muted-foreground tabular-nums">{clock(g.atMs)}</span>
              </div>
              <p className={cn("w-fit max-w-full rounded-2xl rounded-tl-sm px-4 py-2 text-sm leading-relaxed", other ? "bg-muted" : "bg-primary/8")}>
                {g.lines.map((s, i) => (
                  <React.Fragment key={s.id}>
                    {i > 0 && " "}
                    {s.text.trim() ? (
                      <span className={cn(s.partial && "text-muted-foreground")}>
                        <Highlight text={s.text.trim()} query={query} />
                      </span>
                    ) : (
                      <span className="inline-flex gap-0.5 align-middle text-muted-foreground" aria-label="Transcribing">
                        {[0, 1, 2].map((d) => (
                          <span key={d} className="size-1 animate-pulse rounded-full bg-current" style={{ animationDelay: `${d * 150}ms` }} />
                        ))}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/** A finished meeting's transcript: find words in it, or read one side of the call, with each side's share of the talking. */
function TranscriptPanel({ segments, actions }: { segments: Segment[]; actions: React.ReactNode }) {
  const [query, setQuery] = React.useState("");
  const [who, setWho] = React.useState<Who | "all">("all");
  const scroller = React.useRef<HTMLDivElement>(null);
  const spoken = React.useMemo(() => segments.filter((s) => s.text.trim()), [segments]);
  const speakers = (["you", "them", "room"] as const).filter((w) => spoken.some((s) => s.speaker === w));
  const share = React.useMemo(() => {
    const count = { you: 0, them: 0, room: 0 };
    for (const s of spoken) count[s.speaker] += s.text.trim().split(/\s+/).length;
    const total = count.you + count.them + count.room || 1;
    return (w: Who) => Math.round((count[w] / total) * 100);
  }, [spoken]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = spoken.filter((s) => (who === "all" || s.speaker === who) && terms.every((t) => s.text.toLowerCase().includes(t)));
  const filtered = who !== "all" || terms.length > 0;

  React.useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [query, who]);

  return (
    <Card className={cn(!isAndroid && "flex min-h-0 flex-1 flex-col overflow-hidden")}>
      {spoken.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <div className="relative min-w-40 flex-1 @2xl:max-w-64">
            <MagnifyingGlass aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pr-8 pl-9"
              aria-label="Find in the transcript"
              placeholder="Find in transcript"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="size-3.5" weight="bold" />
              </button>
            )}
          </div>
          {speakers.length > 1 && (
            <Segmented<Who | "all">
              value={who}
              onChange={setWho}
              options={[{ value: "all" as const, label: "Everyone" }, ...speakers.map((w) => ({ value: w, label: `${speakerName(w)} ${share(w)}%` }))]}
            />
          )}
          <span role="status" className="text-xs text-muted-foreground tabular-nums">
            {filtered && `${shown.length.toLocaleString()} ${shown.length === 1 ? "line" : "lines"}`}
          </span>
          <span className="ml-auto flex items-center gap-1">{actions}</span>
        </div>
      )}
      <div
        ref={scroller}
        role="region"
        aria-label="Transcript"
        tabIndex={isAndroid ? undefined : 0}
        className={cn("p-5", !isAndroid && "min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset")}
      >
        <div className="mx-auto max-w-3xl">
          {filtered && !shown.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No lines match. Try other words, or everyone.</p>
          ) : (
            <Transcript segments={shown} live={false} query={query} apart={filtered} />
          )}
        </div>
      </div>
    </Card>
  );
}

/** The transcript one line at a time, to pick lines to take out: a stray aside, something off the record. */
function TranscriptEditor({ meeting, onChange, onDone }: { meeting: Meeting; onChange: (m: Meeting) => void; onDone: () => void }) {
  const { toast } = useSettings();
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [deleting, setDeleting] = React.useState(false);
  const lines = meeting.segments.filter((s) => s.text.trim());
  const flip = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const remove = async () => {
    setDeleting(true);
    try {
      onChange(await api.meetingDeleteSegments(meeting.id, [...picked]));
      setPicked(new Set());
      onDone();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div className={cn("space-y-3", !isAndroid && "flex min-h-0 flex-1 flex-col")}>
      <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 backdrop-blur">
        <span className="text-sm text-muted-foreground">{picked.size ? `${picked.size} picked` : "Pick the lines to take out"}</span>
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="destructive" disabled={!picked.size || deleting} onClick={() => void remove()}>
          {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Delete {picked.size || ""} line{picked.size === 1 ? "" : "s"}
        </Button>
      </div>
      <Card className={cn("divide-y p-0", !isAndroid && "min-h-0 flex-1 overflow-y-auto")}>
        {lines.map((s) => (
          <label key={s.id} className={cn("flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm", picked.has(s.id) && "bg-destructive/[0.06]")}>
            <Checkbox className="mt-1 text-destructive" checked={picked.has(s.id)} onChange={() => flip(s.id)} />
            <span className="w-12 shrink-0 pt-px text-xs text-muted-foreground tabular-nums">{clock(s.atMs)}</span>
            <span className="min-w-0 flex-1 leading-relaxed">
              <span className="font-semibold">{speakerName(s.speaker)}: </span>
              <span className={cn(picked.has(s.id) && "text-muted-foreground line-through")}>{s.text.trim()}</span>
            </span>
          </label>
        ))}
      </Card>
      <p className="px-1 text-xs text-muted-foreground">Notes already written keep what they say: write them again to leave these lines out.</p>
    </div>
  );
}

/** Your own notes: saved a moment after you stop typing, and straight away when you leave. */
function useNotesDraft(id: number, saved: string | undefined) {
  const { toast } = useSettings();
  const [draft, setDraft] = React.useState<string | null>(null);
  const pending = React.useRef<{ text: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const flush = React.useCallback(() => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    const { text } = pending.current;
    pending.current = null;
    api.meetingUpdate(id, { notes: text }).catch((e) => toast(`Couldn't save your notes: ${errorMessage(e)}`));
  }, [id, toast]);
  React.useEffect(() => flush, [flush]);
  const change = (text: string) => {
    setDraft(text);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { text, timer: setTimeout(flush, SAVE_DELAY_MS) };
  };
  // Until you type, show what's saved (which a finished meeting may have updated).
  return [draft ?? saved ?? "", change] as const;
}

function YourNotes({ value, onChange, live, className }: { value: string; onChange: (text: string) => void; live: boolean; className?: string }) {
  return (
    <Textarea
      className={cn("min-h-40 resize-none bg-card text-sm leading-relaxed", className)}
      placeholder={
        live
          ? "Jot down what matters: names, numbers, what you need to follow up on. The notes written at the end build on these."
          : "Notes you typed during the meeting. Write notes again to fold in changes."
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** The notes written for you and your own, as in Granola, then what they came from. Questions are Sush's on desktop ("Ask Sush"); a phone has no Sush, so it keeps its own Ask. */
type Tab = "notes" | "mine" | "transcript" | "ask";
/** The live view's side panel ("ask" on a phone only). */
type Side = "yours" | "ask" | "notes";

function MeetingView({ id, status, onBack, go }: { id: number; status: MeetingStatus | null; onBack: () => void; go: (page: PageId) => void }) {
  const { settings, toast } = useSettings();
  const templates = useNoteTemplates(settings.meeting.templates);
  const sushInstalled = useSushInstalled();
  const [meeting, setMeeting] = React.useState<Meeting | null>(null);
  const [tab, setTab] = React.useState<Tab | null>(null);
  const [side, setSide] = React.useState<Side>("yours");
  // Kept once it's stopping, when there's no live meeting to ask any more.
  const notesOnlyRef = React.useRef(false);
  const [pruning, setPruning] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const live = status?.live?.id === id;
  if (live) notesOnlyRef.current = !!status?.live?.notesOnly;
  const notesOnly = notesOnlyRef.current;
  const writing = !!status?.summarizing.includes(id);
  const now = useNow(live);
  const levels = useLevels(live);
  const [notes, setNotes] = useNotesDraft(id, meeting?.notes);

  React.useEffect(() => {
    api.meetingGet(id).then(setMeeting, (e) => {
      toast(errorMessage(e));
      onBack();
    });
    const subs = [
      on.meetingSegment((e) => e.meetingId === id && setMeeting((m) => m && { ...m, segments: upsert(m.segments, e.segment) })),
      on.meetingUpdated((m) => m.id === id && setMeeting(m)),
      on.meetingNotice((e) => e.meetingId === id && setMeeting((m) => m && { ...m, notice: m.notice ?? e.text })),
    ];
    return () => subs.forEach((u) => void u.then((f) => f()));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  if (!meeting) return <PageHeader title="Meetings" />;

  const stop = async () => {
    setStopping(true);
    try {
      const done = await api.meetingStop();
      if (done) setMeeting(done);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setStopping(false);
    }
  };
  const words = meeting.segments.reduce((n, s) => n + (s.text.trim() ? s.text.trim().split(/\s+/).length : 0), 0);
  const remove = () => {
    if (!confirmDelete) return setConfirmDelete(true);
    api.meetingDelete(id).then(onBack, (e) => toast(errorMessage(e)));
  };
  const exportIt = async () => {
    const name = `${titleOf(meeting).replace(/[\\/:*?"<>|]/g, "-")}.md`;
    const contents = markdownExport({ ...meeting, notes });
    try {
      // A phone's files aren't somewhere you go and look, so it's handed to the share sheet.
      if (isAndroid) await api.androidShare(name, contents);
      else toast(`Saved to ${await api.exportFile(name, contents)}`, "info");
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  // Questions go to Sush, which reads the meeting (live ones too) through `yammer --mcp`.
  const askInSush = sushInstalled && (
    <Button
      variant="ghost"
      className="rounded-lg border bg-accent text-accent-foreground hover:bg-foreground/10"
      title="Open Sush on a chat about this meeting, where you can also ask across all your meetings"
      onClick={() =>
        void api.askInSush(id, meeting.title).then(
          (how) => how === "copied" && toast("Sush is open, and your question is on the clipboard: paste it into a new chat.", "info"),
          (e) => toast(errorMessage(e)),
        )
      }
    >
      <SushiIcon /> Ask Sush
    </Button>
  );

  if (live || stopping) {
    const speakers = status?.live?.speakers ?? [];
    const shownSide: Side = notesOnly && side === "yours" ? "notes" : side;
    return (
      <div className="space-y-4">
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 border-red-500/30 bg-red-500/[0.04] p-4">
          <LiveDot />
          <div className="min-w-48 flex-1">
            <div className="text-sm font-semibold">{stopping ? (notesOnly ? "Catching up on what was said…" : "Finishing the transcript…") : notesOnly ? "Taking notes" : "Transcribing this meeting"}</div>
            <div className="truncate text-xs text-muted-foreground">{status?.live?.engine ?? meeting.engine}</div>
          </div>
          {templates.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Notebook className="size-4 text-primary" />
              <span>Notes as</span>
              <Select
                className="w-40"
                label="Template for this meeting's notes"
                title="The notes are written with this when the meeting ends"
                value={templates.some((t) => t.id === meeting.template) ? meeting.template! : settings.meeting.summary}
                disabled={stopping}
                onChange={(template) => {
                  setMeeting({ ...meeting, template });
                  api.meetingSetTemplate(id, template).catch((e) => toast(errorMessage(e)));
                }}
                options={templates.map((t) => ({ value: t.id, label: t.name }))}
              />
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {speakers.map((s) => (
              <span key={s} className="flex items-center gap-1.5" title={speakerSource(s)}>
                <SpeakerIcon speaker={s} className="size-3.5" />
                {speakerName(s)}
                <Meter level={levels[s]} className={s === "them" ? "text-foreground/60" : "text-primary"} />
              </span>
            ))}
          </div>
          <span className="font-mono text-lg font-semibold tabular-nums">{clock(now - meeting.startedAt)}</span>
          {askInSush}
          <Button variant="destructive" className={cn(isAndroid && "w-full")} onClick={() => void stop()} disabled={stopping}>
            {stopping ? <Loader2 className="animate-spin" /> : <Stop weight="fill" />}
            {stopping ? "Stopping…" : "Stop"}
          </Button>
        </Card>
        {meeting.event && (
          <div className="space-y-0.5">
            <h1 className="px-1 text-lg font-semibold tracking-tight">{meeting.event.title}</h1>
            <Attendees event={meeting.event} />
          </div>
        )}
        {meeting.notice && <Notice tone="warn">{meeting.notice}</Notice>}
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
          {notesOnly ? (
            <div className={cn("flex flex-col gap-2", isAndroid ? "h-[50vh]" : "h-[60vh]")}>
              <p className="px-1 text-xs text-pretty text-muted-foreground">Your notes. The written notes and the transcript follow when you stop.</p>
              <YourNotes className="flex-1" value={notes} onChange={setNotes} live />
            </div>
          ) : (
            <Card className={cn("min-h-72 overflow-y-auto p-4", isAndroid ? "h-[50vh] rounded-3xl" : "h-[60vh]")}>
              <Transcript segments={meeting.segments} live />
            </Card>
          )}
          <div className={cn("flex min-h-0 flex-col gap-2", !isAndroid && "@3xl:h-[60vh]")}>
            <div className="flex items-center justify-between gap-2">
              <Segmented<Side>
                value={shownSide}
                onChange={setSide}
                options={[
                  // In notes only they're the main panel.
                  ...(notesOnly ? [] : [{ value: "yours" as const, label: "Your notes" }]),
                  ...(isAndroid ? [{ value: "ask" as const, label: "Ask" }] : []),
                  { value: "notes", label: "So far" },
                ]}
              />
              <Button size="icon" variant="ghost" title="All meetings" onClick={onBack}>
                <ArrowLeft />
              </Button>
            </div>
            {shownSide === "yours" && <YourNotes className="flex-1 @3xl:h-full" value={notes} onChange={setNotes} live />}
            {shownSide === "ask" && <MeetingAsk className="min-h-80 flex-1" meeting={meeting} live onChange={setMeeting} />}
            {shownSide === "notes" && (
              <Card className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {writing ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin text-primary" /> Writing notes from what's been said…
                  </p>
                ) : meeting.summary ? (
                  <Markdown source={meeting.summary} className="text-sm" />
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Catch up without stopping: notes of what's been said so far, as {templates.find((t) => t.id === meeting.template)?.name ?? "your template"}. The full notes are written again when the meeting ends.
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={writing || !words}
                  onClick={() => void api.meetingSummarize(id).then(setMeeting, (e) => toast(errorMessage(e)))}
                >
                  <Sparkles /> {meeting.summary ? "Update" : "Write notes so far"}
                </Button>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  const shownTab: Tab = tab ?? (meeting.summary || writing ? "notes" : notes.trim() ? "mine" : "transcript");
  const copyText =
    shownTab === "notes"
      ? (meeting.summary ?? "")
      : shownTab === "mine"
        ? notes
      : shownTab === "ask"
        ? (meeting.chat ?? []).map((t) => (t.role === "user" ? `Q: ${t.text}` : t.text)).join("\n\n")
        : transcriptText(meeting.segments);
  // Sits with the controls of whatever it copies.
  const copyButton = (
    <Button className="text-foreground" variant="ghost" disabled={!copyText.trim()} onClick={() => void api.copyText(copyText).then(() => toast("Copied.", "info"))}>
      <Copy weight="bold" /> Copy
    </Button>
  );

  return (
    // Each tab fills the window (TitleBar and the page's padding taken off) and scrolls inside it, so switching doesn't move anything. A phone has no room for that, so its page scrolls.
    <div className={cn("space-y-4", !isAndroid && "flex h-[calc(100svh-5rem)] min-h-[32rem] flex-col sm:h-[calc(100svh-5.25rem)]")}>
      <div className="shrink-0 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="-ml-3 text-muted-foreground" onClick={onBack}>
            <ArrowLeft weight="bold" /> All meetings
          </Button>
          <span className="ml-auto" />
          {askInSush}
          <Button size="icon" variant="ghost" title={isAndroid ? "Share as Markdown" : "Export as Markdown"} onClick={() => void exportIt()}>
            <Download weight="bold" />
          </Button>
          <Button size={confirmDelete ? "md" : "icon"} variant={confirmDelete ? "destructive" : "ghost"} title="Delete meeting" onClick={remove}>
            <Trash2 weight="bold" />
            {confirmDelete && "Delete?"}
          </Button>
        </div>

        <div className="space-y-1">
          <CommitInput
            className="h-auto border-transparent bg-transparent -mx-2 w-[calc(100%+1rem)] max-w-none px-2 py-1 text-2xl font-semibold tracking-tight shadow-none hover:border-input dark:bg-transparent"
            value={meeting.title}
            placeholder={titleOf({ ...meeting, title: "" })}
            onCommit={(title) => void api.meetingUpdate(id, { title }).then(setMeeting, (e) => toast(errorMessage(e)))}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <Fact icon={CalendarBlank}>{when.format(meeting.startedAt)}</Fact>
            <Fact icon={Clock}>{meeting.endedAt ? duration(meeting.endedAt - meeting.startedAt) : "Didn't finish"}</Fact>
            <Fact icon={TextAlignLeft}>{words.toLocaleString()} words</Fact>
            <Fact icon={Waveform}>{meeting.engine}</Fact>
          </div>
          {meeting.event && <Attendees event={meeting.event} />}
        </div>

        {meeting.notice && <Notice tone="warn">{meeting.notice}</Notice>}

        <Segmented<Tab>
          value={shownTab}
          onChange={(t) => {
            setTab(t);
            setPruning(false);
          }}
          options={[
            { value: "notes", label: "Notes", icon: tabIcon(Sparkles) },
            { value: "mine", label: "My notes", icon: tabIcon(Notebook) },
            { value: "transcript", label: "Transcript", icon: tabIcon(TextAlignLeft) },
            ...(isAndroid ? [{ value: "ask" as const, label: meeting.chat?.length ? `Ask · ${meeting.chat.length / 2}` : "Ask" }] : []),
          ]}
        />
      </div>

      {shownTab === "notes" && (
        <EnhancedNotes meeting={meeting} writing={writing} canWrite={!!words || !!notes.trim()} onChange={setMeeting} go={go} copy={copyButton} />
      )}

      {shownTab === "mine" && (
        <Card className={cn("overflow-hidden focus-within:border-ring", !isAndroid && "flex min-h-0 flex-1 flex-col")}>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
            <span>Saved as you type</span>
            {copyButton}
          </div>
          <YourNotes
            className="min-h-64 flex-1 rounded-none border-0 bg-transparent p-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
            value={notes}
            onChange={setNotes}
            live={false}
          />
        </Card>
      )}

      {shownTab === "transcript" &&
        (pruning ? (
          <TranscriptEditor meeting={meeting} onChange={setMeeting} onDone={() => setPruning(false)} />
        ) : (
          <TranscriptPanel
            segments={meeting.segments}
            actions={
              <>
                <Button variant="ghost" onClick={() => setPruning(true)}>
                  <CheckSquare weight="bold" /> Remove lines
                </Button>
                {copyButton}
              </>
            }
          />
        ))}

      {shownTab === "ask" && (
        <Card className="overflow-hidden">
          {!!meeting.chat?.length && <div className="flex shrink-0 justify-end border-b px-4 py-2">{copyButton}</div>}
          <MeetingAsk className="flex-1" meeting={meeting} live={false} onChange={setMeeting} />
        </Card>
      )}
    </div>
  );
}

/** A phone's tabs have no room for icons. */
const tabIcon = (Icon: React.ElementType) => (isAndroid ? undefined : <Icon aria-hidden className="size-4" />);

/** One fact about the meeting, with an icon to find it by. */
function Fact({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden className="size-3.5" />
      {children}
    </span>
  );
}

const dayName = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** "Now", "10:30", "Tue 9:00": when an event is, from here. */
function eventWhen(e: CalendarEvent, now: number): string {
  if (e.start <= now && now < e.end) return "Now";
  const d = new Date(e.start);
  return d.toDateString() === new Date(now).toDateString() ? timeOf.format(d) : `${dayName.format(d)} ${timeOf.format(d)}`;
}

/** Who was invited: the first few by name, then how many more. */
function Attendees({ event }: { event: CalendarEvent }) {
  if (!event.attendees.length) return null;
  const shown = event.attendees.slice(0, 6);
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1" aria-label="Invited">
      <Users className="size-3.5 text-muted-foreground" />
      {shown.map((a) => (
        <span key={a.email ?? a.name} title={a.email} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {a.name}
        </span>
      ))}
      {event.attendees.length > shown.length && <span className="text-xs text-muted-foreground">+{event.attendees.length - shown.length} more</span>}
    </div>
  );
}

/** What's next on the calendar: start notes for it (linked to the event), or join its call. Without a calendar, how to connect one. */
function Upcoming({
  events,
  connected,
  starting,
  onStart,
  go,
}: {
  events: CalendarEvent[];
  connected: boolean;
  starting: boolean;
  onStart: (key: string) => void;
  go: (page: PageId) => void;
}) {
  const now = useNow(true);
  const soon = events.filter((e) => e.end > now).slice(0, 3);
  if (!connected || !soon.length) {
    return (
      <Card className="flex flex-col p-5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-chart-1/15 text-chart-3 dark:text-chart-1">
          <CalendarBlank aria-hidden className="size-5" weight="duotone" />
        </span>
        <h2 className="mt-4 text-sm font-semibold">{connected ? "Nothing coming up" : "Bring in your calendar"}</h2>
        <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">
          {connected ? "Your next events appear here, ready to start notes for." : "Meetings take their event's name, and the notes spell everyone's names right."}
        </p>
        {!connected && (
          <div className="mt-auto pt-4">
            <Button variant="outline" onClick={() => go("meeting-settings")}>
              Connect a calendar
            </Button>
          </div>
        )}
      </Card>
    );
  }
  return (
    <Card className="flex flex-col overflow-hidden">
      <h2 className="flex items-center gap-2 px-5 pt-5 pb-2 text-sm font-semibold">
        <CalendarBlank aria-hidden className="size-4 text-chart-3 dark:text-chart-1" weight="bold" /> Coming up
      </h2>
      <ul className="divide-y">
        {soon.map((e) => {
          const under = e.start <= now && now < e.end;
          return (
            <li key={eventKey(e)} className="space-y-2 px-5 py-3">
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={e.title}>
                  {e.title}
                </span>
                <span className={cn("shrink-0 text-xs tabular-nums", under ? "font-semibold text-destructive" : "text-muted-foreground")}>{eventWhen(e, now)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {e.attendees.length > 0 && (
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={e.attendees.map((a) => a.name).join(", ")}>
                    <Users aria-hidden className="size-3.5" /> {e.attendees.length}
                  </span>
                )}
                <span className="ml-auto" />
                {e.joinUrl && (
                  <Button size="sm" variant="ghost" title={e.joinUrl} aria-label={`Join ${e.title}`} onClick={() => void openUrl(e.joinUrl!)}>
                    <VideoCamera /> Join
                  </Button>
                )}
                <Button size="sm" variant={under ? "default" : "outline"} aria-label={`Start notes for ${e.title}`} disabled={starting} onClick={() => onStart(eventKey(e))}>
                  <RecordIcon weight="fill" /> Start notes
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** One past meeting. One nobody spoke in is drawn quieter, so it doesn't compete with the ones worth opening. */
function MeetingRow({ meeting: o, writing, onOpen }: { meeting: MeetingOverview; writing: boolean; onOpen: () => void }) {
  const empty = !o.words && !o.hasSummary;
  const Icon = empty ? MicrophoneSlash : o.hasSummary ? Notebook : TextAlignLeft;
  const people = o.attendees ?? [];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-start gap-4 px-4 py-4 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span
        title={empty ? undefined : o.hasSummary ? "Notes and transcript" : "Transcript only"}
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", empty || !o.hasSummary ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}
      >
        {writing ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <Icon aria-hidden className="size-5" weight={o.hasSummary ? "duotone" : "regular"} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-3">
          {/* The day is above and the time beside it, so a meeting with no name doesn't repeat them. */}
          <span className={cn("min-w-0 truncate text-sm", o.title.trim() ? "font-semibold" : "font-medium text-muted-foreground")}>{o.title.trim() || "Untitled meeting"}</span>
          {writing && <Badge tone="brand">Writing notes…</Badge>}
        </span>
        <span className="mt-1 line-clamp-2 max-w-prose text-[13px] leading-5 text-pretty text-muted-foreground">{empty ? "Nothing was transcribed." : o.preview || `${o.words.toLocaleString()} words`}</span>
        {people.length > 0 && (
          <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">
              {people.slice(0, 3).join(", ")}
              {people.length > 3 ? ` and ${people.length - 3} more` : ""}
            </span>
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-xs leading-5 text-muted-foreground tabular-nums">
        <span>{timeOf.format(o.startedAt)}</span>
        {o.endedAt && <span className="rounded-full bg-muted px-2">{duration(o.endedAt - o.startedAt)}</span>}
      </span>
      {!isAndroid && <CaretRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
    </button>
  );
}

const fieldName: Record<MeetingHit["field"], string> = { title: "Title", summary: "Notes", notes: "Your notes", transcript: "Transcript" };

/** Meetings matching `query`, a moment after typing stops; null while there's no answer yet. */
function useSearch(query: string): MeetingHit[] | null {
  const { toast } = useSettings();
  const [hits, setHits] = React.useState<MeetingHit[] | null>(null);
  React.useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    let stale = false;
    const t = setTimeout(() => api.meetingSearch(q).then((h) => !stale && setHits(h), (e) => toast(errorMessage(e))), 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, toast]);
  return hits;
}

/** `text` with the query's words in bold. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">{p}</mark> : p))}
    </>
  );
}

export function MeetingsPage({ go }: { go: (page: PageId) => void }) {
  const { settings, update, toast } = useSettings();
  const templates = useNoteTemplates(settings.meeting.templates);
  const status = useMeetingStatus();
  const [list, setList] = React.useState<MeetingOverview[] | null>(null);
  const [open, setOpen] = React.useState<number | null>(null);
  useOpenMeetingRequest(setOpen);
  const [starting, setStarting] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const calendar = useCalendar();
  const hits = useSearch(query);
  const live = status?.live ?? null;
  const now = useNow(!!live);

  const reload = React.useCallback(() => void api.meetingsList().then(setList, (e) => toast(errorMessage(e))), [toast]);
  React.useEffect(() => {
    reload();
    const subs = [on.meetingUpdated(reload), on.meetingStatus(reload)];
    return () => subs.forEach((u) => void u.then((f) => f()));
  }, [reload]);
  useBackKey(open !== null ? 1 : 0, () => setOpen(null));

  /** `event`: start notes for this calendar event (its key), else whichever is under way. */
  const start = async (event?: string) => {
    if (starting) return;
    setStarting(true);
    try {
      const started = await api.meetingStart(event);
      setOpen(started.id);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };
  // The phone's round button starts and stops a meeting here, rather than dictating into one.
  useDockAction(
    !isAndroid || !status
      ? null
      : live
        ? { label: "Stop the meeting", icon: Stop, run: () => void api.meetingStop().catch((e) => toast(errorMessage(e))) }
        : { label: settings.meeting.notesOnly ? "Start taking notes" : "Start transcribing", icon: RecordIcon, run: () => void start() },
  );

  if (open !== null) {
    return (
      <MeetingView
        key={open}
        id={open}
        status={status}
        go={go}
        onBack={() => {
          setOpen(null);
          reload();
        }}
      />
    );
  }

  const m = settings.meeting;
  const past = (list ?? []).filter((o) => o.id !== live?.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Meetings" />

      {live ? (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 border-red-500/30 bg-red-500/[0.04] p-4">
          <LiveDot />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{live.notesOnly ? "Notes are being taken" : "A meeting is being transcribed"}</div>
            <div className="truncate text-xs text-muted-foreground">{live.engine}</div>
          </div>
          <span className="font-mono text-lg font-semibold tabular-nums">{clock(now - live.startedAt)}</span>
          <Button onClick={() => setOpen(live.id)}>Open</Button>
        </Card>
      ) : (
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="relative flex flex-col overflow-hidden border-primary/20 bg-primary/[0.05] dark:bg-primary/[0.08]">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(80% 120% at 0% 0%, color-mix(in oklch, var(--brand) 12%, transparent), transparent 60%)" }}
            />
            <div className="relative flex flex-1 items-stretch">
              <div className="flex min-w-0 flex-1 flex-col p-5 @md:p-6">
                <h2 className="text-xl font-semibold tracking-tight text-balance">{m.notesOnly ? (isAndroid ? "Get notes from a meeting" : "Get notes from a call") : isAndroid ? "Transcribe a meeting as it happens" : "Transcribe a call as it happens"}</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
                  {isAndroid
                    ? `Put your phone on the table and start when the meeting does. Yammer ${m.notesOnly ? "listens to the room" : "writes down what's said in the room as it's said"}, and turns it into notes when you stop. Jot your own notes alongside: the write-up builds on them. Let everyone know you're transcribing. Android doesn't let apps hear a call on the phone itself, so for a call, use Yammer on your computer.`
                    : `Start before or during a Teams, Zoom or Meet call. Yammer ${m.notesOnly ? "listens to both sides" : "writes down both sides live"} and turns them into notes when you stop, building on any you jot alongside.`}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
                  <Button className={cn(!isAndroid && "h-10 rounded-lg px-4")} onClick={() => void start()} disabled={starting}>
                    {starting ? <Loader2 className="animate-spin" /> : <RecordIcon weight="fill" />}
                    {starting ? "Starting…" : m.notesOnly ? "Start taking notes" : "Start transcribing"}
                  </Button>
                  {m.hotkey && !isAndroid && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      or press <Hotkey accelerator={m.hotkey} />
                    </span>
                  )}
                  <span className="flex items-center gap-2 text-sm text-muted-foreground" title="Off: just notes when it ends, which usually costs less">
                    <Switch
                      label="Live transcript"
                      checked={!m.notesOnly}
                      disabled={starting}
                      onChange={(on) => void update((s) => ({ ...s, meeting: { ...s.meeting, notesOnly: !on } }))}
                    />
                    Live transcript
                  </span>
                </div>
              </div>
              {/* Sushi on its plate, as in Settings. */}
              {!isAndroid && (
                <div className="hidden w-44 shrink-0 flex-col items-center justify-end pb-6 @xl:flex">
                  <Sushi mood="idle" px={4} interactive className="relative z-10 text-muted-foreground" />
                  <span aria-hidden className="-mt-2 h-3 w-24 rounded-[50%] bg-foreground/10 dark:bg-foreground/15" />
                </div>
              )}
            </div>
            <div className="relative flex flex-wrap items-center gap-2 border-t border-primary/10 bg-background/50 px-5 py-3 text-sm @md:px-6">
              {templates.length > 0 && (
                <>
                  <Notebook aria-hidden className="size-4 text-primary" />
                  <span className="text-muted-foreground">Notes written as</span>
                  <Select
                    className="w-44"
                    label="Template for meeting notes"
                    value={m.summary}
                    onChange={(summary) => void update((s) => ({ ...s, meeting: { ...s.meeting, summary } }))}
                    options={templates.map((t) => ({ value: t.id, label: t.name }))}
                  />
                  <Button variant="ghost" className="text-muted-foreground" onClick={() => go("templates")}>
                    Edit templates
                  </Button>
                </>
              )}
              <Button variant="ghost" className="ml-auto text-muted-foreground" onClick={() => go("meeting-settings")}>
                <Settings2 /> Settings
              </Button>
            </div>
          </Card>
          <Upcoming events={calendar?.events ?? []} starting={starting} onStart={(key) => void start(key)} go={go} connected={!!calendar?.connected} />
        </div>
      )}

      <section className="space-y-4 pt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
            {query.trim() ? "Search" : "Past meetings"}
            {!query.trim() && past.length > 0 && <span className="text-xs font-normal text-muted-foreground tabular-nums">{past.length.toLocaleString()}</span>}
          </h2>
          {(past.length > 0 || query) && (
            <label className="relative ml-auto w-full @lg:w-72">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="bg-card pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
                aria-label="Search meetings"
                placeholder="Search notes and transcripts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </label>
          )}
        </div>
        {query.trim() ? (
          hits === null ? null : hits.length > 0 ? (
            <Card className="divide-y overflow-hidden">
              {hits.map((h) => (
                <button key={h.id} type="button" className="block w-full px-4 py-4 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset" onClick={() => setOpen(h.id)}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{titleOf(h)}</span>
                    <Badge>{fieldName[h.field]}</Badge>
                    <span className="shrink-0 text-xs text-muted-foreground">{when.format(h.startedAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                    <Highlight text={h.snippet} query={query} />
                  </p>
                </button>
              ))}
            </Card>
          ) : (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No meeting mentions all of “{query.trim()}”.</p>
          )
        ) : past.length > 0 ? (
          <div className="space-y-6">
            {byDay(past).map((g) => (
              // The day stays beside its meetings as they scroll past; above them where there's no room.
              <div key={g.label} className="grid gap-2 @3xl:grid-cols-[8rem_minmax(0,1fr)] @3xl:gap-4">
                <h3 className="self-start text-[13px] font-medium text-muted-foreground @3xl:sticky @3xl:top-4 @3xl:pt-5">{g.label}</h3>
                <Card className="divide-y overflow-hidden">
                  {g.items.map((o) => (
                    <MeetingRow key={o.id} meeting={o} writing={!!status?.summarizing.includes(o.id)} onOpen={() => setOpen(o.id)} />
                  ))}
                </Card>
              </div>
            ))}
          </div>
        ) : list ? (
          <EmptyState icon={Users} title="No meetings yet">
            Each meeting you transcribe is kept here on this {isAndroid ? "phone" : "computer"}, with its transcript and notes.
          </EmptyState>
        ) : null}
      </section>
    </div>
  );
}
