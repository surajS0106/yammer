// Shared motion for the settings window: one easing curve (`ease-smooth` in index.css)
// and a couple of wrappers so blocks and list rows enter and leave instead of popping.

import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

export const ease = [0.32, 0.72, 0, 1] as const;
export const smooth = { duration: 0.3, ease };
/** For things that slide to a new place: the nav and tab highlights. */
export const spring = { type: "spring", bounce: 0.15, duration: 0.4 } as const;

// Clip only while folding: once open, overflow goes back to visible so focus rings aren't cut off.
const folded = { height: 0, opacity: 0, overflow: "hidden" } as const;
const open = { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } } as const;

/**
 * Shows or hides a block by collapsing its height, so the content below glides instead of jumping.
 * `gap` is the parent's `space-y` in px: the wrapper owns that margin so it can animate it too.
 */
export function Collapse({ show, gap = 24, className, children }: { show: boolean; gap?: number; className?: string; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ ...folded, marginBottom: 0 }}
          animate={{ ...open, marginBottom: gap }}
          exit={{ ...folded, marginBottom: 0 }}
          transition={smooth}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A list whose rows (keyed children) grow in when added and fold away when removed.
 * Rows already there on mount don't animate; the page entrance covers them.
 */
export function AnimatedList({ children }: { children: React.ReactNode }) {
  return <AnimatePresence initial={false}>{children}</AnimatePresence>;
}

export function ListRow({ className, children, ...props }: React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div
      initial={folded}
      animate={open}
      exit={folded}
      transition={smooth}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
