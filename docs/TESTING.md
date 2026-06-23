# Testing

YES Stems does not require human listening to finish implementation work.
Listening can inform later tuning, but the completion gate is objective and
repeatable.

## Fast Lane

Run from the repo root:

```powershell
npm run verify:fast
```

This expands to:

```powershell
npm test
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Packaging Lane

Run from the repo root:

```powershell
npm run build:windows
```

This invokes `tauri build` and should produce local bundle artifacts under
`src-tauri/target/release/bundle/`.

For a standalone Windows build that includes the local Demucs sidecar and model
weights, run:

```powershell
npm run build:windows:standalone
```

This first stages `src-tauri/resources/demucs-runtime/` with a PyInstaller
`demucs.exe` sidecar and the `htdemucs` / `htdemucs_6s` checkpoints, then runs
the normal Tauri bundle lane.

After installing the NSIS bundle, run:

```powershell
.\scripts\smoke-installed-demucs.ps1
```

This finds the installed app through the Windows uninstall registry, runs the
installed bundled Demucs runtime against a generated synthetic WAV, and verifies
the expected 4-stem and 6-stem files.

## UI Screenshot Lane

Run from the repo root after frontend changes:

```powershell
npm run build
npm run preview:local
```

In a second shell, capture the current desktop viewport:

```powershell
npm run screenshot:ui
```

The capture script uses local Chrome or Edge at `1280x800` and updates
`docs/screenshots/yes-stems-installed-app.png`.

Verify the committed screenshot dimensions:

```powershell
npm run verify:screenshot
```

## Backend Coverage

Rust tests should cover:

- STFT/iSTFT reconstruction tolerance.
- mask partition sanity.
- exported WAV sample rate, channels, duration, and finite samples.
- local ML mode-to-model/stem contracts without requiring Demucs at unit-test
  time.
- command/report contracts where practical.

## Frontend Coverage

Frontend tests should cover:

- selected mode copy and stem expectations.
- disabled run states.
- progress/result rendering.
- no visible cloud/API extraction claims.

## Optional Local ML Smoke

Install the verified local Demucs stack with Python 3.12:

```powershell
.\scripts\setup-demucs.ps1 -Python "C:\path\to\python.exe"
```

When Demucs is installed locally, run a short private audio fixture or synthetic
WAV through both local ML modes. This validates the runtime environment, not
the unit test suite:

```powershell
$env:YES_STEMS_DEMUCS_DEVICE = "cpu"
npm run tauri dev
```

Then choose:

- `Local ML 4 Stems`
- `Local ML 6 Stems`

The app should write the expected WAV filenames to the chosen output folder.
Do not commit private fixtures or generated stems.

Direct CLI smoke commands:

```powershell
.\.venv-demucs\Scripts\demucs.exe -n htdemucs -d cpu --int24 -o test-output\demucs-smoke\out-4 path\to\fixture.wav
.\.venv-demucs\Scripts\demucs.exe -n htdemucs_6s -d cpu --int24 -o test-output\demucs-smoke\out-6 path\to\fixture.wav
```

Expected 4-stem files are `bass.wav`, `drums.wav`, `other.wav`, and
`vocals.wav`. Expected 6-stem files add `guitar.wav` and `piano.wav`.

Latest local smoke evidence:

- `htdemucs` wrote the four expected WAV stems from
  `test-output\demucs-smoke\synthetic.wav`.
- `htdemucs_6s` downloaded its model weights and wrote the six expected WAV
  stems from the same synthetic WAV.
- The staged standalone `src-tauri\resources\demucs-runtime\demucs.exe` wrote
  the four expected `htdemucs` stems and six expected `htdemucs_6s` stems with
  `TORCH_HOME` pointed at the staged bundled model cache.
- `npm run build:windows` produced MSI and NSIS bundles with the staged runtime
  present.
- A clean NSIS install to `%LOCALAPPDATA%\YES Stems` included
  `demucs-runtime\demucs.exe`, both checkpoint files, and passed
  `scripts/smoke-installed-demucs.ps1`.

## Local Audio

Private music fixtures, extracted stems, and ad hoc renders must stay ignored by
git. Use `test-output/` for local evidence when needed.
