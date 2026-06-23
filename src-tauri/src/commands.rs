use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

use crate::{
    audio_io, ml_engine, separation,
    types::{ExtractRequest, ExtractionReport, LocalMlStatus, ProgressEvent, TrackAnalysis},
};

#[tauri::command]
pub async fn analyze_track(input_path: String) -> Result<TrackAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        audio_io::analyze_track(&PathBuf::from(input_path))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn check_local_ml_runtime(app: AppHandle) -> Result<LocalMlStatus, String> {
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || ml_engine::check_runtime(resource_dir))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn extract_stems(
    app: AppHandle,
    request: ExtractRequest,
) -> Result<ExtractionReport, String> {
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let input_path = PathBuf::from(request.input_path);
        let output_dir = PathBuf::from(request.output_dir);
        let mode = request.mode;
        let tuning = request.tuning.unwrap_or_default().clamped();
        let progress_app = app.clone();

        let emit_progress = move |phase: &str, progress: f32, detail: String| {
            let _ = progress_app.emit(
                "stems://progress",
                ProgressEvent {
                    phase: phase.to_string(),
                    progress,
                    detail,
                },
            );
        };

        if mode.is_local_ml() {
            ml_engine::extract_track_to_directory(
                &input_path,
                &output_dir,
                mode,
                resource_dir,
                emit_progress,
            )
            .map_err(|error| error.to_string())
        } else {
            separation::extract_track_to_directory(
                &input_path,
                &output_dir,
                mode,
                tuning,
                emit_progress,
            )
            .map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
