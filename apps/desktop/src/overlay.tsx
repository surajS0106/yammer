// The floating pill (the "overlay" window, overlay.rs). Always drawn dark so
// it reads on any background. It never takes focus. Clicks pass through it
// except on Sushi and the pill, whose boxes are reported to Rust as hit areas:
// drag either to move the overlay anywhere, double-click to send it home.
// Hovering the idle pill opens it into the island: a row of buttons, each
// named by a tooltip above it. The overlay never takes focus, so macOS sends it
// no mouse moves; hover comes from the cursor position Rust polls instead.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertCircle, Check, History, Loader2, Mic, Settings2 } from "lucide-react";
import { motion, type MotionValue, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import * as React from "react";

import { moodOf, Sushi } from "@/components/sushi";
import { api, on, type OverlayState } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const BARS = 24;
// Bar height in px at full voice, and the dot every bar shrinks to in silence.
const MAX = 24;
const DOT = 2;

// The waveform: a fixed wave of bar heights, each bar breathing on its own
// staggered loop. The bars also grow with the live mic level, on a spring so they move smoothly between the ~20 Hz
// level readings, and flatten to a line of dots in silence.
const SHAPE = Array.from({ length: BARS }, (_, i) => {
  const base = Math.sin(i * 0.5) * 0.5 + 0.5;
  const detail = Math.sin(i * 1.7) * 0.3;
  return Math.max(0.18, Math.min(1, base * 0.7 + detail + 0.3));
});

// Speech RMS sits around 0.02–0.2; below this it's room noise, and the wave lies flat.
const SPEAKING_RMS = 0.01;
// How long the wave keeps moving after the voice drops, so pauses between words don't flicker it.
const SPEAKING_HOLD_MS = 300;

function Meter() {
  const reduceMotion = useReducedMotion();
  const [speaking, setSpeaking] = React.useState(false);
  const level = useMotionValue(0);
  const swell = useSpring(level, { stiffness: 260, damping: 26 });
  React.useEffect(() => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const unlisten = on.level((rms) => {
      if (rms >= SPEAKING_RMS) {
        clearTimeout(quiet);
        quiet = undefined;
        setSpeaking(true);
        // A square root spreads speech over the meter; normal talking (~0.05)
        // reaches most of the height, and only loud speech pins it.
        level.set(Math.min(1, Math.sqrt(rms) * 4));
      } else {
        level.set(0);
        quiet ??= setTimeout(() => setSpeaking(false), SPEAKING_HOLD_MS);
      }
    });
    return () => {
      clearTimeout(quiet);
      void unlisten.then((f) => f());
    };
  }, [level]);
  const pulse = speaking && !reduceMotion;
  return (
    <div className="flex items-center gap-0.5" style={{ height: MAX }}>
      {SHAPE.map((h, i) => (
        <Bar key={i} index={i} shape={h} swell={swell} pulse={pulse} />
      ))}
    </div>
  );
}

function Bar({ index: i, shape: h, swell, pulse }: { index: number; shape: number; swell: MotionValue<number>; pulse: boolean }) {
  const height = useTransform(swell, (s) => Math.max(DOT, h * MAX * s));
  return (
    <motion.span
      className="w-[2px] rounded-full bg-white/85"
      style={{ height }}
      animate={pulse ? { scaleY: [1, 1.2 + h * 0.3, 1] } : { scaleY: 1 }}
      transition={
        pulse
          ? { duration: 0.7 + (i % 6) * 0.08, repeat: Infinity, ease: "easeInOut", delay: (i % 12) * 0.05 }
          : { duration: 0.2 }
      }
    />
  );
}

const ISLAND = [
  { id: "dictate", label: "Dictate", icon: Mic, run: () => api.overlayToggleDictation() },
  { id: "history", label: "History", icon: History, run: () => api.overlayOpen("history") },
  { id: "settings", label: "Settings", icon: Settings2, run: () => api.overlayOpen("general") },
] as const;

type Point = { x: number; y: number };

/** Whether `p` is within `pad` px of the rectangle. */
function near(r: DOMRect, p: Point, pad: number) {
  return p.x >= r.left - pad && p.x < r.right + pad && p.y >= r.top - pad && p.y < r.bottom + pad;
}

/** The hovered idle pill's buttons. Clicking one doesn't take focus. */
function IslandButtons({ cursor }: { cursor: Point | null }) {
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const tip = cursor && ISLAND.find((_, i) => buttons.current[i] && near(buttons.current[i].getBoundingClientRect(), cursor, 0))?.id;
  const [hotkey, setHotkey] = React.useState("");
  React.useEffect(() => {
    const load = () => api.hotkeyLabel().then(setHotkey, () => {});
    load();
    const unlisten = on.settingsChanged(load);
    return () => void unlisten.then((f) => f());
  }, []);

  return (
    <div className="flex items-center gap-1" style={{ animation: "pill-in 140ms 80ms ease-out both" }}>
      {ISLAND.map(({ id, label, icon: Icon, run }, i) => (
        <button
          key={id}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          type="button"
          aria-label={label}
          className={cn(
            "relative grid size-8 cursor-pointer place-items-center rounded-full text-white/85 transition-colors",
            tip === id && "bg-white/15 text-white",
          )}
          // Not a drag: the container drags on mousedown.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => void run().catch(() => {})}
        >
          <Icon className="size-4" strokeWidth={2.25} />
          {tip === id && (
            <span
              className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 bg-neutral-900/92 px-2.5 py-1 text-xs font-medium text-white shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
              style={{ animation: "tip-in 120ms ease-out both" }}
            >
              {label}
              {id === "dictate" && hotkey && <span className="font-normal text-white/55">{hotkey}</span>}
            </span>
          )}
        </button>
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

  // The idle pill opens into the island while the cursor is on it or on Sushi.
  // The thin pill gets some slack to be easier to catch.
  const [cursor, setCursor] = React.useState<Point | null>(null);
  const [hovered, setHovered] = React.useState(false);
  React.useEffect(() => setHovered(false), [state.phase]);
  React.useEffect(() => {
    const unlisten = on.overlayCursor((p) => {
      setCursor(p);
      setHovered((was) => {
        if (!p) return false;
        const pad = was ? 4 : 10;
        return [pillRef.current, sushiRef.current].some((el) => el && near(el.getBoundingClientRect(), p, pad));
      });
    });
    return () => void unlisten.then((f) => f());
  }, []);
  const open = state.phase === "idle" && hovered;

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
          className={cn(
            "relative z-20 flex items-center justify-center rounded-full border shadow-[0_4px_12px_rgba(0,0,0,0.25)] transition-[width,height,background-color,border-color] duration-150 ease-out",
            open ? "h-10 w-[120px] border-white/10 bg-neutral-900/92 backdrop-blur" : "h-2 w-12 border-white/20 bg-neutral-900/70",
          )}
          style={{ animation: "pill-in 140ms ease-out" }}
        >
          {open && <IslandButtons cursor={cursor} />}
        </div>
      ) : (
        <div
          ref={pillRef}
          key={state.phase}
          className={cn(
            "flex max-w-[304px] items-center gap-2 rounded-full border border-white/10 bg-neutral-900/92 py-1.5 text-[13px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur",
            state.phase === "listening" ? "px-3" : "px-4",
            state.phase === "message" && state.error && "border-red-400/30",
          )}
          style={{ animation: "pill-in 140ms ease-out" }}
        >
          {state.phase === "listening" && (
            <>
              <span className="size-1.5 shrink-0 rounded-full bg-red-500" style={{ animation: "dot-pulse 1.2s ease-in-out infinite" }} />
              <Meter />
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
