// The floating pill (the "overlay" window, overlay.rs). Always drawn dark so
// it reads on any background. It never takes focus or clicks.

import { AlertCircle, Check, Loader2 } from "lucide-react";
import * as React from "react";

import { on, type OverlayState } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const BARS = 18;

function Meter() {
  const [levels, setLevels] = React.useState<number[]>(() => Array(BARS).fill(0));
  React.useEffect(() => {
    const unlisten = on.level((rms) => {
      // Speech RMS sits around 0.02–0.2; a square root spreads it over the meter.
      const v = Math.min(1, Math.sqrt(rms) * 2.4);
      setLevels((prev) => [...prev.slice(1), v]);
    });
    return () => void unlisten.then((f) => f());
  }, []);
  return (
    <div className="flex h-5 items-center gap-[3px]">
      {levels.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-white/85 transition-[height] duration-75"
          style={{ height: `${Math.max(3, v * 20)}px` }}
        />
      ))}
    </div>
  );
}

export function Overlay() {
  const [state, setState] = React.useState<OverlayState>({ phase: "hidden" });
  React.useEffect(() => {
    const unlisten = on.dictation(setState);
    return () => void unlisten.then((f) => f());
  }, []);

  if (state.phase === "hidden") return null;

  return (
    <div className="flex h-svh items-end justify-center pb-2">
      <div
        key={state.phase}
        className={cn(
          "flex max-w-[304px] items-center gap-2.5 rounded-full border border-white/10 bg-neutral-900/92 px-4 py-2 text-[13px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur",
          state.phase === "message" && state.error && "border-red-400/30",
        )}
        style={{ animation: "pill-in 140ms ease-out" }}
      >
        {state.phase === "listening" && (
          <>
            <span className="size-2 shrink-0 rounded-full bg-red-500" style={{ animation: "dot-pulse 1.2s ease-in-out infinite" }} />
            <Meter />
            {state.hint && <span className="truncate text-xs text-white/60">{state.hint}</span>}
          </>
        )}
        {(state.phase === "transcribing" || state.phase === "polishing") && (
          <>
            <Loader2 className="size-4 shrink-0 animate-spin text-white/80" />
            <span className="text-white/85">{state.phase === "transcribing" ? "Transcribing…" : "Polishing…"}</span>
          </>
        )}
        {state.phase === "message" && (
          <>
            {state.error ? (
              <AlertCircle className="size-4 shrink-0 text-red-400" />
            ) : (
              <Check className="size-4 shrink-0 text-emerald-400" />
            )}
            <span className="line-clamp-2 text-xs leading-snug text-white/90">{state.text}</span>
          </>
        )}
      </div>
    </div>
  );
}
