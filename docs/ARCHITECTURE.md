# Architecture

YES Stems is a Tauri desktop app with a React/TypeScript frontend, a Rust
orchestration backend, a classic DSP engine, and a local ML runner boundary.

## Frontend

- `src/App.tsx` composes the extraction workspace.
- `src/App.css` owns the design system and responsive layout.
- The UI uses native Tauri dialogs to choose the input file and, after
  extraction, the export destination.
- The UI invokes Rust commands for source analysis and extraction.
- Backend progress is emitted as `stems://progress` events.
- Source analysis returns compact waveform peak buckets for the interactive
  overview/selection surface. The overview is audio-derived, while the
  spectrogram remains a non-interactive visual context panel.
- Advanced aggressiveness/artifact-reduction controls are enabled only for
  classic DSP modes. Local ML modes disable them because the Demucs boundary
  does not safely consume those product-level controls.
- The desktop workspace is optimized for `1280x800` with a `1120x720`
  minimum window so the setup rail, analysis stage, processing console, and
  results rack remain visible together.

## Rust Backend

- `src-tauri/src/audio_io.rs` decodes audio and writes WAV stems.
- `src-tauri/src/separation.rs` owns classic STFT masks, reconstruction, and
  reports.
- `src-tauri/src/ml_engine.rs` owns the local Demucs invocation boundary and
  collects emitted stem files.
- `src-tauri/src/commands.rs` exposes Tauri commands.
- `src-tauri/src/types.rs` defines shared request/response contracts.

## Local ML Signal Flow

1. Decode source metadata locally for report consistency.
2. Create an app-managed working output directory for the selected track.
3. Invoke a local Demucs runtime:
   - `Local ML 4 Stems` -> `htdemucs`
   - `Local ML 6 Stems` -> `htdemucs_6s`
4. Search the Demucs work directory for the expected WAV stems.
5. Copy stems into the app-managed working output directory.
6. Decode the written stems locally to report frames, peaks, and paths.
7. Return a report with method notes and `reconstruction_error = -1.0` to mark
   model output rather than a classic mask partition diagnostic.

Runtime selection:

- `YES_STEMS_DEMUCS` can point at a bundled or manually installed Demucs
  executable.
- If no override is present, the backend checks the bundled resource runtime at
  `demucs-runtime\demucs.exe`, then the repo-local dev runtime at
  `.venv-demucs\Scripts\demucs.exe` on Windows or `.venv-demucs/bin/demucs` on
  Unix-like systems.
- `YES_STEMS_DEMUCS_DEVICE` defaults to `cpu` and can be set to a Demucs device
  value such as `cuda` when the local runtime supports it.
- After the bundled and repo-local runtimes, the backend tries `demucs`,
  `python -m demucs`,
  then `py -m demucs`.

Verified runtime staging:

- `.venv-demucs/` is ignored by git and can be recreated with
  `scripts/setup-demucs.ps1`.
- `requirements-demucs.txt` pins `demucs==4.0.1`, `torch==2.5.1`,
  `torchaudio==2.5.1`, and `soundfile==0.14.0`.
- `soundfile` provides the WAV writer backend for the pinned torchaudio stack.
  Newer torchaudio releases may require TorchCodec plus shared FFmpeg DLLs on
  Windows and should be revalidated before changing the pin.
- `scripts/build-demucs-sidecar.ps1` uses PyInstaller to build a standalone
  `demucs.exe` sidecar from the pinned venv, stages it into
  `src-tauri/resources/demucs-runtime/`, and stages the `htdemucs` and
  `htdemucs_6s` weights into `torch-cache/hub/checkpoints`.
- The Tauri bundle maps `src-tauri/resources/demucs-runtime/` to the installed
  resource directory as `demucs-runtime/`.

Packaging seam:

- The current Windows standalone path packages a PyInstaller sidecar and model
  weights. Future optimization work should reduce bundle size, review bundled
  weight licensing/provenance for commercial distribution, and consider ONNX
  Runtime/Core ML for a leaner native inference path.

## Classic DSP Signal Flow

1. Decode source audio with Symphonia.
2. Normalize to finite `f32` PCM, preserving source channels.
3. Compute a Hann-window STFT with 2048-sample frames and 512-sample hop.
4. Estimate masks from channel-averaged magnitudes.
5. Apply bounded DSP tuning:
   - aggressiveness biases foreground/percussive/harmonic masks more strongly
   - artifact reduction clamps and smooths masks to trade isolation for fewer
     rough mask edges
6. Apply masks to each channel's original complex spectrum.
7. Reconstruct stems by inverse FFT and overlap-add.
8. Write 24-bit WAV files with source sample rate and channel count into the
   app-managed working output directory.
9. Return a report with duration, stem paths, method notes, and reconstruction
   error.

## Product Honesty

Local ML modes export named model targets, not guaranteed studio multitracks.
Classic DSP modes export useful layers rather than exact instrument stems. The
UI and docs must keep both distinctions intact.

## Verification Lanes

- `npm run verify:frontend`
- `npm run verify:rust`
- `npm run verify:fast`
- `npm run verify:screenshot`
- `npm run build:windows`
- `npm run build:windows:standalone`

`build:windows:standalone` stages the Demucs sidecar and model weights before
running the Tauri packaging lane. It should be run before treating a local-ML
Windows binary release as ready.
