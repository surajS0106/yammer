use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use voice_core::history::History;
use voice_core::Settings;

use crate::error::AppResult;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub history: Mutex<History>,
    pub scratchpad_path: PathBuf,
    pub models_dir: PathBuf,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> AppResult<AppState> {
        let settings_path = config_dir.join("settings.json");
        let settings = Settings::load(&settings_path);
        let mut history = History::load(&data_dir.join("history.json"));
        if let Err(e) = history.prune(now_ms(), settings.history_days, settings.keep_recordings as usize) {
            eprintln!("couldn't drop old history: {e}");
        }
        Ok(AppState {
            settings: Mutex::new(settings),
            settings_path,
            history: Mutex::new(history),
            scratchpad_path: data_dir.join("scratchpad.json"),
            models_dir: data_dir.join("models"),
            http: reqwest::Client::builder()
                .user_agent(concat!("Yammer/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(crate::error::AppError::invalid)?,
        })
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }
}

/// Unix time in milliseconds.
pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}
