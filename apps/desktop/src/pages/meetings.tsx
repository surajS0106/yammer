// Meetings: start transcribing a call, watch it written down as it happens
// (you and everyone else, side by side with your own notes), and read the
// notes written from it once it ends. A phone can't hear another app's call,
// so there it transcribes the room: one microphone hearing everyone.

import {
  ArrowClockwise as Rewrite,
  ArrowLeft,
  Copy,
  DownloadSimple as Download,
  GearSix as Settings2,
  CircleNotch as Loader2,
  Microphone as Mic,
  Record as RecordIcon,
  SpeakerHigh as Speaker,
  Sparkle as Sparkles,
  Stop,
  Trash as Trash2,
  UsersThree as Users,
} from "@phosphor-icons/react";
import * as React from "react";

import { PageHeader, type PageId } from "@/App";
import { Markdown, toggleCheck } from "@/components/markdown";
import { Badge, Button, Card, CommitInput, EmptyState, Hotkey, Notice, Segmented, Textarea } from "@/components/ui";
import { useBackKey } from "@/lib/back";
import { useDockAction } from "@/lib/dock";
import { useMeetingStatus } from "@/lib/meetings";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, on, type Meeting, type MeetingOverview, type MeetingStatus, type Segment, type Speaker as Who } from "@/lib/tauri";
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
  if (min < 1) return "under a minute";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
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

type Tab = "notes" | "transcript" | "yours";

function MeetingView({ id, status, onBack, go }: { id: number; status: MeetingStatus | null; onBack: () => void; go: (page: PageId) => void }) {
  const { settings, toast } = useSettings();
  const [meeting, setMeeting] = React.useState<Meeting | null>(null);
  const [tab, setTab] = React.useState<Tab | null>(null);
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
  const summarize = () => api.meetingSummarize(id).then(setMeeting, (e) => toast(errorMessage(e)));
  const toggle = (line: number) => {
    if (!meeting.summary) return;
    const summary = toggleCheck(meeting.summary, line);
    setMeeting({ ...meeting, summary });
    api.meetingUpdate(id, { summary }).catch((e) => toast(errorMessage(e)));
  };
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
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{stopping ? "Finishing the transcript…" : "Transcribing this meeting"}</div>
            <div className="truncate text-xs text-muted-foreground">{status?.live?.engine ?? meeting.engine}</div>
          </div>
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
        {meeting.notice && <Notice tone="warn">{meeting.notice}</Notice>}
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
          <Card className={cn("min-h-72 overflow-y-auto p-4", isAndroid ? "h-[50vh] rounded-3xl" : "h-[60vh]")}>
            <Transcript segments={meeting.segments} live />
          </Card>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">Your notes</h2>
              <Button size="sm" variant="ghost" onClick={onBack}>
                <ArrowLeft /> All meetings
              </Button>
            </div>
            <YourNotes className="flex-1 @3xl:h-full" value={notes} onChange={setNotes} live />
          </div>
        </div>
      </div>
    );
  }

  const shownTab: Tab = tab ?? (meeting.summary || writing ? "notes" : "transcript");
  const copyText = shownTab === "notes" ? meeting.summary ?? "" : shownTab === "yours" ? notes : transcriptText(meeting.segments);
  const words = meeting.segments.reduce((n, s) => n + (s.text.trim() ? s.text.trim().split(/\s+/).length : 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft /> All meetings
        </Button>
        <span className="ml-auto" />
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
      </div>

      {meeting.notice && <Notice tone="warn">{meeting.notice}</Notice>}

      <Segmented<Tab>
        value={shownTab}
        onChange={setTab}
        options={[
          { value: "notes", label: "Notes" },
          { value: "transcript", label: "Transcript" },
          { value: "yours", label: "Your notes" },
        ]}
      />

      {shownTab === "notes" &&
        (writing ? (
          <Card className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            Writing the notes with {settings.cleanup.model}…
          </Card>
        ) : meeting.summary ? (
          <Card className="p-5">
            <Markdown source={meeting.summary} onToggle={toggle} />
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              {meeting.summaryBy && <span>Written by {meeting.summaryBy}</span>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void summarize()}>
                <Rewrite /> Write again
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {meeting.error && <Notice tone="error">{meeting.error}</Notice>}
            <EmptyState
              icon={Sparkles}
              title={meeting.error ? "The notes weren't written" : "No notes yet"}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => void summarize()} disabled={!words && !notes.trim()}>
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
              Your AI cleanup model turns the transcript and your own notes into minutes, a summary or a list of action items.
            </EmptyState>
          </div>
        ))}

      {shownTab === "transcript" && (
        <Card className="p-5">
          <Transcript segments={meeting.segments} live={false} />
        </Card>
      )}

      {shownTab === "yours" && <YourNotes className="min-h-64" value={notes} onChange={setNotes} live={false} />}
    </div>
  );
}

export function MeetingsPage({ go }: { go: (page: PageId) => void }) {
  const { settings, toast } = useSettings();
  const status = useMeetingStatus();
  const [list, setList] = React.useState<MeetingOverview[] | null>(null);
  const [open, setOpen] = React.useState<number | null>(null);
  const [starting, setStarting] = React.useState(false);
  const live = status?.live ?? null;
  const now = useNow(!!live);

  const reload = React.useCallback(() => void api.meetingsList().then(setList, (e) => toast(errorMessage(e))), [toast]);
  React.useEffect(() => {
    reload();
    const subs = [on.meetingUpdated(reload), on.meetingStatus(reload)];
    return () => subs.forEach((u) => void u.then((f) => f()));
  }, [reload]);
  useBackKey(open !== null ? 1 : 0, () => setOpen(null));

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const started = await api.meetingStart();
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
          </div>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold">Past meetings</h2>
        {past.length > 0 ? (
          <Card className="divide-y">
            {past.map((o) => (
              <button key={o.id} type="button" className="block w-full px-4 py-3 text-left transition-colors hover:bg-accent/60" onClick={() => setOpen(o.id)}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{titleOf(o)}</span>
                  {status?.summarizing.includes(o.id) ? <Badge tone="brand">Writing notes…</Badge> : o.hasSummary && <Badge>Notes</Badge>}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {when.format(o.startedAt)}
                    {o.endedAt ? ` · ${duration(o.endedAt - o.startedAt)}` : ""}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{o.preview || `${o.words} words`}</p>
              </button>
            ))}
          </Card>
        ) : list ? (
          <EmptyState icon={Users} title="No meetings yet">
            Each meeting you transcribe is kept here on this {isAndroid ? "phone" : "computer"}, with its transcript and notes.
          </EmptyState>
        ) : null}
      </section>
    </div>
  );
}
