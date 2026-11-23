//! Taking what the computer plays out of a dictation, so it needn't be muted.
//!
//! The app records the microphone and, beside it, what the computer plays (the
//! reference). Once the dictation ends, `without` lays the two on one timeline,
//! works out how the room changed the reference, and subtracts it. Whatever can't
//! be lined up, or isn't in the microphone at all (headphones), leaves the
//! microphone's audio as it was.

use std::f64::consts::PI;
use std::time::Instant;

use crate::audio::{downmix, is_silent};
use crate::SAMPLE_RATE;

const RATE: usize = SAMPLE_RATE as usize;
const FRAME: usize = RATE / 100;
/// The room is worked out afresh in each window, so it may change as the user moves.
const WINDOW: usize = 120_000;
const HOP: usize = WINDOW / 2;
/// How long the echo may ring on (128 ms).
const TAPS: usize = 2048;
/// The furthest apart the two captures' clocks and latencies may put them.
const MAX_LAG: usize = RATE / 2;
/// How far the reference runs ahead of its echo: the filter only looks back.
const LEAD: usize = RATE * 16 / 1000;
/// How many standard deviations the correlation's peak must stand out by to be an echo.
const PEAK: f64 = 8.0;
/// A jump in arrival times past this is a stretch with no audio, not jitter.
const GAP: f64 = 0.08;
/// Clocks don't differ by more than this; a steeper slope is a bad fit.
const MAX_DRIFT: f64 = 500e-6;

/// By `at`, `end` samples of a capture had arrived.
#[derive(Debug, Clone, Copy)]
pub struct Mark {
    pub at: Instant,
    pub end: usize,
}

/// A capture at 16 kHz mono, and when its samples arrived.
#[derive(Debug, Clone, Default)]
pub struct Track {
    pub samples: Vec<f32>,
    pub marks: Vec<Mark>,
}

impl Track {
    /// From a capture's interleaved samples, with marks counted in frames at its own rate.
    pub fn new(interleaved: &[f32], channels: usize, rate: u32, marks: &[Mark]) -> Track {
        let mut resampler = Resampler::new(rate);
        let mut samples = resampler.push(&downmix(interleaved, channels));
        samples.extend(resampler.finish());
        let scale = RATE as f64 / rate as f64;
        let marks = marks.iter().map(|m| Mark { at: m.at, end: (m.end as f64 * scale).round() as usize }).collect();
        Track { samples, marks }
    }
}

/// The microphone's audio without what the computer was playing.
pub fn without(mic: &Track, reference: &Track) -> Vec<f32> {
    match align(mic, reference) {
        Some(aligned) => cancel(&mic.samples, &aligned),
        None => mic.samples.clone(),
    }
}

/// A run of unbroken audio: sample `i` was heard at `offset + i * (1 + drift)`, in samples since the origin.
struct Run {
    from: usize,
    to: usize,
    offset: f64,
    drift: f64,
}

/// Split a capture at its gaps and place each run in time. Audio can arrive late but never
/// early, so the earliest arrivals are the true ones.
fn runs(track: &Track, origin: Instant) -> Vec<Run> {
    let secs = |at: Instant| at.saturating_duration_since(origin).as_secs_f64() - origin.saturating_duration_since(at).as_secs_f64();
    let points: Vec<(f64, f64)> = track
        .marks
        .iter()
        .filter(|m| m.end <= track.samples.len() + FRAME)
        .map(|m| (m.end as f64, secs(m.at) * RATE as f64 - m.end as f64))
        .collect();
    if points.is_empty() {
        return Vec::new();
    }
    let gap = GAP * RATE as f64;
    let mut starts = vec![0];
    let mut base = points[0].1;
    for i in 1..points.len() {
        // A late delivery is made up for by the next few; a gap never is.
        let window = points[i..].iter().take_while(|p| p.0 - points[i].0 <= 0.3 * RATE as f64).map(|p| p.1);
        let settled = window.fold(f64::MAX, f64::min);
        if settled - base > gap {
            starts.push(i);
            base = settled;
        } else {
            base = base.min(points[i].1);
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(n, &s)| {
            let e = starts.get(n + 1).copied().unwrap_or(points.len());
            let run = &points[s..e];
            let from = if s == 0 { 0 } else { points[s - 1].0 as usize };
            let to = (run[run.len() - 1].0 as usize).min(track.samples.len());
            let (offset, drift) = fit(run);
            Run { from, to, offset, drift }
        })
        .filter(|r| r.to > r.from)
        .collect()
}

/// The line under `points`: through the lowest of each end's third, when they span long enough to tell.
fn fit(points: &[(f64, f64)]) -> (f64, f64) {
    let lowest = |ps: &[(f64, f64)]| ps.iter().copied().min_by(|a, b| a.1.total_cmp(&b.1)).unwrap_or((0.0, 0.0));
    let span = points[points.len() - 1].0 - points[0].0;
    if points.len() >= 30 && span > 20.0 * RATE as f64 {
        let third = points.len() / 3;
        let (a, b) = (lowest(&points[..third]), lowest(&points[points.len() - third..]));
        let drift = (b.1 - a.1) / (b.0 - a.0);
        if drift.abs() < MAX_DRIFT {
            return (a.1 - drift * a.0, drift);
        }
    }
    (lowest(points).1, 0.0)
}

/// The reference on the microphone's timeline, silent wherever it has no audio.
fn align(mic: &Track, reference: &Track) -> Option<Vec<f32>> {
    let origin = mic.marks.first()?.at;
    // A microphone has no gaps to speak of: one line through it all.
    let mic_runs = runs(mic, origin);
    let first = mic_runs.first()?;
    let (mic_offset, mic_drift) = (first.offset, first.drift);
    let mut out = vec![0.0; mic.samples.len()];
    for run in runs(reference, origin) {
        // Mic sample n was heard when reference sample (n * a + b) was.
        let a = (1.0 + mic_drift) / (1.0 + run.drift);
        let b = (mic_offset - run.offset) / (1.0 + run.drift);
        let start = ((run.from as f64 - b) / a).ceil().max(0.0) as usize;
        let end = (((run.to as f64 - b) / a).floor().max(0.0) as usize).min(out.len());
        if start >= end {
            continue;
        }
        if (a - 1.0).abs() < 5e-6 {
            let shift = b.round() as i64;
            for (n, o) in out.iter_mut().enumerate().take(end).skip(start) {
                *o = reference.samples.get((n as i64 + shift) as usize).copied().unwrap_or(0.0);
            }
        } else {
            let kernel = Kernel::new(1.0);
            for (n, o) in out.iter_mut().enumerate().take(end).skip(start) {
                *o = kernel.at(&reference.samples, n as f64 * a + b);
            }
        }
    }
    Some(out)
}

/// Take `reference` out of `mic`, both 16 kHz and roughly lined up.
pub fn cancel(mic: &[f32], reference: &[f32]) -> Vec<f32> {
    if is_silent(reference) {
        return mic.to_vec();
    }
    let Some(lag) = find_lag(mic, reference) else { return mic.to_vec() };
    let shift = lag - LEAD as i64;
    let at = |n: usize| usize::try_from(n as i64 - shift).ok().and_then(|i| reference.get(i)).copied().unwrap_or(0.0);
    let led: Vec<f32> = (0..mic.len()).map(at).collect();
    let out = subtract(mic, &led);
    if out.iter().all(|s| s.is_finite()) {
        out
    } else {
        mic.to_vec()
    }
}

/// The filter that best turns `reference` into what's heard of it in `mic`, worked out a few seconds
/// at a time and taken away. Nothing but the reference's own sound can be removed, so speech over it
/// stays whole. (A call's echo canceller also ducks whatever it isn't sure of, which costs words.)
fn subtract(mic: &[f32], reference: &[f32]) -> Vec<f32> {
    let len = mic.len();
    let single = len <= WINDOW + HOP;
    let mut out = vec![0.0f64; len];
    let mut weights = vec![0.0f64; len];
    let mut start = 0;
    loop {
        let end = if single || start + WINDOW + HOP > len { len } else { start + WINDOW };
        let echo = window_echo(mic, reference, start, end);
        let span = (end - start) as f64;
        for n in start..end {
            let x = (n - start) as f64 + 0.5;
            let weight = 1e-6 + 0.5 - 0.5 * (2.0 * PI * x / span).cos();
            out[n] += weight * (mic[n] as f64 - echo[n - start]);
            weights[n] += weight;
        }
        if end == len {
            break;
        }
        start += HOP;
    }
    out.iter().zip(&weights).map(|(o, w)| (o / w) as f32).collect()
}

/// What's heard of the reference in `mic[start..end]`: least squares, by conjugate gradients.
fn window_echo(mic: &[f32], reference: &[f32], start: usize, end: usize) -> Vec<f64> {
    let len = end - start;
    // A filter long enough to fit a short clip would fit the speech too.
    let taps = TAPS.min(len / 16).next_power_of_two();
    // The reference from just before the window still echoes into it.
    let from = start.saturating_sub(taps);
    if taps < 16 || is_silent(&reference[from..end]) {
        return vec![0.0; len];
    }
    let big = Fft::new((end - from + taps).next_power_of_two());
    let heard: Vec<f64> = mic[from..end].iter().map(|&s| s as f64).collect();
    let played = big.forward(reference[from..end].iter().map(|&s| s as f64));
    let heard = big.forward(heard);
    let auto = big.inverse(played.iter().map(|p| (p.0 * p.0 + p.1 * p.1, 0.0)));
    let cross = big.inverse(heard.iter().zip(&played).map(|(h, p)| (h.0 * p.0 + h.1 * p.1, h.1 * p.0 - h.0 * p.1)));

    // The normal equations' matrix is Toeplitz, so a circulant twice its size multiplies by it.
    let small = Fft::new(taps * 2);
    let ridge = auto[0] * 1e-4;
    let mut row = vec![0.0; taps * 2];
    row[..taps].copy_from_slice(&auto[..taps]);
    for k in 1..taps {
        row[taps * 2 - k] = auto[k];
    }
    let spectrum = small.forward(row.iter().copied());
    let power: Vec<f64> = spectrum.iter().map(|s| s.0.max(0.0)).collect();
    let floor = power.iter().sum::<f64>() / power.len() as f64 * 1e-3 + ridge;
    let filtered = |x: &[f64], gain: &dyn Fn(usize) -> f64| -> Vec<f64> {
        let spectrum = small.forward(x.iter().copied());
        let mut y = small.inverse(spectrum.iter().enumerate().map(|(k, s)| (s.0 * gain(k), s.1 * gain(k))));
        y.truncate(taps);
        y
    };
    let times = |x: &[f64]| -> Vec<f64> { filtered(x, &|k| spectrum[k].0).iter().zip(x).map(|(y, x)| y + ridge * x).collect() };
    let precondition = |x: &[f64]| filtered(x, &|k| 1.0 / (power[k] + floor));
    let dot = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>();

    let mut filter = vec![0.0; taps];
    let mut left = cross[..taps].to_vec();
    let enough = dot(&left, &left) * 1e-8;
    let mut z = precondition(&left);
    let mut step = z.clone();
    let mut rz = dot(&left, &z);
    for _ in 0..60 {
        let moved = times(&step);
        let size = rz / dot(&step, &moved).max(f64::MIN_POSITIVE);
        for k in 0..taps {
            filter[k] += size * step[k];
            left[k] -= size * moved[k];
        }
        if dot(&left, &left) <= enough {
            break;
        }
        z = precondition(&left);
        let next = dot(&left, &z);
        let turn = next / rz;
        rz = next;
        step.iter_mut().zip(&z).for_each(|(s, z)| *s = z + turn * *s);
    }
    let filter = big.forward(filter);
    let echo = big.inverse(filter.iter().zip(&played).map(|(f, p)| (f.0 * p.0 - f.1 * p.1, f.0 * p.1 + f.1 * p.0)));
    echo[start - from..end - from].to_vec()
}

/// How many samples after `reference` its echo reaches `mic`, or `None` when it doesn't.
fn find_lag(mic: &[f32], reference: &[f32]) -> Option<i64> {
    const BLOCK: usize = 16_384;
    const N: usize = BLOCK * 2;
    let fft = Fft::new(N);
    let mut cross = vec![(0.0, 0.0); N];
    let (mut power_m, mut power_r) = (vec![0.0; N], vec![0.0; N]);
    let len = mic.len().min(reference.len());
    for start in (0..len).step_by(BLOCK / 2) {
        let end = (start + BLOCK).min(len);
        if is_silent(&reference[start..end]) {
            continue;
        }
        let last = (end - start).max(2) as f64;
        let spectrum =
            |s: &[f32]| fft.forward(s[start..end].iter().enumerate().map(|(i, &v)| v as f64 * (0.5 - 0.5 * (2.0 * PI * i as f64 / last).cos())));
        let (m, r) = (spectrum(mic), spectrum(reference));
        for k in 0..N {
            cross[k].0 += m[k].0 * r[k].0 + m[k].1 * r[k].1;
            cross[k].1 += m[k].1 * r[k].0 - m[k].0 * r[k].1;
            power_m[k] += m[k].0 * m[k].0 + m[k].1 * m[k].1;
            power_r[k] += r[k].0 * r[k].0 + r[k].1 * r[k].1;
        }
    }
    // Weighted by coherence, so a tune's loudest notes don't drown out its timing.
    let mean = |p: &[f64]| p.iter().sum::<f64>() / N as f64;
    let floor = (mean(&power_m) * mean(&power_r)).sqrt() * 1e-5 + f64::MIN_POSITIVE;
    let weight = |k: usize| 1.0 / ((power_m[k] * power_r[k]).sqrt() + floor);
    let values = fft.inverse(cross.iter().enumerate().map(|(k, c)| (c.0 * weight(k), c.1 * weight(k))));
    let max = MAX_LAG as i64;
    let values: Vec<f64> = (-max..=max).map(|lag| values[lag.rem_euclid(N as i64) as usize]).collect();
    let deviation = (values.iter().map(|v| v * v).sum::<f64>() / values.len() as f64).sqrt();
    let (i, peak) = values.iter().enumerate().max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))?;
    (deviation > 0.0 && peak.abs() > PEAK * deviation).then_some(i as i64 - max)
}

/// A radix-2 FFT; the size is a power of two.
struct Fft {
    size: usize,
    turns: Vec<(f64, f64)>,
}

impl Fft {
    fn new(size: usize) -> Fft {
        let turn = |k: usize| {
            let (s, c) = (-2.0 * PI * k as f64 / size as f64).sin_cos();
            (c, s)
        };
        Fft { size, turns: (0..size / 2).map(turn).collect() }
    }

    /// The spectrum of real samples, padded with silence.
    fn forward(&self, samples: impl IntoIterator<Item = f64>) -> Vec<(f64, f64)> {
        let mut x: Vec<(f64, f64)> = samples.into_iter().map(|s| (s, 0.0)).collect();
        x.resize(self.size, (0.0, 0.0));
        self.run(&mut x);
        x
    }

    /// The real samples with this spectrum.
    fn inverse(&self, spectrum: impl IntoIterator<Item = (f64, f64)>) -> Vec<f64> {
        // The conjugate's forward transform is the inverse's conjugate.
        let mut x: Vec<(f64, f64)> = spectrum.into_iter().map(|s| (s.0, -s.1)).collect();
        self.run(&mut x);
        x.iter().map(|s| s.0 / self.size as f64).collect()
    }

    fn run(&self, x: &mut [(f64, f64)]) {
        let shift = usize::BITS - self.size.trailing_zeros();
        for i in 0..self.size {
            let j = i.reverse_bits() >> shift;
            if i < j {
                x.swap(i, j);
            }
        }
        let mut half = 1;
        while half < self.size {
            let stride = self.size / (half * 2);
            for block in x.chunks_exact_mut(half * 2) {
                let (lo, hi) = block.split_at_mut(half);
                for ((a, b), w) in lo.iter_mut().zip(hi).zip(self.turns.iter().step_by(stride)) {
                    let t = (b.0 * w.0 - b.1 * w.1, b.0 * w.1 + b.1 * w.0);
                    *b = (a.0 - t.0, a.1 - t.1);
                    *a = (a.0 + t.0, a.1 + t.1);
                }
            }
            half *= 2;
        }
    }
}

/// A windowed sinc, tabulated between samples.
struct Kernel {
    table: Vec<f32>,
    half: usize,
}

impl Kernel {
    const PHASES: usize = 1024;

    /// `cutoff` is a fraction of the input's Nyquist frequency.
    fn new(cutoff: f64) -> Kernel {
        let half = (16.0 / cutoff).ceil() as usize;
        let mut table = Vec::with_capacity((Self::PHASES + 1) * half * 2);
        for phase in 0..=Self::PHASES {
            let frac = phase as f64 / Self::PHASES as f64;
            for tap in 0..half * 2 {
                let x = tap as f64 - (half - 1) as f64 - frac;
                let arg = std::f64::consts::PI * x * cutoff;
                let sinc = if arg.abs() < 1e-9 { 1.0 } else { arg.sin() / arg };
                let window = 0.5 + 0.5 * (std::f64::consts::PI * x / half as f64).clamp(-std::f64::consts::PI, std::f64::consts::PI).cos();
                table.push((sinc * window * cutoff) as f32);
            }
        }
        Kernel { table, half }
    }

    /// `samples` at the fractional index `pos`, silent outside it.
    fn at(&self, samples: &[f32], pos: f64) -> f32 {
        let whole = pos.floor();
        let phase = ((pos - whole) * Self::PHASES as f64).round() as usize;
        let taps = &self.table[phase * self.half * 2..][..self.half * 2];
        let first = whole as i64 - (self.half as i64 - 1);
        if first >= 0 {
            if let Some(span) = samples.get(first as usize..first as usize + taps.len()) {
                return span.iter().zip(taps).map(|(s, t)| s * t).sum();
            }
        }
        let sample = |i: usize| usize::try_from(first + i as i64).ok().and_then(|i| samples.get(i)).copied().unwrap_or(0.0);
        taps.iter().enumerate().map(|(i, t)| sample(i) * t).sum()
    }
}

/// Resamples mono audio to 16 kHz as it comes. Pieces join without a seam, unlike `audio::resample` on each.
pub struct Resampler {
    kernel: Option<Kernel>,
    ratio: f64,
    held: Vec<f32>,
    /// Input samples dropped from the front of `held`.
    dropped: usize,
    made: usize,
    seen: usize,
}

impl Resampler {
    pub fn new(from: u32) -> Resampler {
        let ratio = from as f64 / RATE as f64;
        // Just under the lower of the two Nyquists, leaving room to roll off.
        let kernel = (from != SAMPLE_RATE).then(|| Kernel::new((0.94 / ratio).min(0.94)));
        Resampler { kernel, ratio, held: Vec::new(), dropped: 0, made: 0, seen: 0 }
    }

    pub fn push(&mut self, input: &[f32]) -> Vec<f32> {
        let Some(kernel) = &self.kernel else { return input.to_vec() };
        self.seen += input.len();
        self.held.extend_from_slice(input);
        let ready = self.seen.saturating_sub(kernel.half + 1);
        self.produce(ready)
    }

    /// The last of it, once there's no more input.
    pub fn finish(&mut self) -> Vec<f32> {
        if self.kernel.is_none() {
            return Vec::new();
        }
        self.produce(self.seen)
    }

    fn produce(&mut self, until: usize) -> Vec<f32> {
        let Some(kernel) = &self.kernel else { return Vec::new() };
        let mut out = Vec::new();
        loop {
            let pos = self.made as f64 * self.ratio;
            if pos >= until as f64 {
                break;
            }
            out.push(kernel.at(&self.held, pos - self.dropped as f64));
            self.made += 1;
        }
        let keep = ((self.made as f64 * self.ratio) as usize).saturating_sub(kernel.half + 1).max(self.dropped);
        let drop = (keep - self.dropped).min(self.held.len());
        self.held.drain(..drop);
        self.dropped += drop;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;
    use std::time::Duration;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 40) as f32 / (1u64 << 23) as f32 - 1.0
        }
    }

    /// Something like speech: syllables of buzz and hiss, with pauses.
    fn voice(seed: u64, len: usize) -> Vec<f32> {
        let mut rng = Rng(seed * 7919 + 1);
        let mut out = Vec::with_capacity(len);
        while out.len() < len {
            let syllable = (RATE as f32 * (0.12 + 0.1 * rng.next().abs())) as usize;
            let pitch = 110.0 + 80.0 * rng.next().abs();
            let loud = if rng.next() > 0.6 { 0.0 } else { 0.25 };
            let mut low = 0.0;
            for i in 0..syllable {
                let env = (PI * i as f32 / syllable as f32).sin();
                let t = i as f32 / RATE as f32;
                let buzz: f32 = (1..20).map(|h| (2.0 * PI * pitch * h as f32 * t).sin() / h as f32).sum();
                low = 0.6 * low + 0.4 * rng.next();
                out.push(loud * env * (0.4 * buzz + 0.5 * low));
            }
        }
        out.truncate(len);
        out
    }

    /// A room: the direct sound `lag` samples late, then decaying reflections.
    fn echo(reference: &[f32], lag: i64, gain: f32) -> Vec<f32> {
        let mut rng = Rng(99);
        let mut taps = vec![(0usize, gain)];
        taps.extend((1..60).map(|i| (i * 23, gain * 0.4 * rng.next() * (-(i as f32) / 15.0).exp())));
        (0..reference.len() as i64)
            .map(|n| {
                taps.iter()
                    .map(|(d, g)| usize::try_from(n - lag - *d as i64).ok().and_then(|i| reference.get(i)).map_or(0.0, |s| s * g))
                    .sum()
            })
            .collect()
    }

    fn mix(a: &[f32], b: &[f32]) -> Vec<f32> {
        a.iter().zip(b).map(|(a, b)| a + b).collect()
    }

    fn db(a: &[f32], b: &[f32]) -> f32 {
        20.0 * (crate::audio::rms(a) / crate::audio::rms(b).max(1e-9)).log10()
    }

    /// How alike two signals are, from 0 to 1.
    fn alike(a: &[f32], b: &[f32]) -> f32 {
        let dot = |x: &[f32], y: &[f32]| x.iter().zip(y).map(|(x, y)| x * y).sum::<f32>();
        dot(a, b) / (dot(a, a) * dot(b, b)).sqrt().max(1e-9)
    }

    #[test]
    fn echo_goes() {
        let reference = voice(1, RATE * 12);
        for lag in [-4800, 0, 700, 4800] {
            let mic = echo(&reference, lag, 0.5);
            assert_eq!(find_lag(&mic, &reference), Some(lag));
            let out = cancel(&mic, &reference);
            assert_eq!(out.len(), mic.len());
            let reduced = db(&mic, &out);
            eprintln!("lag {lag}: {reduced:.1} dB");
            assert!(reduced > 15.0, "lag {lag}: only {reduced} dB");
        }
    }

    #[test]
    fn speech_stays() {
        let len = RATE * 12;
        let (reference, speech) = (voice(1, len), voice(2, len));
        let mic = mix(&speech, &echo(&reference, 900, 0.35));
        let out = cancel(&mic, &reference);
        let (before, after) = (alike(&mic, &speech), alike(&out, &speech));
        eprintln!("likeness to the speech: {before:.3} -> {after:.3}, level {:.1} dB", db(&out, &speech));
        assert!(after > 0.97 && after > before, "{before} -> {after}");
        assert!(db(&out, &speech).abs() < 1.0);
    }

    #[test]
    fn the_microphone_is_untouched_without_an_echo() {
        let mic = voice(2, RATE * 8);
        assert_eq!(cancel(&mic, &voice(1, RATE * 8)), mic);
        assert_eq!(cancel(&mic, &vec![0.0; RATE * 8]), mic);
        assert_eq!(cancel(&mic[..1600], &[]), mic[..1600]);
        for (seed, secs) in (10..40).zip([1, 2, 4].into_iter().cycle()) {
            assert_eq!(find_lag(&voice(seed, RATE * secs), &voice(seed + 100, RATE * secs)), None, "seed {seed}, {secs} s");
        }
    }

    /// Marks every 10 ms, some late, for a capture running `drift` fast that began `began` after `t0`.
    fn marks(t0: Instant, began: f64, len: usize, rate: f64) -> Vec<Mark> {
        let mut rng = Rng(5);
        (1..=len / FRAME)
            .map(|i| {
                let late = if i % 7 == 0 { 0.03 } else { 0.002 * rng.next().abs() as f64 };
                Mark { at: t0 + Duration::from_secs_f64(began + (i * FRAME) as f64 / rate + late), end: i * FRAME }
            })
            .collect()
    }

    #[test]
    fn late_start_and_drift_are_lined_up() {
        let t0 = Instant::now();
        let len = RATE * 40;
        let played = voice(1, len);
        let mic = echo(&played, 320, 0.5);
        // The reference began 0.25 s in, on a clock 100 ppm fast.
        let kernel = Kernel::new(1.0);
        let from = RATE / 4;
        let samples: Vec<f32> = (0..len - from - 100).map(|i| kernel.at(&played, from as f64 + i as f64 / 1.0001)).collect();
        let reference = Track { marks: marks(t0, 0.25, samples.len(), RATE as f64 * 1.0001), samples };
        let mic = Track { marks: marks(t0, 0.0, len, RATE as f64), samples: mic };
        let out = without(&mic, &reference);
        let reduced = db(&mic.samples[RATE..], &out[RATE..]);
        eprintln!("late and drifting: {reduced:.1} dB");
        assert!(reduced > 15.0, "{reduced} dB");
    }

    #[test]
    fn silence_fills_gaps() {
        let t0 = Instant::now();
        let mic = Track { marks: marks(t0, 0.0, RATE * 4, RATE as f64), samples: vec![0.0; RATE * 4] };
        // One second of audio, two with nothing arriving, then another.
        let mut m = marks(t0, 0.0, RATE, RATE as f64);
        m.extend(marks(t0, 3.0, RATE, RATE as f64).into_iter().map(|m| Mark { end: m.end + RATE, ..m }));
        let aligned = align(&mic, &Track { samples: vec![0.5; RATE * 2], marks: m }).unwrap();
        let near = |s: f64| aligned[(s * RATE as f64) as usize];
        assert_eq!([near(0.5), near(1.5), near(2.5), near(3.5)], [0.5, 0.0, 0.0, 0.5]);
    }

    #[test]
    fn resampling_in_pieces_keeps_time() {
        for rate in [8_000u32, 44_100, 48_000, 96_000] {
            let tone = |r: u32| (0..r * 3).map(|i| (2.0 * PI * 440.0 * i as f32 / r as f32).sin()).collect::<Vec<_>>();
            let mut resampler = Resampler::new(rate);
            let mut out: Vec<f32> = tone(rate).chunks(511).flat_map(|c| resampler.push(c)).collect();
            out.extend(resampler.finish());
            let want = tone(SAMPLE_RATE);
            assert!(out.len().abs_diff(want.len()) <= 1, "{rate}: {}", out.len());
            assert!(alike(&out[1000..47_000], &want[1000..47_000]) > 0.999, "{rate}");
        }
        // Above the new Nyquist, nothing is left to fold back.
        let high: Vec<f32> = (0..48_000).map(|i| (2.0 * PI * 11_000.0 * i as f32 / 48_000.0).sin()).collect();
        assert!(crate::audio::rms(&Resampler::new(48_000).push(&high)) < 0.01);
    }

    #[test]
    #[ignore = "timing; run with --release"]
    fn ten_minutes_is_quick() {
        let reference = voice(1, RATE * 600);
        let mic = echo(&reference, 500, 0.5);
        let start = Instant::now();
        cancel(&mic, &reference);
        eprintln!("10 minutes took {:?}", start.elapsed());
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}
