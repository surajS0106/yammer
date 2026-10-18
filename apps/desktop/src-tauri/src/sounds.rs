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
    /// Two wooden knocks back to back: (first Hz, second Hz, milliseconds per knock).
    fn notes(self) -> (f32, f32, u32) {
        match self {
            // A3 then F#4, and back down.
            Cue::Start => (220.0, 369.99, 75),
            Cue::Stop => (369.99, 220.0, 75),
            Cue::Error => (165.0, 110.0, 110),
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
    let (first, second, ms) = cue.notes();
    let per = (rate * ms as f32 / 1000.0) as usize;
    let total = per * 2;
    let mut n = 0usize;
    let mut seed = 0x9E37_79B9u32;
    let stream = device
        .build_output_stream::<f32, _, _>(
            config,
            move |out: &mut [f32], _| {
                for frame in out.chunks_mut(channels) {
                    let v = if n < total {
                        let freq = if n < per { first } else { second };
                        let s = (n % per) as f32 / rate;
                        let local = (n % per) as f32 / per as f32;
                        let decay = |tau: f32| (-s / tau).exp();
                        let w = 2.0 * std::f32::consts::PI * freq * s;
                        // Wood's overtones are inharmonic and die off fast; that's what makes
                        // it a knock rather than a tone.
                        let body = w.sin() * decay(0.020) + 0.5 * (w * 2.76).sin() * decay(0.008) + 0.25 * (w * 5.4).sin() * decay(0.004);
                        // A millisecond-long burst of noise for the strike itself.
                        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                        let noise = (seed >> 8) as f32 / (1u32 << 23) as f32 - 1.0;
                        let click = noise * decay(0.0015) * 0.3;
                        // Tiny attack and release so neither edge of a knock clicks.
                        let edges = (s / 0.001).min(1.0) * ((1.0 - local) * 10.0).min(1.0);
                        (body + click) * edges * 0.12
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
    std::thread::sleep(Duration::from_millis(2 * ms as u64 + 120));
    Some(())
}
