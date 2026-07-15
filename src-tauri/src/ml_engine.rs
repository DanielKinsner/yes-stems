use std::{
    env,
    ffi::OsString,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use thiserror::Error;

use crate::{
    audio_io::{self, AudioIoError},
    cancel::CancelToken,
    stem_cleanup,
    types::{
        ExtractionReport, LocalMlStatus, StemCleanupOptions, StemFile, StemMode, TrackAnalysis,
    },
};

#[derive(Debug, Error)]
pub enum MlEngineError {
    #[error(transparent)]
    Audio(#[from] AudioIoError),
    #[error("could not prepare local ML output directory: {0}")]
    OutputDirectory(std::io::Error),
    #[error("could not prepare local ML input for Demucs: {0}")]
    DemucsInput(std::io::Error),
    #[error(
        "local ML extraction requires Demucs. Tried {0}. Install the bundled runtime, use the repo-local .venv-demucs runtime, install Demucs on PATH, run through python -m demucs, or set YES_STEMS_DEMUCS to an executable path."
    )]
    RuntimeUnavailable(String),
    #[error(
        "Demucs failed via {runner} with exit code {code:?}\nstdout:\n{stdout}\nstderr:\n{stderr}"
    )]
    RuntimeFailed {
        runner: String,
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
    #[error("Demucs did not write expected stem {stem} ({filename}) under {root}")]
    MissingStem {
        stem: &'static str,
        filename: &'static str,
        root: String,
    },
    #[error("could not copy local ML stem: {0}")]
    CopyStem(std::io::Error),
    #[error(
        "local ML stem {stem} shape mismatch: expected {expected_sample_rate} Hz, {expected_channels} ch, {expected_frames} frames; got {actual_sample_rate} Hz, {actual_channels} ch, {actual_frames} frames"
    )]
    StemShapeMismatch {
        stem: String,
        expected_sample_rate: u32,
        actual_sample_rate: u32,
        expected_channels: usize,
        actual_channels: usize,
        expected_frames: usize,
        actual_frames: usize,
    },
    #[error("mode {0:?} is not a local ML mode")]
    UnsupportedMode(StemMode),
    #[error("{0}")]
    TrackTooLong(String),
    #[error("extraction was cancelled")]
    Cancelled,
}

#[derive(Debug, Clone)]
struct MlStemSpec {
    name: &'static str,
    role: &'static str,
    filename: &'static str,
}

#[derive(Debug, Clone)]
struct DemucsRunner {
    program: OsString,
    args_prefix: Vec<OsString>,
    envs: Vec<(OsString, OsString)>,
    label: String,
}

#[derive(Debug)]
struct DemucsWorkspace {
    root: PathBuf,
    input_path: PathBuf,
    output_dir: PathBuf,
}

impl Drop for DemucsWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub fn extract_track_to_directory<F>(
    input_path: &Path,
    output_root: &Path,
    mode: StemMode,
    resource_dir: Option<PathBuf>,
    cleanup: StemCleanupOptions,
    cancel: &CancelToken,
    mut progress: F,
) -> Result<ExtractionReport, MlEngineError>
where
    F: FnMut(&str, f32, String),
{
    let model = mode
        .demucs_model()
        .ok_or(MlEngineError::UnsupportedMode(mode))?;
    let stems = stem_plan(mode)?;
    let cleanup = cleanup.clamped();
    let source_name = audio_io::file_name(input_path);
    let analysis = audio_io::analyze_track(input_path)?;
    // Pre-flight OOM guard: refuse tracks past the hard duration cap before handing the whole
    // file to the Demucs subprocess (which would spike memory on a long track); warn on the heavy
    // band. See preflight.rs.
    match crate::preflight::preflight(analysis.duration_seconds) {
        crate::preflight::PreflightVerdict::Reject(message) => {
            return Err(MlEngineError::TrackTooLong(message));
        }
        crate::preflight::PreflightVerdict::Warn(message) => {
            tracing::warn!(%message, "local ML separation pre-flight warning");
        }
        crate::preflight::PreflightVerdict::Ok => {}
    }
    let output_dir = audio_io::unique_output_dir(output_root, &source_name);
    fs::create_dir_all(&output_dir).map_err(MlEngineError::OutputDirectory)?;

    let demucs_workspace = prepare_demucs_workspace(input_path)?;

    if cancel.is_cancelled() {
        return Err(MlEngineError::Cancelled);
    }
    progress(
        "ml-ready",
        0.08,
        format!("starting local Demucs model {model}"),
    );
    let output = run_demucs(
        model,
        &demucs_workspace.input_path,
        &demucs_workspace.output_dir,
        resource_dir.as_deref(),
        cancel,
    )?;
    if cancel.is_cancelled() {
        return Err(MlEngineError::Cancelled);
    }
    if !output.status.success() {
        return Err(MlEngineError::RuntimeFailed {
            runner: output.runner,
            code: output.status.code(),
            stdout: output.stdout,
            stderr: output.stderr,
        });
    }

    progress("export", 0.72, "collecting local ML stem files".to_string());
    let mut stem_files = Vec::with_capacity(stems.len());
    for stem in stems {
        let source =
            find_file_named(&demucs_workspace.output_dir, stem.filename).ok_or_else(|| {
                MlEngineError::MissingStem {
                    stem: stem.name,
                    filename: stem.filename,
                    root: demucs_workspace.output_dir.to_string_lossy().to_string(),
                }
            })?;
        let target = output_dir.join(stem.filename);
        let mut audio = audio_io::decode_audio(&source)?;
        if cleanup.is_active() {
            stem_cleanup::cleanup_samples(&mut audio.samples, audio.sample_rate, cleanup);
            audio_io::write_wav(&target, audio.sample_rate, &audio.samples)?;
        } else {
            fs::copy(&source, &target).map_err(MlEngineError::CopyStem)?;
        }
        audio = audio_io::decode_audio(&target)?;
        validate_stem_shape(&audio, &analysis, stem.name)?;
        let bytes = fs::metadata(&target).map(|meta| meta.len()).unwrap_or(0);
        stem_files.push(StemFile {
            name: stem.name.to_string(),
            role: stem.role.to_string(),
            path: target.to_string_lossy().to_string(),
            frames: audio.frames(),
            peak: audio.peak(),
            bytes,
        });
    }

    progress(
        "complete",
        1.0,
        "local ML stem extraction complete".to_string(),
    );
    Ok(ExtractionReport {
        source_name,
        mode,
        mode_label: mode.as_label().to_string(),
        output_dir: output_dir.to_string_lossy().to_string(),
        sample_rate: analysis.sample_rate,
        channels: analysis.channels,
        frames: analysis.frames,
        duration_seconds: analysis.duration_seconds,
        stems: stem_files,
        method_notes: method_notes(mode, model, cleanup),
        reconstruction_error: -1.0,
    })
}

fn validate_stem_shape(
    audio: &audio_io::AudioBuffer,
    analysis: &TrackAnalysis,
    stem: &str,
) -> Result<(), MlEngineError> {
    if audio.sample_rate == analysis.sample_rate
        && audio.channels == analysis.channels
        && audio.frames() == analysis.frames
    {
        return Ok(());
    }

    Err(MlEngineError::StemShapeMismatch {
        stem: stem.to_string(),
        expected_sample_rate: analysis.sample_rate,
        actual_sample_rate: audio.sample_rate,
        expected_channels: analysis.channels,
        actual_channels: audio.channels,
        expected_frames: analysis.frames,
        actual_frames: audio.frames(),
    })
}

fn prepare_demucs_workspace(input_path: &Path) -> Result<DemucsWorkspace, MlEngineError> {
    let root = create_demucs_workspace_root()?;
    let input_dir = root.join("input");
    let output_dir = root.join("out");
    let result = (|| {
        fs::create_dir_all(&input_dir).map_err(MlEngineError::OutputDirectory)?;
        fs::create_dir_all(&output_dir).map_err(MlEngineError::OutputDirectory)?;
        let demucs_input_path = input_dir.join(demucs_input_filename(input_path));
        fs::copy(input_path, &demucs_input_path).map_err(MlEngineError::DemucsInput)?;
        Ok(DemucsWorkspace {
            root: root.clone(),
            input_path: demucs_input_path,
            output_dir,
        })
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&root);
    }

    result
}

fn create_demucs_workspace_root() -> Result<PathBuf, MlEngineError> {
    let base = env::temp_dir();
    for attempt in 0..1000 {
        let candidate = base.join(format!(
            "yes-stems-demucs-{}-{}-{attempt}",
            std::process::id(),
            timestamp_millis()
        ));
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(MlEngineError::OutputDirectory(error)),
        }
    }

    Err(MlEngineError::OutputDirectory(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not create unique Demucs workspace",
    )))
}

fn demucs_input_filename(input_path: &Path) -> String {
    let extension = input_path
        .extension()
        .and_then(|value| value.to_str())
        .map(ascii_alphanumeric_prefix)
        .unwrap_or_default();

    if extension.is_empty() {
        "source".to_string()
    } else {
        format!("source.{extension}")
    }
}

fn ascii_alphanumeric_prefix(value: &str) -> String {
    value
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(16)
        .collect()
}

pub fn check_runtime(resource_dir: Option<PathBuf>) -> LocalMlStatus {
    let device = demucs_device();
    let mut checked = Vec::new();

    for runner in demucs_runners(resource_dir.as_deref()) {
        checked.push(runner.label.clone());
        match probe_runner(&runner) {
            Ok(output) if output.status.success() => {
                return LocalMlStatus {
                    available: true,
                    runner: Some(runner.label),
                    device,
                    checked,
                    detail: "Demucs runtime is available locally.".to_string(),
                };
            }
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => continue,
        }
    }

    LocalMlStatus {
        available: false,
        runner: None,
        device,
        checked,
        detail: "Demucs is not available locally. Install the bundled runtime, use the repo-local .venv-demucs runtime, install Demucs on PATH, use python -m demucs, or set YES_STEMS_DEMUCS to an executable path.".to_string(),
    }
}

struct DemucsOutput {
    status: std::process::ExitStatus,
    stdout: String,
    stderr: String,
    runner: String,
}

fn run_demucs(
    model: &str,
    input_path: &Path,
    work_dir: &Path,
    resource_dir: Option<&Path>,
    cancel: &CancelToken,
) -> Result<DemucsOutput, MlEngineError> {
    let device = demucs_device();
    let runner = resolve_demucs_runner(resource_dir)?;
    match invoke_demucs(&runner, model, &device, input_path, work_dir, cancel) {
        Ok(output) => Ok(DemucsOutput {
            status: output.status,
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            runner: runner.label,
        }),
        Err(error) => Err(MlEngineError::RuntimeFailed {
            runner: runner.label,
            code: None,
            stdout: String::new(),
            stderr: error.to_string(),
        }),
    }
}

fn resolve_demucs_runner(resource_dir: Option<&Path>) -> Result<DemucsRunner, MlEngineError> {
    let mut attempted = Vec::new();

    for runner in demucs_runners(resource_dir) {
        attempted.push(runner.label.clone());
        match probe_runner(&runner) {
            Ok(output) if output.status.success() => return Ok(runner),
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => continue,
        }
    }

    Err(MlEngineError::RuntimeUnavailable(attempted.join(", ")))
}

fn demucs_device() -> String {
    env::var("YES_STEMS_DEMUCS_DEVICE").unwrap_or_else(|_| "cpu".to_string())
}

fn probe_runner(runner: &DemucsRunner) -> std::io::Result<Output> {
    let mut command = Command::new(&runner.program);
    command.envs(runner.envs.iter().cloned());
    command.args(&runner.args_prefix).arg("--help");
    command.output()
}

fn invoke_demucs(
    runner: &DemucsRunner,
    model: &str,
    device: &str,
    input_path: &Path,
    work_dir: &Path,
    cancel: &CancelToken,
) -> std::io::Result<Output> {
    let mut command = Command::new(&runner.program);
    command.envs(runner.envs.iter().cloned());
    command.args(&runner.args_prefix);
    command
        .arg("-n")
        .arg(model)
        .arg("-d")
        .arg(device)
        .arg("--int24")
        .arg("-o")
        .arg(work_dir)
        .arg(input_path);
    run_child_with_cancel(command, cancel)
}

/// Run a child process to completion while remaining cancellable: the child is registered
/// with the [`CancelToken`] so a Stop from the UI can kill it, and its stdout/stderr are
/// drained on background threads so a long run cannot deadlock on a full pipe buffer.
fn run_child_with_cancel(mut command: Command, cancel: &CancelToken) -> std::io::Result<Output> {
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    let mut child = command.spawn()?;

    let stdout_thread = child.stdout.take().map(spawn_drain);
    let stderr_thread = child.stderr.take().map(spawn_drain);

    cancel.register_child(child);

    let status = loop {
        if let Some(status) = cancel.poll_child()? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(80));
    };

    let stdout = stdout_thread
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr_thread
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn spawn_drain<R: Read + Send + 'static>(mut reader: R) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = reader.read_to_end(&mut buffer);
        buffer
    })
}

fn demucs_runners(resource_dir: Option<&Path>) -> Vec<DemucsRunner> {
    let mut runners = Vec::new();
    if let Some(path) = env::var_os("YES_STEMS_DEMUCS") {
        runners.push(DemucsRunner {
            label: format!("YES_STEMS_DEMUCS={}", path.to_string_lossy()),
            program: path,
            args_prefix: Vec::new(),
            envs: demucs_process_envs(),
        });
    }
    runners.extend(bundled_demucs_runners(resource_dir));
    for path in local_demucs_candidates() {
        runners.push(DemucsRunner {
            label: format!("local venv {}", path.display()),
            program: path.into_os_string(),
            args_prefix: Vec::new(),
            envs: demucs_process_envs(),
        });
    }
    runners.push(DemucsRunner {
        program: OsString::from("demucs"),
        args_prefix: Vec::new(),
        envs: demucs_process_envs(),
        label: "demucs".to_string(),
    });
    runners.push(DemucsRunner {
        program: OsString::from("python"),
        args_prefix: vec![OsString::from("-m"), OsString::from("demucs")],
        envs: demucs_process_envs(),
        label: "python -m demucs".to_string(),
    });
    runners.push(DemucsRunner {
        program: OsString::from("py"),
        args_prefix: vec![OsString::from("-m"), OsString::from("demucs")],
        envs: demucs_process_envs(),
        label: "py -m demucs".to_string(),
    });
    runners
}

fn demucs_process_envs() -> Vec<(OsString, OsString)> {
    vec![
        (OsString::from("PYTHONUTF8"), OsString::from("1")),
        (OsString::from("PYTHONIOENCODING"), OsString::from("utf-8")),
    ]
}

fn bundled_demucs_runners(resource_dir: Option<&Path>) -> Vec<DemucsRunner> {
    let Some(resource_dir) = resource_dir else {
        return Vec::new();
    };
    let root = resource_dir.join("demucs-runtime");
    let torch_home = root.join("torch-cache");
    let mut envs = demucs_process_envs();
    if torch_home.exists() {
        envs.push((OsString::from("TORCH_HOME"), torch_home.into_os_string()));
    }

    bundled_demucs_candidates(&root)
        .into_iter()
        .map(|path| DemucsRunner {
            label: format!("bundled Demucs {}", path.display()),
            program: path.into_os_string(),
            args_prefix: Vec::new(),
            envs: envs.clone(),
        })
        .collect()
}

fn bundled_demucs_candidates(root: &Path) -> Vec<PathBuf> {
    [
        root.join("demucs.exe"),
        root.join("Scripts").join("demucs.exe"),
        root.join("bin").join("demucs"),
    ]
    .into_iter()
    .filter(|path| path.exists())
    .collect()
}

fn local_demucs_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(
            current_dir
                .join(".venv-demucs")
                .join("Scripts")
                .join("demucs.exe"),
        );
        candidates.push(current_dir.join(".venv-demucs").join("bin").join("demucs"));
    }
    candidates
        .into_iter()
        .filter(|path| path.exists())
        .collect()
}

fn stem_plan(mode: StemMode) -> Result<Vec<MlStemSpec>, MlEngineError> {
    let stems = match mode {
        StemMode::LocalMlFour => vec![
            MlStemSpec {
                name: "Vocals",
                role: "Demucs vocal stem from local offline model inference.",
                filename: "vocals.wav",
            },
            MlStemSpec {
                name: "Drums",
                role: "Demucs drum stem from local offline model inference.",
                filename: "drums.wav",
            },
            MlStemSpec {
                name: "Bass",
                role: "Demucs bass stem from local offline model inference.",
                filename: "bass.wav",
            },
            MlStemSpec {
                name: "Other",
                role: "Remaining accompaniment outside vocals, drums, and bass.",
                filename: "other.wav",
            },
        ],
        StemMode::LocalMlSix => vec![
            MlStemSpec {
                name: "Vocals",
                role: "Demucs vocal stem from local offline model inference.",
                filename: "vocals.wav",
            },
            MlStemSpec {
                name: "Drums",
                role: "Demucs drum stem from local offline model inference.",
                filename: "drums.wav",
            },
            MlStemSpec {
                name: "Bass",
                role: "Demucs bass stem from local offline model inference.",
                filename: "bass.wav",
            },
            MlStemSpec {
                name: "Guitar",
                role: "Experimental Demucs guitar stem.",
                filename: "guitar.wav",
            },
            MlStemSpec {
                name: "Piano",
                role: "Experimental Demucs piano stem; expect bleed on some mixes.",
                filename: "piano.wav",
            },
            MlStemSpec {
                name: "Other",
                role: "Remaining accompaniment outside named local ML stems.",
                filename: "other.wav",
            },
        ],
        _ => return Err(MlEngineError::UnsupportedMode(mode)),
    };
    Ok(stems)
}

fn method_notes(mode: StemMode, model: &str, cleanup: StemCleanupOptions) -> Vec<String> {
    let mut notes = vec![
        format!("Local Demucs model inference ({model}); no cloud or API calls."),
        "Runs through a local executable or Python module; future builds can swap this boundary for ONNX/Core ML.".to_string(),
        "Model weights may be cached on first use by the local Demucs runtime.".to_string(),
    ];
    if mode == StemMode::LocalMlSix {
        notes.push(
            "The 6-stem model adds guitar and piano, but Demucs documents piano as artifact-prone."
                .to_string(),
        );
    }
    if let Some(note) = stem_cleanup::method_note(cleanup) {
        notes.push(note);
    }
    notes
}

fn find_file_named(root: &Path, filename: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, filename) {
                return Some(found);
            }
        } else if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(filename))
        {
            return Some(path);
        }
    }
    None
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_stem_plan_matches_demucs_default_outputs() {
        let stems = stem_plan(StemMode::LocalMlFour).expect("plan");
        let filenames = stems.iter().map(|stem| stem.filename).collect::<Vec<_>>();

        assert_eq!(
            filenames,
            vec!["vocals.wav", "drums.wav", "bass.wav", "other.wav"]
        );
    }

    #[test]
    fn six_stem_plan_includes_guitar_and_piano() {
        let stems = stem_plan(StemMode::LocalMlSix).expect("plan");
        let filenames = stems.iter().map(|stem| stem.filename).collect::<Vec<_>>();

        assert!(filenames.contains(&"guitar.wav"));
        assert!(filenames.contains(&"piano.wav"));
        assert_eq!(stems.len(), 6);
    }

    #[test]
    fn runtime_status_reports_attempted_runners() {
        let status = check_runtime(None);

        assert!(!status.checked.is_empty());
        assert_eq!(status.device, "cpu");
    }

    #[test]
    fn local_demucs_candidates_do_not_include_missing_paths() {
        assert!(
            local_demucs_candidates()
                .iter()
                .all(|candidate| candidate.exists())
        );
    }

    #[test]
    fn bundled_runner_sets_torch_home_when_model_cache_exists() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let runtime_dir = temp_dir.path().join("demucs-runtime");
        let cache_dir = runtime_dir.join("torch-cache");
        fs::create_dir_all(&cache_dir).expect("cache dir");
        let demucs_exe = runtime_dir.join("demucs.exe");
        fs::write(&demucs_exe, b"").expect("placeholder exe");

        let runners = demucs_runners(Some(temp_dir.path()));
        let bundled = runners
            .iter()
            .find(|runner| runner.label.starts_with("bundled Demucs"))
            .expect("bundled runner");

        assert_eq!(bundled.program, demucs_exe.into_os_string());
        assert!(
            bundled
                .envs
                .contains(&(OsString::from("TORCH_HOME"), cache_dir.into_os_string()))
        );
    }

    #[test]
    fn demucs_runners_force_utf8_python_stdio() {
        let runners = demucs_runners(None);

        for runner in runners {
            assert!(
                runner
                    .envs
                    .contains(&(OsString::from("PYTHONUTF8"), OsString::from("1")))
            );
            assert!(
                runner
                    .envs
                    .contains(&(OsString::from("PYTHONIOENCODING"), OsString::from("utf-8")))
            );
        }
    }

    #[test]
    fn demucs_workspace_hides_non_ascii_source_names_from_runner() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let input_path = temp_dir.path().join("song\u{ff02}title.wav");
        fs::write(&input_path, b"fake audio bytes").expect("input");

        let workspace = prepare_demucs_workspace(&input_path).expect("workspace");

        assert_eq!(
            workspace
                .input_path
                .file_name()
                .and_then(|name| name.to_str()),
            Some("source.wav")
        );
        assert!(!workspace.input_path.to_string_lossy().contains('\u{ff02}'));
        assert!(!workspace.output_dir.to_string_lossy().contains('\u{ff02}'));
        assert_eq!(
            fs::read(&workspace.input_path).expect("copied input"),
            b"fake audio bytes"
        );
    }

    #[test]
    fn local_ml_method_notes_include_cleanup_when_enabled() {
        let notes = method_notes(
            StemMode::LocalMlSix,
            "htdemucs_6s",
            StemCleanupOptions {
                enabled: true,
                strength: 7,
            },
        );

        assert!(
            notes
                .iter()
                .any(|note| note.contains("Stem cleanup applied at strength 7"))
        );
    }

    #[test]
    fn validates_local_ml_stem_shape_against_source_analysis() {
        let analysis = TrackAnalysis {
            file_name: "song".to_string(),
            sample_rate: 44_100,
            channels: 2,
            frames: 100,
            duration_seconds: 100.0 / 44_100.0,
            peak: 0.5,
            waveform_peaks: vec![0.5],
            spectrum: vec![0.5],
            loudness: vec![0.5],
        };
        let audio = audio_io::AudioBuffer {
            sample_rate: 48_000,
            channels: 2,
            samples: vec![vec![0.0; 100], vec![0.0; 100]],
        };

        let result = validate_stem_shape(&audio, &analysis, "Vocals");

        assert!(matches!(
            result,
            Err(MlEngineError::StemShapeMismatch { stem, .. }) if stem == "Vocals"
        ));
    }
}
