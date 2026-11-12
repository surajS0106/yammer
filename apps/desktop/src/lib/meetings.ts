// Whether a meeting is being transcribed, for the Meetings page, the sidebar
// and the overlay alike.

import * as React from "react";

import { api, on, type MeetingStatus } from "./tauri";

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
