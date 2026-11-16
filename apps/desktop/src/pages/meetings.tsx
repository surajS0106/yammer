// Meetings: start transcribing a call, watch it written down as it happens
// (you and everyone else, side by side with your own notes), and read the
// notes written from it once it ends. A phone can't hear another app's call,
// so there it transcribes the room: one microphone hearing everyone.

import {
  ArrowLeft,
  CalendarBlank,
  ChatCircleDots,
  CheckSquare,
  Copy,
  DownloadSimple as Download,
  GearSix as Settings2,
  CircleNotch as Loader2,
  MagnifyingGlass,
  Notebook,
  Microphone as Mic,
  Record as RecordIcon,
  SpeakerHigh as Speaker,
  Sparkle as Sparkles,
  Stop,
  Trash as Trash2,
  UsersThree as Users,
  VideoCamera,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { Markdown } from "@/components/markdown";
import { MeetingAsk } from "@/components/meeting-ask";
import { EnhancedNotes } from "@/components/meeting-notes";
import { Badge, Button, Card, CommitInput, EmptyState, Hotkey, Input, Notice, Segmented, Select, Textarea } from "@/components/ui";
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

/** The transcript, with each speaker's consecutive lines run together. */
function Transcript({ segments, live }: { segments: Segment[]; live: boolean }) {
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
    if (last && last.speaker === s.speaker) last.lines.push(s);
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
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.lines[0].id} className="flex gap-3">
          <span
            className={cn(
              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
              g.speaker === "them" ? "bg-muted text-muted-foreground" : "bg-primary/12 text-primary",
            )}
          >
            <SpeakerIcon speaker={g.speaker} className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="font-semibold">{speakerName(g.speaker)}</span>
              <span className="text-muted-foreground tabular-nums">{clock(g.atMs)}</span>
            </div>
            <p className="mt-0.5 text-sm leading-relaxed">
              {g.lines.map((s, i) => (
                <React.Fragment key={s.id}>
                  {i > 0 && " "}
                  {s.text.trim() ? (
                    <span className={cn(s.partial && "text-muted-foreground")}>{s.text.trim()}</span>
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
      ))}
      <div ref={end} />
    </div>
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
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 backdrop-blur">
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
      <Card className="divide-y p-0">
        {lines.map((s) => (
          <label key={s.id} className={cn("flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm", picked.has(s.id) && "bg-destructive/[0.06]")}>
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-destructive" checked={picked.has(s.id)} onChange={() => flip(s.id)} />
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

type Tab = "notes" | "transcript" | "ask";
/** The Notes tab's two halves, as in Granola: the notes written for you, and your own. */
type NotesView = "enhanced" | "mine";
/** The live view's side panel. */
type Side = "yours" | "ask" | "notes";

function MeetingView({ id, status, onBack, go }: { id: number; status: MeetingStatus | null; onBack: () => void; go: (page: PageId) => void }) {
  const { settings, toast } = useSettings();
  const templates = useNoteTemplates(settings.meeting.templates);
  const sushInstalled = useSushInstalled();
  const [meeting, setMeeting] = React.useState<Meeting | null>(null);
  const [tab, setTab] = React.useState<Tab | null>(null);
  const [view, setView] = React.useState<NotesView | null>(null);
  const [side, setSide] = React.useState<Side>("yours");
  const [pruning, setPruning] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const live = status?.live?.id === id;
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

  if (live || stopping) {
    const speakers = status?.live?.speakers ?? [];
    return (
      <div className="space-y-4">
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 border-red-500/30 bg-red-500/[0.04] p-4">
          <LiveDot />
          <div className="min-w-48 flex-1">
            <div className="text-sm font-semibold">{stopping ? "Finishing the transcript…" : "Transcribing this meeting"}</div>
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
          <Card className={cn("min-h-72 overflow-y-auto p-4", isAndroid ? "h-[50vh] rounded-3xl" : "h-[60vh]")}>
            <Transcript segments={meeting.segments} live />
          </Card>
          <div className={cn("flex min-h-0 flex-col gap-2", !isAndroid && "@3xl:h-[60vh]")}>
            <div className="flex items-center justify-between gap-2">
              <Segmented<Side>
                value={side}
                onChange={setSide}
                options={[
                  { value: "yours", label: "Your notes" },
                  { value: "ask", label: "Ask" },
                  { value: "notes", label: "So far" },
                ]}
              />
              <Button size="icon" variant="ghost" title="All meetings" onClick={onBack}>
                <ArrowLeft />
              </Button>
            </div>
            {side === "yours" && <YourNotes className="flex-1 @3xl:h-full" value={notes} onChange={setNotes} live />}
            {side === "ask" && <MeetingAsk className="min-h-80 flex-1" meeting={meeting} live onChange={setMeeting} />}
            {side === "notes" && (
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

  const shownTab: Tab = tab ?? (meeting.summary || writing || notes.trim() ? "notes" : "transcript");
  const shownView: NotesView = view ?? (meeting.summary || writing || !notes.trim() ? "enhanced" : "mine");
  const copyText =
    shownTab === "notes"
      ? shownView === "enhanced"
        ? meeting.summary ?? ""
        : notes
      : shownTab === "ask"
        ? (meeting.chat ?? []).map((t) => (t.role === "user" ? `Q: ${t.text}` : t.text)).join("\n\n")
        : transcriptText(meeting.segments);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft /> All meetings
        </Button>
        <span className="ml-auto" />
        {sushInstalled && (
          <Button
            size="sm"
            variant="outline"
            title="Open Sush on a chat about this meeting, where you can also ask across all your meetings"
            onClick={() =>
              void api.askInSush(id, meeting.title).then(
                (how) => how === "copied" && toast("Sush is open, and your question is on the clipboard: paste it into a new chat.", "info"),
                (e) => toast(errorMessage(e)),
              )
            }
          >
            <ChatCircleDots /> Ask in Sush
          </Button>
        )}
        <Button size="icon" variant="ghost" title="Copy" disabled={!copyText.trim()} onClick={() => void api.copyText(copyText).then(() => toast("Copied.", "info"))}>
          <Copy />
        </Button>
        <Button size="icon" variant="ghost" title={isAndroid ? "Share as Markdown" : "Export as Markdown"} onClick={() => void exportIt()}>
          <Download />
        </Button>
        <Button size={confirmDelete ? "sm" : "icon"} variant={confirmDelete ? "destructive" : "ghost"} title="Delete meeting" onClick={remove}>
          <Trash2 />
          {confirmDelete && "Delete?"}
        </Button>
      </div>

      <div className="space-y-1">
        <CommitInput
          className="h-auto border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold tracking-tight shadow-none hover:border-input dark:bg-transparent"
          value={meeting.title}
          placeholder={titleOf({ ...meeting, title: "" })}
          onCommit={(title) => void api.meetingUpdate(id, { title }).then(setMeeting, (e) => toast(errorMessage(e)))}
        />
        <p className="px-1 text-xs text-muted-foreground">
          {when.format(meeting.startedAt)}
          {meeting.endedAt ? ` · ${duration(meeting.endedAt - meeting.startedAt)}` : " · didn't finish"} · {words.toLocaleString()} words · {meeting.engine}
        </p>
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
          { value: "notes", label: "Notes" },
          { value: "transcript", label: "Transcript" },
          { value: "ask", label: meeting.chat?.length ? `Ask · ${meeting.chat.length / 2}` : "Ask" },
        ]}
      />

      {shownTab === "notes" && (
        <div className="space-y-3">
          <Segmented<NotesView>
            value={shownView}
            onChange={setView}
            options={[
              { value: "enhanced", label: "Enhanced", icon: <Sparkles className="size-3.5" /> },
              { value: "mine", label: "My notes" },
            ]}
          />
          {shownView === "enhanced" ? (
            <EnhancedNotes meeting={meeting} writing={writing} canWrite={!!words || !!notes.trim()} onChange={setMeeting} go={go} />
          ) : (
            <YourNotes className="min-h-64" value={notes} onChange={setNotes} live={false} />
          )}
        </div>
      )}

      {shownTab === "transcript" &&
        (pruning ? (
          <TranscriptEditor meeting={meeting} onChange={setMeeting} onDone={() => setPruning(false)} />
        ) : (
          <Card className="p-5">
            {words > 0 && (
              <div className="-mt-1 mb-3 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => setPruning(true)}>
                  <CheckSquare /> Remove lines
                </Button>
              </div>
            )}
            <Transcript segments={meeting.segments} live={false} />
          </Card>
        ))}

      {shownTab === "ask" && <MeetingAsk meeting={meeting} live={false} onChange={setMeeting} />}
    </div>
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
    <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1" aria-label="Invited">
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

/** What's next on the calendar: start notes for it (linked to the event), or join its call. */
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
  const soon = events.filter((e) => e.end > now).slice(0, 4);
  if (!connected) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <CalendarBlank className="size-3.5" />
        Connect your calendar and meetings take their event's name and attendees.
        <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => go("meeting-settings")}>
          Connect a calendar
        </button>
      </p>
    );
  }
  if (!soon.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-semibold">Coming up</h2>
      <Card className="divide-y">
        {soon.map((e) => {
          const under = e.start <= now && now < e.end;
          return (
            <div key={eventKey(e)} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <span className={cn("w-20 shrink-0 text-xs tabular-nums", under ? "font-semibold text-red-500" : "text-muted-foreground")}>{eventWhen(e, now)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.title}</div>
                {e.attendees.length > 0 && (
                  <div className="truncate text-xs text-muted-foreground">
                    {e.attendees
                      .slice(0, 3)
                      .map((a) => a.name)
                      .join(", ")}
                    {e.attendees.length > 3 ? ` and ${e.attendees.length - 3} more` : ""}
                  </div>
                )}
              </div>
              {e.joinUrl && (
                <Button size="sm" variant="ghost" title={e.joinUrl} onClick={() => void openUrl(e.joinUrl!)}>
                  <VideoCamera /> Join
                </Button>
              )}
              <Button size="sm" variant={under ? "default" : "outline"} disabled={starting} onClick={() => onStart(eventKey(e))}>
                <RecordIcon weight="fill" className={cn(under && "text-red-300")} /> Start notes
              </Button>
            </div>
          );
        })}
      </Card>
    </section>
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
        : { label: "Start transcribing", icon: RecordIcon, run: () => void start() },
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
            <div className="text-sm font-semibold">A meeting is being transcribed</div>
            <div className="truncate text-xs text-muted-foreground">{live.engine}</div>
          </div>
          <span className="font-mono text-lg font-semibold tabular-nums">{clock(now - live.startedAt)}</span>
          <Button onClick={() => setOpen(live.id)}>Open</Button>
        </Card>
      ) : (
        <Card className="relative overflow-hidden border-primary/20 bg-primary/[0.05] p-5 dark:bg-primary/[0.08]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(80% 120% at 0% 0%, color-mix(in oklch, var(--brand) 12%, transparent), transparent 60%)" }}
          />
          <div className="relative space-y-3">
            <div className="flex items-center gap-2">
              <Users className="size-5 text-primary" weight="duotone" />
              <h2 className="text-base font-semibold tracking-tight">{isAndroid ? "Transcribe a meeting as it happens" : "Transcribe a call as it happens"}</h2>
            </div>
            {isAndroid ? (
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                Put your phone on the table and start when the meeting does. Yammer writes down what's said in the room as it's said, and turns it into
                notes when you stop. Jot your own notes alongside: the write-up builds on them. Let everyone know you're transcribing. Android doesn't let
                apps hear a call on the phone itself, so for a call, use Yammer on your computer.
              </p>
            ) : (
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                Start before or during a Teams, Zoom or Meet call. Yammer writes down what you say and what everyone else says, live, and turns it into
                notes when you stop. Jot your own notes alongside: the write-up builds on them.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button onClick={() => void start()} disabled={starting}>
                {starting ? <Loader2 className="animate-spin" /> : <RecordIcon weight="fill" className="text-red-300" />}
                {starting ? "Starting…" : "Start transcribing"}
              </Button>
              {m.hotkey && !isAndroid && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  or press <Hotkey accelerator={m.hotkey} />
                </span>
              )}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => go("meeting-settings")}>
                <Settings2 /> Settings
              </Button>
            </div>
            {templates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-primary/10 pt-3 text-sm">
                <Notebook className="size-4 text-primary" />
                <span className="text-muted-foreground">Notes written as</span>
                <Select
                  className="w-44"
                  label="Template for meeting notes"
                  value={m.summary}
                  onChange={(summary) => void update((s) => ({ ...s, meeting: { ...s.meeting, summary } }))}
                  options={templates.map((t) => ({ value: t.id, label: t.name }))}
                />
                <button type="button" className="text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={() => go("templates")}>
                  Edit templates
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {!live && <Upcoming events={calendar?.events ?? []} starting={starting} onStart={(key) => void start(key)} go={go} connected={!!calendar?.connected} />}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="px-1 text-sm font-semibold">{query.trim() ? "Search" : "Past meetings"}</h2>
          {(past.length > 0 || query) && (
            <label className="relative ml-auto w-full max-w-64 @lg:w-64">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="bg-card pl-8"
                aria-label="Search meetings"
                placeholder="Search notes and transcripts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
        </div>
        {query.trim() ? (
          hits === null ? null : hits.length > 0 ? (
            <Card className="divide-y">
              {hits.map((h) => (
                <button key={h.id} type="button" className="block w-full px-4 py-3 text-left transition-colors hover:bg-accent/60" onClick={() => setOpen(h.id)}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{titleOf(h)}</span>
                    <Badge>{fieldName[h.field]}</Badge>
                    <span className="shrink-0 text-xs text-muted-foreground">{when.format(h.startedAt)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    <Highlight text={h.snippet} query={query} />
                  </p>
                </button>
              ))}
            </Card>
          ) : (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No meeting mentions all of “{query.trim()}”.</p>
          )
        ) : past.length > 0 ? (
          <div className="space-y-4">
            {byDay(past).map((g) => (
              <div key={g.label} className="space-y-1.5">
                <h3 className="px-1 text-xs font-medium text-muted-foreground">{g.label}</h3>
                <Card className="divide-y">
                  {g.items.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-accent/60"
                      onClick={() => setOpen(o.id)}
                    >
                      <div className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{titleOf(o)}</span>
                        {status?.summarizing.includes(o.id) && <Badge tone="brand">Writing notes…</Badge>}
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {timeOf.format(o.startedAt)}
                          {o.endedAt ? ` · ${duration(o.endedAt - o.startedAt)}` : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{o.preview || `${o.words} words`}</p>
                    </button>
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
