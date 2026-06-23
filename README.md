# YES Stems

YES Stems is a local desktop app for offline music stem extraction.

The first shipping target is a Tauri desktop workflow that can load a music
track, run local ML or classic DSP extraction, and export WAV files without
sending audio to a cloud service or frontier-model API.

## Local Demucs Runtime

The current dev runtime uses Demucs locally through a repo-local Python venv.
From the repo root, install the verified stack with Python 3.12:

```powershell
.\scripts\setup-demucs.ps1 -Python "C:\path\to\python.exe"
```

This creates `.venv-demucs/`, installs `demucs==4.0.1`,
`torch==2.5.1`, `torchaudio==2.5.1`, and `soundfile==0.14.0`, then the
Tauri backend auto-detects `.venv-demucs\Scripts\demucs.exe`.

Run the app locally:

```powershell
$env:YES_STEMS_DEMUCS_DEVICE = "cpu"
npm run tauri dev
```

The local ML modes map to:

- `Local ML 4 Stems` -> Demucs `htdemucs`: vocals, drums, bass, other
- `Local ML 6 Stems` -> Demucs `htdemucs_6s`: vocals, drums, bass, guitar,
  piano, other

The first dev run downloads model weights into the local Torch cache. Audio
stays local.

Build a standalone Windows installer with the bundled Demucs sidecar and model
weights:

```powershell
npm run build:demucs-sidecar
npm run build:windows
```

The one-step command is:

```powershell
npm run build:windows:standalone
```

The staged sidecar lives under `src-tauri/resources/demucs-runtime/` and is
ignored by git except for `.gitkeep`.

Read the active project docs first:

- `docs/PRODUCT.md`
- `docs/RESEARCH.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
