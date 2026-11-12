//! API keys live in the OS credential store (Windows Credential Manager,
//! macOS Keychain, Secret Service on Linux), never on disk or in the webview.
//!
//! Debug builds are the exception: macOS ties a keychain item's "Always
//! Allow" to the app's code signature, and every `tauri dev` rebuild is
//! signed afresh, so each launch would ask for the login password once per
//! secret. There, secrets go to `dev-secrets.json` (owner-only) in the app
//! config dir instead.
//!
//! Android has no keyring Rust can reach, so its keys are in `secrets.bin`, in
//! the app's private storage, encrypted with AES-256-GCM. That file's key is
//! itself wrapped by a key the Android Keystore holds and never lets out
//! (`Vault.kt`); Kotlin unwraps it as the app or its service starts, and hands it
//! over with `unlock` before anything reads a key. Builds that stored keys in
//! plain `dev-secrets.json` have them moved in, and the file deleted.

//! A key belongs to a provider (`voice_core::settings::KEY_NAMES`), so the one
//! saved on any page serves every feature set to that provider.

use crate::error::{AppError, AppResult};
use voice_core::settings::Settings;

pub use voice_core::settings::KEY_NAMES as NAMES;

/// Keys from before they were shared, saved once per feature.
const LEGACY_NAMES: &[&str] = &["stt", "cleanup", "live"];

#[cfg(all(desktop, not(debug_assertions)))]
const SERVICE: &str = "com.sush.yammer";
/// The keyring service from before the rename to Yammer; read once, then moved to `SERVICE`.
#[cfg(all(desktop, not(debug_assertions)))]
const LEGACY_SERVICE: &str = "com.sush.larp";

/// Called once at startup with the app config dir; debug builds and Android use it.
pub fn init(config_dir: &std::path::Path) {
    #[cfg(all(desktop, debug_assertions))]
    let _ = dev::PATH.set(config_dir.join("dev-secrets.json"));
    #[cfg(target_os = "android")]
    vault::init(config_dir);
    #[cfg(all(desktop, not(debug_assertions)))]
    let _ = config_dir;
}

/// The key that encrypts Android's keys file, from Kotlin (`YammerNative.unlock`).
#[cfg(target_os = "android")]
pub fn unlock(key: [u8; 32]) {
    vault::unlock(key);
}

#[cfg(all(desktop, not(debug_assertions)))]
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

#[cfg(all(desktop, debug_assertions))]
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

#[cfg(all(desktop, debug_assertions))]
use dev as backend;

/// Android: the keys, encrypted (see the module comment).
#[cfg(target_os = "android")]
mod vault {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};

    use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
    use aes_gcm::{Aes256Gcm, Nonce};

    use crate::error::{AppError, AppResult};

    const NONCE: usize = 12;

    static DIR: OnceLock<PathBuf> = OnceLock::new();
    static KEY: OnceLock<[u8; 32]> = OnceLock::new();
    static LOCK: Mutex<()> = Mutex::new(());

    pub fn init(dir: &Path) {
        let _ = DIR.set(dir.to_path_buf());
    }

    pub fn unlock(key: [u8; 32]) {
        let _ = KEY.set(key);
    }

    fn paths() -> AppResult<(PathBuf, PathBuf)> {
        let dir = DIR.get().ok_or_else(|| AppError::Invalid("secrets not initialised".into()))?;
        Ok((dir.join("secrets.bin"), dir.join("dev-secrets.json")))
    }

    fn cipher() -> AppResult<Aes256Gcm> {
        let key = KEY.get().ok_or_else(|| AppError::Invalid("Your API keys are locked. Open Yammer, then try again.".into()))?;
        Ok(Aes256Gcm::new(key.into()))
    }

    fn load() -> AppResult<BTreeMap<String, String>> {
        let (path, plain) = paths()?;
        match std::fs::read(&path) {
            Ok(bytes) if bytes.len() > NONCE => {
                let (nonce, sealed) = bytes.split_at(NONCE);
                match cipher()?.decrypt(Nonce::from_slice(nonce), sealed) {
                    Ok(json) => Ok(serde_json::from_slice(&json)?),
                    // The Keystore's key was lost (a restore to another phone, say): the keys are
                    // gone, and saving one starts a new file.
                    Err(_) => {
                        eprintln!("couldn't decrypt the saved API keys; they'll need adding again");
                        Ok(BTreeMap::new())
                    }
                }
            }
            Ok(_) => Ok(BTreeMap::new()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Keys from builds that kept them in plain JSON: encrypt them, then delete the file.
                let Ok(bytes) = std::fs::read(&plain) else { return Ok(BTreeMap::new()) };
                let map: BTreeMap<String, String> = serde_json::from_slice(&bytes).unwrap_or_default();
                save(&map)?;
                std::fs::remove_file(&plain)?;
                Ok(map)
            }
            Err(e) => Err(e.into()),
        }
    }

    fn save(map: &BTreeMap<String, String>) -> AppResult<()> {
        use std::io::Write;
        let (path, _) = paths()?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let sealed = cipher()?
            .encrypt(&nonce, serde_json::to_vec(map)?.as_slice())
            .map_err(|_| AppError::Invalid("Couldn't encrypt the API keys.".into()))?;
        // Written beside it and renamed over it, so a crash mid-write can't leave half a file.
        let tmp = path.with_extension("tmp");
        let mut file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).open(&tmp)?;
        file.write_all(&nonce)?;
        file.write_all(&sealed)?;
        file.sync_all()?;
        std::fs::rename(tmp, path)?;
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

#[cfg(target_os = "android")]
use vault as backend;

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

fn get_opt(name: Option<&str>) -> AppResult<Option<String>> {
    name.map_or(Ok(None), get)
}

/// The key for the cloud speech engine's provider.
pub fn stt(settings: &Settings) -> AppResult<Option<String>> {
    get_opt(settings.cloud.key_name())
}

/// The key for the cleanup model's provider.
pub fn cleanup(settings: &Settings) -> AppResult<Option<String>> {
    get_opt(settings.cleanup.key_name())
}

/// The key for the meeting streaming engine's provider.
pub fn live(settings: &Settings) -> AppResult<Option<String>> {
    get_opt(settings.meeting.engine.provider())
}

/// Move per-feature keys (`stt`, `cleanup`, `live`) under the provider each feature is set to.
/// A provider that already has a key keeps it. A legacy key whose feature now points at a
/// provider with no key (Ollama) is left alone, and moves once it points at one again.
pub fn migrate(settings: &Settings) {
    for &legacy in LEGACY_NAMES {
        let target = match legacy {
            "stt" => settings.cloud.key_name(),
            "cleanup" => settings.cleanup.key_name(),
            _ => settings.meeting.engine.provider(),
        };
        let Some(target) = target else { continue };
        let entry = format!("key:{legacy}");
        let result = (|| -> AppResult<()> {
            let Some(value) = backend::read(&entry)? else { return Ok(()) };
            if get(target)?.is_none() {
                set(target, &value)?;
            }
            backend::remove(&entry)
        })();
        if let Err(e) = result {
            eprintln!("couldn't move the {legacy} key: {e}");
        }
    }
}
