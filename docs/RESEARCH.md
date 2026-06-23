# Stem Extraction Research

## Executive Summary

The clarified product target is local/offline ML stem extraction, not hosted API
calls to frontier models. The most practical first implementation is a Demucs
runner boundary because Demucs is mature, local, and supports both 4-stem
vocals/drums/bass/other extraction and an experimental 6-stem model with guitar
and piano.

Implementation note: the current checkout uses a pinned Demucs environment
(`demucs==4.0.1`, `torch==2.5.1`, `torchaudio==2.5.1`, `soundfile==0.14.0`)
rather than a cloud service. Windows standalone builds can package that stack as
a PyInstaller sidecar with the `htdemucs` and `htdemucs_6s` model weights.

The classic DSP engine remains valuable as a deterministic fallback and as a
small, inspectable baseline, but it should not be the main product promise for
separate piano/guitar/bass/drum/vocal outputs.

## Local ML Findings

- Demucs is the conservative first runner because it has an established local
  CLI, model zoo, and public documentation. `htdemucs` targets vocals, drums,
  bass, and other. `htdemucs_6s` adds guitar and piano. [8][9]
- The 6-source Demucs path is the closest match to the desired user-facing stem
  list, but the Demucs docs warn that piano quality is not great on all mixes.
  YES Stems should surface that caveat instead of hiding it. [8][9]
- Newer research points toward SCNet and BS/Mel-RoFormer as stronger future
  high-quality engines, especially for performance per watt and flagship
  quality. Their implementation and packaging surface is less mature than
  Demucs for a first solo-dev desktop app. [10]
- The likely hardened architecture is PyTorch for research, ONNX Runtime for
  cross-platform CPU/CUDA deployment, TensorRT for NVIDIA optimization, and Core
  ML for Apple-specific builds. The current Rust boundary can later swap Demucs
  CLI invocation for those runtimes without changing the Tauri command contract.
  [10]
- Licensing and provenance are separate from code availability. Commercial
  builds should review pretrained-weight rights or train/fine-tune product
  weights on clearly licensed data before bundling models. [10]

## Classic DSP Findings

The most defensible non-AI architecture is a local STFT masking engine that
keeps mixture phase, uses median-filter harmonic/percussive/residual separation
for full-band layers, and adds a REPET-style repeating-background cue for
vocal/instrumental separation. This will not match modern neural systems on
isolated vocal/drum/guitar quality, but it is transparent, offline, tunable, and
honest about artifacts.

- Harmonic/percussive separation remains the most practical non-AI full-band
  primitive. Fitzgerald's median-filter approach is low-complexity, and
  Driedger, Muller, and Disch extend it with a separation factor and residual
  component for sounds that are neither clearly harmonic nor percussive. [1][2]
- Vocal/instrumental separation without training is best framed as repeating
  background versus non-repeating foreground. REPET separates a repeated musical
  background from a non-repeating lead using time-frequency masking. [3]
- Modern production software should preserve original phase and write
  time-domain stems from masked mixture spectra. This avoids model dependence
  and keeps stems recombinable, with the usual masking artifacts acknowledged.
- Pure Rust is a strong desktop backend fit: Symphonia handles local decoding,
  RustFFT provides FFT primitives, Hound writes WAV files, and Tauri 2 gives a
  small native shell with React UI and typed Rust commands. [4][5][6][7]

## Current Architecture

YES Stems now uses a two-engine stack:

1. A local ML runner for Demucs-compatible extraction:
   - `Local ML 4 Stems` -> `htdemucs`
   - `Local ML 6 Stems` -> `htdemucs_6s`
2. A classic DSP fallback:
   - `Classic Vocal + Instrumental`
   - `Classic DSP Layers`

The classic DSP engine uses this signal flow:

1. Decode the source locally to floating-point PCM.
2. Build a Hann-window STFT per channel.
3. Average channel magnitudes to estimate masks while preserving per-channel
   complex spectra for reconstruction.
4. Compute median-filter harmonic and percussive scores.
5. Compute a repeating-background score from temporal medians.
6. Build soft masks for:
   - vocal foreground
   - instrumental complement
   - percussive layer
   - bass band
   - harmonic bed
   - residual
7. Apply masks to original complex spectra.
8. Inverse STFT with overlap-add normalization.
9. Export 24-bit WAV stems.

## Why Not NMF First

Non-negative matrix factorization is a legitimate classical source-separation
family, but it introduces more tuning surface, convergence cost, and component
label ambiguity for a first local desktop release. The current architecture
keeps the first app explainable and deterministic while leaving NMF as a future
advanced mode.

## Limits

- Vocals that are heavily doubled, panned wide, or processed like instruments
  will leak into instrumental layers.
- Non-repeating instrumental solos may appear in the vocal foreground.
- Drums with strong harmonic tails and distorted guitars can land in residual.
- Full-band labels are useful layer names, not claims of original multitracks.

## Sources

[1] Derry Fitzgerald, "Harmonic/Percussive Separation using Median Filtering,"
DAFx-10, 2010. Peer-reviewed conference paper.
https://dafx10.iem.at/papers/DerryFitzGerald_DAFx10_P15.pdf

[2] Jonathan Driedger, Meinard Muller, Sascha Disch, "Extending
Harmonic-Percussive Separation of Audio Signals," ISMIR 2014. Peer-reviewed
conference paper.
https://archives.ismir.net/ismir2014/paper/000127.pdf

[3] Zafar Rafii and Bryan Pardo, "REpeating Pattern Extraction Technique
(REPET): A Simple Method for Music/Voice Separation," IEEE Transactions on
Audio, Speech, and Language Processing, 2013. Peer-reviewed journal paper.
https://interactiveaudiolab.github.io/assets/papers/Rafii-Pardo%20-%20REpeating%20Pattern%20Extraction%20Technique%20%28REPET%29%20A%20Simple%20Method%20for%20Music-Voice%20Separation%20-%20TALSP%202013.pdf

[4] librosa documentation, `librosa.decompose.hpss`, implementation reference
for median-filter HPSS controls.
https://librosa.org/doc/main/generated/librosa.decompose.hpss.html

[5] Symphonia crate documentation, pure Rust media container and audio decoding.
https://docs.rs/symphonia/latest/symphonia/

[6] RustFFT crate documentation, pure Rust FFT primitives.
https://docs.rs/rustfft/latest/rustfft/

[7] Tauri 2 documentation, Vite setup, commands, dialog plugin, and frontend
events.
https://v2.tauri.app/start/frontend/vite/
https://v2.tauri.app/develop/calling-rust/
https://v2.tauri.app/plugin/dialog/
https://v2.tauri.app/develop/calling-frontend/

[8] Demucs, official GitHub repository and model documentation.
https://github.com/facebookresearch/demucs

[9] Demucs release notes documenting the experimental 6-source model.
https://github.com/facebookresearch/demucs/blob/main/docs/release.md

[10] Attached research synthesis, "Modern Audio Stem Extraction for Standalone
Desktop Applications," supplied in this Codex thread, summarizing SCNet,
BS/Mel-RoFormer, HT-Demucs, deployment runtimes, and licensing constraints.
