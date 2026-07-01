use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StemMode {
    VocalInstrumental,
    FullBand,
    LocalMlFour,
    LocalMlSix,
}

impl StemMode {
    pub fn as_label(self) -> &'static str {
        match self {
            Self::VocalInstrumental => "Vocal + Instrumental",
            Self::FullBand => "Full Band Layers",
            Self::LocalMlFour => "Local ML 4 Stems",
            Self::LocalMlSix => "Local ML 6 Stems",
        }
    }

    pub fn is_local_ml(self) -> bool {
        matches!(self, Self::LocalMlFour | Self::LocalMlSix)
    }

    pub fn demucs_model(self) -> Option<&'static str> {
        match self {
            Self::LocalMlFour => Some("htdemucs"),
            Self::LocalMlSix => Some("htdemucs_6s"),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRequest {
    pub input_path: String,
    pub mode: StemMode,
    pub tuning: Option<SeparationTuning>,
    pub cleanup: Option<StemCleanupOptions>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SeparationTuning {
    pub aggressiveness: u8,
    pub artifact_reduction: u8,
}

impl Default for SeparationTuning {
    fn default() -> Self {
        Self {
            aggressiveness: 5,
            artifact_reduction: 5,
        }
    }
}

impl SeparationTuning {
    pub fn clamped(self) -> Self {
        Self {
            aggressiveness: self.aggressiveness.min(10),
            artifact_reduction: self.artifact_reduction.min(10),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StemCleanupOptions {
    pub enabled: bool,
    pub strength: u8,
}

impl StemCleanupOptions {
    pub fn clamped(self) -> Self {
        Self {
            enabled: self.enabled,
            strength: self.strength.min(10),
        }
    }

    pub fn is_active(self) -> bool {
        self.enabled && self.strength > 0
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Wav16,
    #[default]
    Wav24,
    Wav32f,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportStemsRequest {
    pub source_name: String,
    pub destination_root: String,
    pub stems: Vec<StemFile>,
    #[serde(default)]
    pub format: ExportFormat,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackAnalysis {
    pub file_name: String,
    pub sample_rate: u32,
    pub channels: usize,
    pub frames: usize,
    pub duration_seconds: f64,
    pub peak: f32,
    pub waveform_peaks: Vec<f32>,
    /// Average magnitude spectrum (0..1) for the Spectrum tab.
    pub spectrum: Vec<f32>,
    /// Short-term RMS loudness curve (0..1) for the Loudness tab.
    pub loudness: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMlStatus {
    pub available: bool,
    pub runner: Option<String>,
    pub device: String,
    pub checked: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    /// Correlates progress events with a single extraction run.
    pub job_id: String,
    pub phase: String,
    pub progress: f32,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StemFile {
    pub name: String,
    pub role: String,
    pub path: String,
    pub frames: usize,
    pub peak: f32,
    pub bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionReport {
    pub source_name: String,
    pub mode: StemMode,
    pub mode_label: String,
    pub output_dir: String,
    pub sample_rate: u32,
    pub channels: usize,
    pub frames: usize,
    pub duration_seconds: f64,
    pub stems: Vec<StemFile>,
    pub method_notes: Vec<String>,
    pub reconstruction_error: f32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportStemsResult {
    pub export_dir: String,
    pub exported_files: usize,
}
