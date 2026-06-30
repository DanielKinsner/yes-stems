# YES Stems — Project Status

YES Stems is a 100% local, offline, privacy-first desktop app that extracts musical stems (vocals, drums, bass, and more) from any audio file using either local Demucs ML models or a built-in Rust DSP engine — your audio never leaves your machine.

**Status: pre-release / alpha — core pipeline working end-to-end; packaging, signing, and shippable polish pending.**

---

## 1. Snapshot

| Field | Value |
|---|---|
| Date | 2026-06-29 |
| Branch | `main` |
| Version | `0.1.0` (pinned in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`) |
| Platform target | Windows (Tauri 2 NSIS + MSI); macOS/Linux targets configured but not exercised |
| Stack | React 19 + TypeScript + Vite (frontend) · Tauri 2 + Rust (shell + commands) · Symphonia / RustFFT / hound (DSP) · PyInstaller-bundled Demucs sidecar (local ML) |
| Verification | GREEN — 12 vitest tests + `tsc --noEmit` + `vite build` clean; `cargo fmt --check` + `cargo clippy -D warnings` + 24 Rust unit tests pass; UI screenshot is exactly 1440×820 (matches the reference aspect ratio) |
| CI | None (no `.github/workflows/`) — verification is local-only via `npm run verify:*` |

---

## 2. What YES Stems is

**Value prop.** A desktop stem-separation tool that processes audio entirely on your own machine. No upload, no cloud, no account — the UI footer commits to this with three pillars: **100% LOCAL · PRIVATE · HONEST**.

**Four extraction modes.**

| Mode | Engine | Model / Method | Stems |
|---|---|---|---|
| Local ML 6 Stems *(default, recommended)* | Demucs sidecar | `htdemucs_6s` | vocals, drums, bass, guitar (exp.), piano (exp.), other |
| Local ML 4 Stems | Demucs sidecar | `htdemucs` | vocals, drums, bass, other |
| Classic Vocal + Instrumental | Rust DSP | HPSS + REPET-style masks, OLA iSTFT | vocals, instrumental |
| Classic DSP Layers | Rust DSP | HPSS / band-split utility layers | vocal_foreground, instrumental_sum, drums_percussion, bass_band, harmonic_bed, residual |

**Target users.** Producers, remixers, DJs, music students, podcasters, and audio hobbyists who need stems on the bench, want to keep masters off the internet, or work without reliable connectivity. The product positions the classic DSP modes as honest "useful layers" rather than studio multitracks; htdemucs_6s guitar and piano heads are labeled experimental in the UI.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend  (Vite + React + TS, single-page, three-column workbench)  │
│  src/App.tsx ─ src/App.css                                           │
│  • source picker · mode list · tuning sliders · transport · report   │
│  • listens stems://progress · invoke(analyze_track / extract_stems / │
│    export_stems / check_local_ml_runtime)                            │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │  Tauri IPC (invoke + events)
┌─────────────────────────────────┴───────────────────────────────────┐
│  Rust Backend  (src-tauri/src/)                                      │
│  commands.rs ─ four Tauri commands, spawn_blocking, emit_progress    │
│  audio_io.rs ─ Symphonia decode → Vec<Vec<f32>>; hound 24-bit WAV    │
│  separation.rs ─ 2048-pt Hann STFT, HPSS, REPET, OLA iSTFT, masks    │
│  stem_cleanup.rs ─ DC removal, edge fades, quiet-bleed suppression   │
│  ml_engine.rs   ─ Demucs runner discovery, workspace, shape validate │
│  types.rs       ─ StemMode, ProgressEvent, ExtractionReport          │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │  child process (Command::output)
┌─────────────────────────────────┴───────────────────────────────────┐
│  Demucs Sidecar  (PyInstaller --onedir bundle)                       │
│  src-tauri/resources/demucs-runtime/demucs.exe                       │
│  + torch-cache/hub/checkpoints/ ({htdemucs, htdemucs_6s}.th)         │
│  Runner discovery order: $YES_STEMS_DEMUCS → bundled → .venv-demucs  │
│  → demucs on PATH → python -m demucs → py -m demucs                  │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow:** *user picks file* → `analyze_track` (Symphonia decode + waveform peaks) → user picks mode/tuning → `extract_stems` (classic DSP or Demucs subprocess in a per-run temp workspace) → optional `stem_cleanup` → write 24-bit WAVs into per-run folder under `$APPDATA/working-stems/` → UI shows stems with solo/mute/audition → `export_stems` copies the run to a user-chosen folder and opens it.

---

## 4. Current state by subsystem

### 4.1 Frontend / UI (`src/App.tsx`, `src/App.css`)

**Works**
- Three-pane workbench (left rack · center stage · right rack) wired to all four Tauri commands.
- Source picking via `@tauri-apps/plugin-dialog` with audio filters (wav/flac/mp3/aif/aiff/m4a/ogg).
- All four extraction modes selectable from both the header dropdown and the left-rack mode list; mode switch clears stale report and stops playback.
- Tuning surface: cleanup enable + strength slider (always), aggressiveness + artifact-reduction sliders (classic modes only).
- Full extract request body wired to `invoke('extract_stems', { request: { inputPath, mode, tuning, cleanup } })` with end-to-end state for `isExtracting`, `progress`, `error`, and report.
- `stems://progress` subscribed via `listen()` in a Tauri-gated `useEffect`; drives the READY/WORKING footer pill and ETA text.
- `check_local_ml_runtime` polled on mount; drives Atom-icon tooltip and the run-button label (switches to "Install local ML runtime" when missing).
- Stem rows render real report stems or expected-stem placeholders; per-row Solo (S) and Mute, color-coded glyph, post-extraction dBFS label and peak meter.
- Playback paths for single-stem audition, sequenced playback (`playSequence`), and concurrent playback (`playConcurrent`) over `convertFileSrc` URIs.
- Export flow via directory dialog → `export_stems` → `openPath()` to reveal the folder.
- Reasonable a11y basics: `aria-label`s, `aria-selected` on mode tabs, `aria-pressed` on Solo/Mute and Sequence/All, `role='alert'` on error toasts, dark color tokens in `:root`.
- Demo dataset (waveform, fake report, fake export dir) hydrates **only** when `!hasTauriRuntime() && import.meta.env.PROD` — vitest and the real Tauri build start empty.

**Partial / demo-only**
- **Settings**, **Fullscreen**, and **Help** header buttons are tooltip-only stubs (`title='… not available in this build.'`).
- **Spectrum** tab is a static CSS gradient (`aria-hidden`) — no FFT data.
- **Loudness** tab plots a subsampled copy of the overview waveform, not a real LUFS/RMS curve.
- **Metrics** tab shows only six cells; reconstruction error renders `n/a` for the ML path (backend sentinel `-1.0`).
- Per-stem **wave bars** are deterministic seed-based shapes (`stemWave(seed)`), not actual per-stem peaks.
- **Volume** is a single global slider applied to every `<audio>` — no per-stem gain or pan.
- Transport **scrubber knob** is read-only — no pointer/seek handler.
- Timeline drag-selection is captured and rendered but never wired to "play selection" or "export selection".
- Toasts in the notes module have **no dismiss button or auto-clear**.

**Gaps**
- No global React `ErrorBoundary` — a render crash white-screens the app.
- No keyboard shortcuts (Space/Esc/S/M/Ctrl+O/number-keys-for-modes).
- No responsive layout below ~1180px; `body { min-width: 1120px; overflow: hidden }` clips chrome on small laptops.
- No light theme or `prefers-color-scheme` handling.
- No persistence (last folder, mode, volume, window size) — every session starts cold.
- No drag-and-drop onto the source card.
- No multi-file/batch queue.
- No way to cancel a running extraction from the UI (no Stop button, no progress phase stepper).
- No localisation — every string is hardcoded English.
- Test coverage gaps: no tests for `check_local_ml_runtime` failure, progress listener, volume/mute, Sequence/All mode, or any error-toast branch.

### 4.2 Rust backend (DSP + commands) — `src-tauri/src/`

**Works**
- Small, consistent Tauri surface: `analyze_track`, `check_local_ml_runtime`, `extract_stems`, `export_stems`, all dispatched via `tauri::async_runtime::spawn_blocking`.
- `stems://progress` events fire at ~5–7 named milestones per run (decode → analysis → render → verify → export → complete).
- Symphonia decode with the `all` feature set, stable-sample-rate/channel validation, and `AudioBuffer::ensure_valid` to reject non-finite samples.
- Classic DSP pipeline is mathematically coherent: 2048-pt Hann STFT @ 512 hop (75% overlap), median-time/median-frequency HPSS, REPET-style repeating-background score, soft Wiener masks, mirrored negative-frequency half, OLA iSTFT with window-squared normalization, normalized reconstruction-error diagnostic.
- Tuning (`aggressiveness 0–10`, `artifact_reduction 0–10`) clamped and threaded into mask gain, ceiling, and a 3-tap temporal smoother.
- Cleanup pass with DC removal, percentile-based quiet-bleed suppression (~30th percentile via every-16th-sample estimator), and 2–6 ms edge fades scaled by strength.
- Export is conservative: sanitized ASCII folder name, parent-dir creation, same-file guard via `canonicalize`.
- Per-run working folder under `app_data_dir/working-stems/` keeps each run isolated from user export targets.
- 24 Rust unit tests across `separation.rs`, `stem_cleanup.rs`, `ml_engine.rs`, `audio_io.rs`, `commands.rs` — STFT roundtrip RMS < 0.005, mask differentiation under tuning, cleanup notes, ASCII-safe workspace, WAV spec invariants.

**Partial / demo-only**
- `StemFile.bytes` is the on-disk file size captured at write time — purely a UI hint; can lie if the file is later replaced.
- `ExtractionReport.reconstruction_error` is `-1.0` (sentinel) on the ML path; frontend has to special-case it.
- Progress reporting is coarse — long classic-mode runs sit at the same percentage for minutes.
- Cleanup on the ML path silently re-decodes Demucs output and re-encodes via the 24-bit Int writer; cleanup-on vs cleanup-off produces different file headers.

**Gaps**
- **No cancellation** anywhere — no token, no `Child` handle for the Demucs subprocess; once started, only killing the app stops it.
- **Whole-file in-memory processing** — `decode_audio` + `compute_stft` can spike to ~800 MB+ of spectra for a 5-minute stereo song. Tests only cover 0.5 s synthetic clips. OOM risk on 8 GB machines.
- Single-threaded DSP (no rayon); STFT and N inverse passes are sequential per channel.
- **Output format locked to 24-bit Int WAV** — no 16-bit, no 32-bit float, no FLAC/AIFF/MP3/AAC, no dithering on float→i24 truncation.
- No resampler, channel downmix, or mono→stereo expansion.
- No re-entrancy guard on `extract_stems` — concurrent invocations will each allocate full buffers / each spawn Demucs.
- `ProgressEvent` carries no job id.
- No `tracing`/log crate; errors stringify at the Tauri boundary with no structured field log.
- No true-peak limiting on export; `clamp_audio` hard-clips to ±1.0.
- No sidecar manifest (no JSON of the report, no checksums) written alongside exports.

### 4.3 Local ML / Demucs runtime — `src-tauri/src/ml_engine.rs`, `scripts/`

**Works**
- Runner discovery is explicit and probed via `--help` before use: env override → bundled (`resource_dir/demucs-runtime/demucs.exe`) → repo-local `.venv-demucs` → `demucs` on PATH → `python -m demucs` → `py -m demucs`.
- `check_local_ml_runtime` surfaces the chosen runner, all attempted runners, and a detail string to the UI.
- `scripts/build-demucs-sidecar.ps1` PyInstalls (`--onedir`) the venv with demucs/dora/julius/lameenc/numpy/openunmix/soundfile/torchaudio, downloads both `htdemucs` and `htdemucs_6s` `.th` checkpoints into `torch-cache/hub/checkpoints/`, writes a `manifest.json`, and smoke-checks `--help`.
- Tauri config bundles the staged folder as a resource; `ml_engine.rs` sets `TORCH_HOME` to the staged cache so the bundled CLI finds the weights offline.
- Each Demucs run goes into a per-invocation RAII temp workspace with the input renamed to a sanitized ASCII `source.<ext>` — dodges non-ASCII path failures.
- Python child stdio forced to UTF-8 (`PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`).
- ML stems are shape-validated (sample rate, channels, frame count) against the source `TrackAnalysis` before being reported.
- `scripts/smoke-installed-demucs.ps1` reads the Windows uninstall registry for "YES Stems", runs the installed `demucs.exe` against a synthetic WAV in both modes, and asserts the 4- and 6-stem filenames.
- Versions pinned in `requirements-demucs.txt`: `demucs==4.0.1`, `torch==2.5.1` (CPU), `torchaudio==2.5.1`, `soundfile==0.14.0`.

**Partial / demo-only**
- `scripts/demucs-sidecar.py` is a thin entry point — there is no custom IPC protocol, the Rust side just shells out and reads the produced WAV files.
- `local_demucs_candidates()` includes both Windows and POSIX paths, but only the **Windows** PyInstaller build script exists.
- `demucs_device()` returns `"cpu"` unless `YES_STEMS_DEMUCS_DEVICE` is set — no CUDA/MPS autodetect; pinned CPU-only torch wheel.
- `src-tauri/resources/demucs-runtime/` ships only `.gitkeep`; the real runtime + checkpoints are gitignored and produced on demand. A plain `tauri build` without first running `npm run build:demucs-sidecar` produces an installer with **no local ML at all**.
- `--help` probe cold-starts the PyInstalled interpreter on every UI poll (no caching).

**Gaps**
- **No macOS or Linux sidecar build path.**
- **No GPU runtime** in the shipped binary; no fallback if the user points it at `cuda` against CPU-only torch.
- **No code-signing** for `demucs.exe` or its bundled DLLs — SmartScreen friction guaranteed.
- No checksum verification of the downloaded `.th` checkpoints from `dl.fbaipublicfiles.com` (existence-only check); no mirror, no hash, no resume.
- No installer-time integrity check that staged checkpoints actually load.
- No size/perf budgeting — `--onedir` + torch + torchaudio + numpy + two ~80 MB `.th` files push the Windows installer to hundreds of MB.
- No update path for bundled runtime; a torch CVE forces a full reinstall.
- No timeout on the Demucs child; no streaming of stdout/stderr while it runs (UI is dark between progress 0.08 and 0.72); errors stuff the full child output into a `String` returned across IPC.
- Commercial review of Demucs model/runtime provenance is **still open** (`docs/RELEASE.md`, `docs/PRODUCT.md` "Deferred").

### 4.4 Build & release

**Works**
- Local Windows build path: `npm run build:windows[:standalone]` runs Vite + `tauri build`; standalone variant first invokes `build:demucs-sidecar` and produces both NSIS and MSI installers.
- `tauri.conf.json` bundles `resources/demucs-runtime` → `demucs-runtime`; backend wires `TORCH_HOME` to the staged cache.
- Verify lanes in `package.json`: `verify:branch`, `verify:frontend`, `verify:rust`, `verify:fast`, `verify:release`, `verify:ui`, `verify:screenshot`.
- Asset-protocol scope is restricted to working-stems directories under `$APPDATA`, `$APPLOCALDATA`, and `$TEMP/yes-stems/`.
- Capabilities limited to `core:default`, `dialog:default`, `opener:default`.
- Icon set present (`icon.ico`, `icon.icns`, square logos, 32 / 128 / 128@2x PNGs).

**Partial / demo-only**
- `bundle.targets` is `"all"` rather than `["nsis", "msi"]` — no Windows-specific tuning.
- CSP is `null` — acceptable for local-only but unhardened.
- Version is duplicated and **manually pinned** in three files (no bump script).
- Demucs sidecar is bundled as a `resource`, not registered as a Tauri `externalBin` sidecar — bypasses Tauri's sidecar permission model.
- `package-lock.json` is gitignored — npm resolution is non-reproducible across builds.

**Gaps**
- **No CI/CD** (`.github/workflows/` does not exist).
- **No code-signing** pipeline (no SignTool invocation, no PFX path, no `WindowsConfiguration.certificateThumbprint` / `signCommand` in `tauri.conf.json`).
- **No Tauri updater plugin** or `plugins.updater` config — no auto-update channel.
- No NSIS / WiX customization block — no `webviewInstallMode`, no per-user vs per-machine choice, no license page, no custom uninstall behavior.
- No publisher / copyright / longDescription metadata; UAC and Add/Remove Programs will show empty fields.
- No `CHANGELOG.md`.
- No SBOM or license/attribution artifacts.
- No CI gate that fails a bundle when `src-tauri/resources/demucs-runtime/demucs.exe` is missing.

### 4.5 Testing & verification

**Works**
- 12 Vitest cases in `src/App.test.tsx` covering: default render, six-stem expectations, Classic DSP layer file list, full `extract_stems` request body, source replacement clearing stale report, classic tuning + cleanup-strength passthrough, pointer-drag timeline math, stem audition via `convertFileSrc`, transport Play, export round-trip incl. `openPath`.
- 24 Rust unit tests across `stem_cleanup`, `separation`, `ml_engine`, `audio_io`, `commands` — including STFT roundtrip RMS < 0.005, mask differentiation under tuning, bundled runner sets `TORCH_HOME`, PYTHONUTF8 enforcement, non-ASCII source workspace, stem shape mismatch validation, export sanitized folder, working-root isolation.
- `scripts/capture-ui-screenshot.ps1` regenerates `docs/screenshots/yes-stems-installed-app.png` via headless Chrome/Edge; `scripts/verify-ui-screenshot.ps1` asserts exact 1440×820.
- `scripts/assert-main-branch.ps1` blocks release flows from non-main branches.

**Partial / demo-only**
- Frontend tests mock every Tauri command and stub the global `Audio` constructor — no real IPC and no real audio playback ever exercised.
- Rust DSP tests use only a synthetic_audio() buffer (440 Hz + 110 Hz sines + clicks, 0.5 s @ 44.1 kHz).
- `ml_engine` tests cover the *plan* (filenames, env vars, workspace sanitization) but never invoke real Demucs; `bundled_runner_sets_torch_home` writes an empty placeholder `demucs.exe`.
- `smoke-installed-demucs.ps1` only asserts that the expected stem filenames exist — not stem quality, separation accuracy, or file sizes.
- Screenshot verification checks **dimensions only** — a blank/corrupted 1440×820 would pass.
- No code-coverage tooling (nyc/c8/tarpaulin/llvm-cov).

**Gaps**
- **No CI** — every release relies on a developer running `verify:release` locally on Windows.
- **No automated end-to-end** test of the real Demucs path (real audio in, real stems out).
- No tests for `analyze_track`, audio decode (WAV/MP3/FLAC), or progress-event emission.
- No performance / runtime regression tests (no benches under `src-tauri/benches/`).
- No tests for cancellation, concurrent extraction, disk-full, malformed input, very long files, or ID3-cover-art tracks.
- No accessibility / keyboard-navigation tests beyond `getByRole`.
- No visual regression / golden-image diff.
- No cross-platform verification — scripts require pwsh + .NET System.Drawing + local Chrome/Edge.
- No security/permission tests of the Tauri allowlist.

### 4.6 Docs & product positioning

**Works**
- Tight internal doc set (`PRODUCT.md`, `ARCHITECTURE.md`, `RESEARCH.md`, `TESTING.md`, `RELEASE.md`, `README.md`).
- Architecture doc accurately mirrors code (Tauri commands, `ml_engine.rs`, `separation.rs`, `stem_cleanup.rs`, types, runner discovery order).
- `RESEARCH.md` defends the stack (Demucs htdemucs/htdemucs_6s, REPET, HPSS, Symphonia/RustFFT/Hound/Tauri 2) with 10 cited sources.
- `RELEASE.md` checklist explicitly mentions local-only processing, expected WAV filenames, Demucs provenance caveat, and the guitar/piano bleed limitation.
- UI footer surfaces the three honesty pillars; `htdemucs_6s` guitar/piano experimental nature is documented and labeled.

**Partial / demo-only**
- Cleanup now defaults **on** (`App.tsx` initializes `cleanupEnabled = true` at 45% strength, matching the reference design); `docs/PRODUCT.md` step 4 was updated to agree. Tests assert `cleanup.enabled = true` on the default path.
- `src-tauri/Cargo.toml` description still reads `"Local non-AI music stem extraction desktop app."` — contradicts the current ML-headlined positioning.
- Trust-badge copy ("No uploads. No cloud. Ever.") is in the UI shell with no privacy policy, no documented network audit, and no Tauri CSP backing it (`csp: null`).
- `RESEARCH.md` still frames classic DSP as the default — one product iteration behind.
- Internal Rust enum variants (`VocalInstrumental`, `FullBand`) differ from UI mode labels — readable for users, mixed internally.
- `RELEASE.md` is Windows-only despite `bundle.targets = "all"`.

**Gaps**
- **No LICENSE file** — project is effectively all-rights-reserved by default.
- **No PRIVACY policy** substantiating the strong local-only claims the UI makes.
- No TERMS/EULA.
- No customer-facing website/store-listing copy, no marketing assets beyond the engineering screenshot.
- No onboarding / first-run UX, permissions explainer, or in-app docs.
- No model-provenance / NOTICE / third-party-attribution doc covering Demucs, PyTorch, torchaudio, soundfile, Symphonia, RustFFT, hound, Tauri, React, lucide-react.
- No `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`.
- No documented network-call audit substantiating the no-uploads claim.
- No user-friendly troubleshooting / FAQ for the common `MlEngineError::RuntimeUnavailable` path.
- No supported-formats matrix, system-requirements, platform-coverage statement, or pricing/business-model doc.
- No data-handling statement covering the working folder under `$APPDATA/working-stems/` (which currently has no cleanup path).

---

## 5. Verification

| Command | What it runs | Status |
|---|---|---|
| `npm test` | Vitest (12 frontend cases) | PASS |
| `npm run build` | `tsc --noEmit && vite build` | PASS |
| `npm run verify:frontend` | `npm test && vite build` | PASS |
| `npm run verify:rust` | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` (24 cases) | PASS |
| `npm run verify:fast` | frontend + rust lanes | PASS |
| `npm run verify:screenshot` | asserts `docs/screenshots/yes-stems-installed-app.png` is 1440×820 | PASS |
| `npm run verify:ui` | branch + frontend + screenshot | PASS |
| `npm run verify:release` | branch + fast + screenshot | PASS |
| `npm run build:windows` | Tauri NSIS + MSI build (no bundled sidecar) | Manual, last known: PASS |
| `npm run build:windows:standalone` | builds sidecar, then NSIS + MSI with bundled Demucs runtime | Manual, last known: PASS |
| `scripts/smoke-installed-demucs.ps1` | post-install smoke against installed `demucs.exe` (both models, synthetic WAV) | Manual, last known: PASS |

---

## 6. Known risks & limitations

- **Windows-only release lane.** macOS/Linux are configured in Tauri but have no sidecar build and no documented release path.
- **No Authenticode signing yet.** SmartScreen and AV friction guaranteed on a clean Windows install; the bundled `demucs.exe` and its DLLs are also unsigned.
- **No auto-update.** Versions ship as frozen artifacts.
- **No CI.** All verification runs on one developer's machine; reproducibility depends on local Python 3.12 + .venv-demucs + PyInstaller 6.21.0 + Rust toolchain + WiX/NSIS.
- **Local ML requires the bundled runtime.** A plain `tauri build` (without first running `build:demucs-sidecar`) produces an installer with zero local-ML capability and only the UI surfaces a tooltip-and-button explaining how to fix it.
- **CPU-only inference.** No CUDA/MPS in the shipped binary; `htdemucs_6s` on a long stereo song is slow.
- **No cancellation.** A click-Run cannot be aborted from the UI; killing the app is the only option.
- **Whole-file in-memory DSP.** Realistic 6–10 minute stereo tracks risk OOM on 8 GB machines; tests only cover 0.5 s synthetic clips.
- **Output format locked to 24-bit WAV.** No 16-bit, 32-bit float, FLAC, or AIFF.
- **`htdemucs_6s` guitar / piano heads are experimental** — labeled in UI and `PRODUCT.md`.
- **Privacy claim is not substantiated** by a published policy or documented network audit.
- **Demucs model/runtime provenance** has an open commercial-licensing review — blocks paid distribution of the standalone installer.
- **No LICENSE file** — currently no legal basis for redistribution.
- **Spectrum / Loudness tabs are placeholder visuals** — labeled but not implemented.

---

## 7. Roadmap to a shipped product

### Stage A — Product hardening *(close the UX cliff for v0.2)*
- [ ] Add a global React `ErrorBoundary` around `<App />` with a "copy diagnostics" button.
- [ ] Thread a cancel token through `commands.rs` → `separation.rs` / `ml_engine.rs`; keep the Demucs `Child` handle so it can be killed.
- [ ] Surface a Stop button in the UI; wire to `cancel_extraction` Tauri command.
- [ ] Implement Settings panel: default output folder, ML device override, cleanup defaults, theme toggle.
- [ ] Persist mode, cleanup defaults, volume, last folder, window size (Tauri store or `localStorage`).
- [ ] Add keyboard shortcuts: Space/Esc for transport, S/M on focused stem, Ctrl+O to open file, 1–4 to switch modes.
- [ ] Auto-dismissing toasts + dismiss button + persistent error log panel.
- [ ] Inline runtime-missing panel with one-click installer guidance (not just a tooltip).
- [ ] Make scrubber knob draggable; honor timeline selection for "play selection".
- [ ] Hide or implement Spectrum + Loudness tabs (don't ship placeholder visuals labeled as features).
- [ ] Drag-and-drop onto source card.
- [ ] **Ship-blocker:** chunked / overlap-add streaming in `separation.rs` to bound RAM (or at minimum a length cap with a clear UI error).

### Stage B — Local ML packaging *(make "it just works offline" true)*
- [ ] Build a `build:macos:standalone` and `build:linux:standalone` sidecar lane (PyInstaller equivalents for `.app` / ELF).
- [ ] Add SHA-256 checksum verification + mirror fallback to the model-weight downloader in `build-demucs-sidecar.ps1`.
- [ ] Add a build-time gate that fails the bundle when `src-tauri/resources/demucs-runtime/demucs.exe` is missing.
- [ ] Ship CUDA (Windows/Linux) and Apple MPS (macOS) torch variants; add device autodetect with CPU fallback.
- [ ] Cache `check_local_ml_runtime` probes so the UI doesn't cold-start Python on every poll.
- [ ] Stream Demucs stdout/stderr while it runs; map progress to per-phase events.
- [ ] Trim the PyInstaller bundle (drop unused torch ops, test data); document an installer-size budget.
- [ ] **Ship-blocker:** resolve the Demucs model/runtime commercial-licensing review (`docs/RELEASE.md`).

### Stage C — Release engineering *(make a shippable installer)*
- [ ] Set up GitHub Actions CI: matrix build (windows-latest at minimum), run `verify:rust` + `verify:frontend`, archive installer artifacts.
- [ ] **Ship-blocker:** provision an Authenticode certificate; sign the NSIS + MSI installers **and** the bundled `demucs.exe`.
- [ ] Add `bundle.windows.nsis` / `bundle.windows.wix` config: publisher, copyright, longDescription, license page, per-user install mode, `webviewInstallMode: downloadBootstrapper`.
- [ ] Pin `bundle.targets` to `["nsis", "msi"]` for Windows; create separate macOS DMG and Linux AppImage lanes.
- [ ] Add `tauri-plugin-updater`; sign updates with a published `pubkey`; host an update manifest.
- [ ] Add a single `version-bump` script that updates `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` together.
- [ ] Commit `package-lock.json` for reproducible npm resolution.
- [ ] Fix `Cargo.toml` description to match current PRODUCT positioning (drop "non-AI").
- [ ] Maintain `CHANGELOG.md` (Keep-a-Changelog format).
- [ ] Generate SBOM + third-party-attribution NOTICE during the build.

### Stage D — Quality
- [ ] Add an end-to-end Rust test that invokes the real bundled Demucs sidecar against a short committed WAV fixture and asserts stem finite-ness + sample-rate + frame count (gated by `cfg(feature = "e2e")`).
- [ ] Add tests for `analyze_track`, the audio_io decode path (WAV/MP3/FLAC), and `stems://progress` event emission.
- [ ] Add Criterion benches under `src-tauri/benches/` for STFT throughput; track regressions.
- [ ] Add a re-entrancy guard / single-job lock on `extract_stems`.
- [ ] Add a job id to `ProgressEvent`.
- [ ] Add `tracing` with a rolling on-disk log under `$APPDATA/logs/`.
- [ ] Multi-format export: 16-bit + 32-bit float WAV, FLAC, AIFF; add proper dither on float→i24.
- [ ] Add visual regression (Playwright + pixelmatch) replacing the dimension-only screenshot check.
- [ ] WCAG 2.1 AA pass: keyboard reachability of timeline, focus rings on dark backgrounds, contrast on `--quiet` text.

### Stage E — Launch
- [ ] **Ship-blocker:** add `LICENSE` (pick one — proprietary EULA or OSS).
- [ ] **Ship-blocker:** write `PRIVACY.md` and document the network-call audit; add a hardened CSP to `tauri.conf.json`.
- [ ] Add `TERMS.md` / EULA.
- [ ] Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- [ ] Write end-user docs: first-run onboarding, supported-formats matrix, system requirements, FAQ, troubleshooting (especially the `RuntimeUnavailable` path), pricing/business-model.
- [ ] Build a marketing site / store listing with real screenshots and feature copy.
- [ ] Write a `NOTICE` / third-party-attribution doc covering Demucs, PyTorch, torchaudio, soundfile, Symphonia, RustFFT, hound, Tauri, React, lucide-react.
- [x] Reconcile `docs/PRODUCT.md` cleanup default with the shipped default (now on-by-default in both).
- [ ] Run a closed beta on 20–30 mixed Windows machines; capture install/launch/extract telemetry-by-consent.
- [ ] GA v1.0.0 — signed Windows installer + signed macOS DMG, published auto-update channel, public privacy + license + EULA.

---

## 8. Quick start

```bash
# clone
git clone https://github.com/DanielKinsner/yes-stems.git
cd yes-stems

# install JS deps
npm install

# (one-time) set up the local Demucs venv for dev
pwsh scripts/setup-demucs.ps1

# run the desktop app in dev (auto-reload)
npm run tauri dev

# run the verification lanes
npm test                # vitest
npm run verify:rust     # fmt + clippy + cargo test
npm run verify:fast     # frontend + rust
npm run verify:ui       # branch + frontend + screenshot
npm run verify:release  # branch + fast + screenshot

# build Windows installers (NSIS + MSI)
npm run build:windows               # no bundled Demucs sidecar
npm run build:windows:standalone    # PyInstalls Demucs + bundles weights, then builds

# post-install smoke (run after installing the standalone NSIS)
pwsh scripts/smoke-installed-demucs.ps1
```