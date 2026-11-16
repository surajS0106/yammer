//! Yammer's meetings as a Model Context Protocol server: `yammer --mcp`.
//!
//! Sush (and Claude Desktop, Cursor, …) launch it as a local stdio server and
//! read meetings through it: list them, search them, read one, or read the
//! one being transcribed right now. It's read-only and reads the same
//! `meetings/<id>.json` files the app writes, so it can run beside the app
//! without talking to it. JSON-RPC 2.0, one message per line.
//!
//! Every meeting it returns carries a `yammer://meeting/<id>` link, which the
//! app opens at that meeting, so an answer can cite where it came from.

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};

use crate::meetings::{Meeting, Overview, Store};

/// Protocol versions this server speaks, newest first. It answers with the client's if it's one of these.
pub const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

/// A meeting with no end whose file was saved this recently is still being transcribed:
/// the app saves a live meeting every 5 s. Older ones were cut off when Yammer quit.
const LIVE_WITHIN: Duration = Duration::from_secs(30);
const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 100;

const INSTRUCTIONS: &str = "Yammer is the user's meeting notetaker. Each meeting has a transcript (\"You\" is the user, \
\"Them\" is everyone else on a call, \"Room\" is one microphone hearing everyone in the room), the notes the user typed, and \
notes written from both. Find meetings with search_meetings or list_meetings, then read one with get_meeting. When you use a \
meeting, cite it with its link (yammer://meeting/<id>) so the user can open it.";

pub struct Server {
    store: Store,
    dir: PathBuf,
    version: String,
}

impl Server {
    /// Serve the meetings in `dir`. `version` is the app's, for `serverInfo`.
    pub fn new(dir: PathBuf, version: &str) -> Server {
        Server { store: Store::new(dir.clone()), dir, version: version.into() }
    }

    /// Answer messages from `input` on `output` until `input` ends.
    pub fn serve(&self, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
        for line in input.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let reply = match serde_json::from_str::<Value>(&line) {
                Ok(msg) => self.handle(&msg),
                Err(e) => Some(error(Value::Null, -32700, &format!("Parse error: {e}"))),
            };
            if let Some(reply) = reply {
                writeln!(output, "{reply}")?;
                output.flush()?;
            }
        }
        Ok(())
    }

    /// The reply to one JSON-RPC message, or `None` for a notification.
    pub fn handle(&self, msg: &Value) -> Option<Value> {
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str).unwrap_or_default();
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        // Notifications ("notifications/initialized", "notifications/cancelled") get no reply.
        let id = id?;
        let result = match method {
            "initialize" => Ok(self.initialize(&params)),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools() })),
            "tools/call" => self.call(&params),
            "resources/list" => Ok(json!({ "resources": [] })),
            "prompts/list" => Ok(json!({ "prompts": [] })),
            _ => Err((-32601, format!("Method not found: {method}"))),
        };
        Some(match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => error(id, code, &message),
        })
    }

    fn initialize(&self, params: &Value) -> Value {
        let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or_default();
        let version = PROTOCOL_VERSIONS.iter().find(|v| **v == asked).unwrap_or(&PROTOCOL_VERSIONS[0]);
        json!({
            "protocolVersion": version,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "yammer", "title": "Yammer meetings", "version": self.version },
            "instructions": INSTRUCTIONS,
        })
    }

    /// A tool's result; a tool that fails says so in its result (`isError`), as MCP asks.
    fn call(&self, params: &Value) -> Result<Value, (i64, String)> {
        let name = params.get("name").and_then(Value::as_str).ok_or((-32602, "Missing the tool's name.".to_string()))?;
        let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
        let out = match name {
            "list_meetings" => self.list_meetings(&args),
            "search_meetings" => self.search_meetings(&args),
            "get_meeting" => self.get_meeting(&args),
            "get_live_meeting" => Ok(self.get_live_meeting()),
            _ => return Err((-32602, format!("Unknown tool: {name}"))),
        };
        Ok(match out {
            Ok(value) => json!({ "content": [{ "type": "text", "text": pretty(&value) }], "structuredContent": value }),
            Err(message) => json!({ "content": [{ "type": "text", "text": message }], "isError": true }),
        })
    }

    fn list_meetings(&self, args: &Value) -> Result<Value, String> {
        let since = date_arg(args, "since", false)?;
        let until = date_arg(args, "until", true)?;
        let limit = limit_arg(args)?;
        let all: Vec<Overview> = self.store.list();
        let matching: Vec<&Overview> =
            all.iter().filter(|o| since.is_none_or(|s| o.started_at >= s) && until.is_none_or(|u| o.started_at < u)).collect();
        let meetings: Vec<Value> = matching.iter().take(limit).map(|o| overview(o, self.is_live(o.id, o.ended_at))).collect();
        Ok(json!({ "meetings": meetings, "total": matching.len(), "shown": meetings.len() }))
    }

    fn search_meetings(&self, args: &Value) -> Result<Value, String> {
        let query = args.get("query").and_then(Value::as_str).map(str::trim).unwrap_or_default();
        if query.is_empty() {
            return Err("Give a query: words that should all appear in the meeting.".into());
        }
        let limit = limit_arg(args)?;
        let hits = self.store.search(query);
        let shown: Vec<Value> = hits
            .iter()
            .take(limit)
            .map(|h| {
                json!({
                    "id": h.id,
                    "title": title_of(&h.title, h.started_at),
                    "started": iso(h.started_at),
                    "matchedIn": h.field,
                    "snippet": h.snippet,
                    "link": link(h.id),
                })
            })
            .collect();
        Ok(json!({ "query": query, "meetings": shown, "total": hits.len() }))
    }

    fn get_meeting(&self, args: &Value) -> Result<Value, String> {
        let id = args.get("id").and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())));
        let id = id.ok_or("Give the meeting's id, from list_meetings or search_meetings.")?;
        let meeting = self.store.get(id).ok_or(format!("There's no meeting {id}."))?;
        let transcript = args.get("includeTranscript").and_then(Value::as_bool).unwrap_or(false);
        Ok(full(&meeting, self.is_live(meeting.id, meeting.ended_at), transcript))
    }

    fn get_live_meeting(&self) -> Value {
        let live = self.store.list().into_iter().find(|o| self.is_live(o.id, o.ended_at)).and_then(|o| self.store.get(o.id));
        match live {
            Some(m) => json!({ "live": true, "meeting": full(&m, true, true) }),
            None => json!({ "live": false, "message": "No meeting is being transcribed right now." }),
        }
    }

    fn is_live(&self, id: u64, ended_at: Option<u64>) -> bool {
        if ended_at.is_some() {
            return false;
        }
        let saved = std::fs::metadata(self.dir.join(format!("{id}.json"))).and_then(|m| m.modified());
        saved.ok().and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|age| age < LIVE_WITHIN)
    }
}

fn tools() -> Value {
    let read_only = json!({ "readOnlyHint": true, "openWorldHint": false });
    json!([
        {
            "name": "list_meetings",
            "title": "List meetings",
            "description": "The user's meetings, newest first: title, when, how long, and the start of the notes. Narrow it to a date range \
    with since and until.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "since": { "type": "string", "description": "Only meetings on or after this date, YYYY-MM-DD (UTC)." },
                    "until": { "type": "string", "description": "Only meetings on or before this date, YYYY-MM-DD (UTC)." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "description": "At most this many (20 if not given)." }
                }
            },
            "annotations": read_only,
        },
        {
            "name": "search_meetings",
            "title": "Search meetings",
            "description": "Meetings that mention every word of the query, in their title, notes or transcript, best match first, with \
    the text around the match.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Words that must all appear, in any order and case." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "description": "At most this many (20 if not given)." }
                },
                "required": ["query"]
            },
            "annotations": read_only,
        },
        {
            "name": "get_meeting",
            "title": "Read a meeting",
            "description": "One meeting in full: its notes, the notes the user typed, the questions they asked about it, the \
    calendar event it was part of (title and attendees, when there was one), and, if asked for, the whole transcript.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "The meeting's id." },
                    "includeTranscript": { "type": "boolean", "description": "Include the transcript, one line per thing said. Long meetings make long transcripts." }
                },
                "required": ["id"]
            },
            "annotations": read_only,
        },
        {
            "name": "get_live_meeting",
            "title": "Read the meeting in progress",
            "description": "The meeting Yammer is transcribing right now, with its transcript so far, or a note that there isn't one.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": read_only,
        }
    ])
}

fn overview(o: &Overview, live: bool) -> Value {
    json!({
        "id": o.id,
        "title": title_of(&o.title, o.started_at),
        "started": iso(o.started_at),
        "minutes": o.ended_at.map(|e| e.saturating_sub(o.started_at) / 60_000),
        "live": live,
        "words": o.words,
        "hasNotes": o.has_summary,
        "attendees": o.attendees,
        "preview": o.preview,
        "link": link(o.id),
    })
}

fn full(m: &Meeting, live: bool, transcript: bool) -> Value {
    let mut v = json!({
        "id": m.id,
        "title": title_of(&m.title, m.started_at),
        "started": iso(m.started_at),
        "ended": m.ended_at.map(iso),
        "live": live,
        "transcribedWith": m.engine,
        "template": m.template,
        "notes": m.summary,
        "notesWrittenBy": m.summary_by,
        "yourNotes": Some(m.notes.trim()).filter(|n| !n.is_empty()),
        "questions": m.chat.iter().map(|t| json!({ "role": t.role, "text": t.text })).collect::<Vec<_>>(),
        "words": m.words(),
        "link": link(m.id),
    });
    if let Some(e) = &m.event {
        v["calendarEvent"] = json!({ "title": e.title, "start": iso(e.start), "end": iso(e.end), "attendees": e.attendees, "joinUrl": e.join_url });
    }
    if transcript {
        v["transcript"] = json!(m.transcript());
    }
    if m.ended_at.is_none() && !live {
        v["note"] = json!("Yammer quit before this meeting was stopped, so the transcript may end early.");
    }
    v
}

fn title_of(title: &str, started_at: u64) -> String {
    match title.trim() {
        "" => format!("Meeting on {}", &iso(started_at)[..10]),
        t => t.to_string(),
    }
}

pub fn link(id: u64) -> String {
    format!("yammer://meeting/{id}")
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn limit_arg(args: &Value) -> Result<usize, String> {
    match args.get("limit") {
        None | Some(Value::Null) => Ok(DEFAULT_LIMIT),
        Some(v) => v.as_u64().filter(|n| *n >= 1).map(|n| (n as usize).min(MAX_LIMIT)).ok_or("limit must be a whole number from 1.".into()),
    }
}

/// A "YYYY-MM-DD" argument as Unix ms at the start of that day (UTC), or of the next day for an
/// `end` bound, so "until 2026-11-16" includes the 16th. A full timestamp ("2026-11-16T09:00:00Z") uses its date.
fn date_arg(args: &Value, name: &str, end: bool) -> Result<Option<u64>, String> {
    let Some(text) = args.get(name).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) else { return Ok(None) };
    let bad = || format!("{name} must be a date like 2026-11-16.");
    let date = text.get(..10).ok_or_else(bad)?;
    let mut parts = date.split('-').map(|p| p.parse::<i64>());
    let (Some(Ok(y)), Some(Ok(m)), Some(Ok(d)), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else { return Err(bad()) };
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return Err(bad());
    }
    let days = days_from_civil(y, m, d) + i64::from(end);
    Ok(Some((days.max(0) as u64) * 86_400_000))
}

/// Unix ms as "2026-11-16T09:30:00Z".
pub fn iso(ms: u64) -> String {
    let secs = ms / 1000;
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let s = secs % 86_400;
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", s / 3600, s / 60 % 60, s % 60)
}

// Howard Hinnant's algorithms: days since 1970-01-01 to and from a proleptic Gregorian date.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meetings::{ChatRole, ChatTurn, Segment, Speaker};

    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("voice-core-mcp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn meeting(id: u64, title: &str, said: &str, ended: bool) -> Meeting {
        let mut m = Meeting { title: title.into(), ..Meeting::new(id, "x".into()) };
        m.upsert(Segment { id: "a".into(), at_ms: 1_000, speaker: Speaker::Them, text: said.into(), partial: false });
        if ended {
            m.finish(id + 30 * 60_000);
        }
        m
    }

    fn call(server: &Server, name: &str, args: Value) -> Value {
        let reply = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": name, "arguments": args } }))
            .unwrap();
        assert_eq!(reply["id"], 7);
        reply["result"].clone()
    }

    #[test]
    fn speaks_the_protocol() {
        let server = Server::new(dir("protocol"), "1.2.3");
        let init = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }))
            .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["version"], "1.2.3");
        let init = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "1999-01-01" } }))
            .unwrap();
        assert_eq!(init["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
        assert_eq!(server.handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })), None);
        let tools = server.handle(&json!({ "jsonrpc": "2.0", "id": "t", "method": "tools/list" })).unwrap();
        let names: Vec<&str> = tools["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["list_meetings", "search_meetings", "get_meeting", "get_live_meeting"]);
        assert!(tools["result"]["tools"].as_array().unwrap().iter().all(|t| t["annotations"]["readOnlyHint"] == true));
        let missing = server.handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "nope" })).unwrap();
        assert_eq!(missing["error"]["code"], -32601);
        let unknown = server.handle(&json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "rm" } })).unwrap();
        assert_eq!(unknown["error"]["code"], -32602);
    }

    #[test]
    fn serves_lines_until_input_ends() {
        let server = Server::new(dir("serve"), "1");
        let input =
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n\nnot json\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n";
        let mut out = Vec::new();
        server.serve(input.as_bytes(), &mut out).unwrap();
        let lines: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["result"], json!({}));
        assert_eq!(lines[1]["error"]["code"], -32700);
    }

    #[test]
    fn lists_searches_and_reads_meetings() {
        let d = dir("tools");
        let store = Store::new(d.clone());
        // 2026-11-02 and 2026-11-16, 09:00 UTC.
        let (early, late) = (1_793_610_000_000, 1_794_819_600_000);
        store.save(&meeting(early, "Pricing sync", "We should raise the Pro price.", true)).unwrap();
        let mut b = meeting(late, "", "Ship the beta on Friday.", true);
        b.summary = Some("## Summary\n- Beta ships Friday".into());
        b.notes = "ask about QA".into();
        b.chat = vec![ChatTurn { role: ChatRole::User, text: "Who ships?".into(), at: 1 }];
        b.event = Some(crate::calendar::Event {
            uid: "u".into(),
            title: "Beta review".into(),
            start: late,
            end: late + 1_800_000,
            attendees: vec![crate::calendar::Attendee { name: "Ana Lopez".into(), email: Some("ana@example.com".into()) }],
            join_url: None,
        });
        store.save(&b).unwrap();
        let server = Server::new(d.clone(), "1");

        let all = call(&server, "list_meetings", json!({}));
        let listed = &all["structuredContent"]["meetings"];
        assert_eq!((listed[0]["id"].as_u64(), listed[1]["id"].as_u64()), (Some(late), Some(early)));
        assert_eq!(listed[0]["title"], "Meeting on 2026-11-16");
        assert_eq!((listed[1]["minutes"].as_u64(), listed[1]["live"].as_bool()), (Some(30), Some(false)));
        assert_eq!(listed[1]["link"], format!("yammer://meeting/{early}"));
        assert!(all["content"][0]["text"].as_str().unwrap().contains("Pricing sync"));

        let week = call(&server, "list_meetings", json!({ "since": "2026-11-10", "until": "2026-11-16" }));
        assert_eq!(week["structuredContent"]["total"], 1);
        let before = call(&server, "list_meetings", json!({ "until": "2026-11-15", "limit": 5 }));
        assert_eq!(before["structuredContent"]["meetings"][0]["id"].as_u64(), Some(early));
        assert_eq!(call(&server, "list_meetings", json!({ "since": "last week" }))["isError"], true);

        let found = call(&server, "search_meetings", json!({ "query": "pro PRICE" }));
        assert_eq!(found["structuredContent"]["meetings"][0]["id"].as_u64(), Some(early));
        assert_eq!(call(&server, "search_meetings", json!({ "query": " " }))["isError"], true);

        let read = call(&server, "get_meeting", json!({ "id": late }))["structuredContent"].clone();
        assert_eq!((read["notes"].as_str(), read["yourNotes"].as_str()), (Some("## Summary\n- Beta ships Friday"), Some("ask about QA")));
        assert_eq!(read["questions"][0]["role"], "user");
        assert_eq!(read["calendarEvent"]["attendees"][0]["email"], "ana@example.com");
        assert_eq!(listed[0]["attendees"], json!(["Ana Lopez"]));
        assert!(read.get("transcript").is_none());
        let read = call(&server, "get_meeting", json!({ "id": late.to_string(), "includeTranscript": true }))["structuredContent"].clone();
        assert_eq!(read["transcript"], "[00:01] Them: Ship the beta on Friday.");
        assert_eq!(call(&server, "get_meeting", json!({ "id": 5 }))["isError"], true);
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn finds_the_meeting_in_progress() {
        let d = dir("live");
        let store = Store::new(d.clone());
        let server = Server::new(d.clone(), "1");
        assert_eq!(call(&server, "get_live_meeting", json!({}))["structuredContent"]["live"], false);
        // Saved a moment ago and not ended: in progress.
        store.save(&meeting(1_000, "Standup", "Blocked on review.", false)).unwrap();
        let live = call(&server, "get_live_meeting", json!({}))["structuredContent"].clone();
        assert_eq!((live["live"].as_bool(), live["meeting"]["transcript"].as_str()), (Some(true), Some("[00:01] Them: Blocked on review.")));
        // An ended one isn't.
        store.save(&meeting(1_000, "Standup", "Blocked on review.", true)).unwrap();
        assert_eq!(call(&server, "get_live_meeting", json!({}))["structuredContent"]["live"], false);
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn converts_dates() {
        assert_eq!(iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso(1_794_819_600_000), "2026-11-16T09:00:00Z");
        assert_eq!(date_arg(&json!({ "d": "2026-11-16" }), "d", false), Ok(Some(1_794_787_200_000)));
        assert_eq!(date_arg(&json!({ "d": "2026-11-16T23:00:00Z" }), "d", true), Ok(Some(1_794_873_600_000)));
        assert_eq!(date_arg(&json!({ "d": "2024-02-29" }), "d", false).map(|d| iso(d.unwrap())), Ok("2024-02-29T00:00:00Z".into()));
        assert!(date_arg(&json!({ "d": "2026-13-01" }), "d", false).is_err());
        assert_eq!(date_arg(&json!({}), "d", false), Ok(None));
    }
}
