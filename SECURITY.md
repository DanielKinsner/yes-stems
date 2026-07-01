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

- **Content-Security-Policy.** A hardened policy is now set in `tauri.conf.json`
  (`app.security.csp`) — asset protocol + IPC only, no remote origins:

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

  **Smoke-test required before release:** run `npm run tauri dev`, load a track, extract, and
  **play a stem** — audio audition uses the asset protocol, so if `media-src` is wrong, playback
  breaks silently. If so, adjust `media-src`/`img-src` (the asset host is `http://asset.localhost`
  on Windows) rather than reverting to `csp: null`.
- **Code signing.** Installers and the bundled `demucs.exe` are not yet Authenticode-signed.
- **Checksum verification** of downloaded model weights at build time.
