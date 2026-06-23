use crate::types::StemCleanupOptions;

const EPSILON: f32 = 1.0e-8;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CleanupReport {
    pub applied: bool,
    pub strength: u8,
    pub quiet_threshold: f32,
}

pub fn cleanup_samples(
    samples: &mut [Vec<f32>],
    sample_rate: u32,
    options: StemCleanupOptions,
) -> CleanupReport {
    let options = options.clamped();
    if !options.is_active() || samples.is_empty() {
        return CleanupReport {
            applied: false,
            strength: options.strength,
            quiet_threshold: 0.0,
        };
    }

    sanitize(samples);
    remove_dc_offset(samples);
    let quiet_threshold = soft_reduce_quiet_bleed(samples, options.strength);
    fade_edges(samples, sample_rate, options.strength);
    sanitize(samples);

    CleanupReport {
        applied: true,
        strength: options.strength,
        quiet_threshold,
    }
}

pub fn method_note(options: StemCleanupOptions) -> Option<String> {
    let options = options.clamped();
    options.is_active().then(|| {
        format!(
            "Stem cleanup applied at strength {}: DC offset removal, short edge fades, finite-sample clamping, and soft low-level bleed reduction.",
            options.strength
        )
    })
}

fn sanitize(samples: &mut [Vec<f32>]) {
    for channel in samples {
        for sample in channel {
            if !sample.is_finite() {
                *sample = 0.0;
            } else {
                *sample = sample.clamp(-1.0, 1.0);
            }
        }
    }
}

fn remove_dc_offset(samples: &mut [Vec<f32>]) {
    for channel in samples {
        if channel.is_empty() {
            continue;
        }

        let mean = channel.iter().copied().sum::<f32>() / channel.len() as f32;
        if mean.abs() <= EPSILON {
            continue;
        }

        for sample in channel {
            *sample -= mean;
        }
    }
}

fn soft_reduce_quiet_bleed(samples: &mut [Vec<f32>], strength: u8) -> f32 {
    let mut amplitudes = samples
        .iter()
        .flat_map(|channel| channel.iter().step_by(16))
        .map(|sample| sample.abs())
        .filter(|sample| *sample > EPSILON)
        .collect::<Vec<_>>();
    if amplitudes.is_empty() {
        return 0.0;
    }

    amplitudes.sort_by(f32::total_cmp);
    let percentile_index = ((amplitudes.len() - 1) as f32 * 0.30).round() as usize;
    let percentile = amplitudes[percentile_index];
    let strength_ratio = f32::from(strength.min(10)) / 10.0;
    let threshold = (percentile * (0.85 + strength_ratio)).clamp(0.0004, 0.045);
    let max_reduction = 0.72 * strength_ratio;

    for channel in samples {
        for sample in channel {
            let amplitude = sample.abs();
            if amplitude >= threshold {
                continue;
            }

            let quietness = 1.0 - (amplitude / threshold).clamp(0.0, 1.0);
            let gain = 1.0 - max_reduction * quietness * quietness;
            *sample *= gain;
        }
    }

    threshold
}

fn fade_edges(samples: &mut [Vec<f32>], sample_rate: u32, strength: u8) {
    let Some(frames) = samples.first().map(Vec::len) else {
        return;
    };
    if frames < 2 || sample_rate == 0 {
        return;
    }

    let strength_ratio = f32::from(strength.min(10)) / 10.0;
    let fade_seconds = 0.002 + strength_ratio * 0.004;
    let fade_frames = ((sample_rate as f32 * fade_seconds).round() as usize)
        .max(1)
        .min(frames / 2);
    if fade_frames == 0 {
        return;
    }

    for channel in samples {
        for index in 0..fade_frames {
            let gain = index as f32 / fade_frames as f32;
            channel[index] *= gain;
            let tail_index = frames - 1 - index;
            channel[tail_index] *= gain;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_cleanup_is_a_noop() {
        let mut samples = vec![vec![0.2, -0.2, 0.1]];
        let original = samples.clone();

        let report = cleanup_samples(
            &mut samples,
            44_100,
            StemCleanupOptions {
                enabled: false,
                strength: 10,
            },
        );

        assert!(!report.applied);
        assert_eq!(samples, original);
    }

    #[test]
    fn cleanup_preserves_shape_and_sanitizes_samples() {
        let mut samples = vec![
            vec![0.05, f32::NAN, 1.4, -1.2],
            vec![0.02, 0.03, 0.04, 0.05],
        ];

        let report = cleanup_samples(
            &mut samples,
            44_100,
            StemCleanupOptions {
                enabled: true,
                strength: 6,
            },
        );

        assert!(report.applied);
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].len(), 4);
        assert!(samples.iter().flatten().all(|sample| sample.is_finite()));
        assert!(
            samples
                .iter()
                .flatten()
                .all(|sample| (-1.0..=1.0).contains(sample))
        );
    }

    #[test]
    fn cleanup_reduces_low_level_bleed() {
        let mut samples = vec![vec![0.002_f32; 128]];
        samples[0][64] = 0.4;
        let before_quiet = samples[0][10].abs();

        cleanup_samples(
            &mut samples,
            44_100,
            StemCleanupOptions {
                enabled: true,
                strength: 10,
            },
        );

        assert!(samples[0][10].abs() < before_quiet);
        assert!(samples[0][64].abs() > 0.2);
    }

    #[test]
    fn cleanup_removes_channel_dc_offset() {
        let mut samples = vec![vec![0.2, 0.3, 0.4, 0.5, 0.6, 0.7]];

        cleanup_samples(
            &mut samples,
            44_100,
            StemCleanupOptions {
                enabled: true,
                strength: 4,
            },
        );

        let mean = samples[0].iter().copied().sum::<f32>() / samples[0].len() as f32;
        assert!(mean.abs() < 0.08, "mean was {mean}");
    }
}
