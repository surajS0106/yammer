// An API key input. The key goes straight to Rust (and the OS keychain);
// the UI only ever learns whether one is saved. Keys are per provider, so the
// same field on another page shows the same key.

import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowSquareOut as ExternalLink, Key as KeyRound } from "@phosphor-icons/react";
import * as React from "react";

import { Badge, Button, Input } from "@/components/ui";
import { keyUsers } from "@/lib/presets";
import { useSettings } from "@/lib/settings";
import type { SecretName } from "@/lib/tauri";
import { isAndroid } from "@/lib/utils";

/** `page` is the page showing the field, left out of the "also used for" line. */
export function KeyField({ name, keyUrl, page }: { name: SecretName; keyUrl?: string; page?: string }) {
  const { settings, secrets, setSecret } = useSettings();
  const [draft, setDraft] = React.useState("");
  const saved = !!secrets[name];
  const others = keyUsers(settings, name).filter((p) => p !== page);

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
        <span>
          {isAndroid ? "Stored encrypted on this phone, with a key the Android Keystore holds." : "Stored in your system keychain, never in a file."}
          {others.length > 0 && ` Also used for ${others.join(" and ")}.`}
        </span>
        {keyUrl && (
          <Button size="sm" variant="outline" className="ml-auto" title={keyUrl} onClick={() => void openUrl(keyUrl)}>
            <KeyRound />
            Get an API key
            <ExternalLink className="text-muted-foreground" />
          </Button>
        )}
      </div>
    </div>
  );
}
