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

When Demucs is installed locally, run a short private audio fixture through both
local ML modes. This validates the sidecar/runtime environment, not the unit
test suite:

```powershell
$env:YES_STEMS_DEMUCS_DEVICE = "cpu"
npm run tauri dev
```

Then choose:

- `Local ML 4 Stems`
- `Local ML 6 Stems`

The app should write the expected WAV filenames to the chosen output folder.
Do not commit private fixtures or generated stems.

## Local Audio

Private music fixtures, extracted stems, and ad hoc renders must stay ignored by
git. Use `test-output/` for local evidence when needed.
