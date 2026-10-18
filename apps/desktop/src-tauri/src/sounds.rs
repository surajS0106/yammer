//! Short synthesized cues so you know recording started and stopped without
//! looking. Played on the default output device from a throwaway thread.

use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;

#[derive(Clone, Copy)]
pub enum Cue {
    Start,
    Stop,
    Error,
}

impl Cue {
    /// (from Hz, to Hz, milliseconds)
    fn sweep(self) -> (f32, f32, u32) {
        match self {
            Cue::Start => (660.0, 990.0, 90),
            Cue::Stop => (880.0, 590.0, 90),
            Cue::Error => (330.0, 220.0, 220),
        }
    }
}

pub fn play(cue: Cue) {
    std::thread::spawn(move || {
        let _ = play_blocking(cue);
    });
}

fn play_blocking(cue: Cue) -> Option<()> {
    let device = cpal::default_host().default_output_device()?;
    let supported = device.default_output_config().ok()?;
    if supported.sample_format() != SampleFormat::F32 {
        return None;
    }
    let config = supported.config();
    let (channels, rate) = (config.channels as usize, config.sample_rate as f32);
    let (from, to, ms) = cue.sweep();
    let total = (rate * ms as f32 / 1000.0) as usize;
    let mut n = 0usize;
    let mut phase = 0.0f32;
    let stream = device
        .build_output_stream::<f32, _, _>(
            config,
            move |out: &mut [f32], _| {
                for frame in out.chunks_mut(channels) {
                    let v = if n < total {
                        let t = n as f32 / total as f32;
                        phase += 2.0 * std::f32::consts::PI * (from + (to - from) * t) / rate;
                        // Quick fade in and out so the cue doesn't click.
                        let envelope = (t * 10.0).min(1.0) * ((1.0 - t) * 4.0).min(1.0);
                        phase.sin() * envelope * 0.18
                    } else {
                        0.0
                    };
                    n += 1;
                    frame.fill(v);
                }
            },
            |_| {},
            None,
        )
        .ok()?;
    stream.play().ok()?;
    std::thread::sleep(Duration::from_millis(ms as u64 + 120));
    Some(())
}
