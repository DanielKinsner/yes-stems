mod audio_io;
mod cancel;
mod commands;
mod ml_engine;
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
        .invoke_handler(tauri::generate_handler![
            commands::analyze_track,
            commands::check_local_ml_runtime,
            commands::extract_stems,
            commands::cancel_extraction,
            commands::export_stems
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
