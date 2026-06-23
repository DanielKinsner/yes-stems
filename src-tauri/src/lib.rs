mod audio_io;
mod commands;
mod ml_engine;
mod separation;
mod types;

pub use types::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::analyze_track,
            commands::check_local_ml_runtime,
            commands::extract_stems
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
