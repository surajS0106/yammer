import { Copy, Trash2 } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/App";
import { Badge, Button, Card, Input } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { engineLabel } from "@/lib/stats";
import { api, errorMessage, on, type HistoryEntry } from "@/lib/tauri";

const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function Item({ entry, onDelete }: { entry: HistoryEntry; onDelete: () => void }) {
  const { toast } = useSettings();
  const [showRaw, setShowRaw] = React.useState(false);
  return (
    <div className="group space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{time.format(entry.at)}</span>
        <span>·</span>
        <span>{(entry.durationMs / 1000).toFixed(1)}s</span>
        <Badge>{engineLabel(entry)}</Badge>
        {entry.cleanup && <Badge tone="brand">Cleaned · {entry.cleanup}</Badge>}
        {entry.raw && (
          <button type="button" className="text-primary hover:underline" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Hide original" : "Show original"}
          </button>
        )}
        <div className="ml-auto flex transition-opacity pointer-fine:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            title="Copy"
            onClick={() => void api.copyText(entry.text).then(() => toast("Copied.", "info"), (e) => toast(errorMessage(e)))}
          >
            <Copy />
          </Button>
          <Button size="icon" variant="ghost" title="Delete" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap select-text">{entry.text}</p>
      {showRaw && entry.raw && <p className="border-l-2 pl-3 text-sm leading-relaxed text-muted-foreground">{entry.raw}</p>}
    </div>
  );
}

export function HistoryPage() {
  const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    api.historyList().then(setEntries, () => {});
    const unlisten = on.historyAdded((e) => setEntries((list) => [e, ...list]));
    return () => void unlisten.then((f) => f());
  }, []);

  const q = query.trim().toLowerCase();
  const shown = q ? entries.filter((e) => e.text.toLowerCase().includes(q)) : entries;
  const words = entries.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="History"
        description={entries.length ? `${entries.length} dictations, ${words.toLocaleString()} words. Kept on this computer only.` : "Your dictations show up here."}
      />
      {entries.length > 0 && (
        <div className="flex gap-2">
          <Input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm("Delete all dictation history?")) void api.historyClear().then(() => setEntries([]));
            }}
          >
            Clear all
          </Button>
        </div>
      )}
      {shown.length > 0 && (
        <Card className="divide-y">
          {shown.map((e) => (
            <Item key={e.id} entry={e} onDelete={() => void api.historyDelete(e.id).then(() => setEntries((l) => l.filter((x) => x.id !== e.id)))} />
          ))}
        </Card>
      )}
      {entries.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
    </div>
  );
}
