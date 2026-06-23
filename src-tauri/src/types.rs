use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StemMode {
    VocalInstrumental,
    FullBand,
}

impl StemMode {
    pub fn as_label(self) -> &'static str {
        match self {
            Self::VocalInstrumental => "Vocal + Instrumental",
            Self::FullBand => "Full Band Layers",
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
pub struct TrackAnalysis {
    pub file_name: String,
    pub sample_rate: u32,
    pub channels: usize,
    pub frames: usize,
    pub duration_seconds: f64,
    pub peak: f32,
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
