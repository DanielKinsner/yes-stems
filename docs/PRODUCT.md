# YES Stems Product Canon

This is the active product source of truth for YES Stems.

YES Stems is a local desktop app for extracting useful non-AI stems from a
finished music track. The app is for musicians and producers who want offline
utility stems for remixing, practice, reference checks, rough arrangement
inspection, or sample prep.

## Core Promise

Drop in a track, choose a stem mode, run local extraction, inspect what was
written, and get WAV stem files without sending audio to an AI model or remote
service.

The app should be honest about its ceiling. Classical DSP can separate stable
musical structures into useful layers, but it cannot guarantee perfectly clean
instrument isolation from a finished mix. YES Stems must prefer grounded labels
like `harmonic bed`, `drums/percussion`, `bass band`, and `residual` over
overpromising exact guitar, piano, kick, snare, or lead-vocal perfection.

## Non-Goals

- No AI/model-based source separation.
- No cloud processing.
- No claim that full-band stems are equivalent to original multitracks.
- No human listening gate for completing implementation work.
- No destructive edits to the source file.

## Primary Workflow

1. Pick a source audio file.
2. Pick an output folder.
3. Choose a mode:
   - `Vocal + Instrumental`
   - `Full Band Layers`
4. Run extraction with visible progress.
5. Review the exported stem list and method notes.
6. Open the output folder.

## Stem Modes

### Vocal + Instrumental

The app estimates a vocal foreground from non-repeating, midrange-biased
spectral residual content and writes the complement as instrumental. This is
best for songs with a relatively repeated backing pattern under a lead vocal.

Exports:

- `vocals.wav`
- `instrumental.wav`

### Full Band Layers

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
- the primary partition sums close to the input within tolerance
- UI progress and results reflect real backend work

Human listening can guide future tuning, but it does not gate completion.

## Deferred

- GPU acceleration.
- Batch queues.
- Stem audition playback inside the app.
- Advanced user controls for STFT window, hop, mask sharpness, and filter spans.
- Native installers, signing, notarization, and autoupdate.
