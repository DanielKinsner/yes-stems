use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
};

use symphonia::core::{
    codecs::{
        CodecParameters,
        audio::{AudioDecoderOptions, CODEC_ID_NULL_AUDIO},
    },
    errors::Error as SymphoniaError,
    formats::{FormatOptions, probe::Hint},
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
};
use thiserror::Error;

use crate::types::TrackAnalysis;

#[derive(Debug, Error)]
pub enum AudioIoError {
    #[error("could not open input file: {0}")]
    Open(#[from] io::Error),
    #[error("could not probe audio format: {0}")]
    Probe(SymphoniaError),
    #[error("could not create decoder: {0}")]
    Decoder(SymphoniaError),
    #[error("could not decode packet: {0}")]
    Decode(SymphoniaError),
    #[error("input does not contain a supported audio track")]
    NoSupportedTrack,
    #[error("decoded audio is empty")]
    EmptyAudio,
    #[error("decoded sample rate changed mid-stream")]
    ChangingSampleRate,
    #[error("decoded channel count changed mid-stream")]
    ChangingChannelCount,
    #[error("audio contains non-finite samples")]
    NonFiniteSamples,
    #[error("could not write wav file: {0}")]
    Wav(#[from] hound::Error),
}

#[derive(Clone, Debug)]
pub struct AudioBuffer {
    pub sample_rate: u32,
    pub channels: usize,
    pub samples: Vec<Vec<f32>>,
}

impl AudioBuffer {
    pub fn frames(&self) -> usize {
        self.samples.first().map_or(0, Vec::len)
    }

    pub fn duration_seconds(&self) -> f64 {
        if self.sample_rate == 0 {
            return 0.0;
        }

        self.frames() as f64 / f64::from(self.sample_rate)
    }

    pub fn peak(&self) -> f32 {
        peak(&self.samples)
    }

    pub fn ensure_valid(&self) -> Result<(), AudioIoError> {
        if self.channels == 0 || self.frames() == 0 {
            return Err(AudioIoError::EmptyAudio);
        }

        let frames = self.frames();
        if self.samples.iter().any(|channel| {
            channel.len() != frames || channel.iter().any(|sample| !sample.is_finite())
        }) {
            return Err(AudioIoError::NonFiniteSamples);
        }

        Ok(())
    }
}

pub fn analyze_track(path: &Path) -> Result<TrackAnalysis, AudioIoError> {
    let audio = decode_audio(path)?;
    Ok(TrackAnalysis {
        file_name: file_name(path),
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        frames: audio.frames(),
        duration_seconds: audio.duration_seconds(),
        peak: audio.peak(),
        waveform_peaks: waveform_peaks(&audio, 96),
    })
}

pub fn decode_audio(path: &Path) -> Result<AudioBuffer, AudioIoError> {
    let file = File::open(path)?;
    let media_source = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .probe(
            &hint,
            media_source,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(AudioIoError::Probe)?;

    let mut format = probed;
    let track = format
        .tracks()
        .iter()
        .find(|track| {
            track
                .codec_params
                .as_ref()
                .and_then(CodecParameters::audio)
                .is_some_and(|params| params.codec != CODEC_ID_NULL_AUDIO)
        })
        .ok_or(AudioIoError::NoSupportedTrack)?;

    let track_id = track.id;
    let audio_params = track
        .codec_params
        .as_ref()
        .and_then(CodecParameters::audio)
        .ok_or(AudioIoError::NoSupportedTrack)?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(audio_params, &AudioDecoderOptions::default())
        .map_err(AudioIoError::Decoder)?;

    let mut sample_rate: Option<u32> = None;
    let mut channel_count: Option<usize> = None;
    let mut channels: Vec<Vec<f32>> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::IoError(error)) if error.kind() == io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(error) => return Err(AudioIoError::Decode(error)),
        };

        if packet.track_id != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(AudioIoError::Decode(error)),
        };

        let spec = decoded.spec();
        if sample_rate.is_some_and(|existing| existing != spec.rate()) {
            return Err(AudioIoError::ChangingSampleRate);
        }
        sample_rate = Some(spec.rate());

        let decoded_channels = spec.channels().count();
        if channel_count.is_some_and(|existing| existing != decoded_channels) {
            return Err(AudioIoError::ChangingChannelCount);
        }
        channel_count = Some(decoded_channels);

        if channels.is_empty() {
            channels = vec![Vec::new(); decoded_channels];
        }

        let mut interleaved = Vec::<f32>::new();
        decoded.copy_to_vec_interleaved(&mut interleaved);
        for frame in interleaved.chunks(decoded_channels) {
            for channel_index in 0..decoded_channels {
                channels[channel_index].push(frame[channel_index]);
            }
        }
    }
    let audio = AudioBuffer {
        sample_rate: sample_rate.unwrap_or(44_100),
        channels: channel_count.unwrap_or(0),
        samples: channels,
    };
    audio.ensure_valid()?;
    Ok(audio)
}

fn waveform_peaks(audio: &AudioBuffer, buckets: usize) -> Vec<f32> {
    if buckets == 0 || audio.frames() == 0 {
        return Vec::new();
    }

    let frames = audio.frames();
    let mut peaks = Vec::with_capacity(buckets);
    for bucket_index in 0..buckets {
        let start = bucket_index * frames / buckets;
        let end = ((bucket_index + 1) * frames / buckets)
            .max(start + 1)
            .min(frames);
        let mut peak = 0.0_f32;
        for channel in &audio.samples {
            for sample in &channel[start..end] {
                peak = peak.max(sample.abs());
            }
        }
        peaks.push(peak.clamp(0.0, 1.0));
    }

    peaks
}

pub fn write_wav(path: &Path, sample_rate: u32, samples: &[Vec<f32>]) -> Result<(), AudioIoError> {
    let channels = samples.len();
    let frames = samples.first().map_or(0, Vec::len);
    if channels == 0 || frames == 0 {
        return Err(AudioIoError::EmptyAudio);
    }
    if samples
        .iter()
        .any(|channel| channel.len() != frames || channel.iter().any(|sample| !sample.is_finite()))
    {
        return Err(AudioIoError::NonFiniteSamples);
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let spec = hound::WavSpec {
        channels: channels as u16,
        sample_rate,
        bits_per_sample: 24,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(path, spec)?;
    for frame_index in 0..frames {
        for channel in samples {
            writer.write_sample(float_to_i24(channel[frame_index]))?;
        }
    }
    writer.finalize()?;
    Ok(())
}

pub fn peak(samples: &[Vec<f32>]) -> f32 {
    samples
        .iter()
        .flat_map(|channel| channel.iter())
        .map(|sample| sample.abs())
        .fold(0.0_f32, f32::max)
}

pub fn file_name(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("track")
        .to_string()
}

pub fn unique_output_dir(base_dir: &Path, source_name: &str) -> PathBuf {
    let sanitized = source_name
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => ch,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    base_dir.join(if sanitized.is_empty() {
        "yes-stems-export"
    } else {
        sanitized.as_str()
    })
}

fn float_to_i24(sample: f32) -> i32 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped <= -1.0 {
        -8_388_608
    } else {
        (clamped * 8_388_607.0).round() as i32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_24_bit_wav() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("stem.wav");
        let samples = vec![vec![0.0, 0.5, -0.5], vec![0.1, -0.1, 0.0]];

        write_wav(&path, 44_100, &samples).expect("write wav");

        let reader = hound::WavReader::open(path).expect("read wav");
        let spec = reader.spec();
        assert_eq!(spec.channels, 2);
        assert_eq!(spec.sample_rate, 44_100);
        assert_eq!(spec.bits_per_sample, 24);
    }

    #[test]
    fn rejects_non_finite_audio() {
        let audio = AudioBuffer {
            sample_rate: 44_100,
            channels: 1,
            samples: vec![vec![0.0, f32::NAN]],
        };

        assert!(matches!(
            audio.ensure_valid(),
            Err(AudioIoError::NonFiniteSamples)
        ));
    }
}
