//! GNOME on Wayland gives apps no way to press keys except the RemoteDesktop
//! portal, which asks the user once, in a dialog, to allow keyboard control.
//! The session is opened at startup, so the dialog doesn't come up mid-paste
//! and take the focus, and kept for the life of the app. The restore token it
//! hands back lets later launches skip the dialog, where the portal supports it.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use ashpd::desktop::remote_desktop::{DeviceType, KeyState, RemoteDesktop, SelectDevicesOptions};
use ashpd::desktop::{PersistMode, Session};
use tokio::sync::Mutex;

struct Keyboard {
    proxy: RemoteDesktop,
    session: Session<RemoteDesktop>,
}

static KEYBOARD: Mutex<Option<Keyboard>> = Mutex::const_new(None);
static TOKEN_PATH: OnceLock<PathBuf> = OnceLock::new();

/// evdev key codes.
const KEY_LEFTCTRL: i32 = 29;
const KEY_V: i32 = 47;

/// Open the session now, so the permission dialog shows up at launch.
pub fn init(config_dir: &Path) {
    let _ = TOKEN_PATH.set(config_dir.join("remote-desktop-token"));
    tauri::async_runtime::spawn(async {
        let mut keyboard = KEYBOARD.lock().await;
        match connect().await {
            Ok(k) => *keyboard = Some(k),
            Err(e) => eprintln!("couldn't get keyboard access from the RemoteDesktop portal: {e}"),
        }
    });
}

async fn connect() -> ashpd::Result<Keyboard> {
    let proxy = RemoteDesktop::new().await?;
    let session = proxy.create_session(Default::default()).await?;
    let token = TOKEN_PATH.get().and_then(|p| std::fs::read_to_string(p).ok());
    let options = SelectDevicesOptions::default()
        .set_devices(Some(DeviceType::Keyboard.into()))
        .set_persist_mode(PersistMode::ExplicitlyRevoked)
        .set_restore_token(token.as_deref());
    proxy.select_devices(&session, options).await?.response()?;
    let started = proxy.start(&session, None, Default::default()).await?.response()?;
    if let (Some(path), Some(token)) = (TOKEN_PATH.get(), started.restore_token()) {
        let _ = std::fs::write(path, token);
    }
    Ok(Keyboard { proxy, session })
}

impl Keyboard {
    async fn key(&self, code: i32, state: KeyState) -> ashpd::Result<()> {
        self.proxy.notify_keyboard_keycode(&self.session, code, state, Default::default()).await
    }

    async fn paste(&self) -> ashpd::Result<()> {
        self.key(KEY_LEFTCTRL, KeyState::Pressed).await?;
        let result = async {
            self.key(KEY_V, KeyState::Pressed).await?;
            self.key(KEY_V, KeyState::Released).await
        }
        .await;
        self.key(KEY_LEFTCTRL, KeyState::Released).await?;
        result
    }
}

/// Ctrl+V in the focused app. Blocking, so call it off the async runtime.
pub fn paste() -> Result<(), String> {
    tauri::async_runtime::block_on(async {
        let mut keyboard = KEYBOARD.lock().await;
        if keyboard.is_none() {
            *keyboard = Some(connect().await.map_err(|e| e.to_string())?);
        }
        let result = keyboard.as_ref().unwrap().paste().await;
        // The user may have stopped the session (GNOME shows it in the top bar); open a new one next time.
        if result.is_err() {
            *keyboard = None;
        }
        result.map_err(|e| e.to_string())
    })
}
