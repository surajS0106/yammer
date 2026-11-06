// The phone's navigation, in place of the sidebar: a glass pill of labelled tabs floating over the page, which
// scrolls behind it, and beside it a round button for what you'd most likely do next. Pages without a tab of
// their own light up the tab they're under. Tabs are 72×48 where they fit, and never narrower than 44.

import { BookOpenText, ClockCounterClockwise, House, Microphone, NotePencil, Square } from "@phosphor-icons/react";
import { motion } from "motion/react";
import * as React from "react";

import type { PageId } from "@/App";
import { usePhoneAction, usePhoneStatus } from "@/components/phone-panel";
import { spring } from "@/components/motion";
import type { DockAction } from "@/lib/dock";
import { dayKey, useHistory } from "@/lib/stats";
import { cn } from "@/lib/utils";

const tabs: { id: PageId; label: string; icon: React.ElementType; pages: PageId[] }[] = [
  { id: "home", label: "Home", icon: House, pages: ["home", "insights", "general", "engine", "cleanup", "help", "changelog"] },
  { id: "scratchpad", label: "Scratchpad", icon: NotePencil, pages: ["scratchpad"] },
  { id: "history", label: "History", icon: ClockCounterClockwise, pages: ["history"] },
  { id: "dictionary", label: "Teach", icon: BookOpenText, pages: ["dictionary", "snippets", "transforms"] },
];

const glass =
  "border border-white/50 bg-background/55 shadow-[0_10px_30px_-8px_rgb(0_0_0/0.3),inset_0_1px_0_rgb(255_255_255/0.6)] backdrop-blur-2xl backdrop-saturate-[1.8] dark:border-white/12 dark:bg-card/55 dark:shadow-[0_10px_30px_-8px_rgb(0_0_0/0.7),inset_0_1px_0_rgb(255_255_255/0.12)]";

/** The page shrinks to make room for the keyboard, so a much shorter window than the tallest seen at this width means it's up. */
function useKeyboardOpen() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let width = window.innerWidth;
    let tallest = window.innerHeight;
    const onResize = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        tallest = 0;
      }
      tallest = Math.max(tallest, window.innerHeight);
      setOpen(window.innerHeight < tallest - 150);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return open;
}

function ActionButton({ action }: { action: DockAction | null }) {
  const status = usePhoneStatus();
  const act = usePhoneAction();
  const recording = !!status?.recording;
  // Mid-dictation it always finishes the dictation, whatever the page offers.
  const Icon = recording ? Square : (action?.icon ?? Microphone);
  const label = recording ? "Finish dictating" : (action?.label ?? "Dictate");
  const run = () => {
    if (action && !recording) action.run();
    else act(status && !status.mic ? "requestMic" : "toggle");
  };
  return (
    <motion.button
      type="button"
      onClick={run}
      aria-label={label}
      whileTap={{ scale: 1.08 }}
      transition={spring}
      className={cn("flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50", glass, recording && "animate-pulse bg-primary text-primary-foreground dark:bg-primary")}
    >
      <Icon className="size-6.5" weight={recording ? "fill" : "regular"} />
    </motion.button>
  );
}

export function BottomNav({ page, go, action }: { page: PageId; go: (page: PageId) => void; action: DockAction | null }) {
  const history = useHistory();
  const today = dayKey(Date.now());
  const todayCount = React.useMemo(() => history.filter((e) => dayKey(e.at) === today).length, [history, today]);
  // It would otherwise ride up on top of the keyboard, over what you're typing.
  if (useKeyboardOpen()) return null;

  return (
    <div data-dock className="absolute inset-x-3 bottom-3 z-40 flex items-center justify-center gap-2">
      <nav aria-label="Main" className={cn("flex max-w-[calc(18rem+10px)] min-w-0 flex-1 rounded-full p-1", glass)}>
        {tabs.map(({ id, label, icon: Icon, pages }) => {
          const active = pages.includes(page);
          const badge = id === "history" && todayCount > 0 ? todayCount : undefined;
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => go(id)}
              aria-current={active ? "page" : undefined}
              whileTap={{ scale: 0.94 }}
              transition={spring}
              className={cn(
                "relative flex h-12 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] leading-3.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
              )}
            >
              {active && <motion.span layoutId="dock-active" transition={spring} className="absolute inset-0 rounded-full bg-foreground/10" />}
              <span className="relative flex">
                <Icon className={cn("size-5.5", active && "text-primary")} weight={active ? "fill" : "regular"} />
                {badge !== undefined && (
                  <span
                    aria-label={`${badge} today`}
                    className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-center text-[9.5px] leading-4 font-semibold text-primary-foreground tabular-nums"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              <span className="relative max-w-full truncate px-0.5">{label}</span>
            </motion.button>
          );
        })}
      </nav>
      <ActionButton action={action} />
    </div>
  );
}
