// Ask about one meeting, on Android only (desktop asks in Sush): a thread of questions and answers, saved on the
// meeting (`Meeting.chat`). While the meeting is going on it answers from
// what's been said so far, so "What did I miss?" works mid-call. The chips
// double as Granola-style quick actions: a follow-up email, the action items.

import {
  ChatCircleDots,
  CheckSquare,
  ClockCounterClockwise,
  Copy,
  EnvelopeSimple,
  Eraser,
  Kanban,
  ListChecks,
  Question as QuestionMark,
  Rewind,
} from "@phosphor-icons/react";
import * as React from "react";

import { Composer } from "@/components/composer";
import { Markdown } from "@/components/markdown";
import { Sushi } from "@/components/sushi";
import { Button } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, type Meeting } from "@/lib/tauri";
import { cn, isAndroid } from "@/lib/utils";

type Prompt = { text: string; hint: string; icon: React.ElementType };
const LIVE_PROMPTS: Prompt[] = [
  { text: "What did I miss?", hint: "Catch up on the call so far", icon: ClockCounterClockwise },
  { text: "What should I ask next?", hint: "Questions worth raising", icon: QuestionMark },
  { text: "Recap the last five minutes", hint: "Just what was said recently", icon: Rewind },
  { text: "What has been decided so far?", hint: "Decisions up to now", icon: ListChecks },
];
const DONE_PROMPTS: Prompt[] = [
  { text: "Write a follow-up email", hint: "A recap ready to send", icon: EnvelopeSimple },
  { text: "List my action items", hint: "Only what's yours to do", icon: CheckSquare },
  { text: "What was decided?", hint: "Each decision, and why", icon: ListChecks },
  { text: "Draft a project plan from this", hint: "Steps, owners and order", icon: Kanban },
];

export function MeetingAsk({ meeting, live, onChange, className }: { meeting: Meeting; live: boolean; onChange: (m: Meeting) => void; className?: string }) {
  const { toast } = useSettings();
  const [draft, setDraft] = React.useState("");
  const [asking, setAsking] = React.useState<string | null>(null);
  const end = React.useRef<HTMLDivElement>(null);
  const thread = meeting.chat ?? [];
  const prompts = live ? LIVE_PROMPTS : DONE_PROMPTS;
  const empty = !thread.length && !asking;

  React.useEffect(() => {
    if (!empty) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread.length, asking, empty]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(q);
    setDraft("");
    try {
      onChange(await api.meetingAsk(meeting.id, q));
    } catch (e) {
      toast(errorMessage(e));
      setDraft(q);
    } finally {
      setAsking(null);
    }
  };
  const clear = () => api.meetingUpdate(meeting.id, { clearChat: true }).then(onChange, (e) => toast(errorMessage(e)));

  return (
    <div className={cn("@container flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className={cn("mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-6", live ? "py-2" : "p-6")}>
            {!live && (
              <div className="flex flex-col items-center gap-2 text-center">
                <Sushi mood="idle" px={4} interactive className="mb-2 text-muted-foreground [@media(max-height:760px)]:hidden" />
                <h2 className="text-lg font-semibold tracking-tight">What would you like to know?</h2>
                <p className="max-w-md text-sm leading-relaxed text-balance text-muted-foreground">
                  Ask anything about this meeting, or have something drafted from it. Answers come from the transcript and the notes.
                </p>
              </div>
            )}
            {live && <p className="px-1 text-sm leading-relaxed text-muted-foreground">Ask about what's been said so far. Answers come from the transcript and your notes.</p>}
            <div className={cn("grid w-full gap-2", !live && "@md:grid-cols-2 @md:gap-3")}>
              {prompts.map((p) => (
                <button
                  key={p.text}
                  type="button"
                  onClick={() => void ask(p.text)}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border bg-background text-left transition-[color,background-color,border-color,scale] outline-none hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
                    live ? "px-3 py-2" : "p-4",
                  )}
                >
                  <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary", live ? "size-7" : "size-9")}>
                    <p.icon aria-hidden className={live ? "size-4" : "size-5"} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{p.text}</span>
                    {!live && <span className="block text-xs leading-5 text-muted-foreground">{p.hint}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={cn("mx-auto max-w-2xl space-y-6", live ? "py-2" : "px-4 py-6")}>
            {thread.map((t, i) =>
              t.role === "user" ? (
                <Question key={i} text={t.text} />
              ) : (
                <div key={i} className="group space-y-1">
                  <Markdown source={t.text} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn("-ml-2 text-muted-foreground", !isAndroid && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                    onClick={() => void api.copyText(t.text).then(() => toast("Copied.", "info"))}
                  >
                    <Copy /> Copy
                  </Button>
                </div>
              ),
            )}
            {asking && (
              <>
                <Question text={asking} />
                <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Sushi mood="transcribing" px={2} className="text-muted-foreground" /> Reading the meeting…
                </div>
              </>
            )}
            <div ref={end} />
          </div>
        )}
      </div>

      <div className={cn("shrink-0", !live && "border-t p-3")}>
        <div className="mx-auto max-w-2xl space-y-2">
          {!empty && (
            <div className="flex flex-wrap gap-2">
              {prompts.map((p) => (
                <button
                  key={p.text}
                  type="button"
                  disabled={!!asking}
                  onClick={() => void ask(p.text)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors outline-none hover:border-primary/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                    isAndroid ? "py-2" : "py-1",
                  )}
                >
                  <p.icon aria-hidden className="size-3.5" />
                  {p.text}
                </button>
              ))}
            </div>
          )}
          <Composer
            label="Ask about this meeting"
            placeholder={live ? "Ask about the meeting so far…" : "Ask about this meeting…"}
            sendLabel="Ask"
            icon={<ChatCircleDots />}
            value={draft}
            onChange={setDraft}
            busy={!!asking}
            onSubmit={() => void ask(draft)}
            actions={
              thread.length > 0 && (
                <Button size="icon" variant="ghost" title="Clear the questions" disabled={!!asking} onClick={() => void clear()}>
                  <Eraser />
                </Button>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

function Question({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/12 px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}
