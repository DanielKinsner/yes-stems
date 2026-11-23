# Changelog

All notable changes to YES Stems are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to adhere to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Global React `ErrorBoundary` with a "copy diagnostics" action, so a render crash no longer
  white-screens the window.
- Preference persistence (mode, cleanup toggle and strength, volume, last export folder) via
  `localStorage` on the desktop build.
- Keyboard shortcuts: Space (play/stop), Esc (stop playback / cancel extraction),
  Ctrl/⌘+O (open file), 1–4 (switch modes).
- Drag-and-drop of an audio file onto the window to load a source.
- Dismissible toasts; the export-success toast auto-clears.
- Cancellable extraction: a Stop button (and Esc) aborts a run — killing the Demucs child
  process mid-run — backed by a shared cancel token.
- Re-entrancy guard so a second extraction cannot start while one is already in flight.
- Seekable/draggable transport scrubber; a partial timeline selection is honored on audition.
- Real **Spectrum** and **Loudness** tabs (averaged magnitude spectrum + short-term RMS from
  `analyze_track`), replacing the placeholder visuals.
- Structured on-disk logging (`tracing`, rolling daily file in the OS app-log dir) and a
  monotonic `job_id` on every progress event.
- **Settings** panel (header gear): default export folder, open logs folder, reset preferences.
- Export **format** choice: 16-bit / 24-bit / 32-bit-float WAV, and lossless **FLAC**; 16-bit
  export uses TPDF dither.
- Hardened Content-Security-Policy (asset protocol + IPC only) in `tauri.conf.json`.
- Proprietary/commercial `LICENSE` and a `EULA.md` end-user agreement (template pending legal
  review); `Cargo.toml`/`package.json` marked proprietary and non-publishable.
- Bundle metadata (publisher, copyright, category, descriptions); GitHub Actions CI running the
  frontend + Rust verify lanes; a `version-bump` script; PRIVACY (with a network-call audit),
  NOTICE, CONTRIBUTING, SECURITY, and CODE_OF_CONDUCT docs.
- A fail-closed standalone-runtime contract that verifies the Demucs runner, manifest, declared
  checkpoints, and full SHA-256 model hashes before Windows packaging.
- Windows NSIS + MSI build wrappers with Authenticode hooks for both the app installers and
  bundled PE files, plus a genuinely ML-free classic-only bundle lane.
- Visible Local ML recovery actions (retry or switch to Classic DSP) and shared long-track
  pre-flight guidance before an extraction can allocate its working buffers.
- Keyboard-complete mode tabs and transport seeking, trapped/restored Settings focus, stronger
  low-emphasis contrast, reduced-motion handling, and forced-colors focus indicators.
- Release decision records for Windows signing and the unresolved commercial model-weight
  redistribution gate.

### Changed

- The workbench now matches the reference design 1:1 and runs at 1920×1080, using a
  fill-scaling 1440×820 design canvas that adapts to any window size.
- `Cargo.toml` package description updated to reflect the local ML + DSP positioning.
- Windows WebView2 bootstrap behavior and current-user NSIS installation are now explicit, and
  downgrade installation is disabled.
- Suite branding now shares YES Master's cobalt interaction palette, graphite workstation
  surfaces, compact section markers, and waveform wordmark while preserving YES Stems' teal
  signal layer, numbered extraction flow, and instrument colors.

### Fixed

- The fill-scaler no longer scales the app to zero (invisible) when the window briefly reports a
  0 size at startup.

## [0.1.0] - 2026-06-22

### Added

- Initial pre-release alpha: four extraction modes (Local ML 6-stem and 4-stem via a bundled
  Demucs sidecar, Classic Vocal + Instrumental, and Classic DSP Layers), 100% local/offline
  processing, per-stem solo/mute/audition, and export to a chosen folder.

[Unreleased]: https://github.com/DanielKinsner/yes-stems/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DanielKinsner/yes-stems/releases/tag/v0.1.0
