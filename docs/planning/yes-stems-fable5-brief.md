# YES Stems — Fable 5 Planning Brief

*Instantiation of `fable5-plan-elicitation.md` for YES Stems. Scope: **technical /
architecture only** (no GTM/pricing this pass). Access model: **agentic — Fable can read the
repo**. Output: **layered strategy + decision-complete tasks**.*

---

## A. The master prompt (paste this into a fresh agentic Fable 5 session in the repo)

```
You are the most capable model that will ever touch this repository. You are the accountable
principal architect for YES Stems. Cheaper models (Opus/Sonnet/Haiku) will implement your plan
verbatim and will NOT exercise independent judgment. Every decision you leave open, they will
make — and make worse. Your job is to make the decisions so they don't have to.

── CONTEXT BOOTSTRAP ──────────────────────────────────────────────
Before planning, READ these, in order:
  1. STATUS.md          (self-audit: what works, what's partial, what's a gap, roadmap A–E)
  2. docs/PRODUCT.md    (product canon, modes, quality/UX contracts, Non-Goals, Deferred)
  3. docs/ARCHITECTURE.md (Tauri + React/TS frontend, Rust DSP, Demucs sidecar boundary)
  4. docs/RESEARCH.md   (engine choices; future SCNet / BS-RoFormer / ONNX / CoreML direction)
  5. docs/RELEASE.md, docs/TESTING.md
Then READ the code those docs describe — at minimum:
  src-tauri/src/{commands,separation,ml_engine,stem_cleanup,audio_io,types}.rs,
  src/App.tsx, src/App.css, scripts/build-demucs-sidecar.ps1, src-tauri/tauri.conf.json.
VERIFY the docs against the code. Do not trust any summary, including the docs or this brief.
Reconstruct the true current state yourself and flag every place the docs have drifted
(STATUS.md itself admits drift: RESEARCH.md is "an iteration behind"; Cargo.toml description
may still misdescribe the product). Report drift as its own short section.

── MANDATE ────────────────────────────────────────────────────────
Produce the plan that takes YES Stems from its current pre-release alpha to a TECHNICALLY
SHIPPABLE product: a signed, installable, offline stem-extraction desktop app that will not
OOM, ships local ML that "just works," and is release-engineered and tested. Business,
pricing, and go-to-market are OUT OF SCOPE for this pass.

You have full authority to challenge the architecture, reorder priorities, and add work I have
not imagined. Tell me what I should be asking that I'm not — the risks and decisions I am blind
to. If one large fork would eliminate several problems at once, name it even if I didn't ask.
(For example: does replacing the PyInstaller Python/Demucs sidecar with a native ONNX Runtime /
Core ML inference path collapse the signing, installer-size, and weight-provenance problems into
one decision? Decide whether that belongs before or after v1. Don't just mention it — rule on
it, with reasoning.)

── SEED CONCERNS (address AT LEAST these; do NOT limit yourself to them) ──
Engine / DSP:
  • SHIP-BLOCKER: whole-file in-memory DSP in separation.rs (~800MB spectra for a 5-min stereo
    track → OOM on 8GB machines; tests only cover 0.5s clips). Design chunked/overlap-add
    streaming OR a hard length cap with an honest UI error. Decide which, and the exact seam.
  • Single-threaded DSP (no rayon); STFT + N inverse passes sequential per channel.
  • No resampler / channel downmix / mono↔stereo handling.
Local ML / Demucs sidecar:
  • SHIP-BLOCKER-ADJACENT: Demucs model + runtime commercial licensing/provenance. As a
    TECHNICAL decision: verify htdemucs/htdemucs_6s weight redistribution rights, OR fine-tune/
    train own weights on licensed data, OR swap to a permissively-licensed model. Pick a path.
  • Windows-only sidecar today. Design build:macos:standalone (.app) and build:linux:standalone
    (ELF) PyInstaller-equivalent lanes.
  • CPU-only shipped torch. Design CUDA (Win/Linux) + Apple MPS (macOS) variants, device
    autodetect, and a guard against a user selecting cuda on a CPU-only build.
  • Installer size: --onedir torch+torchaudio+numpy + two ~80MB .th checkpoints → hundreds of
    MB. Set an installer-size budget and a trim plan.
  • Checkpoint integrity: SHA-256 verify + mirror fallback + resume for .th downloads; a
    build-time gate that fails the bundle when demucs-runtime/demucs.exe is missing; an
    install-time check that staged checkpoints actually load.
  • Demucs child: no timeout, no streamed stdout/stderr (UI is dark between progress 0.08–0.72);
    runtime --help probe cold-starts Python on every UI poll.
Release engineering:
  • SHIP-BLOCKER: Authenticode signing for NSIS + MSI AND the bundled demucs.exe + its DLLs
    (SmartScreen/AV friction guaranteed unsigned).
  • tauri-plugin-updater channel: signed updates, hosted manifest, pubkey.
  • CI currently runs verify lanes only; design the installer-build + artifact-archiving +
    release automation (Python 3.12 + venv + PyInstaller + WiX/NSIS).
Testing:
  • Real-Demucs e2e Rust test (cfg feature) against a short committed WAV fixture.
  • Tests for analyze_track, the audio_io decode path (WAV/MP3/FLAC), progress-event emission.
  • Criterion benches for STFT throughput; visual-regression replacing the dimension-only
    screenshot check.

── OUTPUT CONTRACT ────────────────────────────────────────────────
Produce TWO layers.

STRATEGY LAYER:
  • Phases with explicit sequencing rationale and a dependency graph.
  • A risk register (risk · likelihood · blast radius · mitigation).
  • A decision log: every architectural decision, the runner-up, and why.

TASK LAYER: decision-complete tasks. Each task MUST contain:
  ID · phase · depends-on
  Goal (one line)
  Files to create/modify (EXACT paths)
  Chosen approach + rejected alternatives + WHY   (inline mini-ADR)
  Interface changes (Rust types, fn signatures, Tauri command contracts, TS props/events)
  Acceptance criteria (tie to real lanes: npm run verify:rust / verify:frontend / verify:ui,
    or a named new test)
  Risk + rollback note
  Definition of done (one line)

── RULES ──────────────────────────────────────────────────────────
• Where you would hedge or list options, PICK, and record the runner-up + why. Ambiguity is a
  defect; implementers cannot choose.
• Spend reasoning on judgment, not typing. Write tasks in DENSE DECISION FORMAT — high
  decision-density, low prose. Mark any judgment-free task `[routine — any model can detail]`.
• Preserve the product's Non-Goals (no cloud, no silent upload, no false multitrack claims,
  no unreviewed bundled weights) — a plan that violates them is wrong by construction.
• End with a SELF-RED-TEAM: weakest task, riskiest ordering assumption, most likely field
  failure (e.g. an 8GB laptop, a non-ASCII path, a CUDA-on-CPU mismatch). Revise before finishing.

Deliver the plan as structured markdown suitable for saving to docs/plans/ with stable task IDs.
```

---

## B. Question bank (for follow-up Fable sessions, budget permitting)

**Broad "let it cook" openers** — use when you want emergence, not coverage:
1. "If YES Stems were *your* product and you had to ship it in 6 weeks, what would you cut,
   what would you refuse to ship without, and what would you build that isn't on any current
   list? Rule on each."
2. "What is the single highest-leverage architectural change available right now — the one that
   makes the most downstream problems disappear? Argue for and against it, then decide."
3. "Where is this codebase lying to itself? Find the gap between what the docs/UI claim and what
   the code actually guarantees, and turn each into a task."

**Narrow targeted follow-ups** — use to deep-drill a single decision after the master pass:
4. "Design the exact streaming/overlap-add seam for separation.rs: block size, hop, edge
   handling, memory ceiling, and the test that proves the ceiling holds. Show the function
   signatures."
5. "Produce the complete Authenticode + notarization plan across Windows (NSIS+MSI+demucs.exe)
   and macOS, including where secrets live in CI and the exact signing invocations."
6. "Decide the Demucs-weight provenance path with a legal-adjacent technical analysis: what's
   redistributable, what isn't, and the concrete engineering work each option implies."
7. "Design the native-inference migration (ONNX Runtime / Core ML) that would retire the Python
   sidecar: model export path, Rust inference boundary that keeps the existing Tauri command
   contract, and a phased cutover that never breaks the shipped app."

---

## C. Budget sequencing for YES Stems (7-day Fable window)

- **Session 1 (Fable, dense):** the master prompt above → strategy layer + decision-complete
  task stubs. Save to `docs/plans/`.
- **Session 2 (cheap, e.g. Opus):** inflate stubs → full prose tasks; begin implementing the
  Phase-A tasks that need no further Fable input.
- **Reserve** one Fable follow-up for the single hardest fork the master pass surfaces
  (likely the sidecar-vs-native-inference decision, or the provenance path) using a narrow
  question from §B.

---

## D. Seed-list provenance

Every seed concern above is lifted from the repo's own `STATUS.md` (§4 subsystem breakdown,
§6 known risks, §7 roadmap A–E) — so Fable is being seeded with the project's *actual* declared
gaps, not invented ones. If STATUS.md changes, re-mine it before the next Fable session.
