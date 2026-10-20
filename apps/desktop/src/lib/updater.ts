// App updates from the GitHub release's latest.json (plugins.updater in tauri.conf.json).
// Kept outside React, like models.ts, so an install in progress survives a page switch.

import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import * as React from "react";

import { errorMessage } from "./tauri";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  /** `progress` is the fraction downloaded, or null when the server sends no length. */
  | { phase: "installing"; version: string; progress: number | null }
  | { phase: "error"; version: string; message: string };

const RECHECK_MS = 6 * 60 * 60 * 1000;

let state: UpdateState = { phase: "idle" };
let update: Update | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((l) => l());
}

async function checkForUpdate() {
  if (state.phase === "installing") return;
  try {
    const found = await check();
    if (!found) return;
    update = found;
    set({ phase: "available", version: found.version });
  } catch {
    // Offline, or no release with a latest.json yet: stay quiet and try again later.
  }
}

/** Downloads and installs the update, then relaunches. On Windows the installer closes Yammer itself. */
export async function installUpdate() {
  if (!update || state.phase === "installing") return;
  const { version } = update;
  let total = 0;
  let received = 0;
  set({ phase: "installing", version, progress: null });
  try {
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        received += e.data.chunkLength;
        set({ phase: "installing", version, progress: total ? received / total : null });
      }
    });
    await relaunch();
  } catch (e) {
    set({ phase: "error", version, message: errorMessage(e) });
  }
}

export function useUpdate(): UpdateState {
  React.useEffect(() => {
    // A dev build would "upgrade" itself into the release build.
    if (started || import.meta.env.DEV) return;
    started = true;
    void checkForUpdate();
    setInterval(() => void checkForUpdate(), RECHECK_MS);
  }, []);
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
