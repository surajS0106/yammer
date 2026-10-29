// History export as Markdown (to read) or CSV (for a spreadsheet). Built here
// rather than in Rust for the local date format; `api.exportFile` saves it.

import { engineLabel } from "@/lib/stats";
import type { HistoryEntry } from "@/lib/tauri";

export type ExportFormat = "md" | "csv";

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

function markdown(entries: HistoryEntry[]): string {
  const out = ["# Yammer history", ""];
  let heading = "";
  // Oldest first, grouped by day, the way you'd read it back.
  for (const e of [...entries].reverse()) {
    const d = day.format(e.at);
    if (d !== heading) {
      heading = d;
      out.push(`## ${d}`, "");
    }
    const edit = e.selection ? ` · edited by voice: “${e.raw ?? ""}”` : "";
    out.push(`**${time.format(e.at)}** · ${engineLabel(e)}${e.cleanup ? ` · ${e.cleanup}` : ""}${edit}`, "", e.text, "");
  }
  return out.join("\n");
}

/** A CSV field: quoted, with quotes doubled, so commas and newlines survive. */
const field = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

function csv(entries: HistoryEntry[]): string {
  const rows = [["time", "text", "original", "seconds", "engine", "cleanup", "language"].map(field).join(",")];
  for (const e of entries) {
    const original = e.selection ?? e.raw ?? "";
    rows.push(
      [new Date(e.at).toISOString(), e.text, original, (e.durationMs / 1000).toFixed(1), engineLabel(e), e.cleanup ?? "", e.language ?? ""].map(field).join(","),
    );
  }
  // CRLF, and a byte-order mark so Excel reads it as UTF-8.
  return "﻿" + rows.join("\r\n") + "\r\n";
}

/** The file name and contents for `entries` (newest first, as History holds them). */
export function exportHistory(entries: HistoryEntry[], format: ExportFormat): { name: string; contents: string } {
  const date = new Date().toISOString().slice(0, 10);
  const done = entries.filter((e) => !e.error);
  return { name: `Yammer history ${date}.${format}`, contents: format === "md" ? markdown(done) : csv(done) };
}
