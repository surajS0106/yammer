// Sushi, Sush's mascot (../sush, components/mascot.tsx): a pixel-art nigiri
// (salmon on rice, a teal nori band) who stands on the overlay pill and on
// the Home page, acting out the dictation:
//
// - idle: breathes, blinks, and every few seconds does a trick (a hop, a
//   backflip, a wiggle, a dance, a turnaround, a yawn, a look around). Left
//   alone it falls asleep with floating z's, and wakes with a start.
// - listening: hops up eagerly, then bounces and stretches with your voice,
//   with music notes floating off when you get loud.
// - transcribing: slides on glasses and types away at a laptop, the screen
//   lighting its face, glancing up now and then.
// - polishing: glasses on, head rocking, eyes drifting, sparkles twinkling and
//   a glint sweeping the lenses.
// - done: a backflip, a burst of sparkles and a heart. Error: a shake and a
//   bead of sweat.
//
// With `interactive` (the Home page) its eyes follow the pointer, and clicking
// it hops and pops a heart; three quick clicks do a backflip. On the overlay
// it can be picked up (`held`): it kicks its feet and swings, eyes wide, and
// lands with a squash. Still under reduced motion.

import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "motion/react";
import * as React from "react";

import { on, type OverlayState } from "@/lib/tauri";
import { cn } from "@/lib/utils";

// One character per pixel; "." is transparent. Eyes and legs are drawn
// separately so they can move: the body has rice where the eyes go.
const BODY = [
  "...SSSSSSSSSS...",
  "..SsSSSNNSSSsS..",
  ".SSSsSSNNSSsSSS.",
  ".RRRRRRNNRRRRRR.",
  "rRRRRRRNNRRRRRRr",
  "rRRRRRRNNRRRRRRr",
  "rRRRRRRNNRRRRRRr",
  "rRPRRRRNNRRRRPRr",
  ".rRRRRRNNRRRRRr.",
  "..rrrrrrrrrrrr..",
];
// Feet together, then apart: walking and dancing alternate them.
const LEG_FRAMES = ["....LL......LL..", "...L..L....L..L."];
const EYES = [3, 11].map((x) => ({ x, y: 5 }));

// The laptop's lid seen from behind (a little nigiri logo), its top edge just under the eyes.
const LAPTOP = ["...KKKKKKKKKK...", "...KkkkOOkkkK...", "...KkkkkkkkkK...", "..BBBBBBBBBBBB.."];
const LAPTOP_Y = 7;
// Typing hands either side of the lid, tapping in turn: [left row, right row].
const HAND_X = [1, 14];
const HAND_FRAMES = [
  [2, 1],
  [1, 2],
];

const HEART = ["HH.HH", "HHHHH", ".HHH.", "..H.."];
const STAR = [".Y.", "YYY", ".Y."];
const ZED = ["ZZZ", ".Z.", "ZZZ"];
const BANG = ["X", "X", "X", ".", "X"];
const NOTES = [
  ["..MM", "..M.", "..M.", "MMM.", "MMM."],
  ["mmmmm", "m...m", "m...m", "mm.mm", "mm.mm"],
];

const COLORS: Record<string, string> = {
  S: "#f0533f", // salmon
  s: "#ff8f73", // salmon stripe
  N: "#0f5e5c", // nori
  R: "#fff8ee", // rice
  r: "#e3d1b8", // rice shade
  E: "#2b2b2b", // eyes
  P: "#f7a39b", // blush
  L: "#3d3d3d", // legs
  K: "#c9ced6", // laptop lid edge
  k: "#aeb5bf", // laptop lid
  O: "#f0533f", // laptop logo
  B: "#7d8590", // laptop base
  H: "#f0533f", // heart
  Y: "#f6c945", // sparkle
  Z: "currentColor", // sleep z
  G: "#2b2b2b", // glasses frame
  X: "#f6c945", // startled !
  M: "#ff8f73", // note
  m: "#5fd3b3", // note
  D: "#7cc7ff", // sweat
};

const W = BODY[0].length;
const H = BODY.length + 1;

/** Fall asleep after this long idle with nothing happening. */
const SLEEP_AFTER = 45_000;

type Run = { x: number; y: number; w: number; fill: string };

/** Horizontal runs of one colour, so each row is a few rects rather than sixteen. */
function runs(rows: string[], y0 = 0) {
  const out: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let w = 1;
      while (row[x + w] === c) w++;
      if (c !== ".") out.push({ x, y: y + y0, w, fill: COLORS[c] });
      x += w;
    }
  });
  return out;
}

const BODY_RUNS = runs(BODY);
const LEG_RUNS = LEG_FRAMES.map((row) => runs([row], BODY.length));
const LAPTOP_RUNS = runs(LAPTOP);

// Glasses: a 6×6 lens around each eye, room for it to glance a pixel any way,
// a bridge between them and a stub of each arm.
const LENSES = EYES.map((e) => ({ x: e.x - 2, y: e.y - 2, w: 6, h: 6 }));
const FRAME: Run[] = (() => {
  const fill = COLORS.G;
  const out: Run[] = [];
  for (const l of LENSES) {
    out.push({ x: l.x, y: l.y, w: l.w, fill }, { x: l.x, y: l.y + l.h - 1, w: l.w, fill });
    for (let y = l.y + 1; y < l.y + l.h - 1; y++) out.push({ x: l.x, y, w: 1, fill }, { x: l.x + l.w - 1, y, w: 1, fill });
  }
  const [a, b] = LENSES;
  out.push({ x: a.x + a.w, y: a.y + 1, w: b.x - a.x - a.w, fill });
  out.push({ x: a.x - 1, y: a.y + 1, w: 1, fill }, { x: b.x + b.w, y: b.y + 1, w: 1, fill });
  return out;
})();

function Pixels({ runs }: { runs: Run[] }) {
  return runs.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />);
}

/** A small pixel sprite (heart, note, z) at the given pixel size. */
function Glyph({ rows, px }: { rows: string[]; px: number }) {
  return (
    <svg viewBox={`0 0 ${rows[0].length} ${rows.length}`} width={rows[0].length * px} height={rows.length * px} shapeRendering="crispEdges">
      <Pixels runs={runs(rows)} />
    </svg>
  );
}

export type SushiMood = "idle" | "listening" | "transcribing" | "polishing" | "done" | "error";

export function moodOf(s: OverlayState): SushiMood {
  switch (s.phase) {
    case "listening":
    case "transcribing":
    case "polishing":
      return s.phase;
    case "message":
      return s.error ? "error" : "done";
    default:
      return "idle";
  }
}

type Look = { x: -1 | 0 | 1; y: -1 | 0 | 1 };
const sign = (d: number, dead: number): -1 | 0 | 1 => (d < -dead ? -1 : d > dead ? 1 : 0);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TRICKS = ["hop", "flip", "wiggle", "dance", "turn", "yawn", "look"] as const;
type Trick = (typeof TRICKS)[number];

type Fx = { id: number; kind: "heart" | "note" | "bang"; dx: number; variant: number };

const SPARKS = [
  { x: -11, y: -8 },
  { x: 11, y: -9 },
  { x: -13, y: 1 },
  { x: 13, y: 0 },
  { x: 0, y: -14 },
  { x: -6, y: -13 },
  { x: 6, y: -13 },
];
// Where the sparkles twinkle while polishing, around the head.
const TWINKLES = [
  { x: -9, y: -2 },
  { x: 10, y: -6 },
  { x: 2, y: -11 },
];

interface SushiProps {
  mood: SushiMood;
  /** CSS px per sprite pixel. */
  px?: number;
  /** Follows the pointer and reacts to clicks. */
  interactive?: boolean;
  /** Being carried around (the overlay, mid-drag). */
  held?: boolean;
  /** Also sets the colour of the sleep z's (`text-*`). */
  className?: string;
}

export function Sushi({ mood, px = 2, interactive = false, held = false, className }: SushiProps) {
  const reduce = !!useReducedMotion();
  const controls = useAnimationControls();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const k = px / 2; // distances below are tuned for 2 px per pixel

  const [level, setLevel] = React.useState(0);
  const [blink, setBlink] = React.useState(false);
  const [sleeping, setSleeping] = React.useState(false);
  const [pointerLook, setPointerLook] = React.useState<Look>({ x: 0, y: 0 });
  const [trickLook, setTrickLook] = React.useState<Look | null>(null);
  const [dancing, setDancing] = React.useState(false);
  const [frame, setFrame] = React.useState(0);
  const [glance, setGlance] = React.useState(false);
  const [ponder, setPonder] = React.useState(false);
  const [fx, setFx] = React.useState<Fx[]>([]);
  const [burst, setBurst] = React.useState(0);

  const moodRef = React.useRef(mood);
  moodRef.current = mood;
  const sleepingRef = React.useRef(sleeping);
  sleepingRef.current = sleeping;
  const lastActive = React.useRef(Date.now());
  const nextId = React.useRef(1);
  const clicks = React.useRef<number[]>([]);

  const spawn = React.useCallback((kind: Fx["kind"], dx = 0) => {
    const id = nextId.current++;
    setFx((f) => [...f, { id, kind, dx, variant: id % 2 }]);
  }, []);

  const wake = React.useCallback(() => {
    lastActive.current = Date.now();
    if (!sleepingRef.current) return;
    setSleeping(false);
    spawn("bang");
    void controls.start({ y: [0, -12 * k, 0], scaleY: [1, 1.15, 1], transition: { duration: 0.35, ease: "easeOut" } });
  }, [controls, spawn, k]);

  // The voice level, while listening. It rises quickly and settles slowly, so
  // it bounces rather than jitters; loud bits send notes floating off.
  React.useEffect(() => {
    if (reduce || mood !== "listening") return setLevel(0);
    let lastNote = 0;
    const unlisten = on.level((rms) => {
      const v = Math.min(1, Math.sqrt(rms) * 2.4);
      setLevel((prev) => (v > prev ? v : prev * 0.6 + v * 0.4));
      const now = Date.now();
      if (v > 0.4 && now - lastNote > 450) {
        lastNote = now;
        spawn("note", Math.round((Math.random() - 0.5) * 16));
      }
    });
    return () => void unlisten.then((f) => f());
  }, [mood, reduce, spawn]);

  // Blink every few seconds, at slightly random intervals, sometimes twice.
  React.useEffect(() => {
    if (reduce || sleeping) return;
    let timer: ReturnType<typeof setTimeout>;
    const blinkOnce = (then: () => void) => {
      setBlink(true);
      timer = setTimeout(() => {
        setBlink(false);
        then();
      }, 140);
    };
    const next = () => {
      timer = setTimeout(
        () => blinkOnce(() => (Math.random() < 0.25 ? (timer = setTimeout(() => blinkOnce(next), 120)) : next())),
        2200 + Math.random() * 3000,
      );
    };
    next();
    return () => clearTimeout(timer);
  }, [reduce, sleeping]);

  // Doze off when idle and left alone.
  React.useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      if (moodRef.current === "idle" && !sleepingRef.current && Date.now() - lastActive.current > SLEEP_AFTER) setSleeping(true);
    }, 3000);
    return () => clearInterval(id);
  }, [reduce]);

  // On the Home page: eyes follow the pointer, and any activity wakes it.
  React.useEffect(() => {
    if (!interactive || reduce) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      wake();
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        const look: Look = {
          x: sign(e.clientX - (rect.left + rect.width / 2), 24),
          y: sign(e.clientY - (rect.top + rect.height / 2), 24),
        };
        setPointerLook((prev) => (prev.x === look.x && prev.y === look.y ? prev : look));
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", wake);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", wake);
    };
  }, [interactive, reduce, wake]);

  // Each mood gets its own act (being carried overrides it); the first
  // appearance drops it in first.
  const act: SushiMood | "held" = held ? "held" : mood;
  const prevAct = React.useRef<SushiMood | "held" | null>(null);
  React.useEffect(() => {
    const from = prevAct.current;
    prevAct.current = act;
    if (act !== "idle") wake();
    if (reduce) return;
    let alive = true;
    const settle = { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1 };
    const intro =
      from === "held"
        ? // Set down: land with a squash.
          controls.start({
            ...settle,
            y: [-3 * k, 0, 0],
            scaleY: [1.1, 0.8, 1],
            scaleX: [0.92, 1.18, 1],
            transition: { duration: 0.35, ease: "easeOut" },
          })
        : from === null
        ? controls.start({
            y: [-18 * k, 0, -4 * k, 0],
            scaleX: [0.6, 1.2, 0.95, 1],
            scaleY: [1.3, 0.8, 1.05, 1],
            rotate: [0, -8, 4, 0],
            opacity: [0, 1, 1, 1],
            transition: { duration: 0.55, times: [0, 0.45, 0.75, 1], ease: "easeOut" },
          })
        : Promise.resolve();
    void intro.then(async () => {
      if (!alive) return;
      switch (act) {
        case "held":
          // Dangling from your cursor, swinging.
          setDancing(true);
          void controls.start({
            ...settle,
            y: -2 * k,
            rotate: [0, -10, 10, -10],
            transition: { duration: 0.9, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" },
          });
          break;
        case "idle":
          if (from !== null && from !== "idle")
            await controls.start({ ...settle, y: [0, -6 * k, 0, -2 * k, 0], transition: { duration: 0.5, times: [0, 0.3, 0.6, 0.8, 1] } });
          break;
        case "listening":
          // Ears up: an eager hop with a stretch.
          await controls.start({
            ...settle,
            y: [0, -10 * k, 0],
            scaleX: [1, 0.88, 1],
            scaleY: [1, 1.16, 1],
            transition: { duration: 0.35, ease: "easeOut" },
          });
          break;
        case "transcribing":
          await controls.start({ ...settle, y: [0, -5 * k, 0], transition: { duration: 0.3, ease: "easeOut" } });
          if (!alive) return;
          void controls.start({
            y: [0, 0.6 * k, 0],
            scaleY: [1, 0.97, 1],
            scaleX: [1, 1.015, 1],
            transition: { duration: 0.4, repeat: Infinity, ease: "easeInOut" },
          });
          break;
        case "polishing":
          void controls.start({ ...settle, rotate: [0, -6, 0, 6, 0], transition: { duration: 2, repeat: Infinity, ease: "easeInOut" } });
          break;
        case "done":
          setBurst((b) => b + 1);
          spawn("heart");
          await controls.start({ ...settle, y: [0, -16 * k, 0], rotate: [0, -360], transition: { duration: 0.65, ease: [0.3, 0, 0.3, 1] } });
          controls.set({ rotate: 0 });
          if (!alive) return;
          await controls.start({ scaleY: [1, 0.82, 1.06, 1], scaleX: [1, 1.15, 0.96, 1], transition: { duration: 0.35 } });
          break;
        case "error":
          await controls.start({ ...settle, x: [0, -4 * k, 4 * k, -3 * k, 3 * k, -1, 0], transition: { duration: 0.5 } });
          if (!alive) return;
          await controls.start({ scaleY: 0.94, scaleX: 1.04, transition: { duration: 0.3 } });
          break;
      }
    });
    return () => {
      alive = false;
      if (act === "held") setDancing(false);
    };
  }, [act, reduce, controls, wake, spawn, k]);

  // Picked up: a startled "!".
  React.useEffect(() => {
    if (held && !reduce) spawn("bang");
  }, [held, reduce, spawn]);

  // Settle down to sleep.
  React.useEffect(() => {
    if (sleeping && !reduce) void controls.start({ x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, transition: { duration: 0.5 } });
  }, [sleeping, reduce, controls]);

  // Idle tricks, every few seconds, never the same one twice running.
  React.useEffect(() => {
    if (reduce || mood !== "idle" || sleeping || held) return;
    let alive = true;
    let last: Trick | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const look = async (seq: Look[]) => {
      for (const l of seq) {
        if (!alive) return;
        setTrickLook(l);
        await wait(550);
      }
      if (alive) setTrickLook(null);
    };
    const perform = async (t: Trick) => {
      switch (t) {
        case "hop":
          await controls.start({
            y: [0, 1, -12 * k, 0, -4 * k, 0],
            scaleY: [1, 0.82, 1.12, 0.9, 1.04, 1],
            scaleX: [1, 1.14, 0.92, 1.08, 0.98, 1],
            transition: { duration: 0.7, ease: "easeOut" },
          });
          break;
        case "flip":
          await controls.start({ y: [0, -16 * k, 0], rotate: [0, -360], transition: { duration: 0.6, ease: [0.3, 0, 0.3, 1] } });
          controls.set({ rotate: 0 });
          break;
        case "wiggle":
          await controls.start({ rotate: [0, -12, 12, -9, 9, -4, 0], transition: { duration: 0.8, ease: "easeInOut" } });
          break;
        case "dance":
          setDancing(true);
          await controls.start({
            rotate: [0, -8, 8, -8, 8, -8, 8, 0],
            y: [0, -3 * k, 0, -3 * k, 0, -3 * k, 0, 0],
            transition: { duration: 1.6, ease: "easeInOut" },
          });
          setDancing(false);
          break;
        case "turn":
          await controls.start({ scaleX: [1, -1, -1, 1], transition: { duration: 1.2, times: [0, 0.2, 0.75, 1] } });
          break;
        case "yawn":
          setTrickLook({ x: 0, y: 1 });
          await controls.start({ scaleY: [1, 1.22, 1.22, 1], scaleX: [1, 0.88, 0.88, 1], transition: { duration: 1.3, times: [0, 0.35, 0.7, 1] } });
          if (alive) setTrickLook(null);
          break;
        case "look":
          await look([
            { x: -1, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: -1 },
          ]);
          break;
      }
    };
    const next = () => {
      timer = setTimeout(
        async () => {
          if (!alive) return;
          const options = TRICKS.filter((t) => t !== last);
          last = options[Math.floor(Math.random() * options.length)];
          await perform(last);
          if (alive) next();
        },
        3500 + Math.random() * 5000,
      );
    };
    next();
    return () => {
      alive = false;
      clearTimeout(timer);
      setTrickLook(null);
      setDancing(false);
    };
  }, [mood, sleeping, held, reduce, controls, k]);

  // While polishing, the eyes drift up to one side, then the other.
  React.useEffect(() => {
    if (reduce || mood !== "polishing") return;
    const id = setInterval(() => setPonder((p) => !p), 1100);
    return () => clearInterval(id);
  }, [mood, reduce]);

  // Every few seconds at the laptop, glance up from the screen for a moment.
  React.useEffect(() => {
    if (reduce || mood !== "transcribing") return setGlance(false);
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(
        () => {
          setGlance(true);
          timer = setTimeout(() => {
            setGlance(false);
            next();
          }, 600);
        },
        1800 + Math.random() * 2000,
      );
    };
    next();
    return () => clearTimeout(timer);
  }, [mood, reduce]);

  // One frame counter drives the dancing feet and the typing hands.
  const moving = dancing || mood === "transcribing";
  React.useEffect(() => {
    if (reduce || !moving) return setFrame(0);
    const id = setInterval(() => setFrame((f) => f + 1), held ? 120 : dancing ? 200 : 110);
    return () => clearInterval(id);
  }, [moving, dancing, held, reduce]);

  const onClick = () => {
    if (reduce) return;
    wake();
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 900), now];
    spawn("heart", Math.round((Math.random() - 0.5) * 8));
    if (mood !== "idle") return;
    if (clicks.current.length >= 3) {
      clicks.current = [];
      setBurst((b) => b + 1);
      void controls
        .start({ y: [0, -18 * k, 0], rotate: [0, -360], transition: { duration: 0.6, ease: [0.3, 0, 0.3, 1] } })
        .then(() => controls.set({ rotate: 0 }));
    } else {
      void controls.start({
        y: [0, 1, -10 * k, 0],
        scaleY: [1, 0.82, 1.12, 1],
        scaleX: [1, 1.14, 0.92, 1],
        rotate: [0, 0, -6, 0],
        transition: { duration: 0.45, times: [0, 0.15, 0.55, 1], ease: "easeOut" },
      });
    }
  };

  const look: Look = held
    ? { x: 0, y: -1 }
    : sleeping
    ? { x: 0, y: 1 }
    : mood === "listening"
      ? { x: 0, y: level > 0.55 ? -1 : 0 }
      : mood === "transcribing"
        ? glance
          ? { x: 1, y: -1 }
          : { x: 0, y: 0 }
        : mood === "polishing"
          ? { x: ponder ? 1 : -1, y: -1 }
          : mood === "error"
            ? { x: 0, y: 1 }
            : (trickLook ?? pointerLook);
  // Closed: asleep, blinking, or squeezed shut with joy.
  const closed = !held && (sleeping || blink || mood === "done");
  const glasses = mood === "transcribing" || mood === "polishing";
  const legs = LEG_RUNS[dancing ? frame % 2 : 0];
  const hands = HAND_FRAMES[frame % HAND_FRAMES.length];

  return (
    <div
      ref={rootRef}
      aria-hidden
      title={interactive ? "Sushi" : undefined}
      onClick={interactive ? onClick : undefined}
      className={cn("relative select-none", interactive ? "cursor-pointer" : "pointer-events-none", className)}
      style={{ width: W * px, height: H * px }}
    >
      {fx.map((f) => (
        <motion.div
          key={f.id}
          className="pointer-events-none absolute top-0 left-1/2"
          style={{ marginLeft: -2 * px }}
          initial={{ x: f.dx * k, y: 0, opacity: 1, scale: 0.6, rotate: 0 }}
          animate={
            f.kind === "note"
              ? { x: f.dx * k + (f.variant ? 8 : -8) * k, y: -22 * k, opacity: [1, 1, 0], scale: 1, rotate: f.variant ? 15 : -15 }
              : f.kind === "bang"
                ? { y: [-2 * k, -8 * k, -8 * k], opacity: [0, 1, 0], scale: [0.6, 1.2, 1] }
                : { y: -22 * k, x: f.dx * k + ((f.id % 3) - 1) * 4 * k, opacity: 0, scale: 1 }
          }
          transition={{ duration: f.kind === "bang" ? 0.8 : 1, ease: "easeOut" }}
          onAnimationComplete={() => setFx((all) => all.filter((v) => v.id !== f.id))}
        >
          <Glyph rows={f.kind === "heart" ? HEART : f.kind === "bang" ? BANG : NOTES[f.variant]} px={px * 0.8} />
        </motion.div>
      ))}
      {burst > 0 &&
        !reduce &&
        SPARKS.map((s, i) => (
          <motion.div
            key={`${burst}-${i}`}
            className="pointer-events-none absolute top-1/2 left-1/2"
            style={{ marginLeft: -1.5 * px * 0.8, marginTop: -1.5 * px * 0.8 }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 }}
            animate={{ x: s.x * px, y: s.y * px, opacity: [0, 1, 0], scale: [0.4, 1.3, 0.6], rotate: 90 }}
            transition={{ duration: 0.75, delay: 0.1 + i * 0.03, ease: "easeOut" }}
          >
            <Glyph rows={STAR} px={px * 0.8} />
          </motion.div>
        ))}
      {mood === "polishing" &&
        !reduce &&
        TWINKLES.map((s, i) => (
          <motion.div
            key={i}
            className="pointer-events-none absolute top-1/3 left-1/2"
            style={{ x: s.x * px, y: s.y * px, marginLeft: -1.5 * px * 0.7 }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0], rotate: [0, 90] }}
            transition={{ duration: 1.2, delay: i * 0.4, repeat: Infinity, repeatDelay: 0.3 }}
          >
            <Glyph rows={STAR} px={px * 0.7} />
          </motion.div>
        ))}
      {sleeping &&
        !reduce &&
        [0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="pointer-events-none absolute -top-1 right-0"
            initial={{ opacity: 0 }}
            animate={{ x: [0, 5 * k, 10 * k], y: [0, -10 * k, -20 * k], opacity: [0, 1, 0], scale: [0.6, 1, 1.2] }}
            transition={{ duration: 2.4, delay: i * 0.8, repeat: Infinity, ease: "easeOut" }}
          >
            <Glyph rows={ZED} px={px * 0.75} />
          </motion.div>
        ))}
      <motion.div animate={controls} style={{ transformOrigin: "50% 100%" }}>
        {/* Bounces and stretches with the voice, like it's singing along. */}
        <div
          style={{
            transformOrigin: "50% 100%",
            transform: `translateY(${-level * 3 * k}px) scale(${1 - level * 0.08}, ${1 + level * 0.16})`,
            transition: "transform 80ms ease-out",
          }}
        >
          <motion.svg
            viewBox={`0 0 ${W} ${H}`}
            width={W * px}
            height={H * px}
            shapeRendering="crispEdges"
            style={{ transformOrigin: "50% 100%", display: "block" }}
            animate={reduce || moving || mood === "listening" ? { scaleY: 1 } : { scaleY: sleeping ? [1, 1.06, 1] : [1, 1.03, 1] }}
            transition={
              reduce || moving || mood === "listening"
                ? { duration: 0.2 }
                : { duration: sleeping ? 3.6 : 2.6, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <Pixels runs={BODY_RUNS} />
            {EYES.map((e) => (
              <rect
                key={e.x}
                x={e.x + look.x}
                y={e.y + look.y + (closed ? 1 : 0)}
                width={2}
                height={closed ? 1 : 2}
                fill={COLORS.E}
              />
            ))}
            <AnimatePresence>
              {glasses && (
                // Slid down from the forehead onto the eyes; lifted back up when done.
                <motion.g
                  key="glasses"
                  initial={reduce ? { opacity: 0 } : { y: -4, opacity: 0 }}
                  animate={{ y: 0, opacity: 1, transition: { duration: 0.25, ease: "easeOut" } }}
                  exit={reduce ? { opacity: 0 } : { y: -5, opacity: 0, transition: { duration: 0.35, ease: "easeIn" } }}
                >
                  {LENSES.map((l) => (
                    <g key={l.x}>
                      <rect x={l.x + 1} y={l.y + 1} width={l.w - 2} height={l.h - 2} fill="#9fdcff" opacity={0.28} />
                      {mood === "polishing" && !reduce ? (
                        <motion.rect
                          y={l.y + 1}
                          width={1}
                          height={l.h - 2}
                          fill="#ffffff"
                          initial={{ x: l.x + 1, opacity: 0 }}
                          animate={{ x: [l.x + 1, l.x + l.w - 2], opacity: [0, 0.9, 0] }}
                          transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 1, ease: "easeInOut" }}
                        />
                      ) : (
                        <rect x={l.x + 1} y={l.y + 1} width={1} height={1} fill="#ffffff" opacity={0.7} />
                      )}
                    </g>
                  ))}
                  <Pixels runs={FRAME} />
                </motion.g>
              )}
            </AnimatePresence>
            <Pixels runs={legs} />
            <AnimatePresence>
              {mood === "error" && !reduce && (
                // A bead of sweat sliding down the side of the head.
                <motion.g
                  key="sweat"
                  initial={{ opacity: 0, y: 0 }}
                  animate={{ opacity: [0, 1, 1, 0], y: [0, 1, 3, 4] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: 0.3 }}
                >
                  <rect x={14} y={1} width={1} height={1} fill={COLORS.D} />
                  <rect x={13} y={2} width={3} height={2} fill={COLORS.D} />
                </motion.g>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {mood === "transcribing" && (
                <motion.g key="laptop">
                  {/* Screen light flickering on the face. */}
                  <motion.rect
                    x={1}
                    y={3}
                    width={14}
                    height={4}
                    fill="#9fdcff"
                    initial={{ opacity: 0 }}
                    animate={reduce ? { opacity: 0.15 } : { opacity: [0.1, 0.24, 0.14, 0.28, 0.12], transition: { duration: 2, repeat: Infinity } }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  />
                  <g transform={`translate(0 ${LAPTOP_Y})`}>
                    <motion.g
                      style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
                      initial={reduce ? { opacity: 0 } : { y: 4, scaleY: 0.3, opacity: 0 }}
                      animate={{ y: 0, scaleY: 1, opacity: 1, transition: { delay: 0.12, duration: 0.25, ease: "easeOut" } }}
                      exit={reduce ? { opacity: 0 } : { scaleY: 0.2, y: 3, opacity: 0, transition: { duration: 0.25 } }}
                    >
                      <Pixels runs={LAPTOP_RUNS} />
                      {HAND_X.map((hx, i) => (
                        <rect key={hx} x={hx} y={hands[i]} width={1} height={1} fill={COLORS.R} />
                      ))}
                    </motion.g>
                  </g>
                </motion.g>
              )}
            </AnimatePresence>
          </motion.svg>
        </div>
      </motion.div>
    </div>
  );
}
