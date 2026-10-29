import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy, Loader2, RotateCcw, Trash2 } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/App";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { exportHistory, type ExportFormat } from "@/lib/export";
import { useSettings } from "@/lib/settings";
import { engineLabel, replaceEntry } from "@/lib/stats";
import { api, errorMessage, on, type HistoryEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function Item({ entry, onDelete }: { entry: HistoryEntry; onDelete: () => void }) {
  const { toast } = useSettings();
  const [showRaw, setShowRaw] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  // For an edit by voice the original is the selected text, and `raw` is what was said.
  const original = entry.selection ?? entry.raw;

  const retry = async () => {
    setRetrying(true);
    try {
      // The list picks up the new text from history-updated.
      const e = await api.historyRetry(entry.id);
      if (e.error) toast(e.error);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="group space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{time.format(entry.at)}</span>
        <span>·</span>
        <span>{(entry.durationMs / 1000).toFixed(1)}s</span>
        <Badge>{engineLabel(entry)}</Badge>
        {entry.error ? (
          <Badge tone="error">Failed</Badge>
        ) : entry.selection ? (
          <Badge tone="brand">Edited by voice</Badge>
        ) : (
          entry.cleanup && <Badge tone="brand">Cleaned · {entry.cleanup}</Badge>
        )}
        {original && !entry.error && (
          <button type="button" className="text-primary hover:underline" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Hide original" : "Show original"}
          </button>
        )}
        {/* A failed entry's buttons stay visible: retrying is the point of it. */}
        <div className={cn("ml-auto flex transition-opacity group-hover:opacity-100 focus-within:opacity-100", !entry.error && !retrying && "pointer-fine:opacity-0")}>
          {entry.audio && (
            <Button size="icon" variant="ghost" title="Transcribe again with your current settings" disabled={retrying} onClick={() => void retry()}>
              {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            </Button>
          )}
          {!entry.error && (
            <Button
              size="icon"
              variant="ghost"
              title="Copy"
              onClick={() => void api.copyText(entry.text).then(() => toast("Copied.", "info"), (e) => toast(errorMessage(e)))}
            >
              <Copy />
            </Button>
          )}
          <Button size="icon" variant="ghost" title="Delete" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
      {entry.error ? (
        <p className="text-sm leading-relaxed text-destructive">
          {entry.error}
          {!entry.audio && <span className="text-muted-foreground"> Its recording wasn’t kept, so it can’t be retried.</span>}
        </p>
      ) : (
        <>
          {entry.selection && entry.raw && <p className="text-xs text-muted-foreground italic">“{entry.raw}”</p>}
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap select-text">{entry.text}</p>
        </>
      )}
      {showRaw && original && <p className="border-l-2 pl-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{original}</p>}
    </div>
  );
}

const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_KEY = "history.pageSize";

function loadPageSize() {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (PAGE_SIZES.includes(n)) return n;
  } catch {}
  return 25;
}

function Pagination({
  page,
  pages,
  start,
  count,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  start: number;
  count: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <label className="flex items-center gap-2">
        Rows per page
        <Select className="w-auto" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          {start + 1}–{start + count} of {total}
        </span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" title="First page" disabled={page <= 1} onClick={() => onPage(1)}>
            <ChevronsLeft />
          </Button>
          <Button size="icon" variant="ghost" title="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft />
          </Button>
          <span className="px-1 tabular-nums">
            Page {page} of {pages}
          </span>
          <Button size="icon" variant="ghost" title="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight />
          </Button>
          <Button size="icon" variant="ghost" title="Last page" disabled={page >= pages} onClick={() => onPage(pages)}>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function HistoryPage() {
  const { toast } = useSettings();
  const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(loadPageSize);
  const top = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    api.historyList().then(setEntries, () => {});
    const unlisten = [
      on.historyAdded((e) => setEntries((list) => [e, ...list])),
      on.historyUpdated((e) => setEntries((list) => replaceEntry(list, e))),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, []);

  const q = query.trim().toLowerCase();
  const matches = q ? entries.filter((e) => (e.error ?? e.text).toLowerCase().includes(q)) : entries;
  const words = entries.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);

  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  // Clamp rather than reset, so deleting the last row on a page steps back one page.
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const shown = matches.slice(start, start + pageSize);

  // What the search shows, or everything.
  const exportAs = async (format: ExportFormat) => {
    const { name, contents } = exportHistory(matches, format);
    try {
      toast(`Saved to ${await api.exportFile(name, contents)}`, "info");
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  return (
    <div ref={top} className="space-y-6">
      <PageHeader
        title="History"
        description={entries.length ? `${entries.length} dictations, ${words.toLocaleString()} words. Kept on this computer only.` : "Your dictations show up here."}
      />
      {entries.length > 0 && (
        <div className="flex gap-2">
          <Input
            placeholder="Search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <Select
            className="w-auto"
            aria-label="Export"
            title={q ? "Export the dictations that match your search to Downloads" : "Export every dictation to Downloads"}
            value=""
            onChange={(e) => void exportAs(e.target.value as ExportFormat)}
          >
            <option value="" disabled>
              Export…
            </option>
            <option value="md">Markdown</option>
            <option value="csv">CSV (spreadsheet)</option>
          </Select>
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
      {matches.length > 0 && (
        <Pagination
          page={current}
          pages={pages}
          start={start}
          count={shown.length}
          total={matches.length}
          pageSize={pageSize}
          onPage={(p) => {
            setPage(p);
            // The controls sit below the list, so jump back to the first row of the new page.
            top.current?.scrollIntoView({ block: "start" });
          }}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(Math.floor(start / size) + 1);
            try {
              localStorage.setItem(PAGE_SIZE_KEY, String(size));
            } catch {}
          }}
        />
      )}
      {entries.length > 0 && matches.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
    </div>
  );
}
