//! The user's calendar, kept fresh: read from its secret iCal address (in the
//! keyring as the `calendar` secret) at startup and every 10 minutes after, and
//! cached here for the rest of the app. A meeting that starts during an event
//! is linked to it (`for_meeting`), Sushi offers to take notes as an event
//! begins (`calls.rs`), and the Meetings page lists what's coming up.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use voice_core::calendar::{self, Event};

use crate::error::{AppError, AppResult};
use crate::secrets;
use crate::state::{now_ms, AppState};

/// The secret the address is kept under.
pub const SECRET: &str = "calendar";
const EVERY: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct Calendar {
    cache: Mutex<Cache>,
    /// The event the next meeting belongs to, picked by "Start notes" on it.
    chosen: Mutex<Option<String>>,
}

#[derive(Default, Clone)]
struct Cache {
    events: Vec<Event>,
    error: Option<String>,
    fetched_at: Option<u64>,
}

/// What the UI shows. Sent as `calendar-updated` after every refresh.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// An address is saved.
    pub connected: bool,
    /// Events from now (and those under way) to a week ahead, soonest first.
    pub events: Vec<Event>,
    /// Why the last refresh failed, if it did.
    pub error: Option<String>,
    pub fetched_at: Option<u64>,
}

impl Calendar {
    pub fn status(&self) -> Status {
        let cache = self.cache.lock().unwrap().clone();
        let now = now_ms();
        Status {
            connected: secrets::get(SECRET).ok().flatten().is_some(),
            events: cache.events.into_iter().filter(|e| e.end > now).collect(),
            error: cache.error,
            fetched_at: cache.fetched_at,
        }
    }

    pub fn events(&self) -> Vec<Event> {
        self.cache.lock().unwrap().events.clone()
    }

    /// The event a meeting starting now belongs to: the one picked to start notes for, else the one under way.
    pub fn for_meeting(&self, at: u64) -> Option<Event> {
        let events = self.events();
        let chosen = self.chosen.lock().unwrap().take();
        chosen
            .and_then(|key| events.iter().find(|e| e.key() == key).cloned())
            .or_else(|| calendar::current(&events, at).cloned())
    }

    /// The event under way at `at`, for naming a call: unlike `for_meeting`, leaves a chosen one alone.
    #[cfg_attr(not(desktop), allow(dead_code))]
    pub fn for_meeting_peek(&self, at: u64) -> Option<Event> {
        calendar::current(&self.events(), at).cloned()
    }

    /// The next meeting started belongs to this event (`Event::key`).
    pub fn choose(&self, key: Option<String>) {
        *self.chosen.lock().unwrap() = key;
    }
}

/// Read the calendar now and every few minutes, for as long as Yammer runs.
pub fn watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = refresh(&app).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Read the calendar again from the saved address. Without one, the cache empties.
pub async fn refresh(app: &AppHandle) -> Status {
    let me = app.state::<Calendar>();
    let url = secrets::get(SECRET).ok().flatten();
    let next = match url {
        None => Cache::default(),
        Some(url) => match read(app, &url).await {
            Ok(events) => Cache { events, error: None, fetched_at: Some(now_ms()) },
            // Keep what was read last time: a dropped connection shouldn't empty the calendar.
            Err(e) => Cache { error: Some(e.to_string()), ..me.cache.lock().unwrap().clone() },
        },
    };
    *me.cache.lock().unwrap() = next;
    let status = me.status();
    let _ = app.emit("calendar-updated", &status);
    status
}

async fn read(app: &AppHandle, url: &str) -> AppResult<Vec<Event>> {
    let now = now_ms();
    let http = app.state::<AppState>().http.clone();
    Ok(calendar::fetch(&http, url, now.saturating_sub(calendar::PAST_MS), now + calendar::AHEAD_MS).await?)
}

/// Save the calendar's address once it reads, or forget it (`url` empty). The status after.
pub async fn connect(app: &AppHandle, url: &str) -> AppResult<Status> {
    let url = url.trim();
    if url.is_empty() {
        secrets::delete(SECRET)?;
        return Ok(refresh(app).await);
    }
    let address =
        calendar::normalize_url(url).ok_or_else(|| AppError::Invalid("That isn't a calendar address. Paste the secret iCal (.ics) link.".into()))?;
    // Checked before it's saved, so a mistyped link never replaces a working one.
    read(app, &address).await?;
    secrets::set(SECRET, &address)?;
    Ok(refresh(app).await)
}
