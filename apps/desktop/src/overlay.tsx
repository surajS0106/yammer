// The floating pill (the "overlay" window, overlay.rs). Always drawn dark so
// it reads on any background. It never takes focus. Clicks pass through it
// except on Sushi and the pill, whose boxes are reported to Rust as hit areas:
// drag either to move the overlay anywhere, double-click to send it home.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import * as React from "react";

import { moodOf, Sushi } from "@/components/sushi";
import { api, on, type OverlayState } from "@/lib/tauri";
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
    let live = false;
    const unlisten = on.dictation((s) => {
      live = true;
      setState(s);
    });
    // The idle pill is shown at startup, before this webview may be listening.
    api.overlayState().then((s) => live || setState(s), () => {});
    return () => void unlisten.then((f) => f());
  }, []);

  const sushiRef = React.useRef<HTMLDivElement>(null);
  const pillRef = React.useRef<HTMLDivElement>(null);
  // Tell Rust where Sushi and the pill are, so only they take the mouse.
  React.useEffect(() => {
    const report = () => {
      const areas = [sushiRef.current, pillRef.current].flatMap((el) => {
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [{ x: r.x, y: r.y, width: r.width, height: r.height }];
      });
      api.overlayHitAreas(areas).catch(() => {});
    };
    report();
    // Again once the pill's entrance animation has settled.
    const t = setTimeout(report, 200);
    const observer = new ResizeObserver(report);
    for (const el of [sushiRef.current, pillRef.current]) if (el) observer.observe(el);
    return () => {
      clearTimeout(t);
      observer.disconnect();
    };
  }, [state.phase]);

  // Held while being dragged: until the window stops moving for a moment.
  const [held, setHeld] = React.useState(false);
  const letGo = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastDown = React.useRef(0);
  const holdOn = React.useCallback(() => {
    setHeld(true);
    clearTimeout(letGo.current);
    letGo.current = setTimeout(() => {
      letGo.current = undefined;
      setHeld(false);
    }, 300);
  }, []);
  React.useEffect(() => {
    // Only moves during a hold; the app placing the window isn't a drag.
    const unlisten = getCurrentWindow().onMoved(() => letGo.current && holdOn());
    return () => void unlisten.then((f) => f());
  }, [holdOn]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // The native drag swallows the second click, so spot the double-click here.
    const now = Date.now();
    if (now - lastDown.current < 350) {
      lastDown.current = 0;
      api.overlayResetPosition().catch(() => {});
      return;
    }
    lastDown.current = now;
    holdOn();
    getCurrentWindow()
      .startDragging()
      .catch(() => {});
  };

  if (state.phase === "hidden") return null;

  return (
    // Sushi stands on the pill's top edge, as it stands on Sush's composer, and
    // stays mounted across phases so it can act out each change.
    <div className="flex h-svh flex-col items-center justify-end pb-2 [&>*]:cursor-grab" onMouseDown={onMouseDown}>
      <div ref={sushiRef} className="relative z-10 -mb-px">
        <Sushi mood={moodOf(state)} held={held} className="text-white/70" />
      </div>
      {state.phase === "idle" ? (
        <div
          ref={pillRef}
          className="h-2 w-12 rounded-full border border-white/20 bg-neutral-900/70 shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
          style={{ animation: "pill-in 140ms ease-out" }}
        />
      ) : (
        <div
          ref={pillRef}
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
              <span className="shrink-0 text-white/85">{state.phase === "transcribing" ? "Transcribing…" : "Polishing…"}</span>
              <span className="truncate text-xs text-white/55">{state.phase === "transcribing" ? state.engine : state.model}</span>
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
        )}
      </div>
    );
  }
