//! Microphone capture with cpal. A cpal stream isn't `Send` on every
//! platform, so each recording owns a thread that opens the device, holds
//! the stream, reports the input level, and hands back the samples on stop.

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
    host.default_input_device().ok_or_else(|| AppError::Invalid("No microphone found. Plug one in or check your sound settings.".into()))
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
            loop {
                match stop_rx.recv_timeout(Duration::from_millis(50)) {
                    Err(mpsc::RecvTimeoutError::Timeout) => on_level(f32::from_bits(level.load(Ordering::Relaxed))),
                    _ => break,
                }
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
    let format = supported.sample_format();
    let config = supported.config();
    let (channels, rate) = (config.channels as usize, config.sample_rate);

    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, &config, buffer, level),
        SampleFormat::I16 => build::<i16>(&device, &config, buffer, level),
        SampleFormat::I32 => build::<i32>(&device, &config, buffer, level),
        SampleFormat::U16 => build::<u16>(&device, &config, buffer, level),
        SampleFormat::U8 => build::<u8>(&device, &config, buffer, level),
        SampleFormat::I8 => build::<i8>(&device, &config, buffer, level),
        other => return Err(mic_err(&format!("unsupported sample format {other}"))),
    }
    .map_err(|e| mic_err(&e))?;
    stream.play().map_err(|e| mic_err(&e))?;
    Ok((stream, channels, rate))
}

fn build<T>(device: &cpal::Device, config: &cpal::StreamConfig, buffer: Arc<Mutex<Vec<f32>>>, level: Arc<AtomicU32>) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device.build_input_stream::<T, _, _>(
        config.clone(),
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
