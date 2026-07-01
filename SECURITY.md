# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for anything
security-sensitive.

- Preferred: GitHub → **Security** → **Report a vulnerability** (private advisory) on
  [DanielKinsner/yes-stems](https://github.com/DanielKinsner/yes-stems/security/advisories/new).

Include steps to reproduce, affected version, and impact. We aim to acknowledge reports within a
few days and to coordinate a fix and disclosure timeline with you.

## Scope & threat model

YES Stems is a **local, offline desktop application**. It has no server, no accounts, and no
network calls at runtime (see `PRIVACY.md` for the audit). The main trust boundaries are:

- The **Tauri capability allowlist** (`src-tauri/capabilities/default.json`) — currently limited to
  `core:default`, `dialog:default`, `opener:default`.
- The **asset-protocol scope**, restricted to the working-stems directories under
  `$APPDATA`/`$APPLOCALDATA`/`$TEMP` so stem playback cannot read the wider filesystem.
- The **bundled Demucs sidecar**, which runs as a local subprocess over a temporary workspace.

Relevant classes of issue: path traversal in export/working directories, unsafe handling of
untrusted audio input, and privilege scope of the webview.

## Hardening backlog

- **Content-Security-Policy.** `tauri.conf.json` currently sets `csp: null`. A hardened policy for
  this app (asset protocol + IPC only) is recommended and should be verified against a real
  `tauri dev`/build run — audio audition uses the asset protocol, so the policy must allow it:

  ```
  default-src 'self';
  connect-src 'self' ipc: http://ipc.localhost;
  img-src 'self' asset: http://asset.localhost https://asset.localhost data:;
  media-src 'self' asset: http://asset.localhost https://asset.localhost;
  style-src 'self' 'unsafe-inline';
  script-src 'self';
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none'
  ```

  This is documented here (rather than applied blind) because it must be smoke-tested in the
  packaged app — a too-strict `media-src`/`img-src` would break stem playback.
- **Code signing.** Installers and the bundled `demucs.exe` are not yet Authenticode-signed.
- **Checksum verification** of downloaded model weights at build time.
