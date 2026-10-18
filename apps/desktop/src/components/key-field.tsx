// An API key input. The key goes straight to Rust (and the OS keychain);
// the UI only ever learns whether one is saved.

import * as React from "react";

import { Badge, Button, Input } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import type { SecretName } from "@/lib/tauri";

export function KeyField({ name, keyUrl }: { name: SecretName; keyUrl?: string }) {
  const { secrets, setSecret } = useSettings();
  const [draft, setDraft] = React.useState("");
  const saved = secrets[name];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2 @md:flex-nowrap">
        <Input
          className="min-w-0 flex-1 basis-48"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={saved ? "•••••••• (saved)" : "Paste your API key"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) void setSecret(name, draft).then(() => setDraft(""));
          }}
        />
        <Button disabled={!draft.trim()} onClick={() => void setSecret(name, draft).then(() => setDraft(""))}>
          Save
        </Button>
        {saved && (
          <Button variant="ghost" onClick={() => void setSecret(name, "")}>
            Remove
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {saved ? <Badge tone="brand">Key saved</Badge> : <Badge>No key</Badge>}
        <span>Stored in your system keychain, never in a file.</span>
        {keyUrl && (
          <a href={keyUrl} target="_blank" rel="noreferrer" className="ml-auto text-primary hover:underline">
            Get a key
          </a>
        )}
      </div>
    </div>
  );
}
