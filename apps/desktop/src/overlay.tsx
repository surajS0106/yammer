// The floating pill (the "overlay" window, overlay.rs). Always drawn dark so
// it reads on any background. It never takes focus. Clicks pass through it
// except on Sushi and the pill, whose boxes are reported to Rust as hit areas:
// drag either to move the overlay anywhere, double-click to send it home.
// Hovering the idle pill opens it into the island: a row of buttons, each
// named by a tooltip above it. When a dictation had no text box to go into,
// the pill becomes a card holding the transcript, with Sushi inside it. When a
// dictation heard words the Dictionary doesn't know, a card offers to add them
// (inside the transcript card, if that's showing). The overlay never takes focus, so macOS sends it
// no mouse moves; hover comes from the cursor position Rust polls instead.

import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  Copy,
  EyeOff,
  History,
  Loader2,
  type LucideIcon,
  Mic,
  Plus,
  Power,
  Settings2,
  Square,
  X,
} from "lucide-react";
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

/** The dictation hotkey as shown to the user, e.g. "Ctrl+Shift+Space". */
function useHotkeyLabel() {
  const [hotkey, setHotkey] = React.useState("");
  React.useEffect(() => {
    const load = () => api.hotkeyLabel().then(setHotkey, () => {});
    load();
    const unlisten = on.settingsChanged(load);
    return () => void unlisten.then((f) => f());
  }, []);
  return hotkey;
}

/** The hovered idle pill's buttons. Clicking one doesn't take focus. */
function IslandButtons({ cursor }: { cursor: Point | null }) {
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const tip = cursor && ISLAND.find((_, i) => buttons.current[i] && near(buttons.current[i].getBoundingClientRect(), cursor, 0))?.id;
  const hotkey = useHotkeyLabel();

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

const MENU_WIDTH = 224;
/** How long the cursor can stray from the menu before it closes. */
const MENU_LINGER_MS = 350;

type MenuItem = { id: string; label: string; icon: LucideIcon; run: () => Promise<void>; hint?: string; danger?: boolean };

/**
 * The right-click menu, drawn like the island rather than as the webview's own.
 * Like the island, it can't take focus or see mouse moves, so its highlight
 * follows the cursor Rust polls, and it closes once the cursor wanders off.
 */
const ContextMenu = React.forwardRef<HTMLDivElement, { at: Point; cursor: Point | null; phase: OverlayState["phase"]; onClose: () => void }>(
  function ContextMenu({ at, cursor, phase, onClose }, ref) {
    const hotkey = useHotkeyLabel();
    const dictating = phase === "listening" || phase === "transcribing" || phase === "polishing";
    const groups: MenuItem[][] = [
      [{ id: "dictate", label: dictating ? "Stop dictation" : "Start dictation", icon: dictating ? Square : Mic, hint: hotkey, run: api.overlayToggleDictation }],
      [
        { id: "history", label: "History", icon: History, run: () => api.overlayOpen("history") },
        { id: "settings", label: "Settings", icon: Settings2, run: () => api.overlayOpen("general") },
      ],
      [
        { id: "reset", label: "Move to bottom", icon: ArrowDownToLine, run: api.overlayResetPosition },
        // Outside dictation, a visible pill means "Always show the pill" is on.
        ...(phase === "idle" ? [{ id: "hide", label: "Hide pill", icon: EyeOff, run: api.overlayHide }] : []),
      ],
      [{ id: "quit", label: "Quit Yammer", icon: Power, run: api.quit, danger: true }],
    ];

    const items = React.useRef(new Map<string, HTMLButtonElement>());
    const hot =
      cursor && [...items.current].find(([, el]) => el.isConnected && near(el.getBoundingClientRect(), cursor, 0))?.[0];

    // Opens up and to the right of the click, kept inside the window.
    const left = Math.min(Math.max(6, at.x - 10), window.innerWidth - MENU_WIDTH - 6);
    const bottom = Math.max(6, window.innerHeight - at.y + 6);

    return (
      <motion.div
        ref={ref}
        role="menu"
        initial={{ opacity: 0, y: 4, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="fixed z-30 origin-bottom-left rounded-2xl border border-white/10 bg-neutral-900/95 p-1.5 text-[13px] text-white shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl select-none"
        style={{ left, bottom, width: MENU_WIDTH }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {groups.map((group, g) => (
          <React.Fragment key={g}>
            {g > 0 && <div className="mx-2 my-1 h-px bg-white/[0.08]" />}
            {group.map(({ id, label, icon: Icon, hint, danger, run }) => (
              <button
                key={id}
                ref={(el) => {
                  if (el) items.current.set(id, el);
                  else items.current.delete(id);
                }}
                type="button"
                role="menuitem"
                className={cn(
                  "flex h-8 w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-75",
                  danger ? "text-red-300/90" : "text-white/85",
                  hot === id && (danger ? "bg-red-500/15 text-red-200" : "bg-white/10 text-white"),
                )}
                onClick={() => {
                  onClose();
                  void run().catch(() => {});
                }}
              >
                <Icon className={cn("size-4 shrink-0", !danger && (hot === id ? "text-white" : "text-white/55"))} strokeWidth={2} />
                <span className="flex-1 truncate">{label}</span>
                {hint && <span className="shrink-0 text-[11px] text-white/40">{hint}</span>}
              </button>
            ))}
          </React.Fragment>
        ))}
      </motion.div>
    );
  },
);

/** How long the transcript card stays up. Hovering it holds the countdown. */
const TRANSCRIPT_MS = 12_000;
/** How long the new-words card stays up, held the same way. */
const WORDS_MS = 10_000;
const RING_RADIUS = 14;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const CARD =
  "relative z-20 flex w-[304px] flex-col gap-3 rounded-[20px] border border-white/10 bg-neutral-900/95 p-4 text-white shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl";

/** A card's text button (Copy, Add, …), lit while the cursor is on it. */
function pillButton(hot: boolean) {
  return cn(
    "flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-4 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-50",
    hot ? "bg-white/20 text-white" : "bg-white/12 text-white/90",
  );
}

/** A card's close button, with a ring around it that counts down to closing the card. */
function CloseRing({ ms, paused, hot, onClose, buttonRef }: { ms: number; paused: boolean; hot: boolean; onClose: () => void; buttonRef: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Close"
      className={cn(
        "relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-white/70 transition-colors",
        hot && "bg-white/10 text-white",
      )}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 32 32" aria-hidden>
        <circle cx={16} cy={16} r={RING_RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={2} />
        <circle
          cx={16}
          cy={16}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          style={
            {
              "--ring-length": RING_LENGTH,
              animation: `ring-drain ${ms}ms linear forwards`,
              animationPlayState: paused ? "paused" : "running",
            } as React.CSSProperties
          }
          onAnimationEnd={onClose}
        />
      </svg>
      <X className="size-3.5" strokeWidth={2.5} />
    </button>
  );
}

/**
 * Words the dictation heard that the Dictionary doesn't know, as chips that
 * click on and off. Add saves the ticked ones and never offers the rest
 * again; "Don't ask" never offers any of them again. `actions` are the
 * card's own buttons, kept on the same row.
 */
function NewWords({
  words,
  label,
  over,
  onDone,
  actions,
}: {
  words: string[];
  label?: string;
  over: (el: HTMLElement | null) => boolean;
  onDone: () => void;
  actions?: React.ReactNode;
}) {
  const [picked, setPicked] = React.useState(() => new Set(words));
  // How many were added, once saved.
  const [added, setAdded] = React.useState<number | null>(null);
  const chips = React.useRef<(HTMLButtonElement | null)[]>([]);
  const skipRef = React.useRef<HTMLButtonElement>(null);
  const addRef = React.useRef<HTMLButtonElement>(null);

  const save = (add: string[]) =>
    void api.dictionaryAdd(add, words.filter((w) => !add.includes(w))).then(() => {
      setAdded(add.length);
      onDone();
    }, () => {});
  const toggle = (w: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(w)) next.add(w);
      return next;
    });

  return (
    <>
      {added === null ? (
        <div className="flex flex-col gap-2">
          {label && <p className="text-[11px] leading-4 text-white/55">{label}</p>}
          <div className="flex flex-wrap gap-1.5">
            {words.map((w, i) => {
              const on = picked.has(w);
              return (
                <button
                  key={w}
                  ref={(el) => {
                    chips.current[i] = el;
                  }}
                  type="button"
                  aria-pressed={on}
                  className={cn(
                    "flex h-7 max-w-full cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
                    on ? "border-white/15 bg-white/12 text-white" : "border-white/10 text-white/45",
                    over(chips.current[i]) && "bg-white/20 text-white",
                  )}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => toggle(w)}
                >
                  {on ? <Check className="size-3 shrink-0 text-emerald-400" strokeWidth={2.5} /> : <Plus className="size-3 shrink-0" strokeWidth={2.5} />}
                  <span className={cn("truncate", !on && "line-through decoration-white/30")}>{w}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-white/75">
          <Check className="size-3.5 shrink-0 text-emerald-400" strokeWidth={2.5} />
          {added ? `Added ${added === 1 ? "1 word" : `${added} words`} to your Dictionary` : "Got it. I won't ask about those again."}
        </p>
      )}
      {(actions || added === null) && (
        <div className="flex items-center justify-end gap-1.5">
          {actions}
          {added === null && (
            <>
              <button
                ref={skipRef}
                type="button"
                className={cn(
                  "h-8 cursor-pointer rounded-full px-3 text-xs font-medium transition-colors",
                  over(skipRef.current) ? "bg-white/10 text-white" : "text-white/60",
                )}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => save([])}
              >
                Don't ask
              </button>
              <button
                ref={addRef}
                type="button"
                disabled={!picked.size}
                className={pillButton(over(addRef.current) && picked.size > 0)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => save(words.filter((w) => picked.has(w)))}
              >
                <Plus className="size-3.5" strokeWidth={2.25} />
                Add
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The transcript, when no text box had focus to paste it into. Sushi fools
 * around in the corner, a ring around the close button counts down to closing
 * the card, and Copy puts the text on the clipboard. New words it heard can be
 * added to the Dictionary from here too. Like the island, it sees no mouse
 * moves, so hover comes from the cursor Rust polls.
 */
function TranscriptCard({
  text,
  words,
  cursor,
  held,
  cardRef,
}: {
  text: string;
  words: string[];
  cursor: Point | null;
  held: boolean;
  cardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const copyRef = React.useRef<HTMLButtonElement>(null);
  const over = (el: HTMLElement | null) => !!cursor && !!el && near(el.getBoundingClientRect(), cursor, 0);
  const hovered = over(cardRef.current);

  const [copied, setCopied] = React.useState(false);
  const dismiss = React.useCallback(() => void api.overlayDismiss().catch(() => {}), []);
  // Long enough to see "Copied" before the card goes.
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(dismiss, 900);
    return () => clearTimeout(t);
  }, [copied, dismiss]);

  const paused = hovered || held || copied;
  const copy = (
    <button
      ref={copyRef}
      type="button"
      className={cn(pillButton(over(copyRef.current) || copied), words.length > 0 && "mr-auto")}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => void api.copyText(text).then(() => setCopied(true), () => {})}
    >
      {copied ? <Check className="size-3.5 text-emerald-400" strokeWidth={2.5} /> : <Copy className="size-3.5" strokeWidth={2.25} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );

  return (
    <div ref={cardRef} className={CARD} style={{ animation: "pill-in 160ms ease-out" }}>
      <div className="flex items-center gap-3">
        <Sushi mood="idle" restless held={held} className="shrink-0 text-white/70" />
        <p className="flex-1 text-[11px] leading-4 text-white/55">Got it! Click a text box next time and I'll type it in for you.</p>
        <CloseRing ms={TRANSCRIPT_MS} paused={paused} hot={over(closeRef.current)} onClose={dismiss} buttonRef={closeRef} />
      </div>
      {/* Shorter with new words below it, so the card still fits the overlay window. */}
      <p className={cn("overflow-y-auto text-[13px] leading-5 break-words whitespace-pre-wrap text-white/90", words.length ? "max-h-[80px]" : "max-h-[120px]")}>
        {text}
      </p>
      {words.length > 0 ? (
        <NewWords words={words} label="New words. Add them to your Dictionary?" over={over} onDone={() => {}} actions={copy} />
      ) : (
        <div className="flex justify-end">{copy}</div>
      )}
    </div>
  );
}

/**
 * After a paste, the words it heard that the Dictionary doesn't know, offered
 * for adding. It closes on its own like the transcript card, and soon after
 * the words are added or turned down.
 */
function WordsCard({ words, cursor, held, cardRef }: { words: string[]; cursor: Point | null; held: boolean; cardRef: React.RefObject<HTMLDivElement | null> }) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const over = (el: HTMLElement | null) => !!cursor && !!el && near(el.getBoundingClientRect(), cursor, 0);

  const [done, setDone] = React.useState(false);
  const dismiss = React.useCallback(() => void api.overlayDismiss().catch(() => {}), []);
  React.useEffect(() => {
    if (!done) return;
    const t = setTimeout(dismiss, 1200);
    return () => clearTimeout(t);
  }, [done, dismiss]);

  return (
    <div ref={cardRef} className={CARD} style={{ animation: "pill-in 160ms ease-out" }}>
      <div className="flex items-center gap-3">
        <Sushi mood={done ? "done" : "idle"} restless={!done} held={held} className="shrink-0 text-white/70" />
        <p className="flex-1 text-[11px] leading-4 text-white/55">I heard some new words. Add them to your Dictionary so I always spell them right?</p>
        <CloseRing ms={WORDS_MS} paused={over(cardRef.current) || held || done} hot={over(closeRef.current)} onClose={dismiss} buttonRef={closeRef} />
      </div>
      <NewWords words={words} over={over} onDone={() => setDone(true)} />
    </div>
  );
}


export function Overlay() {
  const [state, setState] = React.useState<OverlayState>({ phase: "hidden" });
  // Bumped on every change, so a new transcript card starts its countdown afresh.
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    let live = false;
    const unlisten = on.dictation((s) => {
      live = true;
      setState(s);
      setShown((n) => n + 1);
    });
    // The idle pill is shown at startup, before this webview may be listening.
    api.overlayState().then((s) => live || setState(s), () => {});
    return () => void unlisten.then((f) => f());
  }, []);

  const [menu, setMenu] = React.useState<Point | null>(null);
  React.useEffect(() => setMenu(null), [state.phase]);

  const sushiRef = React.useRef<HTMLDivElement>(null);
  const pillRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  // Tell Rust where Sushi, the pill and an open menu are, so only they take the mouse.
  React.useEffect(() => {
    const report = () => {
      const areas = [sushiRef.current, pillRef.current, menuRef.current].flatMap((el) => {
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
    for (const el of [sushiRef.current, pillRef.current, menuRef.current]) if (el) observer.observe(el);
    return () => {
      clearTimeout(t);
      observer.disconnect();
    };
  }, [state.phase, menu, shown]);

  // The idle pill opens into the island while the cursor is on it or on Sushi.
  // The thin pill gets some slack to be easier to catch.
  const [cursor, setCursor] = React.useState<Point | null>(null);
  const [hovered, setHovered] = React.useState(false);
  React.useEffect(() => setHovered(false), [state.phase]);
  React.useEffect(() => {
    const point = (p: Point | null) => {
      setCursor(p);
      setHovered((was) => {
        if (!p) return false;
        const pad = was ? 4 : 10;
        return [pillRef.current, sushiRef.current].some((el) => el && near(el.getBoundingClientRect(), p, pad));
      });
    };
    const unlisten = on.overlayCursor(point);
    // Where the webview does get the mouse (Linux, over the hit areas), its own
    // events are fresher: under XWayland the polled cursor freezes on leaving.
    const move = (e: MouseEvent) => point({ x: e.clientX, y: e.clientY });
    const leave = () => point(null);
    document.addEventListener("mousemove", move);
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      void unlisten.then((f) => f());
      document.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, []);
  const open = state.phase === "idle" && hovered && !menu;

  // A click elsewhere goes to another app, unseen, so the menu closes once
  // the cursor has been off it (and off Sushi and the pill) for a moment.
  const onMenu = !!menu && !!cursor && [menuRef.current, pillRef.current, sushiRef.current].some((el) => el && near(el.getBoundingClientRect(), cursor, 12));
  React.useEffect(() => {
    if (!menu || onMenu) return;
    const t = setTimeout(() => setMenu(null), MENU_LINGER_MS);
    return () => clearTimeout(t);
  }, [menu, onMenu]);

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
    setMenu(null);
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
    // stays mounted across phases so it can act out each change. The
    // transcript card has its own Sushi inside it instead.
    <div
      className="flex h-svh flex-col items-center justify-end pb-2 [&>*]:cursor-grab"
      onMouseDown={onMouseDown}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {menu && <ContextMenu ref={menuRef} at={menu} cursor={cursor} phase={state.phase} onClose={() => setMenu(null)} />}
      {/* A card counts as the pill: a hit area that drags the overlay. */}
      {state.phase === "transcript" ? (
        <TranscriptCard key={shown} text={state.text} words={state.words} cursor={cursor} held={held} cardRef={pillRef} />
      ) : state.phase === "words" ? (
        <WordsCard key={shown} words={state.words} cursor={cursor} held={held} cardRef={pillRef} />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
