// Shortcuts the OS (or every app) already uses, so the hotkey recorder can say
// why it won't take one instead of saving a hotkey that never fires, or one
// that steals Copy from every app. Some (⌘Space, ⌘Tab, Win+L) never reach the
// window at all; the recorder catches those by the window losing focus.

import { isMac } from "./utils";

const isWindows = navigator.userAgent.includes("Windows");

// Written with the recorder's modifier names: CommandOrControl is ⌘ on macOS
// and Ctrl elsewhere; Control is ⌃ on macOS; Super is the Windows/Super key.
type Table = Record<string, string>;

/** Copy, paste and friends: taking one globally breaks it in every app (and Edit by voice copies with it). */
const editing: Table = {
  "CommandOrControl+KeyC": "Copy in every app",
  "CommandOrControl+KeyV": "Paste in every app",
  "CommandOrControl+KeyX": "Cut in every app",
  "CommandOrControl+KeyZ": "Undo in every app",
  "CommandOrControl+KeyA": "Select All in every app",
  "CommandOrControl+KeyS": "Save in every app",
  "CommandOrControl+KeyF": "Find in every app",
  "CommandOrControl+KeyP": "Print in every app",
  "CommandOrControl+KeyN": "New in every app",
  "CommandOrControl+KeyO": "Open in every app",
  "CommandOrControl+KeyT": "New Tab in every app",
  "CommandOrControl+KeyW": "Close Window in every app",
  "CommandOrControl+Shift+KeyZ": "Redo in every app",
};

const mac: Table = {
  ...editing,
  "CommandOrControl+KeyQ": "Quit in every app",
  "CommandOrControl+KeyH": "Hide in every app",
  "CommandOrControl+Alt+KeyH": "Hide Others in every app",
  "CommandOrControl+KeyM": "Minimize in every app",
  "CommandOrControl+Space": "Spotlight",
  "CommandOrControl+Alt+Space": "Finder search",
  "Control+Space": "switching input source",
  "CommandOrControl+Control+Space": "the emoji picker",
  "CommandOrControl+Tab": "the app switcher",
  "CommandOrControl+Shift+Tab": "the app switcher",
  "CommandOrControl+Backquote": "switching windows",
  "CommandOrControl+Shift+Digit3": "screenshots",
  "CommandOrControl+Shift+Digit4": "screenshots",
  "CommandOrControl+Shift+Digit5": "screenshots and screen recording",
  "CommandOrControl+Control+KeyQ": "Lock Screen",
  "CommandOrControl+Control+KeyF": "full screen",
  "CommandOrControl+Alt+Escape": "Force Quit",
  "CommandOrControl+Alt+KeyD": "showing and hiding the Dock",
  "Control+ArrowUp": "Mission Control",
  "Control+ArrowDown": "App Exposé",
  "Control+ArrowLeft": "switching Spaces",
  "Control+ArrowRight": "switching Spaces",
};

const windows: Table = {
  ...editing,
  "CommandOrControl+KeyY": "Redo in every app",
  "Alt+Tab": "switching windows",
  "Alt+Shift+Tab": "switching windows",
  "Alt+F4": "closing windows",
  "Alt+Space": "the window menu",
  "CommandOrControl+Escape": "the Start menu",
  "CommandOrControl+Shift+Escape": "Task Manager",
  "Alt+Shift+Escape": "switching windows",
  "Super+KeyA": "Quick Settings",
  "Super+KeyD": "showing the desktop",
  "Super+KeyE": "File Explorer",
  "Super+KeyG": "the Game Bar",
  "Super+KeyH": "Windows voice typing",
  "Super+KeyI": "Settings",
  "Super+KeyK": "Cast",
  "Super+KeyL": "locking the PC",
  "Super+KeyM": "minimizing every window",
  "Super+KeyN": "notifications",
  "Super+KeyP": "display projection",
  "Super+KeyR": "the Run dialog",
  "Super+KeyS": "Windows search",
  "Super+KeyV": "clipboard history",
  "Super+KeyW": "Widgets",
  "Super+KeyX": "the Quick Link menu",
  "Super+Shift+KeyS": "Snipping Tool",
  "Super+Tab": "Task View",
  "Super+Space": "switching input language",
  "Super+Period": "the emoji panel",
  "Super+Semicolon": "the emoji panel",
  "Super+Comma": "peeking at the desktop",
  "Super+ArrowUp": "snapping windows",
  "Super+ArrowDown": "snapping windows",
  "Super+ArrowLeft": "snapping windows",
  "Super+ArrowRight": "snapping windows",
  "Super+CommandOrControl+KeyD": "new virtual desktops",
  "Super+CommandOrControl+ArrowLeft": "switching virtual desktops",
  "Super+CommandOrControl+ArrowRight": "switching virtual desktops",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Super+Digit${i}`, "opening taskbar apps"])),
};

const linux: Table = {
  ...editing,
  "Alt+Tab": "switching windows",
  "Alt+Shift+Tab": "switching windows",
  "Alt+Backquote": "switching windows",
  "Alt+F1": "the activities overview",
  "Alt+F2": "the Run dialog",
  "Alt+F4": "closing windows",
  "Alt+Space": "the window menu",
  "CommandOrControl+Alt+KeyT": "opening a terminal",
  "CommandOrControl+Alt+Delete": "logging out",
  "CommandOrControl+Alt+ArrowUp": "switching workspaces",
  "CommandOrControl+Alt+ArrowDown": "switching workspaces",
  "CommandOrControl+Alt+ArrowLeft": "switching workspaces",
  "CommandOrControl+Alt+ArrowRight": "switching workspaces",
  "Super+KeyA": "the app grid",
  "Super+KeyD": "showing the desktop",
  "Super+KeyH": "hiding windows",
  "Super+KeyL": "locking the screen",
  "Super+KeyM": "the notification list",
  "Super+KeyV": "the notification list",
  "Super+Tab": "switching apps",
  "Super+Space": "switching input source",
  "Super+ArrowUp": "maximizing windows",
  "Super+ArrowDown": "restoring windows",
  "Super+ArrowLeft": "tiling windows",
  "Super+ArrowRight": "tiling windows",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Super+Digit${i}`, "opening dock apps"])),
};

const MOD_ORDER = ["CommandOrControl", "Control", "Super", "Alt", "Shift"];

/** Modifiers in a fixed order, so "Shift+Alt+X" and "Alt+Shift+X" match. */
function normalize(accelerator: string): string {
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  const mods = parts.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return [...mods, key].join("+");
}

const table: Table = Object.fromEntries(
  Object.entries(isMac ? mac : isWindows ? windows : linux).map(([acc, what]) => [normalize(acc), what]),
);

/** What already uses `accelerator` on this OS ("Spotlight"), or null if it's free as far as we know. */
export function reservedBy(accelerator: string): string | null {
  return table[normalize(accelerator)] ?? null;
}

/** "your Mac", "Windows" or "your system", for messages. */
export const systemName = isMac ? "your Mac" : isWindows ? "Windows" : "your system";
