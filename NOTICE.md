# Third-Party Notices

YES Stems is built on open-source software. This file lists the primary third-party components
and their licenses. Each component remains under its own license; consult the linked projects for
full terms. (This list covers the main direct dependencies; run `npm ls` and
`cargo tree --manifest-path src-tauri/Cargo.toml` for the complete transitive set.)

## Application framework & UI

| Component | Purpose | License |
|---|---|---|
| [Tauri](https://github.com/tauri-apps/tauri) | Desktop shell (Rust + WebView) | MIT / Apache-2.0 |
| [React](https://github.com/facebook/react) & React DOM | UI framework | MIT |
| [lucide-react](https://github.com/lucide-icons/lucide) | Icon set | ISC |
| [Vite](https://github.com/vitejs/vite) | Frontend build tool | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | Language / type checker | Apache-2.0 |

## Audio DSP (Rust)

| Component | Purpose | License |
|---|---|---|
| [Symphonia](https://github.com/pdeljanov/Symphonia) | Audio decoding (WAV/MP3/FLAC/…) | MPL-2.0 |
| [RustFFT](https://github.com/ejmahler/RustFFT) | FFT for STFT/iSTFT | MIT / Apache-2.0 |
| [hound](https://github.com/ruuda/hound) | WAV encoding | Apache-2.0 |

## Local ML runtime (bundled in the standalone installer)

| Component | Purpose | License |
|---|---|---|
| [Demucs](https://github.com/facebookresearch/demucs) | Music source separation models (`htdemucs`, `htdemucs_6s`) | MIT |
| [PyTorch](https://github.com/pytorch/pytorch) & [torchaudio](https://github.com/pytorch/audio) | ML inference | BSD-3-Clause |
| [soundfile](https://github.com/bastibe/python-soundfile) | Audio I/O for the sidecar | BSD-3-Clause |
| [openunmix](https://github.com/sigsep/open-unmix-pytorch) / [julius](https://github.com/adefossez/julius) / [dora](https://github.com/facebookresearch/dora) / [lameenc](https://github.com/chrisstaff/python-lameenc) | Demucs runtime dependencies | see each project |

> **Note:** The Demucs models and their pretrained weights are provided by their authors under
> their own terms. Commercial redistribution of the bundled model weights is subject to an open
> licensing review (see `docs/RELEASE.md`) and is **not** cleared for paid distribution yet.

## Development-only

| Component | Purpose | License |
|---|---|---|
| [Vitest](https://github.com/vitest-dev/vitest) / [Testing Library](https://github.com/testing-library/react-testing-library) | Frontend tests | MIT |
| [thiserror](https://github.com/dtolnay/thiserror) / [tempfile](https://github.com/Stebalien/tempfile) | Rust error handling / test fixtures | MIT / Apache-2.0 |
