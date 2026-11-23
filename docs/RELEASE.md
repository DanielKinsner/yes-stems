# Release Checklist

Run from `main` before sharing a Windows build.

## Owner gates

- `docs/MODEL-LICENSING.md` has an approved commercial model decision.
- A Windows code-signing certificate is provisioned as described in
  `docs/WINDOWS-SIGNING.md`.
- The EULA and commercial notices have completed owner/legal review.

These gates cannot be closed by CI or an agent build.

## Mechanical verification

```powershell
git status --short --branch
npm run verify:release
npm run verify:demucs-runtime
npm run build:windows:standalone:signed
```

The standalone build verifies full SHA-256 hashes for both model checkpoints
and refuses to package a release when the runner, manifest, or either checkpoint
is absent. An intentional classic-DSP-only installer must use the explicit
`npm run build:windows:classic` lane.

After installing the signed NSIS bundle on a clean Windows machine:

```powershell
.\scripts\smoke-installed-demucs.ps1
```

Confirm the expected Authenticode publisher for the installer, installed app,
and bundled runtime. Release notes should call out:

- local-only processing, with no cloud upload
- included stem modes and expected WAV filenames
- the approved model provenance/distribution basis
- the 12-minute separation limit and heavy-track warning
- known limitation that guitar and piano stems can bleed depending on the mix
