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
    pub output_dir: String,
    pub mode: StemMode,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportStemsRequest {
    pub source_name: String,
    pub destination_root: String,
    pub stems: Vec<StemFile>,
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
