// Light/dark: the `.dark` class on <html> drives the CSS, and the native window
// theme (title bar, and what `prefers-color-scheme` reports) is kept in step.

import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Theme } from "./tauri";

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let current: Theme = "system";
// The first setTheme (with the saved setting, at startup) flips without a crossfade.
let started = false;

function apply(animate: boolean) {
  const root = document.documentElement;
  const dark = current === "dark" || (current === "system" && systemDark.matches);
  if (root.classList.contains("dark") === dark) return;
  const flip = () => root.classList.toggle("dark", dark);
  // Crossfade a switch in the open window; engines without view transitions flip at once.
  // A newer switch skips one still running, which rejects `ready`; that's expected.
  if (animate && !reduceMotion.matches && document.startViewTransition) document.startViewTransition(flip).ready.catch(() => {});
  else flip();
}

apply(false);
systemDark.addEventListener("change", () => apply(true));

/** Only the settings window calls this; the overlay keeps following the OS. */
export function setTheme(theme: Theme) {
  current = theme;
  apply(started);
  started = true;
  void getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => {});
}
