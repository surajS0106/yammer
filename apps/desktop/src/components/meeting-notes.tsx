// A meeting's written ("Enhanced") notes: read them with ticking checkboxes,
// edit them by hand, have them changed by asking ("make it shorter"), or
// write them again with another template. The user's own notes are the
// other half of the toggle, in pages/meetings.tsx.

import { ArrowClockwise as Rewrite, ArrowUUpLeft as Undo, CircleNotch as Loader2, MagicWand, PencilSimple, Sparkle as Sparkles } from "@phosphor-icons/react";
import * as React from "react";

import type { PageId } from "@/App";
import { Markdown, toggleCheck } from "@/components/markdown";
import { Button, Card, EmptyState, Input, Notice, Select, Textarea } from "@/components/ui";
import { useNoteTemplates } from "@/lib/meetings";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, type Meeting } from "@/lib/tauri";

export function EnhancedNotes({
  meeting,
  writing,
  canWrite,
  onChange,
  go,
}: {
  meeting: Meeting;
  /** Its notes are being written or revised. */
  writing: boolean;
  /** There's a transcript or notes of your own to write from. */
  canWrite: boolean;
  onChange: (m: Meeting) => void;
  go: (page: PageId) => void;
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
      className="w-48"
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
    <div className="space-y-3">
      <Card className="p-5">
        {editing !== null ? (
          <Textarea
            autoFocus
            className="min-h-80 font-mono text-[13px]"
            aria-label="Edit the notes"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
          />
        ) : (
          <Markdown source={meeting.summary} onToggle={(line) => save(toggleCheck(meeting.summary ?? "", line))} />
        )}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          {editing !== null ? (
            <>
              <span>Markdown: ## headings, - bullets, - [ ] action items.</span>
              <span className="ml-auto" />
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  save(editing);
                  setEditing(null);
                  setBefore(null);
                }}
              >
                Save
              </Button>
            </>
          ) : (
            <>
              {meeting.summaryBy && (
                <span>
                  Written by {meeting.summaryBy}
                  {template && meeting.template ? ` · ${template.name}` : ""}
                </span>
              )}
              <span className="ml-auto" />
              {picker}
              <Button size="sm" variant="ghost" onClick={() => setEditing(meeting.summary ?? "")}>
                <PencilSimple /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => write(template?.id)}>
                <Rewrite /> Write again
              </Button>
            </>
          )}
        </div>
      </Card>

      {editing === null && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void revise();
          }}
        >
          <Input
            className="flex-1 bg-card"
            aria-label="Ask for changes to the notes"
            placeholder="Ask for changes: shorter, more on pricing, add who owns each action…"
            value={request}
            disabled={revising}
            onChange={(e) => setRequest(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!request.trim() || revising}>
            {revising ? <Loader2 className="animate-spin" /> : <MagicWand />}
            {revising ? "Changing…" : "Change"}
          </Button>
          {before !== null && !revising && (
            <Button
              type="button"
              variant="ghost"
              title="Put back the notes from before that change"
              onClick={() => {
                save(before);
                setBefore(null);
              }}
            >
              <Undo /> Undo
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
