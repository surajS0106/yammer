//! Microphone capture with cpal. A cpal stream isn't `Send` on every
//! platform, so each recording owns a thread that opens the device, holds
//! the stream, reports the input level, and hands back the samples on stop.
//!
//! A meeting captures live instead (`live`): the thread hands over 16 kHz audio
//! every 50 ms, from the microphone or from what the computer plays. That's a
//! loopback stream on the output device with cpal on macOS (14.6+, which asks
//! for "System Audio Recording" permission) and Windows, and `parec` reading
//! the default sink's monitor on Linux (PulseAudio and PipeWire alike).

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};

use crate::error::{AppError, AppResult};

/// Ten minutes at 48 kHz stereo; anything past it is dropped.
const MAX_SAMPLES: usize = 48_000 * 2 * 600;

pub struct Captured {
    pub samples: Vec<f32>,
    pub channels: usize,
    pub rate: u32,
}

pub struct Recording {
    stop: mpsc::Sender<()>,
    thread: JoinHandle<Captured>,
}

impl Recording {
    /// Stop capturing and return everything recorded.
    pub fn stop(self) -> Captured {
        let _ = self.stop.send(());
        self.thread.join().unwrap_or(Captured { samples: Vec::new(), channels: 1, rate: voice_core::SAMPLE_RATE })
    }
}

pub fn input_devices() -> Vec<String> {
    cpal::default_host().input_devices().map(|devices| devices.map(|d| d.to_string()).collect()).unwrap_or_default()
}

fn pick_device(name: Option<&str>) -> AppResult<cpal::Device> {
    let host = cpal::default_host();
    if let Some(name) = name {
        if let Some(device) = host.input_devices().ok().and_then(|mut ds| ds.find(|d| d.to_string() == name)) {
            return Ok(device);
        }
        // The chosen mic was unplugged: fall back to the default rather than fail.
    }
    host.default_input_device()
        .ok_or_else(|| AppError::Invalid("No microphone found. Plug one in or check your sound settings.".into()))
}

/// Start recording from `device` (or the default). `on_level` gets the input
/// level (RMS, 0..1) about 20 times a second, on the recording thread.
pub fn start(device: Option<String>, on_level: impl Fn(f32) + Send + 'static) -> AppResult<Recording> {
    let (ready_tx, ready_rx) = mpsc::channel::<AppResult<()>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let thread = std::thread::Builder::new()
        .name("recorder".into())
        .spawn(move || {
            let buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(48_000 * 30)));
            let level = Arc::new(AtomicU32::new(0));
            let opened = open(device.as_deref(), buffer.clone(), level.clone());
            let (stream, channels, rate) = match opened {
                Ok(v) => {
                    let _ = ready_tx.send(Ok(()));
                    v
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return Captured { samples: Vec::new(), channels: 1, rate: voice_core::SAMPLE_RATE };
                }
            };
            while let Err(mpsc::RecvTimeoutError::Timeout) = stop_rx.recv_timeout(Duration::from_millis(50)) {
                on_level(f32::from_bits(level.load(Ordering::Relaxed)));
            }
            drop(stream);
            let samples = std::mem::take(&mut *buffer.lock().unwrap());
            Captured { samples, channels, rate }
        })
        .map_err(AppError::from)?;

    match ready_rx.recv() {
        Ok(Ok(())) => Ok(Recording { stop: stop_tx, thread }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => Err(AppError::Invalid("The microphone thread stopped unexpectedly.".into())),
    }
}

fn open(device: Option<&str>, buffer: Arc<Mutex<Vec<f32>>>, level: Arc<AtomicU32>) -> AppResult<(cpal::Stream, usize, u32)> {
    let device = pick_device(device)?;
    let mic_err = |e: &dyn std::fmt::Display| AppError::Invalid(format!("Couldn't open the microphone: {e}"));
    let supported = device.default_input_config().map_err(|e| mic_err(&e))?;
    open_with(&device, supported, buffer, level, &mic_err)
}

/// Record what the default output device plays (cpal's loopback).
#[cfg(not(target_os = "linux"))]
fn open_output(buffer: Arc<Mutex<Vec<f32>>>, level: Arc<AtomicU32>) -> AppResult<(cpal::Stream, usize, u32)> {
    let err = |e: &dyn std::fmt::Display| {
        let hint = if cfg!(target_os = "macos") {
            " It needs macOS 14.6 or later, and Yammer allowed under System Settings → Privacy & Security → Screen & System Audio Recording."
        } else {
            ""
        };
        AppError::Invalid(format!("Couldn't listen to the computer's sound: {e}.{hint}"))
    };
    let device = cpal::default_host().default_output_device().ok_or_else(|| err(&"no sound output found"))?;
    let supported = device.default_output_config().map_err(|e| err(&e))?;
    open_with(&device, supported, buffer, level, &err)
}

fn open_with(
    device: &cpal::Device,
    supported: cpal::SupportedStreamConfig,
    buffer: Arc<Mutex<Vec<f32>>>,
    level: Arc<AtomicU32>,
    mic_err: &dyn Fn(&dyn std::fmt::Display) -> AppError,
) -> AppResult<(cpal::Stream, usize, u32)> {
    let format = supported.sample_format();
    let config = supported.config();
    let (channels, rate) = (config.channels as usize, config.sample_rate);

    let stream = match format {
        SampleFormat::F32 => build::<f32>(device, &config, buffer, level),
        SampleFormat::I16 => build::<i16>(device, &config, buffer, level),
        SampleFormat::I32 => build::<i32>(device, &config, buffer, level),
        SampleFormat::U16 => build::<u16>(device, &config, buffer, level),
        SampleFormat::U8 => build::<u8>(device, &config, buffer, level),
        SampleFormat::I8 => build::<i8>(device, &config, buffer, level),
        other => return Err(mic_err(&format!("unsupported sample format {other}"))),
    }
    .map_err(|e| mic_err(&e))?;
    stream.play().map_err(|e| mic_err(&e))?;
    Ok((stream, channels, rate))
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    buffer: Arc<Mutex<Vec<f32>>>,
    level: Arc<AtomicU32>,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device.build_input_stream::<T, _, _>(
        *config,
        move |data: &[T], _| {
            let mut sum = 0.0f32;
            let mut buf = buffer.lock().unwrap();
            let room = MAX_SAMPLES.saturating_sub(buf.len());
            for (i, s) in data.iter().enumerate() {
                let v = s.to_sample::<f32>();
                sum += v * v;
                if i < room {
                    buf.push(v);
                }
            }
            let rms = if data.is_empty() { 0.0 } else { (sum / data.len() as f32).sqrt() };
            level.store(rms.to_bits(), Ordering::Relaxed);
        },
        |e| eprintln!("microphone stream error: {e}"),
        None,
    )
}

/// Where a live capture listens.
#[derive(Debug, Clone)]
pub enum Source {
    /// This microphone, or the default one.
    Mic(Option<String>),
    /// What the computer plays: the other side of a call.
    System,
}

/// A capture that hands its audio over as it comes. Dropping it stops it too,
/// without waiting; `stop` waits until the last audio has been handed over.
pub struct Live {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
    #[cfg(target_os = "linux")]
    child: Arc<Mutex<Option<std::process::Child>>>,
}

impl Live {
    pub fn stop(mut self) {
        self.signal();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }

    fn signal(&mut self) {
        drop(self.stop.take());
        // parec may be blocked in a read with nothing playing; killing it ends the read.
        #[cfg(target_os = "linux")]
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        self.signal();
    }
}

/// How often a live capture hands over its audio.
const LIVE_TICK: Duration = Duration::from_millis(50);

/// Start a live capture. `on_audio` gets 16 kHz mono audio every 50 ms, and
/// `on_level` its level (RMS, 0..1), both on the capture's thread.
pub fn live(source: Source, on_audio: impl Fn(Vec<f32>) + Send + 'static, on_level: impl Fn(f32) + Send + 'static) -> AppResult<Live> {
    #[cfg(target_os = "linux")]
    if let Source::System = source {
        return monitor(on_audio, on_level);
    }
    let (ready_tx, ready_rx) = mpsc::channel::<AppResult<()>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let thread = std::thread::Builder::new()
        .name("live-capture".into())
        .spawn(move || {
            let buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(48_000)));
            let level = Arc::new(AtomicU32::new(0));
            let opened = match &source {
                Source::Mic(device) => open(device.as_deref(), buffer.clone(), level.clone()),
                #[cfg(not(target_os = "linux"))]
                Source::System => open_output(buffer.clone(), level.clone()),
                #[cfg(target_os = "linux")]
                Source::System => unreachable!("Linux captures system audio with parec"),
            };
            let (stream, channels, rate) = match opened {
                Ok(v) => {
                    let _ = ready_tx.send(Ok(()));
                    v
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            let hand_over = || {
                let captured = std::mem::take(&mut *buffer.lock().unwrap());
                if !captured.is_empty() {
                    on_audio(voice_core::audio::to_whisper(&captured, channels, rate));
                }
            };
            // Sending () never happens: dropping the sender is the signal.
            while let Err(mpsc::RecvTimeoutError::Timeout) = stop_rx.recv_timeout(LIVE_TICK) {
                hand_over();
                on_level(f32::from_bits(level.load(Ordering::Relaxed)));
            }
            drop(stream);
            hand_over();
        })
        .map_err(AppError::from)?;

    match ready_rx.recv() {
        Ok(Ok(())) => Ok(Live {
            stop: Some(stop_tx),
            thread: Some(thread),
            #[cfg(target_os = "linux")]
            child: Arc::new(Mutex::new(None)),
        }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => Err(AppError::Invalid("The audio thread stopped unexpectedly.".into())),
    }
}

/// What the default sink plays, from `parec`, already 16 kHz mono f32.
#[cfg(target_os = "linux")]
fn monitor(on_audio: impl Fn(Vec<f32>) + Send + 'static, on_level: impl Fn(f32) + Send + 'static) -> AppResult<Live> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let mut child = Command::new("parec")
        .args(["--device=@DEFAULT_MONITOR@", "--format=float32le", "--rate=16000", "--channels=1", "--raw", "--latency-msec=50"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            AppError::Invalid(format!(
                "Couldn't listen to the computer's sound ({e}). Install parec (the pulseaudio-utils package), which works with PipeWire too."
            ))
        })?;
    let mut stdout = child.stdout.take().ok_or_else(|| AppError::Invalid("parec gave no output".into()))?;
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let thread = std::thread::Builder::new()
        .name("live-monitor".into())
        .spawn(move || {
            // 50 ms of 16 kHz f32.
            let mut bytes = vec![0u8; 3200];
            loop {
                match stop_rx.try_recv() {
                    Err(mpsc::TryRecvError::Empty) => {}
                    _ => break,
                }
                let Ok(n) = stdout.read(&mut bytes) else { break };
                if n == 0 {
                    break;
                }
                let n = n / 4 * 4;
                let samples: Vec<f32> = bytes[..n].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
                on_level(voice_core::audio::rms(&samples));
                on_audio(samples);
            }
        })
        .map_err(AppError::from)?;
    Ok(Live { stop: Some(stop_tx), thread: Some(thread), child: Arc::new(Mutex::new(Some(child))) })
}
