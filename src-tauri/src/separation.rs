use std::{f32::consts::PI, path::Path};

use rustfft::{FftPlanner, num_complex::Complex};
use thiserror::Error;

use crate::{
    audio_io::{self, AudioBuffer, AudioIoError},
    stem_cleanup,
    types::{ExtractionReport, SeparationTuning, StemCleanupOptions, StemFile, StemMode},
};

const WINDOW_SIZE: usize = 2048;
const HOP_SIZE: usize = 512;
const HALF_BINS: usize = WINDOW_SIZE / 2 + 1;
const EPSILON: f32 = 1.0e-8;

#[derive(Debug, Error)]
pub enum SeparationError {
    #[error(transparent)]
    Audio(#[from] AudioIoError),
    #[error("could not create output directory: {0}")]
    OutputDirectory(std::io::Error),
}

#[derive(Debug)]
struct Stft {
    channels: usize,
    frames: usize,
    source_frames: usize,
    spectra: Vec<Vec<Vec<Complex<f32>>>>,
    magnitudes: Vec<Vec<f32>>,
}

#[derive(Debug)]
struct StemRender {
    name: &'static str,
    role: &'static str,
    filename: &'static str,
    samples: Vec<Vec<f32>>,
}

pub fn extract_to_directory<F>(
    audio: &AudioBuffer,
    output_dir: &Path,
    mode: StemMode,
    tuning: SeparationTuning,
    cleanup: StemCleanupOptions,
    mut progress: F,
) -> Result<ExtractionReport, SeparationError>
where
    F: FnMut(&str, f32, String),
{
    debug_assert!(!mode.is_local_ml());
    audio.ensure_valid()?;
    std::fs::create_dir_all(output_dir).map_err(SeparationError::OutputDirectory)?;

    progress(
        "analysis",
        0.12,
        "building phase-preserving spectra".to_string(),
    );
    let stft = compute_stft(audio);

    progress(
        "analysis",
        0.30,
        "estimating harmonic and percussive masks".to_string(),
    );
    let tuning = tuning.clamped();
    let cleanup = cleanup.clamped();
    let mask_set = build_masks(&stft, audio.sample_rate, tuning);

    progress(
        "render",
        0.48,
        "rendering stems from masked spectra".to_string(),
    );
    let mut stems = render_stems(&stft, mode, &mask_set);

    progress("export", 0.76, "writing 24-bit wav stems".to_string());
    let mut stem_files = Vec::with_capacity(stems.len());
    for stem in &mut stems {
        stem_cleanup::cleanup_samples(&mut stem.samples, audio.sample_rate, cleanup);
        clamp_audio(&mut stem.samples);
        let path = output_dir.join(stem.filename);
        audio_io::write_wav(&path, audio.sample_rate, &stem.samples)?;
        stem_files.push(StemFile {
            name: stem.name.to_string(),
            role: stem.role.to_string(),
            path: path.to_string_lossy().to_string(),
            frames: stem.samples.first().map_or(0, Vec::len),
            peak: audio_io::peak(&stem.samples),
        });
    }

    progress(
        "verify",
        0.92,
        "checking partition reconstruction".to_string(),
    );
    let reconstruction_error = reconstruction_error(audio, mode, &stems);

    progress("complete", 1.0, "stem extraction complete".to_string());
    Ok(ExtractionReport {
        source_name: "source".to_string(),
        mode,
        mode_label: mode.as_label().to_string(),
        output_dir: output_dir.to_string_lossy().to_string(),
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        frames: audio.frames(),
        duration_seconds: audio.duration_seconds(),
        stems: stem_files,
        method_notes: method_notes(mode, tuning, cleanup),
        reconstruction_error,
    })
}

pub fn extract_track_to_directory<F>(
    input_path: &Path,
    output_root: &Path,
    mode: StemMode,
    tuning: SeparationTuning,
    cleanup: StemCleanupOptions,
    mut progress: F,
) -> Result<ExtractionReport, SeparationError>
where
    F: FnMut(&str, f32, String),
{
    progress("decode", 0.04, "decoding source audio locally".to_string());
    let audio = audio_io::decode_audio(input_path)?;
    let source_name = audio_io::file_name(input_path);
    let output_dir = audio_io::unique_output_dir(output_root, &source_name);
    let mut report = extract_to_directory(&audio, &output_dir, mode, tuning, cleanup, progress)?;
    report.source_name = source_name;
    Ok(report)
}

fn compute_stft(audio: &AudioBuffer) -> Stft {
    let source_frames = audio.frames();
    let frame_count = source_frames.saturating_sub(1) / HOP_SIZE + 1;
    let window = hann_window();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(WINDOW_SIZE);
    let mut spectra =
        vec![vec![vec![Complex::default(); WINDOW_SIZE]; frame_count]; audio.channels];

    for (channel_spectra, channel) in spectra.iter_mut().zip(&audio.samples) {
        for (frame_index, frame_slot) in channel_spectra.iter_mut().enumerate() {
            let offset = frame_index * HOP_SIZE;
            let mut frame = vec![Complex::default(); WINDOW_SIZE];
            for sample_index in 0..WINDOW_SIZE {
                let source_index = offset + sample_index;
                let sample = channel.get(source_index).copied().unwrap_or(0.0);
                frame[sample_index] = Complex::new(sample * window[sample_index], 0.0);
            }
            fft.process(&mut frame);
            *frame_slot = frame;
        }
    }

    let mut magnitudes = vec![vec![0.0; HALF_BINS]; frame_count];
    for frame_index in 0..frame_count {
        for bin_index in 0..HALF_BINS {
            let channel_sum = (0..audio.channels)
                .map(|channel_index| spectra[channel_index][frame_index][bin_index].norm())
                .sum::<f32>();
            magnitudes[frame_index][bin_index] = channel_sum / audio.channels as f32;
        }
    }

    Stft {
        channels: audio.channels,
        frames: frame_count,
        source_frames,
        spectra,
        magnitudes,
    }
}

fn inverse_stft(stft: &Stft, mask: &[Vec<f32>]) -> Vec<Vec<f32>> {
    let window = hann_window();
    let mut planner = FftPlanner::<f32>::new();
    let inverse = planner.plan_fft_inverse(WINDOW_SIZE);
    let mut rendered = vec![vec![0.0; stft.source_frames + WINDOW_SIZE]; stft.channels];
    let mut window_sums = vec![0.0; stft.source_frames + WINDOW_SIZE];

    for frame_index in 0..stft.frames {
        let offset = frame_index * HOP_SIZE;
        for sample_index in 0..WINDOW_SIZE {
            window_sums[offset + sample_index] += window[sample_index] * window[sample_index];
        }
    }

    for (channel_index, output_channel) in rendered.iter_mut().enumerate() {
        for frame_index in 0..stft.frames {
            let offset = frame_index * HOP_SIZE;
            let mut frame = stft.spectra[channel_index][frame_index].clone();
            for (bin_index, value) in frame.iter_mut().enumerate() {
                *value *= mirrored_mask(mask, frame_index, bin_index);
            }
            inverse.process(&mut frame);

            for sample_index in 0..WINDOW_SIZE {
                let source_index = offset + sample_index;
                output_channel[source_index] +=
                    (frame[sample_index].re / WINDOW_SIZE as f32) * window[sample_index];
            }
        }
    }

    for channel in &mut rendered {
        for sample_index in 0..stft.source_frames {
            let sum = window_sums[sample_index];
            if sum > EPSILON {
                channel[sample_index] /= sum;
            }
        }
        channel.truncate(stft.source_frames);
    }

    rendered
}

#[derive(Debug)]
struct MaskSet {
    vocal: Vec<Vec<f32>>,
    instrumental: Vec<Vec<f32>>,
    percussive: Vec<Vec<f32>>,
    bass: Vec<Vec<f32>>,
    harmonic: Vec<Vec<f32>>,
    residual: Vec<Vec<f32>>,
}

fn build_masks(stft: &Stft, sample_rate: u32, tuning: SeparationTuning) -> MaskSet {
    let harmonic_score = median_time(&stft.magnitudes, 8, 1);
    let percussive_score = median_frequency(&stft.magnitudes, 10);
    let repeating_score = median_time(&stft.magnitudes, 96, 8);
    let aggressiveness = 0.70 + (f32::from(tuning.aggressiveness) / 10.0) * 0.70;
    let artifact_reduction = f32::from(tuning.artifact_reduction) / 10.0;
    let mask_ceiling = 0.98 - artifact_reduction * 0.26;

    let mut vocal = zeros(stft.frames);
    let mut instrumental = zeros(stft.frames);
    let mut percussive = zeros(stft.frames);
    let mut bass = zeros(stft.frames);
    let mut harmonic = zeros(stft.frames);
    let mut residual = zeros(stft.frames);

    for frame_index in 0..stft.frames {
        for bin_index in 0..HALF_BINS {
            let h_score = harmonic_score[frame_index][bin_index].max(EPSILON);
            let p_score = percussive_score[frame_index][bin_index].max(EPSILON);
            let h_mask = soft_ratio(h_score * aggressiveness, p_score * 1.6);
            let p_mask = soft_ratio(p_score * aggressiveness, h_score * 1.6);
            let hp_residual = (1.0 - h_mask - p_mask).clamp(0.0, 1.0);

            let frequency = bin_frequency(bin_index, sample_rate);
            let vocal_band = band_pass_weight(frequency, 120.0, 8_000.0, 90.0, 1_800.0);
            let low_band = low_pass_weight(frequency, 220.0, 360.0);
            let repeating = repeating_score[frame_index][bin_index]
                .min(stft.magnitudes[frame_index][bin_index]);
            let novelty = (stft.magnitudes[frame_index][bin_index] - repeating).max(0.0);
            let voice_score = novelty * vocal_band * (0.65 + 0.35 * h_mask) * aggressiveness;
            let backing_score = repeating
                + (p_score * 0.25)
                + stft.magnitudes[frame_index][bin_index] * (1.0 - vocal_band) * 0.2;
            let vocal_mask = soft_ratio(voice_score, backing_score).clamp(0.0, mask_ceiling);
            let non_vocal = 1.0 - vocal_mask;

            vocal[frame_index][bin_index] = vocal_mask;
            instrumental[frame_index][bin_index] = non_vocal;
            percussive[frame_index][bin_index] = (p_mask * non_vocal).min(mask_ceiling);
            bass[frame_index][bin_index] = (h_mask * low_band * non_vocal).min(mask_ceiling);
            harmonic[frame_index][bin_index] =
                (h_mask * (1.0 - low_band) * non_vocal).min(mask_ceiling);
            residual[frame_index][bin_index] =
                (hp_residual * non_vocal + vocal_mask * 0.02).clamp(0.0, 1.0);
        }
    }

    if tuning.artifact_reduction > 0 {
        smooth_mask(&mut vocal, tuning.artifact_reduction);
        for frame_index in 0..stft.frames {
            for bin_index in 0..HALF_BINS {
                instrumental[frame_index][bin_index] = 1.0 - vocal[frame_index][bin_index];
            }
        }
        smooth_mask(&mut percussive, tuning.artifact_reduction);
        smooth_mask(&mut bass, tuning.artifact_reduction);
        smooth_mask(&mut harmonic, tuning.artifact_reduction);
        smooth_mask(&mut residual, tuning.artifact_reduction);
    }

    MaskSet {
        vocal,
        instrumental,
        percussive,
        bass,
        harmonic,
        residual,
    }
}

fn render_stems(stft: &Stft, mode: StemMode, masks: &MaskSet) -> Vec<StemRender> {
    match mode {
        StemMode::VocalInstrumental => vec![
            StemRender {
                name: "Vocals",
                role: "Non-repeating midrange foreground estimate.",
                filename: "vocals.wav",
                samples: inverse_stft(stft, &masks.vocal),
            },
            StemRender {
                name: "Instrumental",
                role: "Complement of the vocal foreground mask.",
                filename: "instrumental.wav",
                samples: inverse_stft(stft, &masks.instrumental),
            },
        ],
        StemMode::FullBand => vec![
            StemRender {
                name: "Vocal Foreground",
                role: "Non-repeating midrange foreground estimate.",
                filename: "vocal_foreground.wav",
                samples: inverse_stft(stft, &masks.vocal),
            },
            StemRender {
                name: "Instrumental Sum",
                role: "Everything outside the vocal foreground mask.",
                filename: "instrumental_sum.wav",
                samples: inverse_stft(stft, &masks.instrumental),
            },
            StemRender {
                name: "Drums / Percussion",
                role: "Vertical transient structures from HPSS.",
                filename: "drums_percussion.wav",
                samples: inverse_stft(stft, &masks.percussive),
            },
            StemRender {
                name: "Bass Band",
                role: "Low-frequency harmonic energy below the bass crossover.",
                filename: "bass_band.wav",
                samples: inverse_stft(stft, &masks.bass),
            },
            StemRender {
                name: "Harmonic Bed",
                role: "Non-bass horizontal harmonic structures.",
                filename: "harmonic_bed.wav",
                samples: inverse_stft(stft, &masks.harmonic),
            },
            StemRender {
                name: "Residual",
                role: "Noise-like or ambiguous energy outside clear masks.",
                filename: "residual.wav",
                samples: inverse_stft(stft, &masks.residual),
            },
        ],
        _ => unreachable!("local ML modes are dispatched through ml_engine"),
    }
}

fn method_notes(
    mode: StemMode,
    tuning: SeparationTuning,
    cleanup: StemCleanupOptions,
) -> Vec<String> {
    let mut notes = vec![
        "Local non-AI extraction; no model inference or cloud processing.".to_string(),
        "Masks are applied to the original complex spectra to preserve mixture phase.".to_string(),
        "Full-band labels are utility layers, not recovered original multitracks.".to_string(),
        format!(
            "DSP tuning used aggressiveness {} and artifact reduction {}.",
            tuning.aggressiveness, tuning.artifact_reduction
        ),
    ];
    if mode == StemMode::VocalInstrumental {
        notes.push("Vocal estimate relies on non-repeating midrange foreground cues.".to_string());
    } else if mode == StemMode::FullBand {
        notes.push(
            "Full-band layers combine HPSS, residual, and bass-band partitioning.".to_string(),
        );
    }
    if let Some(note) = stem_cleanup::method_note(cleanup) {
        notes.push(note);
    }
    notes
}

fn reconstruction_error(audio: &AudioBuffer, mode: StemMode, stems: &[StemRender]) -> f32 {
    let selected = match mode {
        StemMode::VocalInstrumental => stems.iter().collect::<Vec<_>>(),
        StemMode::FullBand => stems
            .iter()
            .filter(|stem| stem.filename != "instrumental_sum.wav")
            .collect::<Vec<_>>(),
        _ => unreachable!("local ML modes are dispatched through ml_engine"),
    };

    let mut error_energy = 0.0_f64;
    let mut source_energy = 0.0_f64;
    for channel_index in 0..audio.channels {
        for frame_index in 0..audio.frames() {
            let summed = selected
                .iter()
                .map(|stem| stem.samples[channel_index][frame_index])
                .sum::<f32>();
            let source = audio.samples[channel_index][frame_index];
            error_energy += f64::from((source - summed).powi(2));
            source_energy += f64::from(source.powi(2));
        }
    }

    if source_energy <= f64::from(EPSILON) {
        return 0.0;
    }

    (error_energy / source_energy).sqrt() as f32
}

fn clamp_audio(samples: &mut [Vec<f32>]) {
    for channel in samples {
        for sample in channel {
            *sample = sample.clamp(-1.0, 1.0);
        }
    }
}

fn hann_window() -> Vec<f32> {
    (0..WINDOW_SIZE)
        .map(|index| 0.5 - 0.5 * ((2.0 * PI * index as f32) / WINDOW_SIZE as f32).cos())
        .collect()
}

fn mirrored_mask(mask: &[Vec<f32>], frame_index: usize, bin_index: usize) -> f32 {
    let mirrored_bin = if bin_index < HALF_BINS {
        bin_index
    } else {
        WINDOW_SIZE - bin_index
    };
    mask[frame_index][mirrored_bin]
}

fn zeros(frames: usize) -> Vec<Vec<f32>> {
    vec![vec![0.0; HALF_BINS]; frames]
}

fn median_time(magnitudes: &[Vec<f32>], radius: usize, stride: usize) -> Vec<Vec<f32>> {
    let frames = magnitudes.len();
    let mut output = zeros(frames);
    let mut sampled_frames = Vec::new();
    let step = stride.max(1);

    let mut frame_index = 0;
    while frame_index < frames {
        sampled_frames.push(frame_index);
        frame_index += step;
    }
    if sampled_frames.last().copied() != Some(frames.saturating_sub(1)) {
        sampled_frames.push(frames.saturating_sub(1));
    }

    for &sampled_frame in &sampled_frames {
        let start = sampled_frame.saturating_sub(radius);
        let end = (sampled_frame + radius + 1).min(frames);
        for bin_index in 0..HALF_BINS {
            let mut values = (start..end)
                .map(|time_index| magnitudes[time_index][bin_index])
                .collect::<Vec<_>>();
            output[sampled_frame][bin_index] = median(&mut values);
        }
    }

    for pair in sampled_frames.windows(2) {
        let left = pair[0];
        let right = pair[1];
        for frame in (left + 1)..right {
            let use_right = frame - left > right - frame;
            output[frame] = if use_right {
                output[right].clone()
            } else {
                output[left].clone()
            };
        }
    }

    output
}

fn median_frequency(magnitudes: &[Vec<f32>], radius: usize) -> Vec<Vec<f32>> {
    let mut output = zeros(magnitudes.len());
    for (frame, output_frame) in magnitudes.iter().zip(&mut output) {
        for (bin_index, output_bin) in output_frame.iter_mut().enumerate() {
            let start = bin_index.saturating_sub(radius);
            let end = (bin_index + radius + 1).min(HALF_BINS);
            let mut values = frame[start..end].to_vec();
            *output_bin = median(&mut values);
        }
    }
    output
}

fn smooth_mask(mask: &mut [Vec<f32>], artifact_reduction: u8) {
    if mask.len() < 3 {
        return;
    }

    let mix = (f32::from(artifact_reduction.min(10)) / 10.0) * 0.32;
    if mix <= 0.0 {
        return;
    }

    let original = mask.to_vec();
    for frame_index in 1..(mask.len() - 1) {
        for bin_index in 0..HALF_BINS {
            let smoothed = (original[frame_index - 1][bin_index]
                + original[frame_index][bin_index] * 2.0
                + original[frame_index + 1][bin_index])
                / 4.0;
            mask[frame_index][bin_index] =
                (original[frame_index][bin_index] * (1.0 - mix) + smoothed * mix).clamp(0.0, 1.0);
        }
    }
}

fn median(values: &mut [f32]) -> f32 {
    values.sort_by(f32::total_cmp);
    values[values.len() / 2]
}

fn soft_ratio(primary: f32, secondary: f32) -> f32 {
    let primary = primary.max(0.0).powi(2);
    let secondary = secondary.max(0.0).powi(2);
    primary / (primary + secondary + EPSILON)
}

fn bin_frequency(bin_index: usize, sample_rate: u32) -> f32 {
    bin_index as f32 * sample_rate as f32 / WINDOW_SIZE as f32
}

fn low_pass_weight(frequency: f32, full_below: f32, zero_above: f32) -> f32 {
    if frequency <= full_below {
        1.0
    } else if frequency >= zero_above {
        0.0
    } else {
        1.0 - ((frequency - full_below) / (zero_above - full_below))
    }
}

fn band_pass_weight(
    frequency: f32,
    full_above: f32,
    full_below: f32,
    lower_fade: f32,
    upper_fade: f32,
) -> f32 {
    let lower = if frequency < lower_fade {
        0.0
    } else if frequency >= full_above {
        1.0
    } else {
        (frequency - lower_fade) / (full_above - lower_fade)
    };

    let upper = if frequency <= full_below {
        1.0
    } else if frequency >= full_below + upper_fade {
        0.0
    } else {
        1.0 - ((frequency - full_below) / upper_fade)
    };

    lower.min(upper).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn full_mask_reconstructs_signal_with_low_error() {
        let audio = synthetic_audio();
        let stft = compute_stft(&audio);
        let mask = vec![vec![1.0; HALF_BINS]; stft.frames];

        let rendered = inverse_stft(&stft, &mask);

        let error = rms_error(&audio.samples, &rendered);
        assert!(error < 0.005, "roundtrip error {error}");
    }

    #[test]
    fn vocal_instrumental_partition_exports_expected_files() {
        let audio = synthetic_audio();
        let temp = tempfile::tempdir().expect("temp dir");

        let report = extract_to_directory(
            &audio,
            temp.path(),
            StemMode::VocalInstrumental,
            SeparationTuning::default(),
            StemCleanupOptions::default(),
            |_, _, _| {},
        )
        .expect("extract stems");

        assert_eq!(report.stems.len(), 2);
        assert!(
            report
                .stems
                .iter()
                .any(|stem| stem.path.ends_with("vocals.wav"))
        );
        assert!(
            report
                .stems
                .iter()
                .any(|stem| stem.path.ends_with("instrumental.wav"))
        );
        assert!(report.reconstruction_error < 0.15);
    }

    #[test]
    fn full_band_partition_exports_utility_layers() {
        let audio = synthetic_audio();
        let temp = tempfile::tempdir().expect("temp dir");

        let report = extract_to_directory(
            &audio,
            temp.path(),
            StemMode::FullBand,
            SeparationTuning::default(),
            StemCleanupOptions::default(),
            |_, _, _| {},
        )
        .expect("extract stems");

        let filenames = report
            .stems
            .iter()
            .map(|stem| PathBuf::from(&stem.path))
            .map(|path| path.file_name().unwrap().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(filenames.contains(&"drums_percussion.wav".to_string()));
        assert!(filenames.contains(&"bass_band.wav".to_string()));
        assert!(filenames.contains(&"harmonic_bed.wav".to_string()));
        assert!(report.reconstruction_error < 0.30);
    }

    #[test]
    fn tuning_changes_classic_dsp_masks() {
        let audio = synthetic_audio();
        let temp_a = tempfile::tempdir().expect("temp dir");
        let temp_b = tempfile::tempdir().expect("temp dir");

        let gentle = extract_to_directory(
            &audio,
            temp_a.path(),
            StemMode::VocalInstrumental,
            SeparationTuning {
                aggressiveness: 0,
                artifact_reduction: 10,
            },
            StemCleanupOptions::default(),
            |_, _, _| {},
        )
        .expect("gentle extract");
        let assertive = extract_to_directory(
            &audio,
            temp_b.path(),
            StemMode::VocalInstrumental,
            SeparationTuning {
                aggressiveness: 10,
                artifact_reduction: 0,
            },
            StemCleanupOptions::default(),
            |_, _, _| {},
        )
        .expect("assertive extract");

        let gentle_vocal = gentle
            .stems
            .iter()
            .find(|stem| stem.name == "Vocals")
            .expect("gentle vocal");
        let assertive_vocal = assertive
            .stems
            .iter()
            .find(|stem| stem.name == "Vocals")
            .expect("assertive vocal");

        assert_ne!(gentle_vocal.peak, assertive_vocal.peak);
        assert!(
            gentle
                .method_notes
                .iter()
                .any(|note| note.contains("aggressiveness 0"))
        );
    }

    #[test]
    fn cleanup_notes_are_reported_when_enabled() {
        let audio = synthetic_audio();
        let temp = tempfile::tempdir().expect("temp dir");

        let report = extract_to_directory(
            &audio,
            temp.path(),
            StemMode::VocalInstrumental,
            SeparationTuning::default(),
            StemCleanupOptions {
                enabled: true,
                strength: 4,
            },
            |_, _, _| {},
        )
        .expect("extract stems");

        assert!(
            report
                .method_notes
                .iter()
                .any(|note| note.contains("Stem cleanup applied at strength 4"))
        );
    }

    fn synthetic_audio() -> AudioBuffer {
        let sample_rate = 44_100;
        let frames = sample_rate as usize / 2;
        let mut left = Vec::with_capacity(frames);
        let mut right = Vec::with_capacity(frames);
        for index in 0..frames {
            let time = index as f32 / sample_rate as f32;
            let bass = (2.0 * PI * 110.0 * time).sin() * 0.25;
            let tone = (2.0 * PI * 440.0 * time).sin() * 0.20;
            let click = if index % 4096 < 64 { 0.15 } else { 0.0 };
            left.push(bass + tone + click);
            right.push(bass * 0.9 + tone * 0.8 + click);
        }
        AudioBuffer {
            sample_rate,
            channels: 2,
            samples: vec![left, right],
        }
    }

    fn rms_error(expected: &[Vec<f32>], actual: &[Vec<f32>]) -> f32 {
        let mut sum = 0.0;
        let mut count = 0;
        for (expected_channel, actual_channel) in expected.iter().zip(actual) {
            for (expected_sample, actual_sample) in expected_channel.iter().zip(actual_channel) {
                sum += (expected_sample - actual_sample).powi(2);
                count += 1;
            }
        }
        (sum / count as f32).sqrt()
    }
}
