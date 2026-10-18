use std::path::PathBuf;
use std::sync::Mutex;

use voice_core::history::History;
use voice_core::Settings;

use crate::error::AppResult;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub history: Mutex<History>,
    pub models_dir: PathBuf,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> AppResult<AppState> {
        let settings_path = config_dir.join("settings.json");
        Ok(AppState {
            settings: Mutex::new(Settings::load(&settings_path)),
            settings_path,
            history: Mutex::new(History::load(&data_dir.join("history.json"))),
            models_dir: data_dir.join("models"),
            http: reqwest::Client::builder()
                .user_agent(concat!("SushVoice/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(crate::error::AppError::invalid)?,
        })
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }
}
