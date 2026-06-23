# Release Checklist

Run from `main` before sharing a Windows build.

```powershell
git status --short --branch
npm run verify:branch
npm run verify:fast
npm run verify:screenshot
npm run build:windows:standalone
```

After installing the NSIS bundle:

```powershell
.\scripts\smoke-installed-demucs.ps1
```

Release notes should call out:

- local-only processing, with no cloud upload
- included stem modes and expected WAV filenames
- Demucs model/runtime provenance still requiring commercial review
- known limitation that guitar and piano stems can bleed depending on the mix
