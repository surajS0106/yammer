// Ask about one meeting: a thread of questions and answers, saved on the
// meeting (`Meeting.chat`). While the meeting is going on it answers from
// what's been said so far, so "What did I miss?" works mid-call. The chips
// double as Granola-style quick actions: a follow-up email, the action items.

import { ArrowUp, CircleNotch as Loader2, Copy, Eraser } from "@phosphor-icons/react";
import * as React from "react";

import { Markdown } from "@/components/markdown";
import { Button, Textarea } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, type Meeting } from "@/lib/tauri";
import { cn, isAndroid } from "@/lib/utils";

const LIVE_PROMPTS = ["What did I miss?", "What should I ask next?", "Recap the last five minutes", "What has been decided so far?"];
const DONE_PROMPTS = ["Write a follow-up email", "List my action items", "What was decided?", "Draft a project plan from this"];

export function MeetingAsk({ meeting, live, onChange, className }: { meeting: Meeting; live: boolean; onChange: (m: Meeting) => void; className?: string }) {
  const { toast } = useSettings();
  const [draft, setDraft] = React.useState("");
  const [asking, setAsking] = React.useState<string | null>(null);
  const end = React.useRef<HTMLDivElement>(null);
  const thread = meeting.chat ?? [];

  React.useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [thread.length, asking]);

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
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {!thread.length && !asking && (
          <p className="px-1 pt-1 text-sm leading-relaxed text-muted-foreground">
            {live
              ? "Ask about what's been said so far. Answers come from the transcript and your notes."
              : "Ask anything about this meeting, or have something drafted from it. Answers come from the transcript and the notes."}
          </p>
        )}
        {thread.map((t, i) =>
          t.role === "user" ? (
            <Question key={i} text={t.text} />
          ) : (
            <div key={i} className="group space-y-1">
              <Markdown source={t.text} className="text-sm" />
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
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" /> Reading the meeting…
            </p>
          </>
        )}
        <div ref={end} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(live ? LIVE_PROMPTS : DONE_PROMPTS).map((p) => (
          <button
            key={p}
            type="button"
            disabled={!!asking}
            onClick={() => void ask(p)}
            className={cn(
              "rounded-full border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50",
              isAndroid ? "py-2" : "py-1",
            )}
          >
            {p}
          </button>
        ))}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <Textarea
          rows={1}
          className="max-h-32 min-h-0 flex-1 resize-none bg-card"
          placeholder={live ? "Ask about the meeting so far…" : "Ask about this meeting…"}
          aria-label="Ask about this meeting"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask(draft);
            }
          }}
        />
        <Button type="submit" size="icon" title="Ask" disabled={!draft.trim() || !!asking}>
          <ArrowUp weight="bold" />
        </Button>
        {thread.length > 0 && (
          <Button type="button" size="icon" variant="ghost" title="Clear the questions" disabled={!!asking} onClick={() => void clear()}>
            <Eraser />
          </Button>
        )}
      </form>
    </div>
  );
}

function Question({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/12 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}
