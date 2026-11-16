//! Spotting calls. Twice a second this asks the OS which apps are
//! using the microphone, and `voice_core::calls::Detector` turns that into
//! calls beginning and ending:
//!
//! - A call begins and no meeting is being transcribed: Sushi offers to
//!   transcribe it (`OverlayState::CallStarted`), or, with `CallDetect::Auto`,
//!   counts down and starts by itself unless cancelled. Each call is offered once.
//! - The call the meeting is transcribing ends: Sushi counts down to stopping
//!   the meeting (`OverlayState::CallEnded`), unless told to keep going.
//! - An event on the calendar begins and nothing is being transcribed: Sushi
//!   offers to take notes (`calendar_offer`), whether or not a call app is open.
//!   A call offered during an event is named after it ("Weekly sync, in Zoom").
//!
//! A card only goes up while the overlay has nothing else to show, so it never
//! covers a dictation. The cards' countdowns run in the overlay, which pauses
//! them while hovered and answers with `call_answer` when they run out.
//!
//! Where each OS says who's recording, without asking for any permission:
//! - Windows: the active audio sessions on each capture device (WASAPI). Not
//!   the registry's `CapabilityAccessManager` records: since late 2026 Windows
//!   keeps those in a database only SYSTEM can read.
//! - macOS 14.2 and later: Core Audio's process objects, each saying whether it's recording.
//! - Linux: PulseAudio's (or PipeWire's) recording streams, from `pactl list source-outputs`.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use voice_core::calls::{Change, Detector, MicUser};
use voice_core::settings::{CallDetect, IgnoredApp};

use crate::calendar::Calendar;
use crate::meeting;
use crate::overlay::{self, OverlayState};
use crate::state::{now_ms, AppState};

/// Often enough that a call's end is noticed within about a second (`LEAVE_MS`).
const POLL: Duration = Duration::from_millis(500);
/// The countdown before a call is transcribed by itself (`CallDetect::Auto`).
const AUTO_MS: u64 = 5_000;
/// The countdown before the meeting stops once its call has ended.
const ENDED_MS: u64 = 10_000;
/// An event is offered this long after it begins, so starting Yammer late still offers it.
const EVENT_GRACE_MS: u64 = 2 * 60_000;
/// Yammer's own dictations and meetings use the microphone too.
const YAMMER: &[&str] = &["yammer", "com.sush.yammer"];

/// The card on the overlay, waiting for an answer.
static OFFER: Mutex<Option<Offer>> = Mutex::new(None);
/// The call the meeting in progress is transcribing.
static CALL: Mutex<Option<MicUser>> = Mutex::new(None);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

struct Offer {
    id: u64,
    /// The app with the call; none for a calendar event alone.
    user: Option<MicUser>,
    kind: Kind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// Transcribe the call that began?
    Start,
    /// Stop the meeting whose call ended?
    Stop,
}

/// What the user (or a card's countdown running out) said to a call card.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Answer {
    Start,
    NotNow,
    /// Never offer to transcribe a call from this app again.
    Never,
    Stop,
    KeepGoing,
}

/// Watch for calls, on a thread of its own, for as long as Yammer runs.
pub fn watch(app: AppHandle) {
    let spawned = std::thread::Builder::new().name("calls".into()).spawn(move || {
        let mut detector = Detector::new();
        // Calls already offered, or transcribed: not offered again until they end.
        let mut asked = HashSet::<String>::new();
        // The meeting's call has ended: offer to stop it once the overlay is free.
        let mut ended: Option<MicUser> = None;
        // Calendar events already offered (`Event::key`).
        let mut asked_events = HashSet::<String>::new();
        loop {
            std::thread::sleep(POLL);
            let settings = app.state::<AppState>().settings().meeting;
            if settings.detect == CallDetect::Off {
                detector.reset();
                asked.clear();
                ended = None;
                withdraw(&app, |o| o.user.is_some());
                offer_event(&app, &mut asked_events, settings.calendar_offer);
                continue;
            }
            let present: Vec<_> = users().into_iter().filter(|u| !settings.ignored_apps.iter().any(|a| a.id == u.id)).collect();
            let live = meeting::is_live();
            if !live {
                *CALL.lock().unwrap() = None;
                ended = None;
                // Stopped by hand while its card counted down.
                withdraw(&app, |o| o.kind == Kind::Stop);
            }
            for change in detector.poll(now_ms(), &present) {
                match change {
                    // Back before its meeting was stopped: keep going.
                    Change::Began(u) => {
                        if ended.as_ref().is_some_and(|e| e.id == u.id) {
                            ended = None;
                        }
                        withdraw(&app, |o| o.kind == Kind::Stop && o.user.as_ref().is_some_and(|x| x.id == u.id));
                    }
                    Change::Left(u) => {
                        asked.remove(&u.id);
                        withdraw(&app, |o| o.kind == Kind::Start && o.user.as_ref().is_some_and(|x| x.id == u.id));
                        if live && CALL.lock().unwrap().as_ref().is_some_and(|c| c.id == u.id) {
                            ended = Some(u);
                        }
                    }
                }
            }
            let active = detector.active();
            if live {
                // Not offered while it's transcribed, nor after the meeting is stopped by hand.
                asked.extend(active.iter().map(|u| u.id.clone()));
                // A meeting started by hand during a call follows that call.
                let mut call = CALL.lock().unwrap();
                if let (None, [only]) = (call.as_ref(), active.as_slice()) {
                    *call = Some(only.clone());
                }
                drop(call);
                withdraw(&app, |o| o.kind == Kind::Start);
            }

            // A card that something else (a dictation, say) replaced goes back in the queue.
            let replaced = {
                let mut offer = OFFER.lock().unwrap();
                let shown = match overlay::current() {
                    OverlayState::CallStarted { id, .. } | OverlayState::CallEnded { id, .. } => Some(id),
                    _ => None,
                };
                if offer.as_ref().is_some_and(|o| Some(o.id) != shown) {
                    offer.take()
                } else {
                    None
                }
            };
            match replaced {
                Some(Offer { user: Some(user), kind: Kind::Start, .. }) => drop(asked.remove(&user.id)),
                Some(Offer { user: Some(user), kind: Kind::Stop, .. }) if live => ended = Some(user),
                _ => {}
            }

            let free = matches!(overlay::current(), OverlayState::Hidden | OverlayState::Idle | OverlayState::Meeting { .. });
            if !free || OFFER.lock().unwrap().is_some() {
                continue;
            }
            if live {
                if let Some(u) = ended.take() {
                    offer(&app, Some(u), None, Kind::Stop, Some(ENDED_MS));
                }
            } else if let Some(u) = active.into_iter().find(|u| !asked.contains(&u.id)) {
                asked.insert(u.id.clone());
                // A call during an event is that event: it's offered by name, and not again on its own.
                let event = app.state::<Calendar>().for_meeting_peek(now_ms());
                if let Some(e) = &event {
                    asked_events.insert(e.key());
                }
                offer(&app, Some(u), event.map(|e| e.title), Kind::Start, (settings.detect == CallDetect::Auto).then_some(AUTO_MS));
            } else {
                offer_event(&app, &mut asked_events, settings.calendar_offer);
            }
        }
    });
    if let Err(e) = spawned {
        eprintln!("couldn't start watching for calls: {e}");
    }
}

fn offer(app: &AppHandle, user: Option<MicUser>, event: Option<String>, kind: Kind, countdown_ms: Option<u64>) {
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let name = user.as_ref().map(|u| u.name.clone()).unwrap_or_default();
    *OFFER.lock().unwrap() = Some(Offer { id, user, kind });
    let state = match kind {
        Kind::Start => OverlayState::CallStarted { id, app: name, event, countdown_ms },
        Kind::Stop => OverlayState::CallEnded { id, app: name, countdown_ms: countdown_ms.unwrap_or(ENDED_MS) },
    };
    overlay::show(app, state);
}

/// An event on the calendar has just begun and nothing's being transcribed: offer to take notes, once.
/// Only called while the overlay is free, no card is up and no meeting is live.
fn offer_event(app: &AppHandle, asked: &mut HashSet<String>, enabled: bool) {
    if !enabled || meeting::is_live() || OFFER.lock().unwrap().is_some() {
        return;
    }
    if !matches!(overlay::current(), OverlayState::Hidden | OverlayState::Idle) {
        return;
    }
    let now = now_ms();
    let events = app.state::<Calendar>().events();
    let Some(event) = events.into_iter().find(|e| e.start <= now && now < e.start + EVENT_GRACE_MS && !asked.contains(&e.key())) else { return };
    asked.insert(event.key());
    offer(app, None, Some(event.title), Kind::Start, None);
}

/// Take down the card, if it's one `which` picks.
fn withdraw(app: &AppHandle, which: impl Fn(&Offer) -> bool) {
    let taken = {
        let mut offer = OFFER.lock().unwrap();
        if offer.as_ref().is_some_and(which) {
            offer.take()
        } else {
            None
        }
    };
    if let Some(o) = taken {
        close(app, o.id);
    }
}

/// Close card `id`, if it's still the one showing.
fn close(app: &AppHandle, id: u64) {
    if matches!(overlay::current(), OverlayState::CallStarted { id: shown, .. } | OverlayState::CallEnded { id: shown, .. } if shown == id) {
        overlay::dismiss(app);
    }
}

/// The answer to card `id`. One for a card that's gone is ignored.
pub fn answer(app: &AppHandle, id: u64, answer: Answer) {
    let offer = {
        let mut offer = OFFER.lock().unwrap();
        if offer.as_ref().is_some_and(|o| o.id == id) {
            offer.take()
        } else {
            None
        }
    };
    let Some(Offer { user, kind, .. }) = offer else { return };
    close(app, id);
    match (kind, answer) {
        (Kind::Start, Answer::Start) => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                match meeting::start(&app).await {
                    Ok(_) => *CALL.lock().unwrap() = user,
                    Err(e) => meeting::report(&app, &e),
                }
            });
        }
        (Kind::Start, Answer::Never) => {
            if let Some(user) = user {
                ignore(app, user);
            }
        }
        (Kind::Stop, Answer::Stop) => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = meeting::stop(&app).await {
                    meeting::report(&app, &e);
                }
            });
        }
        // Not asked about this call again; the meeting carries on until stopped by hand.
        (Kind::Stop, Answer::KeepGoing) => *CALL.lock().unwrap() = None,
        _ => {}
    }
}

/// "Never for Zoom": add it to the apps never offered.
fn ignore(app: &AppHandle, user: MicUser) {
    let state = app.state::<AppState>();
    let settings = {
        let mut settings = state.settings.lock().unwrap();
        let ignored = &mut settings.meeting.ignored_apps;
        if !ignored.iter().any(|a| a.id == user.id) {
            ignored.push(IgnoredApp { id: user.id, name: user.name });
        }
        settings.clone()
    };
    if let Err(e) = settings.save(&state.settings_path) {
        eprintln!("saving settings failed: {e}");
    }
    let _ = app.emit("settings-changed", &settings);
}

/// The apps using the microphone now, other than Yammer.
fn users() -> Vec<MicUser> {
    let mut users: Vec<MicUser> = Vec::new();
    for u in recording().iter().filter_map(|raw| MicUser::from_raw(raw)) {
        if !YAMMER.contains(&u.id.as_str()) && !users.iter().any(|x| x.id == u.id) {
            users.push(u);
        }
    }
    users
}

/// The exe of each process with an active audio session on a microphone (any
/// capture device). A session stays listed after its stream stops, but is
/// only active while recording.
#[cfg(target_os = "windows")]
fn recording() -> Vec<String> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eCapture, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

    let me = std::process::id();
    let mut pids = Vec::new();
    // SAFETY: COM is initialised for this thread for the duration, and every interface is dropped before it's uninitialised.
    unsafe {
        let init = CoInitializeEx(None, COINIT_MULTITHREADED);
        let _ = (|| -> windows::core::Result<()> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let devices = enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)?;
            for i in 0..devices.GetCount()? {
                let Ok(manager) = devices.Item(i).and_then(|d| d.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)) else { continue };
                let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
                for j in 0..sessions.GetCount().unwrap_or(0) {
                    let Ok(session) = sessions.GetSession(j) else { continue };
                    if !session.GetState().is_ok_and(|s| s == AudioSessionStateActive) {
                        continue;
                    }
                    if let Ok(pid) = session.cast::<IAudioSessionControl2>().and_then(|s| s.GetProcessId()) {
                        if pid != 0 && pid != me && !pids.contains(&pid) {
                            pids.push(pid);
                        }
                    }
                }
            }
            Ok(())
        })();
        if init.is_ok() {
            CoUninitialize();
        }
    }
    pids.into_iter().filter_map(exe_path).collect()
}

#[cfg(target_os = "windows")]
fn exe_path(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};

    // SAFETY: the handle is closed once read, and `len` says how much of `buf` was written.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let read = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        read.ok().map(|_| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Bundle ids of the processes recording now.
#[cfg(target_os = "macos")]
fn recording() -> Vec<String> {
    let me = std::process::id() as i32;
    mac::recording().into_iter().filter(|(pid, _)| *pid != me).map(|(_, id)| id).collect()
}

/// The binaries of the streams recording now, other than Yammer's own (and the `parec` it runs).
#[cfg(target_os = "linux")]
fn recording() -> Vec<String> {
    let Ok(out) = std::process::Command::new("pactl").args(["list", "source-outputs"]).env("LC_ALL", "C").output() else {
        return Vec::new();
    };
    let me = std::process::id();
    voice_core::calls::parse_pactl(&String::from_utf8_lossy(&out.stdout))
        .into_iter()
        .filter(|o| !o.corked && o.pid.is_none_or(|p| p != me && parent(p) != Some(me)))
        .map(|o| o.app)
        .collect()
}

#[cfg(target_os = "linux")]
fn parent(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // "pid (name) state ppid …", where the name may hold spaces.
    stat.rsplit_once(')')?.1.split_whitespace().nth(1)?.parse().ok()
}

/// Core Audio's process objects (macOS 14.2+). On older versions the list
/// can't be read, so no call is ever spotted.
#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CStr};
    use std::mem::size_of;
    use std::ptr::null;

    type ObjectId = u32;

    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyDataSize(
            object: ObjectId,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
        ) -> i32;
        fn AudioObjectGetPropertyData(
            object: ObjectId,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
            data: *mut c_void,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringGetCString(string: *const c_void, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
        fn CFRelease(cf: *const c_void);
    }

    const fn code(s: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*s)
    }

    const SYSTEM_OBJECT: ObjectId = 1;
    const SCOPE_GLOBAL: u32 = code(b"glob");
    const ELEMENT_MAIN: u32 = 0;
    /// kAudioHardwarePropertyProcessObjectList
    const PROCESS_LIST: u32 = code(b"prs#");
    /// kAudioProcessPropertyPID
    const PID: u32 = code(b"ppid");
    /// kAudioProcessPropertyBundleID, a CFString the caller releases.
    const BUNDLE_ID: u32 = code(b"pbid");
    /// kAudioProcessPropertyIsRunningInput
    const RUNNING_INPUT: u32 = code(b"piri");
    const UTF8: u32 = 0x0800_0100;

    fn address(selector: u32) -> Address {
        Address { selector, scope: SCOPE_GLOBAL, element: ELEMENT_MAIN }
    }

    /// A fixed-size property, if `object` has it.
    fn get<T: Copy + Default>(object: ObjectId, selector: u32) -> Option<T> {
        let mut value = T::default();
        let mut size = size_of::<T>() as u32;
        // SAFETY: `value` is a `T` and `size` says so.
        let status = unsafe { AudioObjectGetPropertyData(object, &address(selector), 0, null(), &mut size, (&raw mut value).cast()) };
        (status == 0 && size as usize == size_of::<T>()).then_some(value)
    }

    fn bundle_id(process: ObjectId) -> Option<String> {
        let string = get::<usize>(process, BUNDLE_ID)? as *const c_void;
        if string.is_null() {
            return None;
        }
        let mut buf = [0 as c_char; 512];
        // SAFETY: `string` is the CFString Core Audio handed over, released once read.
        let read = unsafe {
            let ok = CFStringGetCString(string, buf.as_mut_ptr(), buf.len() as isize, UTF8) != 0;
            CFRelease(string);
            ok
        };
        // SAFETY: CFStringGetCString wrote a NUL-terminated string into `buf`.
        let id = read.then(|| unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned())?;
        (!id.is_empty()).then_some(id)
    }

    /// (pid, bundle id) of each process recording now.
    pub fn recording() -> Vec<(i32, String)> {
        let list = address(PROCESS_LIST);
        let mut size = 0u32;
        // SAFETY: plain out-parameters.
        if unsafe { AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &list, 0, null(), &mut size) } != 0 || size == 0 {
            return Vec::new();
        }
        let mut ids = vec![0 as ObjectId; size as usize / size_of::<ObjectId>()];
        // SAFETY: `ids` holds `size` bytes.
        if unsafe { AudioObjectGetPropertyData(SYSTEM_OBJECT, &list, 0, null(), &mut size, ids.as_mut_ptr().cast()) } != 0 {
            return Vec::new();
        }
        ids.truncate(size as usize / size_of::<ObjectId>());
        ids.into_iter()
            .filter(|&p| get::<u32>(p, RUNNING_INPUT).is_some_and(|r| r != 0))
            .filter_map(|p| Some((get::<i32>(p, PID)?, bundle_id(p)?)))
            .collect()
    }
}
