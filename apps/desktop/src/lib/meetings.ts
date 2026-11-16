// Whether a meeting is being transcribed, for the Meetings page, the sidebar
// and the overlay alike.

import * as React from "react";

import { api, on, type CalendarStatus, type MeetingStatus, type NoteTemplate } from "./tauri";
import { isAndroid } from "./utils";

/** Whether a meeting is being transcribed, and which ones' notes are being written. */
export function useMeetingStatus(): MeetingStatus | null {
  const [status, setStatus] = React.useState<MeetingStatus | null>(null);
  React.useEffect(() => {
    api.meetingStatus().then(setStatus, () => {});
    const unlisten = on.meetingStatus(setStatus);
    return () => void unlisten.then((f) => f());
  }, []);
  return status;
}

/** A meeting to open, asked for from outside the Meetings page (a link Sush cited). `at` tells repeat requests apart. */
let opening: { id: number; at: number } | null = null;
const openListeners = new Set<() => void>();

export function requestOpenMeeting(id: number) {
  opening = { id, at: Date.now() };
  openListeners.forEach((f) => f());
}

/** The meeting the Meetings page should open, once: taking it clears it. */
export function useOpenMeetingRequest(open: (id: number) => void) {
  React.useEffect(() => {
    const take = () => {
      if (!opening) return;
      const { id } = opening;
      opening = null;
      open(id);
    };
    take();
    openListeners.add(take);
    return () => void openListeners.delete(take);
  }, [open]);
}

let builtIns: Promise<NoteTemplate[]> | null = null;

/**
 * Every note template, as `MeetingSettings::all_templates` lists them: Yammer's own (fetched
 * once), then the user's from the settings, so an edit shows at once. Empty until loaded.
 */
export function useNoteTemplates(own: NoteTemplate[]): NoteTemplate[] {
  const [shipped, setShipped] = React.useState<NoteTemplate[]>([]);
  React.useEffect(() => {
    builtIns ??= api.meetingTemplates().then((all) => all.filter((t) => t.builtIn));
    builtIns.then(setShipped, () => (builtIns = null));
  }, []);
  return React.useMemo(
    () => [...shipped, ...own.filter((t) => t.instructions.trim() && !shipped.some((b) => b.id === t.id))],
    [shipped, own],
  );
}

let sush: Promise<boolean> | null = null;

/** Whether Sush is installed to take "Ask in Sush" (desktop only). Checked once per session. */
export function useSushInstalled(): boolean {
  const [installed, setInstalled] = React.useState(false);
  React.useEffect(() => {
    if (isAndroid) return;
    sush ??= api.sushInstalled().catch(() => false);
    void sush.then(setInstalled);
  }, []);
  return installed;
}

/** The calendar and its events for the week ahead, kept current (`calendar-updated`). Null until loaded. */
export function useCalendar(): CalendarStatus | null {
  const [status, setStatus] = React.useState<CalendarStatus | null>(null);
  React.useEffect(() => {
    api.calendarStatus().then(setStatus, () => {});
    const unlisten = on.calendarUpdated(setStatus);
    return () => void unlisten.then((f) => f());
  }, []);
  return status;
}
