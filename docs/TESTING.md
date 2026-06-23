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
- command/report contracts where practical.

## Frontend Coverage

Frontend tests should cover:

- selected mode copy and stem expectations.
- disabled run states.
- progress/result rendering.
- no visible AI extraction claims.

## Local Audio

Private music fixtures, extracted stems, and ad hoc renders must stay ignored by
git. Use `test-output/` for local evidence when needed.
