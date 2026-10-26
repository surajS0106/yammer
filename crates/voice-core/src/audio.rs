//! Turning whatever the microphone gives us into what whisper wants:
//! 16 kHz mono f32 in [-1, 1], plus WAV encoding for the cloud APIs.

use crate::{Error, Result, SAMPLE_RATE};

/// Average interleaved frames down to one channel.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved.chunks_exact(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32).collect()
}

/// Resample mono audio. Downsampling averages the input over each output
/// sample's span (a box low-pass, plenty for speech); upsampling interpolates.
pub fn resample(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = ((samples.len() as f64) / ratio).floor() as usize;
    let last = samples.len() - 1;
    let mut out = Vec::with_capacity(out_len);
    if ratio > 1.0 {
        for i in 0..out_len {
            let start = (i as f64 * ratio) as usize;
            let end = (((i + 1) as f64 * ratio) as usize).clamp(start + 1, samples.len());
            let span = &samples[start..end];
            out.push(span.iter().sum::<f32>() / span.len() as f32);
        }
    } else {
        for i in 0..out_len {
            let pos = i as f64 * ratio;
            let a = pos.floor() as usize;
            let b = (a + 1).min(last);
            let t = (pos - a as f64) as f32;
            out.push(samples[a] * (1.0 - t) + samples[b] * t);
        }
    }
    out
}

/// Downmix and resample a captured buffer to 16 kHz mono.
pub fn to_whisper(interleaved: &[f32], channels: usize, rate: u32) -> Vec<f32> {
    resample(&downmix(interleaved, channels), rate, SAMPLE_RATE)
}

/// Root mean square level, 0 for silence.
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

/// 20 ms at 16 kHz, the unit silence is judged in.
const WINDOW: usize = SAMPLE_RATE as usize / 50;
/// A window at or below this level counts as silence.
const THRESHOLD: f32 = 0.004;
/// Windows of silence (200 ms) kept on each side of a pause by `squeeze_silence`.
const PAUSE_KEEP: usize = 10;

/// True when no 20 ms window of a 16 kHz clip rises above a whisper of noise.
/// Whisper hallucinates text ("Thank you.") on silence, so we skip such clips.
pub fn is_silent(samples: &[f32]) -> bool {
    !samples.chunks(WINDOW).any(|w| rms(w) > THRESHOLD)
}

/// Drop the silence a per-second-billed service would charge for: leading and
/// trailing silence shrinks to 200 ms, and any pause to 400 ms.
pub fn squeeze_silence(samples: &[f32]) -> Vec<f32> {
    let windows: Vec<&[f32]> = samples.chunks(WINDOW).collect();
    let silent: Vec<bool> = windows.iter().map(|w| rms(w) <= THRESHOLD).collect();
    let mut out = Vec::with_capacity(samples.len());
    let mut i = 0;
    while i < windows.len() {
        if !silent[i] {
            out.extend_from_slice(windows[i]);
            i += 1;
            continue;
        }
        let end = i + silent[i..].iter().take_while(|&&s| s).count();
        let head = if i == 0 { 0 } else { PAUSE_KEEP };
        let tail = if end == windows.len() { 0 } else { PAUSE_KEEP };
        if end - i <= head + tail {
            windows[i..end].iter().for_each(|w| out.extend_from_slice(w));
        } else {
            windows[i..i + head].iter().chain(&windows[end - tail..end]).for_each(|w| out.extend_from_slice(w));
        }
        i = end;
    }
    out
}

/// Cut a 16 kHz clip into pieces of at most `max` samples. Each cut falls in
/// the quietest 200 ms of the back half of its piece, so words stay whole.
pub fn split_at_pauses(samples: &[f32], max: usize) -> Vec<&[f32]> {
    let mut pieces = Vec::new();
    let mut rest = samples;
    while rest.len() > max {
        let (piece, tail) = rest.split_at(max / 2 + quietest_point(&rest[max / 2..max]));
        pieces.push(piece);
        rest = tail;
    }
    if !rest.is_empty() {
        pieces.push(rest);
    }
    pieces
}

/// The offset of the middle of the quietest 200 ms of `samples`.
fn quietest_point(samples: &[f32]) -> usize {
    let levels: Vec<f32> = samples.chunks(WINDOW).map(rms).collect();
    if levels.len() <= PAUSE_KEEP {
        return samples.len() / 2;
    }
    let level = |at: usize| levels[at..at + PAUSE_KEEP].iter().sum::<f32>();
    let best = (0..=levels.len() - PAUSE_KEEP).min_by(|&a, &b| level(a).total_cmp(&level(b))).unwrap_or(0);
    (best + PAUSE_KEEP / 2) * WINDOW
}

/// whisper.cpp drops clips shorter than a second; pad with silence.
pub fn pad_for_whisper(mut samples: Vec<f32>) -> Vec<f32> {
    let min = SAMPLE_RATE as usize * 11 / 10;
    if samples.len() < min {
        samples.resize(min, 0.0);
    }
    samples
}

pub fn duration_ms(samples_16k: usize) -> u64 {
    samples_16k as u64 * 1000 / SAMPLE_RATE as u64
}

/// A 16 kHz mono 16-bit PCM WAV file.
pub fn encode_wav(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend(b"RIFF");
    out.extend((36 + data_len).to_le_bytes());
    out.extend(b"WAVEfmt ");
    out.extend(16u32.to_le_bytes());
    out.extend(1u16.to_le_bytes()); // PCM
    out.extend(1u16.to_le_bytes()); // mono
    out.extend(SAMPLE_RATE.to_le_bytes());
    out.extend((SAMPLE_RATE * 2).to_le_bytes());
    out.extend(2u16.to_le_bytes());
    out.extend(16u16.to_le_bytes());
    out.extend(b"data");
    out.extend(data_len.to_le_bytes());
    for s in samples {
        out.extend(((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
    }
    out
}

/// Samples from a mono 16-bit PCM WAV, scaled to [-1, 1].
pub fn decode_wav(wav: &[u8]) -> Result<Vec<f32>> {
    let bad = || Error::Decode("audio is not a 16-bit PCM WAV".into());
    if wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err(bad());
    }
    let mut i = 12;
    while i + 8 <= wav.len() {
        let id = &wav[i..i + 4];
        let len = u32::from_le_bytes(wav[i + 4..i + 8].try_into().unwrap()) as usize;
        let body = &wav[i + 8..(i + 8 + len).min(wav.len())];
        if id == b"data" {
            return Ok(body.as_chunks::<2>().0.iter().map(|&b| i16::from_le_bytes(b) as f32 / 32768.0).collect());
        }
        i += 8 + len + (len & 1);
    }
    Err(bad())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmixes_stereo() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(downmix(&[0.25, 0.75], 1), vec![0.25, 0.75]);
    }

    #[test]
    fn resamples_to_the_right_length() {
        let one_second_48k = vec![0.1; 48_000];
        let out = resample(&one_second_48k, 48_000, 16_000);
        assert_eq!(out.len(), 16_000);
        assert!(out.iter().all(|s| (s - 0.1).abs() < 1e-6));

        let out = resample(&vec![0.0; 44_100], 44_100, 16_000);
        assert_eq!(out.len(), 16_000);

        let out = resample(&vec![0.0; 8_000], 8_000, 16_000);
        assert_eq!(out.len(), 16_000);
    }

    #[test]
    fn downsampling_filters_out_high_frequencies() {
        // A 12 kHz tone at 48 kHz is above the 8 kHz Nyquist limit of 16 kHz audio.
        let tone: Vec<f32> = (0..48_000).map(|i| (i as f32 * 2.0 * std::f32::consts::PI * 12_000.0 / 48_000.0).sin()).collect();
        assert!(rms(&resample(&tone, 48_000, 16_000)) < 0.4);
    }

    #[test]
    fn wav_round_trips() {
        let samples = vec![0.0, 0.5, -0.5, 1.0, -1.0];
        let back = decode_wav(&encode_wav(&samples)).unwrap();
        for (a, b) in samples.iter().zip(&back) {
            assert!((a - b).abs() < 1e-3, "{a} vs {b}");
        }
    }

    #[test]
    fn rejects_non_wav() {
        assert!(decode_wav(b"not a wav file").is_err());
    }

    #[test]
    fn detects_silence() {
        assert!(is_silent(&vec![0.0; 16_000]));
        assert!(is_silent(&vec![0.001; 16_000]));
        let mut speech = vec![0.0; 16_000];
        speech[8_000..8_400].fill(0.2);
        assert!(!is_silent(&speech));
    }

    #[test]
    fn squeezes_silence() {
        let ms = |n: usize| n * 16;
        let mut clip = vec![0.0; ms(1000)];
        clip.extend(vec![0.2; ms(500)]);
        clip.extend(vec![0.0; ms(2000)]);
        clip.extend(vec![0.2; ms(500)]);
        clip.extend(vec![0.0; ms(100)]);
        clip.extend(vec![0.2; ms(500)]);
        clip.extend(vec![0.0; ms(1000)]);
        // 1 s lead -> 200 ms, 2 s pause -> 400 ms, the 100 ms gap stays, 1 s tail -> 200 ms.
        assert_eq!(squeeze_silence(&clip).len(), ms(200 + 500 + 400 + 500 + 100 + 500 + 200));
        assert!(squeeze_silence(&vec![0.0; ms(1000)]).is_empty());
    }

    #[test]
    fn splits_at_the_quietest_pause() {
        let max = 16_000 * 25;
        let short = vec![0.2; max];
        assert_eq!(split_at_pauses(&short, max).len(), 1);

        // 40 s of speech with a pause at 18-18.3 s: the cut lands inside it.
        let mut clip = vec![0.2; 16_000 * 40];
        clip[16_000 * 18..16_000 * 18 + 4_800].fill(0.0);
        let pieces = split_at_pauses(&clip, max);
        assert_eq!(pieces.len(), 2);
        assert!((16_000 * 18..16_000 * 18 + 4_800).contains(&pieces[0].len()), "cut at {}", pieces[0].len());
        assert_eq!(pieces.iter().map(|p| p.len()).sum::<usize>(), clip.len());

        // No pause at all still yields pieces no longer than `max`.
        let flat = vec![0.2; 16_000 * 70];
        let pieces = split_at_pauses(&flat, max);
        assert!(pieces.iter().all(|p| p.len() <= max));
        assert_eq!(pieces.iter().map(|p| p.len()).sum::<usize>(), 16_000 * 70);
    }

    #[test]
    fn pads_short_clips() {
        assert_eq!(pad_for_whisper(vec![0.1; 100]).len(), 17_600);
        assert_eq!(pad_for_whisper(vec![0.1; 40_000]).len(), 40_000);
    }
}
