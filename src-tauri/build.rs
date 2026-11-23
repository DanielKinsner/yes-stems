use std::{env, fs, path::PathBuf};

const REQUIRED_RUNTIME_FILES: &[&str] = &[
    "demucs.exe",
    "manifest.json",
    "torch-cache/hub/checkpoints/955717e8-8726e21a.th",
    "torch-cache/hub/checkpoints/5c90dfd2-34c22ccb.th",
];

fn main() {
    println!("cargo:rerun-if-env-changed=YES_STEMS_ALLOW_CLASSIC_ONLY_BUNDLE");
    verify_release_runtime();
    tauri_build::build()
}

fn verify_release_runtime() {
    if env::var("PROFILE").as_deref() != Ok("release") {
        return;
    }

    if env::var("YES_STEMS_ALLOW_CLASSIC_ONLY_BUNDLE").as_deref() == Ok("1") {
        println!(
            "cargo:warning=building an explicit classic-only bundle without enforcing the local ML runtime"
        );
        return;
    }

    let manifest_dir = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("Cargo must define CARGO_MANIFEST_DIR"),
    );
    let runtime_dir = manifest_dir.join("resources/demucs-runtime");
    let mut missing = Vec::new();

    for relative in REQUIRED_RUNTIME_FILES {
        let path = runtime_dir.join(relative);
        println!("cargo:rerun-if-changed={}", path.display());
        match fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() && metadata.len() > 0 => {}
            _ => missing.push(relative.to_string()),
        }
    }

    if !missing.is_empty() {
        panic!(
            "refusing to build a release bundle without the standalone Demucs runtime; missing: {}. Run `npm run build:demucs-sidecar`, or set YES_STEMS_ALLOW_CLASSIC_ONLY_BUNDLE=1 only for an intentional classic-DSP-only build",
            missing.join(", ")
        );
    }
}
