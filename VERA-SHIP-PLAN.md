# YES Stems — Ship Plan

*Written by Vera, 2026-07-12 (Fable session). Current state verified against `origin/main` @ 09899b8.*

## Where it actually is
Further along than "fairly." This is a **Tauri 2 desktop app** (React 19 + TS frontend, Rust backend) with a **local Demucs sidecar** for ML stem separation. The end-to-end pipeline already works: load file → analyze → separate (Local ML 6/4-stem via Demucs, or 2 classic-DSP Rust modes) → solo/mute/audition → export WAV/FLAC (16/24/32-bit + FLAC w/ dither). Real spectrum + loudness visualizations, transport scrubbing, cancel, drag-drop, persisted settings, error boundary, keyboard shortcuts. Verification is **green** (12 Vitest + tsc/build, 28 Rust tests + clippy -D warnings, CI on windows-latest). Docs are thorough and code-accurate. Idle since 2026-07-01. All three local clones are the same repo; **there is no orphaned work** — main is the truth.

**The big strategic fact:** because separation runs *locally* on the user's machine, there is **no cloud/GPU/hosting/compute cost** to run this as a business. The entire "hard part" is packaging + legal, not infrastructure. That's a huge margin advantage.

## Definition of "shipped" (v1)
A **Windows** user downloads a signed installer, installs, drags in a song, gets clean stems out, and pays for it — with no OOM crash on a normal 8GB laptop and no scary SmartScreen wall.

## Critical path (ordered — do them in this sequence)

**Phase 0 — Clear the one true gate (LEGAL, do first, it's non-code):**
1. Resolve **Demucs weight provenance/commercial-licensing**. htdemucs weights are MIT-code but the *training-data/redistribution* question is the actual blocker to selling. Decision needed (see below). Until this is answered, everything else is polishing a thing that can't legally be sold. **This is the real bottleneck, not engineering.**

**Phase 1 — Make it un-crashable + un-scary (engineering, ~1-2 focused sessions):**
2. **Bound the RAM.** `separation.rs` spikes ~800MB+ on a 5-min stereo track (OOM risk on 8GB). For v1, do the *cheap* version first: a hard **length cap + pre-flight RAM/duration warning** (ship-safe in an afternoon), and defer the full chunked/streaming OLA rewrite to v1.1. Don't let perfect block ship.
3. **Code-sign** the NSIS/MSI installers *and* the bundled `demucs.exe`/DLLs (Authenticode cert). This kills the SmartScreen/AV friction that would tank first-run conversion. ~$200-400/yr cert; this is a purchase + CI wiring task.
4. **Guard against the "silent no-ML installer."** Add a build-time gate so `tauri build` cannot ship without `build:demucs-sidecar` having run (right now a plain build produces an installer with zero local ML and only a tooltip explaining it — that's a support-ticket landmine).

**Phase 2 — Make it sellable (business/marketing):**
5. Pricing + business-model doc (one-time license vs. subscription — I lean **one-time license w/ paid major-version upgrades**, since there's no recurring server cost to justify a sub, and "buy it once, runs offline forever, your audio never leaves your machine" is the whole pitch).
6. Landing page / store listing + onboarding/FAQ. The privacy story ("no uploads, no cloud, works offline") is the marketing spearhead — lead with it.
7. Checkpoint integrity (SHA-256 verify + mirror for the `.th` downloads) so first-run model fetch can't silently corrupt.

**Phase 3 — Reach (defer past v1):**
8. macOS/Linux sidecar builds + Tauri updater/auto-update + CI-driven installer builds. All real, all post-first-ship.

## Ship blockers, ranked
1. **Demucs commercial-licensing** (legal, blocks selling) — Phase 0.
2. **Code-signing** (unsigned = SmartScreen wall on every install) — Phase 1.
3. **RAM/OOM on 8GB** (crash risk) — Phase 1, mitigatable with a length-cap for v1.

## Decisions I need from you (my rec on each)
- **macOS/Linux in v1?** → *My rec: NO. Windows-only v1.* It removes the entire cross-platform sidecar-build + second-signing-cert burden and gets you selling months sooner. Add Mac in v1.1.
- **Full streaming-DSP rewrite before ship, or length-cap now?** → *My rec: length-cap + warning now, streaming in v1.1.* Don't let a 5-min-track RAM edge case delay a shippable product.
- **Demucs licensing** → this needs a real answer. Options: (a) confirm the htdemucs weights are redistributable for commercial use (research/legal), (b) offer the app as a *tool* and have the user download weights themselves on first run (shifts the redistribution question), or (c) ship the classic-DSP Rust modes as the paid product and Demucs as "bring-your-own." I can research (a) and draft the first-run-download flow for (b) if you point me.
- **Pricing model** → one-time vs sub (I lean one-time — see Phase 2).

## What I'd do first (single next move)
**Answer the Demucs licensing question**, because it's the only thing that can invalidate all the engineering. In parallel it's safe for me to knock out the **RAM length-cap + pre-flight warning** and wire the **build-time ML-presence gate** — both are pure upside regardless of the licensing outcome. Point me and I'll start there.

*(Note: there's already a `docs/planning/yes-stems-fable5-brief.md` you wrote — a master prompt to generate a `docs/plans/` strategy that was never run. This plan supersedes/answers most of it; tell me if you still want that fuller agentic pass.)*
