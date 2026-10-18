import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isMac = navigator.userAgent.includes("Mac");

/** "CommandOrControl+Shift+Space" → ["Ctrl", "Shift", "Space"] (⌘ ⇧ on macOS). */
export function hotkeyParts(accelerator: string): string[] {
  return accelerator.split("+").map((part) => {
    const p = part.trim();
    switch (p.toLowerCase()) {
      case "commandorcontrol":
      case "cmdorctrl":
        return isMac ? "⌘" : "Ctrl";
      case "control":
      case "ctrl":
        return isMac ? "⌃" : "Ctrl";
      case "command":
      case "cmd":
      case "super":
      case "meta":
        return isMac ? "⌘" : "Win";
      case "shift":
        return isMac ? "⇧" : "Shift";
      case "alt":
      case "option":
        return isMac ? "⌥" : "Alt";
    }
    const m = /^(?:Key|Digit)(.)$/.exec(p);
    return m ? m[1] : p;
  });
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}
