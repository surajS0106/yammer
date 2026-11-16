//! The user's calendar, from its secret iCal address (Google's "Secret address
//! in iCal format", Outlook's published ICS link). No sign-in and no account:
//! the address is a password the user pastes, kept in the keyring like an API
//! key. A meeting started near an event is linked to it, so it gets the event's
//! title and its attendees, whose names help the notes tell people apart.
//!
//! Parsing is done here. RFC 5545 is simple line by line, but repeating events
//! are not, so recurrences go to the `rrule` crate. Time zones are IANA names
//! (`chrono-tz`), plus the Windows names Outlook writes.

use std::collections::HashMap;
use std::time::Duration;

use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use crate::error::check_status;
use crate::{Error, Result};

/// How far back and ahead events are kept: enough for "today" and the week ahead.
pub const PAST_MS: u64 = 12 * 3_600_000;
pub const AHEAD_MS: u64 = 7 * 86_400_000;
/// A meeting started this long before an event, or any time during it, belongs to it.
pub const LINK_EARLY_MS: u64 = 5 * 60_000;
/// A repeating event's occurrences, at most, in the window.
const MAX_OCCURRENCES: u16 = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    /// Their name, or their email address when the invite has no name.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

/// One occurrence of an event, in Unix ms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// The event's UID; occurrences of a repeating event share it.
    pub uid: String,
    pub title: String,
    pub start: u64,
    pub end: u64,
    /// The organizer first, then everyone invited.
    #[serde(default)]
    pub attendees: Vec<Attendee>,
    /// A video call link from the invite (Zoom, Meet, Teams, Webex), if it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join_url: Option<String>,
}

impl Event {
    /// The occurrence key: a repeating event's occurrences share a UID but not a start.
    pub fn key(&self) -> String {
        format!("{}@{}", self.uid, self.start)
    }
}

/// The event a meeting starting at `at` belongs to: one under way (or about to start), the latest-starting first.
pub fn current(events: &[Event], at: u64) -> Option<&Event> {
    events.iter().filter(|e| e.start <= at + LINK_EARLY_MS && at < e.end).max_by_key(|e| e.start)
}

/// Download the calendar at `url` and read its events between `from` and `to` (Unix ms).
pub async fn fetch(http: &reqwest::Client, url: &str, from: u64, to: u64) -> Result<Vec<Event>> {
    let url = normalize_url(url).ok_or_else(|| Error::Config("That isn't a calendar address. Paste the secret iCal (.ics) link.".into()))?;
    let resp = http.get(&url).timeout(Duration::from_secs(30)).send().await.map_err(Error::sending("your calendar"))?;
    let text = check_status("your calendar", resp).await?.text().await?;
    if !text.contains("BEGIN:VCALENDAR") {
        return Err(Error::Decode("That address didn't return a calendar. Check it's the secret iCal (.ics) link.".into()));
    }
    Ok(parse(&text, from, to))
}

/// `webcal://` (what calendar apps hand out) is plain HTTPS.
pub fn normalize_url(url: &str) -> Option<String> {
    let url = url.trim();
    let url = match url.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    };
    (url.starts_with("https://") || url.starts_with("http://")).then_some(url)
}

/// The events of an iCalendar file that overlap `from..to` (Unix ms), soonest first.
pub fn parse(ics: &str, from: u64, to: u64) -> Vec<Event> {
    let lines = unfold(ics);
    let mut masters = Vec::new();
    // Edited occurrences of a repeating event: (UID, the start they replace) → the edited event.
    let mut edits: HashMap<(String, u64), Option<Raw>> = HashMap::new();
    let mut current: Option<Vec<Prop>> = None;
    for line in &lines {
        if line == "BEGIN:VEVENT" {
            current = Some(Vec::new());
        } else if line == "END:VEVENT" {
            if let Some(raw) = current.take().and_then(|props| Raw::from_props(&props)) {
                match raw.recurrence_id {
                    Some(original) => {
                        let key = (raw.uid.clone(), original);
                        edits.insert(key, (!raw.cancelled).then_some(raw));
                    }
                    None if !raw.cancelled => masters.push(raw),
                    None => {}
                }
            }
        } else if let Some(props) = current.as_mut() {
            if let Some(prop) = Prop::parse(line) {
                props.push(prop);
            }
        }
    }

    let mut out = Vec::new();
    for raw in &masters {
        for start in raw.occurrences(from, to) {
            match edits.get(&(raw.uid.clone(), start)) {
                // Moved, renamed or cancelled: the edit stands in for it below.
                Some(_) => {}
                None => out.push(raw.event(start)),
            }
        }
    }
    for raw in edits.values().flatten() {
        out.push(raw.event(raw.start));
    }
    out.retain(|e| e.end > from && e.start < to);
    out.sort_by_key(|e| (e.start, e.title.clone()));
    out.dedup_by(|a, b| a.key() == b.key());
    out
}

/// RFC 5545 folds long lines with a CRLF and a space; put them back together.
fn unfold(ics: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in ics.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        match (raw.strip_prefix(' ').or_else(|| raw.strip_prefix('\t')), lines.last_mut()) {
            (Some(rest), Some(last)) => last.push_str(rest),
            _ => lines.push(raw.to_string()),
        }
    }
    lines
}

/// A property: `NAME;PARAM=VALUE:value`.
#[derive(Debug)]
struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn parse(line: &str) -> Option<Prop> {
        // The value starts at the first colon outside a quoted parameter value.
        let mut quoted = false;
        let split = line.char_indices().find(|&(_, c)| {
            if c == '"' {
                quoted = !quoted;
            }
            c == ':' && !quoted
        })?;
        let (head, value) = (&line[..split.0], &line[split.0 + 1..]);
        let mut parts = head.split(';');
        let name = parts.next()?.trim().to_ascii_uppercase();
        let params = parts
            .filter_map(|p| p.split_once('='))
            .map(|(k, v)| (k.trim().to_ascii_uppercase(), v.trim().trim_matches('"').to_string()))
            .collect();
        Some(Prop { name, params, value: value.to_string() })
    }

    fn param(&self, name: &str) -> Option<&str> {
        self.params.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    /// The value as text: `\n`, `\,`, `\;` and `\\` unescaped.
    fn text(&self) -> String {
        let mut out = String::with_capacity(self.value.len());
        let mut chars = self.value.chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match chars.next() {
                Some('n' | 'N') => out.push('\n'),
                Some(other) => out.push(other),
                None => {}
            }
        }
        out
    }

    /// A date-time value as Unix ms, or `None` for an all-day date (or one that can't be read).
    fn time(&self) -> Option<u64> {
        if self.param("VALUE") == Some("DATE") || !self.value.contains('T') {
            return None;
        }
        instant(self.value.trim(), self.param("TZID"))
    }
}

/// `20261116T090000Z`, or a local time in `tzid`, or (neither) the computer's own time, as Unix ms.
fn instant(value: &str, tzid: Option<&str>) -> Option<u64> {
    let (local, utc) = match value.strip_suffix('Z') {
        Some(v) => (v, true),
        None => (value, false),
    };
    let naive = NaiveDateTime::parse_from_str(local, "%Y%m%dT%H%M%S").ok()?;
    let ms = if utc {
        Utc.from_utc_datetime(&naive).timestamp_millis()
    } else if let Some(tz) = tzid.and_then(zone) {
        tz.from_local_datetime(&naive).earliest()?.timestamp_millis()
    } else {
        Local.from_local_datetime(&naive).earliest()?.timestamp_millis()
    };
    u64::try_from(ms).ok()
}

/// An IANA zone, or the one a Windows name (Outlook's) stands for.
fn zone(tzid: &str) -> Option<chrono_tz::Tz> {
    let tzid = tzid.trim().trim_start_matches('/');
    if let Ok(tz) = tzid.parse::<chrono_tz::Tz>() {
        return Some(tz);
    }
    let iana = match tzid {
        "UTC" | "Coordinated Universal Time" | "GMT" => "UTC",
        "Pacific Standard Time" => "America/Los_Angeles",
        "Mountain Standard Time" => "America/Denver",
        "US Mountain Standard Time" => "America/Phoenix",
        "Central Standard Time" => "America/Chicago",
        "Eastern Standard Time" => "America/New_York",
        "Atlantic Standard Time" => "America/Halifax",
        "Alaskan Standard Time" => "America/Anchorage",
        "Hawaiian Standard Time" => "Pacific/Honolulu",
        "E. South America Standard Time" => "America/Sao_Paulo",
        "GMT Standard Time" => "Europe/London",
        "W. Europe Standard Time" => "Europe/Berlin",
        "Romance Standard Time" => "Europe/Paris",
        "Central Europe Standard Time" => "Europe/Budapest",
        "Central European Standard Time" => "Europe/Warsaw",
        "E. Europe Standard Time" => "Europe/Chisinau",
        "FLE Standard Time" => "Europe/Kiev",
        "Russian Standard Time" => "Europe/Moscow",
        "Israel Standard Time" => "Asia/Jerusalem",
        "Arabian Standard Time" => "Asia/Dubai",
        "India Standard Time" => "Asia/Kolkata",
        "Singapore Standard Time" => "Asia/Singapore",
        "China Standard Time" => "Asia/Shanghai",
        "Tokyo Standard Time" => "Asia/Tokyo",
        "Korea Standard Time" => "Asia/Seoul",
        "AUS Eastern Standard Time" => "Australia/Sydney",
        "New Zealand Standard Time" => "Pacific/Auckland",
        // Prefixed names ("/mozilla.org/20050126_1/America/New_York") end in the IANA name.
        other => {
            let parts: Vec<&str> = other.split('/').collect();
            return parts.len().checked_sub(2).and_then(|i| parts[i..].join("/").parse().ok());
        }
    };
    iana.parse().ok()
}

/// A VEVENT's properties, read.
#[derive(Debug, Clone)]
struct Raw {
    uid: String,
    title: String,
    start: u64,
    /// How long it lasts; an hour when the invite doesn't say.
    length: u64,
    attendees: Vec<Attendee>,
    join_url: Option<String>,
    cancelled: bool,
    /// For an edited occurrence: the start of the occurrence it replaces.
    recurrence_id: Option<u64>,
    /// The repeat rule and its exceptions, as `rrule` reads them.
    rule: Option<String>,
}

impl Raw {
    fn from_props(props: &[Prop]) -> Option<Raw> {
        let get = |name: &str| props.iter().find(|p| p.name == name);
        let dtstart = get("DTSTART")?;
        // All-day events aren't meetings.
        let start = dtstart.time()?;
        let end = get("DTEND").and_then(Prop::time).or_else(|| get("DURATION").and_then(|d| duration_ms(&d.value)).map(|d| start + d));
        let length = end.filter(|&e| e > start).map_or(3_600_000, |e| e - start);

        let mut attendees = Vec::new();
        for p in props.iter().filter(|p| p.name == "ORGANIZER" || p.name == "ATTENDEE") {
            if p.param("ROLE") == Some("NON-PARTICIPANT") || p.param("CUTYPE").is_some_and(|c| c == "ROOM" || c == "RESOURCE") {
                continue;
            }
            let email = p.value.trim().strip_prefix("mailto:").or_else(|| p.value.trim().strip_prefix("MAILTO:")).map(str::to_string);
            let name = p.param("CN").map(str::to_string).filter(|n| !n.trim().is_empty()).or_else(|| email.clone());
            let Some(name) = name else { continue };
            let same = |a: &Attendee| a.email.is_some() && a.email == email || a.name == name;
            if !attendees.iter().any(same) {
                attendees.push(Attendee { name, email });
            }
        }

        let texts = ["URL", "X-GOOGLE-CONFERENCE", "LOCATION", "DESCRIPTION"]
            .iter()
            .filter_map(|n| get(n))
            .map(Prop::text)
            .collect::<Vec<_>>();
        let join_url = texts.iter().find_map(|t| join_link(t));

        let rule = get("RRULE").map(|r| {
            // Repeated in the event's own zone, so a 9:00 meeting stays at 9:00 across daylight saving.
            let local = dtstart.value.trim();
            let first = match dtstart.param("TZID").and_then(zone) {
                Some(tz) if !local.ends_with('Z') => format!("DTSTART;TZID={}:{local}", tz.name()),
                _ => format!("DTSTART:{}", utc_stamp(start)),
            };
            let mut lines = vec![first, format!("RRULE:{}", r.value.trim())];
            for ex in props.iter().filter(|p| p.name == "EXDATE") {
                let tzid = ex.param("TZID");
                let stamps: Vec<String> = ex.value.split(',').filter_map(|v| instant(v.trim(), tzid)).map(utc_stamp).collect();
                if !stamps.is_empty() {
                    lines.push(format!("EXDATE:{}", stamps.join(",")));
                }
            }
            lines.join("\n")
        });

        Some(Raw {
            uid: get("UID").map(Prop::text).unwrap_or_else(|| format!("{start}")),
            title: get("SUMMARY")
                .map(Prop::text)
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| "Untitled event".into()),
            start,
            length,
            attendees,
            join_url,
            cancelled: get("STATUS").is_some_and(|s| s.value.trim().eq_ignore_ascii_case("CANCELLED")),
            recurrence_id: get("RECURRENCE-ID").and_then(Prop::time),
            rule,
        })
    }

    /// Starts of this event (or each occurrence of a repeating one) that overlap `from..to`.
    fn occurrences(&self, from: u64, to: u64) -> Vec<u64> {
        let Some(rule) = &self.rule else { return vec![self.start] };
        // A floating time (no zone) repeats in UTC from its first start, so it can be an hour off
        // across a daylight saving change; calendar apps rarely write those.
        let parsed: std::result::Result<rrule::RRuleSet, _> = rule.parse();
        let Ok(set) = parsed else { return vec![self.start] };
        let at = |ms: u64| rrule::Tz::UTC.timestamp_millis_opt(ms as i64).single();
        let (Some(after), Some(before)) = (at(from.saturating_sub(self.length)), at(to)) else { return vec![self.start] };
        set.after(after)
            .before(before)
            .all(MAX_OCCURRENCES)
            .dates
            .iter()
            .filter_map(|d| u64::try_from(d.timestamp_millis()).ok())
            .collect()
    }

    fn event(&self, start: u64) -> Event {
        Event {
            uid: self.uid.clone(),
            title: self.title.clone(),
            start,
            end: start + self.length,
            attendees: self.attendees.clone(),
            join_url: self.join_url.clone(),
        }
    }
}

fn utc_stamp(ms: u64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms as i64).unwrap_or_default().format("%Y%m%dT%H%M%SZ").to_string()
}

/// `PT1H30M`, `PT45M`, `P1D` as ms.
fn duration_ms(value: &str) -> Option<u64> {
    let v = value.trim().strip_prefix('P')?;
    let (days, time) = v.split_once('T').unwrap_or((v, ""));
    let mut ms = 0u64;
    let mut num = String::new();
    for (part, unit_ms) in
        [(days, [("W", 604_800_000u64), ("D", 86_400_000)].as_slice()), (time, [("H", 3_600_000u64), ("M", 60_000), ("S", 1_000)].as_slice())]
    {
        for c in part.chars() {
            if c.is_ascii_digit() {
                num.push(c);
            } else {
                let unit = unit_ms.iter().find(|(u, _)| u.starts_with(c))?.1;
                ms += num.parse::<u64>().ok()? * unit;
                num.clear();
            }
        }
    }
    Some(ms)
}

/// The first video call link in some text: Zoom, Google Meet, Teams, Webex and the like.
fn join_link(text: &str) -> Option<String> {
    const HOSTS: &[&str] =
        &["zoom.us/", "meet.google.com/", "teams.microsoft.com/", "teams.live.com/", "webex.com/", "whereby.com/", "around.co/", "meet.jit.si/"];
    text.split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '(' | ')' | '[' | ']'))
        .filter_map(|word| word.find("https://").map(|i| &word[i..]))
        .map(|url| url.trim_end_matches(['.', ',', ';']))
        .find(|url| HOSTS.iter().any(|h| url.contains(h)))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOV16_9UTC: u64 = 1_794_819_600_000; // 2026-11-16 09:00 UTC, a Monday.
    const DAY: u64 = 86_400_000;

    fn ics(events: &str) -> String {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{events}END:VCALENDAR\r\n")
    }

    #[test]
    fn reads_a_simple_event_with_attendees_and_a_call_link() {
        let cal = ics(concat!(
            "BEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:Pricing sync\\, Q4\r\n",
            "DTSTART:20261116T090000Z\r\nDTEND:20261116T093000Z\r\n",
            "ORGANIZER;CN=Ana Lopez:mailto:ana@example.com\r\n",
            "ATTENDEE;CN=\"Raj: PM\";ROLE=REQ-PARTICIPANT:mailto:raj@example.com\r\n",
            "ATTENDEE;CN=Ana Lopez:mailto:ana@example.com\r\n",
            "ATTENDEE;CUTYPE=ROOM;CN=Room 4:mailto:room4@example.com\r\n",
            "ATTENDEE:mailto:sam@example.com\r\n",
            "DESCRIPTION:Join: https://us02web.zoom.us/j/123?pwd=x\\nThanks\r\n",
            " folded on\r\n",
            "END:VEVENT\r\n",
        ));
        let events = parse(&cal, NOV16_9UTC - DAY, NOV16_9UTC + DAY);
        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!((e.title.as_str(), e.start, e.end), ("Pricing sync, Q4", NOV16_9UTC, NOV16_9UTC + 30 * 60_000));
        let names: Vec<&str> = e.attendees.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["Ana Lopez", "Raj: PM", "sam@example.com"]);
        assert_eq!(e.join_url.as_deref(), Some("https://us02web.zoom.us/j/123?pwd=x"));
    }

    #[test]
    fn expands_repeats_with_exceptions_and_edits() {
        let cal = ics(concat!(
            "BEGIN:VEVENT\r\nUID:standup\r\nSUMMARY:Standup\r\n",
            "DTSTART;TZID=Europe/London:20261102T090000\r\nDURATION:PT15M\r\n",
            "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR\r\n",
            "EXDATE;TZID=Europe/London:20261117T090000\r\n",
            "END:VEVENT\r\n",
            // Wednesday's moved to 10:00 and renamed.
            "BEGIN:VEVENT\r\nUID:standup\r\nRECURRENCE-ID;TZID=Europe/London:20261118T090000\r\n",
            "SUMMARY:Standup (late)\r\nDTSTART;TZID=Europe/London:20261118T100000\r\nDTEND;TZID=Europe/London:20261118T101500\r\n",
            "END:VEVENT\r\n",
            // Thursday's cancelled.
            "BEGIN:VEVENT\r\nUID:standup\r\nRECURRENCE-ID;TZID=Europe/London:20261119T090000\r\nSTATUS:CANCELLED\r\n",
            "DTSTART;TZID=Europe/London:20261119T090000\r\nEND:VEVENT\r\n",
        ));
        let events = parse(&cal, NOV16_9UTC - 60_000, NOV16_9UTC + 5 * DAY);
        let got: Vec<(String, u64)> = events.iter().map(|e| (e.title.clone(), (e.start - NOV16_9UTC) / 3_600_000)).collect();
        // London is on GMT in November, so 09:00 there is 09:00 UTC.
        assert_eq!(got, [("Standup".into(), 0), ("Standup (late)".into(), 49), ("Standup".into(), 96)]);
        assert!(events.iter().all(|e| e.end - e.start == 15 * 60_000));
    }

    #[test]
    fn repeats_keep_their_local_time_across_daylight_saving() {
        // 09:00 in New York every Monday from 26 October (EDT, UTC-4). Daylight saving ends on 1 November.
        let cal = ics(concat!(
            "BEGIN:VEVENT\r\nUID:w\r\nSUMMARY:Weekly\r\nDTSTART;TZID=Eastern Standard Time:20261026T090000\r\n",
            "DTEND;TZID=Eastern Standard Time:20261026T093000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\n",
        ));
        let events = parse(&cal, NOV16_9UTC - 30 * DAY, NOV16_9UTC + DAY);
        let utc: Vec<String> = events.iter().map(|e| crate::mcp::iso(e.start)).collect();
        assert_eq!(utc, ["2026-10-26T13:00:00Z", "2026-11-02T14:00:00Z", "2026-11-09T14:00:00Z", "2026-11-16T14:00:00Z"]);
    }

    #[test]
    fn skips_all_day_and_cancelled_events_and_reads_windows_zones() {
        let cal = ics(concat!(
            "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261116\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Gone\r\nSTATUS:CANCELLED\r\nDTSTART:20261116T100000Z\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:West coast\r\nDTSTART;TZID=Pacific Standard Time:20261116T010000\r\nEND:VEVENT\r\n",
        ));
        let events = parse(&cal, NOV16_9UTC - DAY, NOV16_9UTC + DAY);
        assert_eq!(events.len(), 1);
        // 01:00 Pacific (UTC-8 in November) is 09:00 UTC, and an hour long with no end.
        assert_eq!((events[0].title.as_str(), events[0].start, events[0].end - events[0].start), ("West coast", NOV16_9UTC, 3_600_000));
    }

    #[test]
    fn links_a_meeting_to_the_event_under_way() {
        let e = |uid: &str, start: u64, mins: u64| Event {
            uid: uid.into(),
            title: uid.into(),
            start,
            end: start + mins * 60_000,
            attendees: vec![],
            join_url: None,
        };
        let events = [e("early", NOV16_9UTC - 3_600_000, 90), e("next", NOV16_9UTC + 4 * 60_000, 30), e("later", NOV16_9UTC + 3_600_000, 30)];
        // Starting four minutes early picks the meeting about to begin over the one ending.
        assert_eq!(current(&events, NOV16_9UTC).map(|e| e.uid.as_str()), Some("next"));
        assert_eq!(current(&events, NOV16_9UTC - 30 * 60_000).map(|e| e.uid.as_str()), Some("early"));
        assert_eq!(current(&events, NOV16_9UTC + 2 * 3_600_000), None);
    }

    #[test]
    fn reads_addresses_and_durations() {
        assert_eq!(normalize_url(" webcal://calendar.google.com/x.ics "), Some("https://calendar.google.com/x.ics".into()));
        assert_eq!(normalize_url("file:///etc/passwd"), None);
        assert_eq!(duration_ms("PT1H30M"), Some(90 * 60_000));
        assert_eq!(duration_ms("P1DT2H"), Some(DAY + 7_200_000));
        assert_eq!(duration_ms("bogus"), None);
        assert_eq!(join_link("see <https://meet.google.com/abc-defg-hij>."), Some("https://meet.google.com/abc-defg-hij".into()));
        assert_eq!(join_link("https://example.com/agenda"), None);
    }
}
