// Click, then press the new shortcut. Every global hotkey is released while
// listening, so pressing one here doesn't start a dictation. An optional
// hotkey (`onClear`) can be unset.

import * as React from "react";

import { Button, Hotkey, Kbd } from "@/components/ui";
import { api } from "@/lib/tauri";
import { isMac } from "@/lib/utils";

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

/** A KeyboardEvent as a Tauri accelerator ("CommandOrControl+Shift+Space"), or null if incomplete. */
function accelerator(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const mods: string[] = [];
  // The platform's primary modifier is stored portably, so settings carry across OSes.
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("CommandOrControl");
  if (isMac ? e.ctrlKey : e.metaKey) mods.push(isMac ? "Control" : "Super");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const fKey = /^F\d{1,2}$/.test(e.code);
  // A bare letter would fire every time you type it.
  if (mods.length === 0 && !fKey) return null;
  return [...mods, e.code].join("+");
}

/**
 * `onChange` resolves true once the new hotkey is saved (saving registers it);
 * false puts the saved ones back.
 */
export function HotkeyRecorder({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (accelerator: string) => Promise<boolean>;
  onClear?: () => void;
}) {
  const [listening, setListening] = React.useState(false);

  React.useEffect(() => {
    if (!listening) return;
    let done = false;
    void api.hotkeySuspend(true);
    const finish = async (next: string | null) => {
      if (done) return;
      done = true;
      setListening(false);
      // Saving registers the new hotkey; otherwise take the old one back.
      if (!next || !(await onChange(next))) await api.hotkeySuspend(false).catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return void finish(null);
      const acc = accelerator(e);
      if (acc) void finish(acc);
    };
    const onBlur = () => void finish(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      void finish(null);
    };
    // onChange is stable enough for one listening session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {listening ? (
        <span className="flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2.5 text-xs text-muted-foreground">
          Press a shortcut… <Kbd>Esc</Kbd> to cancel
        </span>
      ) : value ? (
        <Hotkey accelerator={value} />
      ) : (
        <span className="text-xs text-muted-foreground">Not set</span>
      )}
      {!listening && (
        <Button variant="outline" size="sm" onClick={() => setListening(true)}>
          {value ? "Change" : "Set"}
        </Button>
      )}
      {!listening && value && onClear && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Remove
        </Button>
      )}
    </div>
  );
}
