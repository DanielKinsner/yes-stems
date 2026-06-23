# Architecture

YES Stems is a Tauri desktop app with a React/TypeScript frontend and a Rust
audio backend.

## Frontend

- `src/App.tsx` composes the extraction workspace.
- `src/App.css` owns the design system and responsive layout.
- The UI uses native Tauri dialogs to choose the input file and output folder.
- The UI invokes Rust commands for source analysis and extraction.
- Backend progress is emitted as `stems://progress` events.

## Rust Backend

- `src-tauri/src/audio_io.rs` decodes audio and writes WAV stems.
- `src-tauri/src/separation.rs` owns STFT, masks, reconstruction, and reports.
- `src-tauri/src/commands.rs` exposes Tauri commands.
- `src-tauri/src/types.rs` defines shared request/response contracts.

## Signal Flow

1. Decode source audio with Symphonia.
2. Normalize to finite `f32` PCM, preserving source channels.
3. Compute a Hann-window STFT with 2048-sample frames and 512-sample hop.
4. Estimate masks from channel-averaged magnitudes.
5. Apply masks to each channel's original complex spectrum.
6. Reconstruct stems by inverse FFT and overlap-add.
7. Write 24-bit WAV files with source sample rate and channel count.
8. Return a report with duration, stem paths, method notes, and reconstruction
   error.

## Product Honesty

The backend exports useful layers rather than pretending to recover original
multitracks. The UI and docs must keep that language intact.

## Verification Lanes

- `npm run verify:frontend`
- `npm run verify:rust`
- `npm run verify:fast`
- `npm run build:windows`

`build:windows` is a packaging lane and may require platform bundling
dependencies. It should be run before treating a binary release as ready.
