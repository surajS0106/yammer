// Settings → Meetings → Calendar: connect a calendar by its secret iCal
// address (calendar.rs), so meetings are named after their event and know
// who was invited, and Sushi can offer to take notes as an event begins.

import { ArrowClockwise as Refresh, CalendarBlank, CircleNotch as Loader2 } from "@phosphor-icons/react";
import * as React from "react";

import { Button, Input, Notice, Row, Section, Switch } from "@/components/ui";
import { useCalendar } from "@/lib/meetings";
import { useSettings } from "@/lib/settings";
import { api, errorMessage } from "@/lib/tauri";
import { isAndroid } from "@/lib/utils";

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function CalendarSection() {
  const { settings, update, toast } = useSettings();
  const calendar = useCalendar();
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState<"connect" | "refresh" | "forget" | null>(null);
  const m = settings.meeting;

  const run = async (what: "connect" | "refresh" | "forget", call: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await call();
      if (what === "connect") setDraft("");
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const today = calendar?.events.filter((e) => new Date(e.start).toDateString() === new Date().toDateString()).length ?? 0;

  return (
    <Section
      title="Calendar"
      description="Meetings recorded during an event take its name, and the notes know who was invited. Yammer reads your calendar on this device; nothing is sent anywhere else."
    >
      {calendar?.connected ? (
        <Row
          label="Connected"
          description={
            calendar.fetchedAt
              ? `${today} ${today === 1 ? "event" : "events"} today, ${calendar.events.length} this week. Read ${ago.format(Math.round((calendar.fetchedAt - Date.now()) / 60_000), "minute")}; it's read again every 10 minutes.`
              : "Reading your calendar…"
          }
        >
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("refresh", api.calendarRefresh)}>
              {busy === "refresh" ? <Loader2 className="animate-spin" /> : <Refresh />} Refresh
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("forget", () => api.calendarConnect(""))}>
              Disconnect
            </Button>
          </div>
        </Row>
      ) : (
        <Row
          label="Calendar address"
          stacked
          description={
            <>
              Paste your calendar's secret iCal address. Google Calendar: Settings, your calendar, Integrate calendar, “Secret address in iCal
              format”. Outlook: Settings, Calendar, Shared calendars, Publish a calendar, then the ICS link. Treat it like a password: anyone with
              it can read your calendar.
            </>
          }
        >
          <form
            className="flex flex-wrap gap-2 @md:flex-nowrap"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void run("connect", () => api.calendarConnect(draft));
            }}
          >
            <Input
              className="min-w-0 flex-1 basis-48"
              type="password"
              autoComplete="off"
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              aria-label="Calendar address"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button type="submit" disabled={!draft.trim() || !!busy}>
              {busy === "connect" ? <Loader2 className="animate-spin" /> : <CalendarBlank />}
              {busy === "connect" ? "Reading…" : "Connect"}
            </Button>
          </form>
        </Row>
      )}
      {calendar?.connected && calendar.error && (
        <div className="px-4 pb-3">
          <Notice tone="warn">Couldn't read your calendar just now: {calendar.error}</Notice>
        </div>
      )}
      {!isAndroid && (
        <Row label="Offer to take notes when a meeting starts" description="As an event on your calendar begins, Sushi asks whether to transcribe it.">
          <Switch
            label="Offer to take notes when a meeting starts"
            checked={m.calendarOffer}
            disabled={!calendar?.connected}
            onChange={(calendarOffer) => void update((s) => ({ ...s, meeting: { ...s.meeting, calendarOffer } }))}
          />
        </Row>
      )}
    </Section>
  );
}
