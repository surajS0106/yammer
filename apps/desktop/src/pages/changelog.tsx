import { CircleArrowUp, LoaderCircle } from "lucide-react";
import * as React from "react";

import { PageHeader, PlatformContext } from "@/App";
import { Badge, Button, Card, Section } from "@/components/ui";
import { formatReleaseDate, releases, type ChangeKind, type Release } from "@/lib/changelog";
import { useSettings } from "@/lib/settings";
import { installUpdate, useUpdate } from "@/lib/updater";

const kindLabel: Record<ChangeKind, string> = { new: "New", improved: "Improved", fixed: "Fixed" };
const kindTone = { new: "brand", improved: "muted", fixed: "warn" } as const;

function Changes({ changes }: { changes: Release["changes"] }) {
  return changes.map((c, i) => (
    <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <span className="w-16 shrink-0 pt-px">
        <Badge tone={kindTone[c.kind]}>{kindLabel[c.kind]}</Badge>
      </span>
      <span className="leading-relaxed">{c.text}</span>
    </div>
  ));
}

export function ChangelogPage() {
  const { settings, update } = useSettings();
  const platform = React.useContext(PlatformContext);
  const pending = useUpdate();
  const installed = platform?.version;

  // Opening the page counts as reading it, so the sidebar stops pointing here.
  React.useEffect(() => {
    if (installed && settings.seenChangelog !== installed) void update({ seenChangelog: installed });
  }, [installed, settings.seenChangelog, update]);

  return (
    <div className="space-y-6">
      <PageHeader title="What's new" description="The changes in each version of Yammer that you'd notice." />

      {pending.phase !== "idle" && (
        <Card className="border-primary/40 bg-primary/5">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CircleArrowUp className="size-4 text-primary" />
              Yammer {pending.version} is ready to install
            </div>
            <Button size="sm" onClick={() => void installUpdate()} disabled={pending.phase === "installing"}>
              {pending.phase === "installing" && <LoaderCircle className="animate-spin" />}
              {pending.phase === "installing" ? "Updating…" : pending.phase === "error" ? "Try again" : "Upgrade now"}
            </Button>
          </div>
          {pending.notes.length > 0 && (
            <div className="divide-y border-t border-primary/20">
              <Changes changes={pending.notes} />
            </div>
          )}
        </Card>
      )}

      {releases.map((r) => (
        <Section
          key={r.version}
          title={`Version ${r.version}${r.version === installed ? " · installed" : ""}`}
          description={formatReleaseDate(r.date)}
        >
          <Changes changes={r.changes} />
        </Section>
      ))}
    </div>
  );
}
