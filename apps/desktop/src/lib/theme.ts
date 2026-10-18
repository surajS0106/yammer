// Light/dark: the `.dark` class on <html> drives the CSS, and the native window
// theme (title bar, and what `prefers-color-scheme` reports) is kept in step.

import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Theme } from "./tauri";

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
let current: Theme = "system";

function apply() {
  document.documentElement.classList.toggle("dark", current === "dark" || (current === "system" && systemDark.matches));
}

apply();
systemDark.addEventListener("change", apply);

/** Only the settings window calls this; the overlay keeps following the OS. */
export function setTheme(theme: Theme) {
  current = theme;
  apply();
  void getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => {});
}
