# YES Stems Product Canon

This is the active product source of truth for YES Stems.

YES Stems is a local desktop app for extracting stems from a finished music
track with offline/local processing. The app is for musicians and producers who
want private stem exports for remixing, practice, reference checks, rough
arrangement inspection, or sample prep.

## Core Promise

Drop in a track, choose a stem mode, run local extraction, inspect what was
written, and get WAV stem files without sending audio to a remote service or
frontier-model API.

The app should be honest about its ceiling. Local ML can produce true named stem
targets like vocals, drums, bass, guitar, piano, and other, but it still cannot
guarantee recovered studio multitracks. YES Stems must explain when guitar and
piano use the experimental Demucs 6-source path and must keep the classic DSP
layers labeled as utility layers.

Development builds can use a repo-local Demucs runtime installed with
`scripts/setup-demucs.ps1`. Windows standalone builds can stage and bundle a
PyInstaller Demucs sidecar plus the `htdemucs` and `htdemucs_6s` model weights
with `npm run build:windows:standalone`.

## Non-Goals

- No cloud processing.
- No API calls to frontier models or hosted source-separation services.
- No silent upload of user audio.
- No claim that full-band stems are equivalent to original multitracks.
- No bundled pretrained weights whose commercial/provenance status has not been
  reviewed.
- No human listening gate for completing implementation work.
- No destructive edits to the source file.

## Primary Workflow

1. Pick a source audio file.
2. Choose a mode:
   - `Local ML 6 Stems`
   - `Local ML 4 Stems`
   - `Classic Vocal + Instrumental`
   - `Classic DSP Layers`
3. For classic DSP modes, optionally adjust aggressiveness and artifact
   reduction before running extraction. Local ML modes keep these controls
   disabled because Demucs does not consume those product-level settings.
4. Optionally enable stem cleanup. Cleanup is off by default and is a real
   post-process across local ML and classic DSP stems: it removes DC offset,
   clamps non-finite samples, applies short edge fades, and softly reduces
   low-level bleed.
5. Run extraction with visible progress. Extraction writes to an app-managed
   working folder so the user does not need to choose an output destination up
   front.
6. Review the exported stem list, audition individual stems, play the rendered
   stems in sequence, and inspect method
   notes.
7. Export All asks for the user-facing output folder and copies the finished
   WAV stems there.

## Stem Modes

### Local ML 6 Stems

The app invokes a local Demucs `htdemucs_6s` runtime when available. This is the
main path for the user-facing promise of separate named instruments.

Exports:

- `vocals.wav`
- `drums.wav`
- `bass.wav`
- `guitar.wav`
- `piano.wav`
- `other.wav`

The guitar and piano heads are experimental and can bleed into each other or
into `other.wav` depending on the mix.

### Local ML 4 Stems

The app invokes the mature local Demucs `htdemucs` runtime when available.

Exports:

- `vocals.wav`
- `drums.wav`
- `bass.wav`
- `other.wav`

### Classic Vocal + Instrumental

The app estimates a vocal foreground from non-repeating, midrange-biased
spectral residual content and writes the complement as instrumental. This is
best treated as a deterministic fallback for songs with a relatively repeated
backing pattern under a lead vocal.

Exports:

- `vocals.wav`
- `instrumental.wav`

### Classic DSP Layers

The app uses harmonic/percussive/residual decomposition and frequency-aware
partitioning to write useful production layers.

Exports:

- `vocal_foreground.wav`
- `instrumental_sum.wav`
- `drums_percussion.wav`
- `bass_band.wav`
- `harmonic_bed.wav`
- `residual.wav`

## Quality Contract

Quality is evaluated with objective and mechanical checks:

- source can be decoded
- output folder is writable
- exported stems are finite PCM
- stems have the expected sample rate, channel count, and duration
- classic DSP partitions sum close to the input within tolerance
- optional stem cleanup preserves stem shape and produces finite PCM
- local ML modes report the exact files written by the local runtime
- UI progress and results reflect real backend work

Human listening can guide future tuning, but it does not gate completion.

## UX Contract

YES Stems should feel like focused pro-audio software, not a generic SaaS
dashboard. The primary screen should keep setup, analysis, processing, and
results visible as one workstation so producers can understand the extraction
state at a glance.

Every visible control must either perform real work or be visibly unavailable
with honest copy. The current timeline renders audio-derived peak buckets from
source analysis and supports a simple source-duration selection readout; it is
not a decorative static waveform.

## Deferred

- Bundle-size optimization and sidecar hardening.
- Commercial licensing/provenance review for bundled pretrained weights.
- ONNX/Core ML runtime exploration for a leaner native inference path.
- GPU acceleration and device auto-detection.
- Batch queues.
- Cancellable/pausable extraction workers and richer transport controls.
- Advanced user controls for STFT window, hop, mask sharpness, and filter spans.
- Manual cleanup profiles beyond the current deterministic cleanup strength.
- Signing, notarization, autoupdate, and model download/signature management.
