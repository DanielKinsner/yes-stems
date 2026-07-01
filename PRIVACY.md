# Privacy

YES Stems is a **100% local, offline** desktop application. Your audio never leaves your
machine. There is no account, no telemetry, no analytics, and no cloud processing.

## What the app does with your files

- **Source audio** you open is decoded **in memory** for analysis and separation. It is never
  copied off your device.
- **Extracted stems** are written to a per-run working folder under your OS app-data directory
  (`%APPDATA%/com.yesstems.desktop/working-stems/…` on Windows) and, when you choose **Export**,
  copied to a folder **you** select.
- The **Local ML** modes run a bundled Demucs model as a **local subprocess**. `TORCH_HOME` is
  pointed at the bundled model cache, so the model does **not** download anything at runtime.

## Network-call audit

This claim is backed by an audit of the source, not just a promise. As of **2026-06-30**:

| Surface | Finding |
|---|---|
| Frontend (`src/`) | No `fetch`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon` calls. |
| Rust backend (`src-tauri/src/`) | No HTTP/socket code (`reqwest`, `std::net`, `hyper`, …). |
| Tauri capabilities (`src-tauri/capabilities/default.json`) | Only `core:default`, `dialog:default`, `opener:default` — **no HTTP or updater permission** is granted to the webview. |
| Registered plugins (`src-tauri/src/lib.rs`) | Only `dialog` and `opener`. No `http`, no `updater`. |
| Asset access | The `protocol-asset` scope is restricted to the working-stems directories under `$APPDATA`/`$APPLOCALDATA`/`$TEMP`, so stem audio can be auditioned without exposing the wider filesystem. |

`reqwest`/`hyper`/`tokio` appear only as **transitive entries** in `Cargo.lock` (pulled in by the
Tauri crate); they are not referenced by any application code and no network permission is exposed
to reach them.

### The only network access is at build time

Building the standalone installer (`scripts/build-demucs-sidecar.ps1`) downloads the Demucs model
weights (`.th` files) and Python packages **once, on the developer's machine**, and bundles them
into the installer. The shipped application performs no downloads.

## Reproducing the audit

```bash
# Frontend — expect no matches:
rg -n "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" src/
# Rust — expect no matches:
rg -n "reqwest|std::net|TcpStream|hyper|http://|https://" src-tauri/src/
# Capabilities — expect only core/dialog/opener:
cat src-tauri/capabilities/default.json
```

## Changes to this policy

If a future version adds any network feature (e.g. an opt-in update check), it will be documented
here and in `CHANGELOG.md` before release, and gated behind an explicit user choice.
