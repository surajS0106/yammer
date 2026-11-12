// Click, then press the new shortcut. Every global hotkey is released while
// listening, so pressing one here doesn't start a dictation. The keys show as
// they're held, and a shortcut the OS already uses is refused with the reason
// (see lib/reserved-hotkeys.ts). An optional hotkey (`onClear`) can be unset.

import * as React from "react";

import { Button, Hotkey, Kbd } from "@/components/ui";
import { reservedBy, systemName } from "@/lib/reserved-hotkeys";
import { api } from "@/lib/tauri";
import { cn, hotkeyParts, isMac } from "@/lib/utils";

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

/** The held modifiers, as accelerator names. The platform's primary one is stored portably, so settings carry across OSes. */
function modifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("CommandOrControl");
  if (isMac ? e.ctrlKey : e.metaKey) mods.push(isMac ? "Control" : "Super");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return mods;
}

const MODIFIER_HINT = isMac ? "⌘, ⌥, ⌃ or ⇧" : "Ctrl, Alt, Shift or Win";

/** "⌘ ⇧ Space", for messages. */
const spoken = (accelerator: string) => hotkeyParts(accelerator).join(" ");

/**
 * `onChange` resolves true once the new hotkey is saved (saving registers it);
 * false puts the saved ones back.
 */
export function HotkeyRecorder({
  value,
  onChange,
  onClear,
  align = "end",
}: {
  value: string;
  onChange: (accelerator: string) => Promise<boolean>;
  onClear?: () => void;
  align?: "end" | "center";
}) {
  const [listening, setListening] = React.useState(false);
  /** What's held right now: modifiers, plus the key when the combination is refused. */
  const [held, setHeld] = React.useState<string[]>([]);
  /** Why the last press wasn't taken. Stays after listening ends, until the next try. */
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!listening) return;
    let done = false;
    let mods: string[] = [];
    void api.hotkeySuspend(true);
    const finish = async (next: string | null) => {
      if (done) return;
      done = true;
      setListening(false);
      setHeld([]);
      // Saving registers the new hotkey; otherwise take the old one back.
      if (!next || !(await onChange(next))) await api.hotkeySuspend(false).catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      mods = modifiers(e);
      if (e.key === "Escape" && mods.length === 0) return void finish(null);
      if (MODIFIER_CODES.has(e.code)) {
        setHeld(mods);
        return;
      }
      const acc = [...mods, e.code].join("+");
      setHeld(acc.split("+"));
      // A bare letter would fire every time you type it.
      if (mods.length === 0 && !/^F\d{1,2}$/.test(e.code)) {
        return setProblem(`A single key would fire every time you type it. Hold ${MODIFIER_HINT} with it.`);
      }
      const owner = reservedBy(acc);
      if (owner) return setProblem(`${spoken(acc)} is already ${systemName}'s shortcut for ${owner}. Try another.`);
      setProblem(null);
      void finish(acc);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      mods = modifiers(e);
      setHeld(mods);
    };
    // The OS acts on its own shortcuts (⌘Space, ⌘Tab, Win+L) before the window
    // sees the key, usually by taking focus. Modifiers still held means that's what happened.
    const onBlur = () => {
      if (mods.length) setProblem(`${spoken(mods.join("+"))} + that key is a shortcut ${systemName} keeps for itself, so Yammer can't use it. Try another.`);
      void finish(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      void finish(null);
    };
    // onChange is stable enough for one listening session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  const start = () => {
    setProblem(null);
    setListening(true);
  };

  return (
    <div className={cn("flex max-w-full flex-col gap-1.5", align === "center" ? "items-center text-center" : "items-end text-right")}>
      <div className="flex flex-wrap items-center gap-2">
        {listening ? (
          <span
            aria-live="polite"
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground transition-colors",
              problem ? "border-destructive/40 bg-destructive/5" : "border-primary/40 bg-primary/5",
            )}
          >
            {held.length ? (
              <>
                {hotkeyParts(held.join("+")).map((part, i) => (
                  <Kbd key={i}>{part}</Kbd>
                ))}
                {held.every((k) => ["CommandOrControl", "Control", "Super", "Alt", "Shift"].includes(k)) && (
                  <Kbd className="border-dashed text-muted-foreground">…</Kbd>
                )}
              </>
            ) : (
              <>
                Press a shortcut… <Kbd>Esc</Kbd> to cancel
              </>
            )}
          </span>
        ) : value ? (
          <Hotkey accelerator={value} />
        ) : (
          <span className="text-xs text-muted-foreground">Not set</span>
        )}
        {!listening && (
          <Button variant="outline" size="sm" onClick={start}>
            {value ? "Change" : "Set"}
          </Button>
        )}
        {!listening && value && onClear && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Remove
          </Button>
        )}
      </div>
      {problem && (
        <p role="alert" className="max-w-72 text-xs leading-relaxed text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
