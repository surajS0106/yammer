//! Spotting a call: another app holding the microphone, as Zoom, Teams or a
//! browser tab on Meet does. The desktop app asks the OS which apps are
//! recording every couple of seconds and feeds the answer to a `Detector`,
//! which tells it when an app has started a call (held the mic for a moment)
//! and when it has ended one (let go of it for a while).
//!
//! Apps are known by an `id` that stays the same across versions, helper
//! processes and install paths ("zoom", "us.zoom.xos", "msteams"), which is
//! what "Never ask for Zoom" remembers.

use std::collections::HashMap;

/// An app using the microphone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicUser {
    pub id: String,
    /// What to call it: "Zoom", "Microsoft Teams", "Chrome".
    pub name: String,
}

impl MicUser {
    /// From what the OS calls the app: an exe path, a Windows package family name, a macOS bundle id or a Linux binary.
    pub fn from_raw(raw: &str) -> Option<MicUser> {
        let id = app_id(raw)?;
        Some(MicUser { name: app_name(&id), id })
    }
}

/// How long an app has to hold the microphone before it counts as a call,
/// so a voice search or a quick mic check isn't taken for one.
pub const HOLD_MS: u64 = 3_000;
/// How long an app has to have let go of the microphone before its call
/// counts as over: some apps close and reopen it, as when changing devices.
pub const LEAVE_MS: u64 = 6_000;

/// A call starting or ending.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Began(MicUser),
    Left(MicUser),
}

struct Seen {
    name: String,
    first: u64,
    last: u64,
    began: bool,
}

/// Turns the apps using the microphone, polled over time, into calls beginning and ending.
#[derive(Default)]
pub struct Detector {
    seen: HashMap<String, Seen>,
}

impl Detector {
    pub fn new() -> Detector {
        Detector::default()
    }

    /// The apps using the microphone at `now` (ms).
    pub fn poll(&mut self, now: u64, present: &[MicUser]) -> Vec<Change> {
        let mut changes = Vec::new();
        for u in present {
            let seen = self.seen.entry(u.id.clone()).or_insert_with(|| Seen { name: u.name.clone(), first: now, last: now, began: false });
            seen.last = now;
            if !seen.began && now.saturating_sub(seen.first) >= HOLD_MS {
                seen.began = true;
                changes.push(Change::Began(u.clone()));
            }
        }
        self.seen.retain(|id, seen| {
            if now.saturating_sub(seen.last) < LEAVE_MS {
                return true;
            }
            if seen.began {
                changes.push(Change::Left(MicUser { id: id.clone(), name: seen.name.clone() }));
            }
            false
        });
        changes
    }

    /// The apps in a call now, longest first.
    pub fn active(&self) -> Vec<MicUser> {
        let mut active: Vec<_> = self.seen.iter().filter(|(_, s)| s.began).collect();
        active.sort_by_key(|(id, s)| (s.first, id.as_str()));
        active.into_iter().map(|(id, s)| MicUser { id: id.clone(), name: s.name.clone() }).collect()
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.seen.get(id).is_some_and(|s| s.began)
    }

    /// Forget every app, as when spotting calls is turned off.
    pub fn reset(&mut self) {
        self.seen.clear();
    }
}

/// The stable id of an app from what the OS calls it, or `None` for parts of
/// the OS that listen all the time (Siri, Voice Access) rather than calls.
pub fn app_id(raw: &str) -> Option<String> {
    let raw = raw.trim();
    // A path: its file name, without ".exe".
    let file = raw.rsplit(['\\', '/']).next().unwrap_or(raw);
    let mut id = file.to_lowercase();
    if let Some(stem) = id.strip_suffix(".exe") {
        id = stem.to_string();
    }
    // A Windows package family name, "5319275A.WhatsAppDesktop_cv1g1gvanyjgm": the app's part.
    if !raw.contains(['\\', '/']) {
        if let Some((name, hash)) = id.rsplit_once('_') {
            if hash.len() == 13 && hash.chars().all(|c| c.is_ascii_alphanumeric()) {
                if name.starts_with("microsoftwindows.") || name.starts_with("windows.") {
                    return None;
                }
                id = name.rsplit('.').next().unwrap_or(name).to_string();
            }
        }
    }
    // macOS helper processes record for their app: "com.google.Chrome.helper" is Chrome.
    if let Some(i) = id.find(".helper") {
        id.truncate(i);
    }
    if id.is_empty() {
        return None;
    }
    // Apple's own daemons (Siri, dictation) hold the mic while listening for "Hey Siri", which isn't a call.
    if id.starts_with("com.apple.") && known(&id).is_none() {
        return None;
    }
    Some(id)
}

/// Apps that make calls, and the browsers that run Meet, Teams and Zoom on the web.
const KNOWN: &[(&[&str], &str)] = &[
    (&["zoom", "zoom.us", "us.zoom.xos", "cpthost", "zoomwebviewhost"], "Zoom"),
    (&["ms-teams", "msteams", "teams", "com.microsoft.teams", "com.microsoft.teams2", "teams-for-linux"], "Microsoft Teams"),
    (&["chrome", "google-chrome", "google-chrome-stable", "com.google.chrome"], "Chrome"),
    (&["chromium", "chromium-browser", "org.chromium.chromium"], "Chromium"),
    (&["msedge", "microsoft-edge", "microsoft-edge-stable", "com.microsoft.edgemac"], "Microsoft Edge"),
    (&["msedgewebview2"], "Edge WebView"),
    (&["firefox", "firefox-bin", "firefox-esr", "org.mozilla.firefox"], "Firefox"),
    (&["brave", "brave-browser", "com.brave.browser"], "Brave"),
    (&["arc", "company.thebrowser.browser"], "Arc"),
    (&["opera", "com.operasoftware.opera"], "Opera"),
    (&["vivaldi", "vivaldi-bin", "com.vivaldi.vivaldi"], "Vivaldi"),
    // Safari records in WebKit's GPU process.
    (&["safari", "com.apple.safari", "com.apple.webkit.gpu"], "Safari"),
    (&["com.apple.facetime", "com.apple.avconferenced"], "FaceTime"),
    (&["slack", "com.tinyspeck.slackmacgap"], "Slack"),
    (&["discord", "com.hnc.discord"], "Discord"),
    (&["webex", "ciscocollabhost", "webexmta", "atmgr", "com.cisco.webexmeetingsapp", "com.webex.meetingmanager"], "Webex"),
    (&["whatsapp", "whatsappdesktop", "whatsapp.root", "net.whatsapp.whatsapp"], "WhatsApp"),
    (&["telegram", "telegramdesktop", "ru.keepcoder.telegram", "org.telegram.desktop"], "Telegram"),
    (&["signal", "signal-desktop", "org.whispersystems.signal-desktop"], "Signal"),
    (&["skype", "com.skype.skype"], "Skype"),
    (&["goto", "gotomeeting", "com.logmein.goto", "com.logmein.gotomeeting"], "GoTo Meeting"),
    (&["ringcentral", "com.ringcentral.glip"], "RingCentral"),
];

fn known(id: &str) -> Option<&'static str> {
    KNOWN.iter().find(|(ids, _)| ids.contains(&id)).map(|(_, name)| *name)
}

/// What to call app `id`: its known name, or one made from the id ("com.example.MyApp" is "Myapp").
pub fn app_name(id: &str) -> String {
    if let Some(name) = known(id) {
        return name.to_string();
    }
    let last = id.rsplit('.').next().unwrap_or(id).replace(['-', '_'], " ");
    let mut chars = last.trim().chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => id.to_string(),
    }
}

/// One stream recording from a source in `pactl list source-outputs` (Linux).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceOutput {
    pub pid: Option<u32>,
    /// `application.process.binary`, else `application.name`.
    pub app: String,
    pub corked: bool,
}

/// Parse `LC_ALL=C pactl list source-outputs`.
pub fn parse_pactl(text: &str) -> Vec<SourceOutput> {
    struct Block {
        pid: Option<u32>,
        binary: Option<String>,
        name: Option<String>,
        corked: bool,
    }
    fn finish(b: Block, out: &mut Vec<SourceOutput>) {
        if let Some(app) = b.binary.or(b.name).filter(|a| !a.is_empty()) {
            out.push(SourceOutput { pid: b.pid, app, corked: b.corked });
        }
    }
    let mut out = Vec::new();
    let mut block: Option<Block> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("Source Output #") {
            if let Some(b) = block.take() {
                finish(b, &mut out);
            }
            block = Some(Block { pid: None, binary: None, name: None, corked: false });
            continue;
        }
        let Some(b) = block.as_mut() else { continue };
        if let Some(v) = line.strip_prefix("Corked:") {
            b.corked = v.trim() == "yes";
        } else if let Some((key, value)) = line.split_once(" = ") {
            let value = value.trim().trim_matches('"').to_string();
            match key.trim() {
                "application.process.id" => b.pid = value.parse().ok(),
                "application.process.binary" => b.binary = Some(value),
                "application.name" => b.name = Some(value),
                _ => {}
            }
        }
    }
    if let Some(b) = block {
        finish(b, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(id: &str) -> MicUser {
        MicUser { id: id.into(), name: app_name(id) }
    }

    #[test]
    fn ids_from_what_each_os_reports() {
        assert_eq!(app_id(r"C:\Program Files\Zoom\bin\Zoom.exe").as_deref(), Some("zoom"));
        assert_eq!(app_id(r"C:\Program Files\Google\Chrome\Application\chrome.exe").as_deref(), Some("chrome"));
        assert_eq!(app_id("MSTeams_8wekyb3d8bbwe").as_deref(), Some("msteams"));
        assert_eq!(app_id("5319275A.WhatsAppDesktop_cv1g1gvanyjgm").as_deref(), Some("whatsappdesktop"));
        assert_eq!(app_id("MicrosoftWindows.Client.CBS_cw5n1h2txyewy"), None);
        assert_eq!(app_id("com.google.Chrome.helper").as_deref(), Some("com.google.chrome"));
        assert_eq!(app_id("com.google.Chrome.helper.Renderer").as_deref(), Some("com.google.chrome"));
        assert_eq!(app_id("com.apple.WebKit.GPU").as_deref(), Some("com.apple.webkit.gpu"));
        assert_eq!(app_id("com.apple.corespeechd"), None);
        assert_eq!(app_id("/usr/lib/firefox/firefox").as_deref(), Some("firefox"));
        assert_eq!(app_id("   "), None);
    }

    #[test]
    fn names() {
        for (raw, name) in [
            (r"C:\Program Files\Zoom\bin\Zoom.exe", "Zoom"),
            ("MSTeams_8wekyb3d8bbwe", "Microsoft Teams"),
            ("5319275A.WhatsAppDesktop_cv1g1gvanyjgm", "WhatsApp"),
            ("us.zoom.xos", "Zoom"),
            ("com.apple.WebKit.GPU", "Safari"),
            ("teams-for-linux", "Microsoft Teams"),
            ("com.example.MyApp", "Myapp"),
            (r"D:\Tools\obs64.exe", "Obs64"),
            ("some-recorder", "Some recorder"),
        ] {
            assert_eq!(MicUser::from_raw(raw).unwrap().name, name, "{raw}");
        }
    }

    #[test]
    fn a_call_begins_once_the_mic_is_held_and_ends_once_let_go() {
        let mut d = Detector::new();
        let zoom = user("zoom");
        assert_eq!(d.poll(0, std::slice::from_ref(&zoom)), vec![]);
        assert_eq!(d.poll(2_000, std::slice::from_ref(&zoom)), vec![]);
        assert!(!d.is_active("zoom"));
        assert_eq!(d.poll(4_000, std::slice::from_ref(&zoom)), vec![Change::Began(zoom.clone())]);
        assert_eq!(d.poll(6_000, std::slice::from_ref(&zoom)), vec![]);
        assert_eq!(d.active(), vec![zoom.clone()]);
        // A short gap isn't the end of the call.
        assert_eq!(d.poll(8_000, &[]), vec![]);
        assert_eq!(d.poll(10_000, std::slice::from_ref(&zoom)), vec![]);
        assert_eq!(d.poll(14_000, &[]), vec![]);
        assert_eq!(d.poll(16_000, &[]), vec![Change::Left(zoom.clone())]);
        assert!(d.active().is_empty());
        // The next call begins afresh.
        assert_eq!(d.poll(18_000, std::slice::from_ref(&zoom)), vec![]);
        assert_eq!(d.poll(21_000, std::slice::from_ref(&zoom)), vec![Change::Began(zoom)]);
    }

    #[test]
    fn a_blip_is_no_call() {
        let mut d = Detector::new();
        let chrome = user("chrome");
        assert_eq!(d.poll(0, std::slice::from_ref(&chrome)), vec![]);
        assert_eq!(d.poll(2_000, std::slice::from_ref(&chrome)), vec![]);
        assert_eq!(d.poll(10_000, &[]), vec![]);
        assert!(d.seen.is_empty());
    }

    #[test]
    fn active_is_longest_first() {
        let mut d = Detector::new();
        d.poll(0, &[user("zoom")]);
        d.poll(1_000, &[user("zoom"), user("slack")]);
        d.poll(5_000, &[user("zoom"), user("slack")]);
        assert_eq!(d.active().iter().map(|u| u.id.as_str()).collect::<Vec<_>>(), ["zoom", "slack"]);
        d.reset();
        assert!(d.active().is_empty());
    }

    #[test]
    fn pactl_source_outputs() {
        let text = r#"Source Output #42
	Driver: PipeWire
	Owner Module: n/a
	Client: 77
	Source: 1
	Corked: no
	Properties:
		media.name = "Zoom audio"
		application.name = "ZOOM VoiceEngine"
		application.process.id = "1234"
		application.process.binary = "zoom"

Source Output #43
	Corked: yes
	Properties:
		application.name = "Firefox"
		application.process.id = "99"

Source Output #44
	Properties:
		media.name = "nothing to go on"
"#;
        assert_eq!(
            parse_pactl(text),
            vec![
                SourceOutput { pid: Some(1234), app: "zoom".into(), corked: false },
                SourceOutput { pid: Some(99), app: "Firefox".into(), corked: true },
            ]
        );
        assert!(parse_pactl("").is_empty());
    }
}
