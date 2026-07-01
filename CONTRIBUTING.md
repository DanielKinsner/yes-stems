# Contributing to YES Stems

Thanks for your interest! YES Stems is a local-first desktop app (React + TypeScript frontend,
Tauri 2 + Rust backend, optional bundled Demucs sidecar for local ML).

> **Note:** YES Stems is **proprietary, commercial software** (see `LICENSE`). The source is not
> open, and this guide is primarily for the maintainer and any authorized collaborators. External
> contributions can only be accepted under a signed contributor agreement assigning rights to the
> Licensor — please reach out before submitting a change.

## Prerequisites

- **Node.js 20+** and npm
- **Rust** (stable) with `rustfmt` and `clippy`
- For the **Local ML** modes in dev: **Python 3.12** and a Demucs venv
  (`pwsh scripts/setup-demucs.ps1`)

## Getting started

```bash
git clone https://github.com/DanielKinsner/yes-stems.git
cd yes-stems
npm install
npm run tauri dev        # run the desktop app with auto-reload
```

The browser-only preview (`npm run preview:local` after `npm run build`) renders a seeded demo
state and is used for UI screenshots; the real desktop build hydrates from the backend.

## Before you open a PR

Run the verification lanes and keep them green:

```bash
npm run verify:fast      # frontend (vitest + tsc + vite build) + rust (fmt + clippy + cargo test)
```

Useful lanes:

| Command | What it runs |
|---|---|
| `npm test` | Vitest frontend tests |
| `npm run verify:frontend` | `npm test` + `vite build` |
| `npm run verify:rust` | `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test` |
| `npm run verify:ui` | branch + frontend + screenshot dimension check |

CI (GitHub Actions, `windows-latest`) runs `verify:frontend` and `verify:rust` on every push and PR.

## Guidelines

- Branch off `main`; keep commits small and focused with clear messages.
- Match the surrounding code style; `rustfmt` and the existing TypeScript conventions are the
  source of truth. `clippy` runs with `-D warnings`, so treat lints as errors.
- Add or update tests for behavior changes.
- The UI is authored on a fixed **1440×820 design canvas** and scaled to fill the window — make
  CSS changes in that coordinate space (see `src/main.tsx`).
- Preserve the product's core promise: **everything runs locally**. Don't add network calls
  without an explicit, documented, opt-in design (see `PRIVACY.md`).

## Where things live

- `src/` — React frontend (`App.tsx`, `App.css`, `ErrorBoundary.tsx`)
- `src-tauri/src/` — Rust backend (`commands.rs`, `separation.rs`, `ml_engine.rs`, `cancel.rs`, …)
- `scripts/` — build/verify PowerShell scripts
- `docs/` — architecture, product, research, testing, release notes
