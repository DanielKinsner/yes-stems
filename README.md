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

The first run downloads model weights into the local Torch cache. Audio stays
local. The packaged installer does not yet bundle Python, Demucs, or model
weights; that sidecar packaging step is still deferred.

Read the active project docs first:

- `docs/PRODUCT.md`
- `docs/RESEARCH.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
