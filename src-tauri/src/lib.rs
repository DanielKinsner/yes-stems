mod audio_io;
mod cancel;
mod commands;
mod ml_engine;
mod preflight;
mod separation;
mod stem_cleanup;
mod types;

pub use types::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::ExtractionState::default())
        .setup(|app| {
            init_logging(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::analyze_track,
            commands::check_local_ml_runtime,
            commands::extract_stems,
            commands::cancel_extraction,
            commands::log_directory,
            commands::export_stems
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Initialize a rolling on-disk log under the OS app-log directory. Best-effort: logging
/// failures never block app startup. Level is `info` by default, overridable via `RUST_LOG`.
fn init_logging(app: &tauri::App) {
    use tauri::Manager;

    let Ok(log_dir) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }

    let file_appender = tracing_appender::rolling::daily(&log_dir, "yes-stems.log");
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_writer(file_appender)
        .with_ansi(false)
        .with_env_filter(filter)
        .try_init();

    tracing::info!(dir = %log_dir.display(), "YES Stems logging started");
}
