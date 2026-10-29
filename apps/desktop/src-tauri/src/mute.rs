//! "Mute other audio while recording": the default output device is muted
//! while the mic is open, so music or a call doesn't play into the dictation,
//! and unmuted afterwards. Only a mute Yammer made is undone, so a device that
//! was already muted stays that way.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// Whether Yammer muted the output, and so should unmute it. Held while switching.
static MUTED: Mutex<bool> = Mutex::new(false);
/// Bumped on every mute and restore, so a delayed mute doesn't land after its recording ended.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Mute the output after `delay` (so the start cue is heard), unless a restore comes first.
pub fn mute_after(delay: Duration) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let mut muted = MUTED.lock().unwrap_or_else(|e| e.into_inner());
        if GENERATION.load(Ordering::SeqCst) != generation || *muted {
            return;
        }
        if imp::muted() == Some(false) && imp::set_muted(true) {
            *muted = true;
        }
    });
}

/// Unmute, if Yammer muted it, then run `then` (the stop cue, which would be lost while muted).
pub fn restore(then: impl FnOnce() + Send + 'static) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    std::thread::spawn(move || {
        restore_now();
        then();
    });
}

/// Unmute now, if Yammer muted it. Blocking; used on quit.
pub fn restore_now() {
    let mut muted = MUTED.lock().unwrap_or_else(|e| e.into_inner());
    if *muted {
        imp::set_muted(false);
        *muted = false;
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

    /// Run `f` on the default output device's volume control. Each call is on its own thread (`mute_after`, `restore`).
    fn with_endpoint<T>(f: impl FnOnce(&IAudioEndpointVolume) -> windows::core::Result<T>) -> Option<T> {
        // SAFETY: COM is initialised for this thread for the duration, and every interface is dropped before it's uninitialised.
        unsafe {
            let init = CoInitializeEx(None, COINIT_MULTITHREADED);
            let result = (|| {
                let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let volume: IAudioEndpointVolume = devices.GetDefaultAudioEndpoint(eRender, eConsole)?.Activate(CLSCTX_ALL, None)?;
                f(&volume)
            })();
            if init.is_ok() {
                CoUninitialize();
            }
            result.map_err(|e| eprintln!("couldn't reach the sound output: {e}")).ok()
        }
    }

    pub fn muted() -> Option<bool> {
        with_endpoint(|v| unsafe { v.GetMute() }.map(|b| b.as_bool()))
    }

    pub fn set_muted(on: bool) -> bool {
        with_endpoint(|v| unsafe { v.SetMute(on, std::ptr::null()) }).is_some()
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::process::Command;

    fn osascript(script: &str) -> Option<String> {
        let out = Command::new("osascript").args(["-e", script]).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    pub fn muted() -> Option<bool> {
        osascript("output muted of (get volume settings)").map(|s| s == "true")
    }

    pub fn set_muted(on: bool) -> bool {
        osascript(&format!("set volume output muted {on}")).is_some()
    }
}

/// PipeWire's `wpctl`, else PulseAudio's `pactl` (which PipeWire also serves).
#[cfg(target_os = "linux")]
mod imp {
    use std::process::Command;

    fn run(program: &str, args: &[&str]) -> Option<String> {
        let out = Command::new(program).args(args).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    pub fn muted() -> Option<bool> {
        run("wpctl", &["get-volume", "@DEFAULT_AUDIO_SINK@"])
            .map(|s| s.contains("[MUTED]"))
            .or_else(|| run("pactl", &["get-sink-mute", "@DEFAULT_SINK@"]).map(|s| s.contains("yes")))
    }

    pub fn set_muted(on: bool) -> bool {
        let flag = if on { "1" } else { "0" };
        run("wpctl", &["set-mute", "@DEFAULT_AUDIO_SINK@", flag]).is_some() || run("pactl", &["set-sink-mute", "@DEFAULT_SINK@", flag]).is_some()
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod imp {
    pub fn muted() -> Option<bool> {
        None
    }

    pub fn set_muted(_on: bool) -> bool {
        false
    }
}
