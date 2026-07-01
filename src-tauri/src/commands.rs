use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter, Manager};

use crate::{
    audio_io,
    cancel::CancelToken,
    ml_engine, separation,
    types::{
        ExportStemsRequest, ExportStemsResult, ExtractRequest, ExtractionReport, LocalMlStatus,
        ProgressEvent, TrackAnalysis,
    },
};

/// Shared extraction state. The `running` flag guards against concurrent `extract_stems`
/// invocations so two runs cannot each allocate full-song spectra or spawn Demucs at once;
/// `cancel` lets the UI abort the in-flight run.
#[derive(Default)]
pub struct ExtractionState {
    running: Arc<AtomicBool>,
    cancel: CancelToken,
}

/// RAII guard that clears the `running` flag when an extraction finishes — including on
/// early return, error, or if the command future is dropped (e.g. window closed).
struct RunningGuard(Arc<AtomicBool>);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

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
    state: tauri::State<'_, ExtractionState>,
) -> Result<ExtractionReport, String> {
    let running = state.running.clone();
    if running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "An extraction is already running. Wait for it to finish before starting another."
                .to_string(),
        );
    }
    let _guard = RunningGuard(running);

    state.cancel.reset();
    let cancel = state.cancel.clone();
    let resource_dir = app.path().resource_dir().ok();
    let managed_output_root = managed_working_root(app.path().app_data_dir().ok().as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        let input_path = PathBuf::from(request.input_path);
        let mode = request.mode;
        let tuning = request.tuning.unwrap_or_default().clamped();
        let cleanup = request.cleanup.unwrap_or_default().clamped();
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
                &managed_output_root,
                mode,
                resource_dir,
                cleanup,
                &cancel,
                emit_progress,
            )
            .map_err(|error| error.to_string())
        } else {
            separation::extract_track_to_directory(
                &input_path,
                &managed_output_root,
                mode,
                tuning,
                cleanup,
                &cancel,
                emit_progress,
            )
            .map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Abort the in-flight extraction (kills the Demucs child if one is running).
#[tauri::command]
pub fn cancel_extraction(state: tauri::State<'_, ExtractionState>) {
    state.cancel.cancel();
}

fn managed_working_root(app_data_dir: Option<&Path>) -> PathBuf {
    app_data_dir
        .map(Path::to_path_buf)
        .unwrap_or_else(|| env::temp_dir().join("yes-stems"))
        .join("working-stems")
        .join(timestamp_millis().to_string())
}

#[tauri::command]
pub async fn export_stems(request: ExportStemsRequest) -> Result<ExportStemsResult, String> {
    tauri::async_runtime::spawn_blocking(move || export_stems_to_directory(request))
        .await
        .map_err(|error| error.to_string())?
}

fn export_stems_to_directory(request: ExportStemsRequest) -> Result<ExportStemsResult, String> {
    if request.stems.is_empty() {
        return Err("nothing to export: no finished stem files are available".to_string());
    }

    let destination_root = PathBuf::from(&request.destination_root);
    let export_dir = audio_io::unique_output_dir(&destination_root, &request.source_name);
    fs::create_dir_all(&export_dir).map_err(|error| {
        format!(
            "could not create export folder {}: {error}",
            export_dir.display()
        )
    })?;

    let mut exported_files = 0;
    for stem in request.stems {
        let source = PathBuf::from(&stem.path);
        if !source.is_file() {
            return Err(format!("cannot export missing stem {}", source.display()));
        }

        let file_name = source
            .file_name()
            .ok_or_else(|| format!("cannot export stem with invalid path {}", source.display()))?;
        let target = export_dir.join(file_name);

        if same_file(&source, &target) {
            exported_files += 1;
            continue;
        }

        fs::copy(&source, &target).map_err(|error| {
            format!(
                "could not export {} to {}: {error}",
                source.display(),
                target.display()
            )
        })?;
        exported_files += 1;
    }

    Ok(ExportStemsResult {
        export_dir: export_dir.to_string_lossy().to_string(),
        exported_files,
    })
}

fn same_file(source: &Path, target: &Path) -> bool {
    match (fs::canonicalize(source), fs::canonicalize(target)) {
        (Ok(source), Ok(target)) => source == target,
        _ => false,
    }
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::StemFile;

    fn stem(path: &Path) -> StemFile {
        StemFile {
            name: "Vocals".to_string(),
            role: "test stem".to_string(),
            path: path.to_string_lossy().to_string(),
            frames: 1,
            peak: 0.5,
            bytes: 6,
        }
    }

    #[test]
    fn export_stems_copies_finished_wavs_to_sanitized_folder() {
        let temp = tempfile::tempdir().expect("temp dir");
        let source_dir = temp.path().join("source");
        let destination_root = temp.path().join("exports");
        fs::create_dir_all(&source_dir).expect("source dir");
        fs::create_dir_all(&destination_root).expect("destination dir");
        let vocals = source_dir.join("vocals.wav");
        let guitar = source_dir.join("guitar.wav");
        fs::write(&vocals, b"vocals").expect("vocals wav");
        fs::write(&guitar, b"guitar").expect("guitar wav");

        let result = export_stems_to_directory(ExportStemsRequest {
            source_name: "BILMURI \u{ff02} end".to_string(),
            destination_root: destination_root.to_string_lossy().to_string(),
            stems: vec![stem(&vocals), stem(&guitar)],
        })
        .expect("export stems");

        let export_dir = PathBuf::from(result.export_dir);
        assert_eq!(result.exported_files, 2);
        assert!(!export_dir.to_string_lossy().contains('\u{ff02}'));
        assert_eq!(
            fs::read(export_dir.join("vocals.wav")).expect("vocals"),
            b"vocals"
        );
        assert_eq!(
            fs::read(export_dir.join("guitar.wav")).expect("guitar"),
            b"guitar"
        );
    }

    #[test]
    fn export_stems_skips_files_already_in_the_export_folder() {
        let temp = tempfile::tempdir().expect("temp dir");
        let export_dir = temp.path().join("song");
        fs::create_dir_all(&export_dir).expect("export dir");
        let vocals = export_dir.join("vocals.wav");
        fs::write(&vocals, b"vocals").expect("vocals wav");

        let result = export_stems_to_directory(ExportStemsRequest {
            source_name: "song".to_string(),
            destination_root: temp.path().to_string_lossy().to_string(),
            stems: vec![stem(&vocals)],
        })
        .expect("export stems");

        assert_eq!(result.exported_files, 1);
        assert_eq!(PathBuf::from(result.export_dir), export_dir);
    }

    #[test]
    fn running_guard_blocks_reentry_then_resets_on_drop() {
        let state = ExtractionState::default();
        assert!(!state.running.load(Ordering::SeqCst));

        // First acquisition wins.
        assert!(
            state
                .running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        );
        {
            let _guard = RunningGuard(state.running.clone());
            // A concurrent attempt is rejected while the guard is alive.
            assert!(
                state
                    .running
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_err()
            );
        }

        // Dropping the guard frees the slot for the next run.
        assert!(!state.running.load(Ordering::SeqCst));
        assert!(
            state
                .running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        );
    }

    #[test]
    fn managed_working_root_is_not_user_destination() {
        let app_data = PathBuf::from("app-data");
        let root = managed_working_root(Some(&app_data));

        assert!(root.starts_with(app_data.join("working-stems")));
        assert_ne!(root, app_data.join("working-stems"));
    }
}
