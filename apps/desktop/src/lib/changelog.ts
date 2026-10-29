// The user-facing changelog: CHANGELOG.md at the repo root, bundled at build
// time. The release workflow publishes each version's section as the release
// notes, so an update's `body` parses with the same `parseNotes`.

import raw from "../../../../CHANGELOG.md?raw";

export type ChangeKind = "new" | "improved" | "fixed";

export interface Release {
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  changes: { kind: ChangeKind; text: string }[];
}

const kinds: Record<string, ChangeKind> = { new: "new", improved: "improved", fixed: "fixed" };

/** `### New` / `### Improved` / `### Fixed` sections of `- ` bullets. Anything else is ignored. */
export function parseNotes(text: string): Release["changes"] {
  const changes: Release["changes"] = [];
  let kind: ChangeKind | null = null;
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    const heading = /^###\s+(\w+)/.exec(line);
    if (heading) kind = kinds[heading[1].toLowerCase()] ?? null;
    else if (kind && /^[-*]\s+/.test(line)) changes.push({ kind, text: line.replace(/^[-*]\s+/, "").trim() });
  }
  return changes;
}

/** Released versions, newest first. `## Unreleased` is left out. */
export const releases: Release[] = raw
  .split(/^## /m)
  .slice(1)
  .flatMap((section) => {
    const [title, ...body] = section.split(/\r?\n/);
    const m = /^(\d+\.\d+\.\d+)\s+—\s+(\d{4}-\d{2}-\d{2})/.exec(title);
    return m ? [{ version: m[1], date: m[2], changes: parseNotes(body.join("\n")) }] : [];
  });

export function releaseOf(version: string): Release | undefined {
  return releases.find((r) => r.version === version);
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" });

export function formatReleaseDate(date: string): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}
