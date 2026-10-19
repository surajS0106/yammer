//! API keys live in the OS credential store (Windows Credential Manager,
//! macOS Keychain, Secret Service on Linux), never on disk or in the webview.
//!
//! Debug builds are the exception: macOS ties a keychain item's "Always
//! Allow" to the app's code signature, and every `tauri dev` rebuild is
//! signed afresh, so each launch would ask for the login password once per
//! secret. There, secrets go to `dev-secrets.json` (owner-only) in the app
//! config dir instead.

use crate::error::{AppError, AppResult};

/// The keys the app keeps: one for cloud transcription, one for cleanup.
pub const NAMES: &[&str] = &["stt", "cleanup"];

#[cfg(not(debug_assertions))]
const SERVICE: &str = "com.sush.yammer";
/// The keyring service from before the rename to Yammer; read once, then moved to `SERVICE`.
#[cfg(not(debug_assertions))]
const LEGACY_SERVICE: &str = "com.sush.larp";

/// Called once at startup with the app config dir; only debug builds use it.
pub fn init(config_dir: &std::path::Path) {
    #[cfg(debug_assertions)]
    let _ = dev::PATH.set(config_dir.join("dev-secrets.json"));
    #[cfg(not(debug_assertions))]
    let _ = config_dir;
}

#[cfg(not(debug_assertions))]
mod backend {
    use super::{LEGACY_SERVICE, SERVICE};
    use crate::error::AppResult;

    pub fn read(name: &str) -> AppResult<Option<String>> {
        if let Some(value) = get(SERVICE, name)? {
            return Ok(Some(value));
        }
        // A key saved by Larp: move it under Yammer's service so later reads find it directly.
        let Some(value) = get(LEGACY_SERVICE, name)? else { return Ok(None) };
        write(name, &value)?;
        let _ = keyring::Entry::new(LEGACY_SERVICE, name)?.delete_credential();
        Ok(Some(value))
    }

    fn get(service: &str, name: &str) -> AppResult<Option<String>> {
        match keyring::Entry::new(service, name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn write(name: &str, value: &str) -> AppResult<()> {
        Ok(keyring::Entry::new(SERVICE, name)?.set_password(value)?)
    }

    pub fn remove(name: &str) -> AppResult<()> {
        match keyring::Entry::new(SERVICE, name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(debug_assertions)]
mod dev {
    use crate::error::{AppError, AppResult};
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    pub static PATH: OnceLock<PathBuf> = OnceLock::new();
    static LOCK: Mutex<()> = Mutex::new(());

    fn path() -> AppResult<&'static PathBuf> {
        PATH.get().ok_or_else(|| AppError::Invalid("secrets not initialised".into()))
    }

    fn load() -> AppResult<BTreeMap<String, String>> {
        match std::fs::read(path()?) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(e.into()),
        }
    }

    fn save(map: &BTreeMap<String, String>) -> AppResult<()> {
        use std::io::Write;
        let path = path()?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        options.open(path)?.write_all(&serde_json::to_vec_pretty(map)?)?;
        Ok(())
    }

    pub fn read(name: &str) -> AppResult<Option<String>> {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        Ok(load()?.remove(name))
    }

    pub fn write(name: &str, value: &str) -> AppResult<()> {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = load()?;
        map.insert(name.to_string(), value.to_string());
        save(&map)
    }

    pub fn remove(name: &str) -> AppResult<()> {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = load()?;
        if map.remove(name).is_some() {
            save(&map)?;
        }
        Ok(())
    }
}

#[cfg(debug_assertions)]
use dev as backend;

fn entry_name(name: &str) -> AppResult<String> {
    if NAMES.contains(&name) {
        Ok(format!("key:{name}"))
    } else {
        Err(AppError::Invalid(format!("unknown secret {name}")))
    }
}

pub fn get(name: &str) -> AppResult<Option<String>> {
    backend::read(&entry_name(name)?)
}

pub fn set(name: &str, value: &str) -> AppResult<()> {
    let value = value.trim();
    if value.is_empty() {
        return delete(name);
    }
    backend::write(&entry_name(name)?, value)
}

pub fn delete(name: &str) -> AppResult<()> {
    backend::remove(&entry_name(name)?)
}
