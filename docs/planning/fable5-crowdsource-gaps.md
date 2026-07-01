# Fable 5 Framework — Crowd-Blend & Gap Analysis

*You ran the same opening prompt across 5 Claude-Opus-4.8 sessions (this one + 4 siblings).
This worksheet blends them into one master framework and tracks what any single session missed.*

**Method:** convergence validates the method; divergence is the cross-pollination gold. A
concern *type* that surfaced in another repo (e.g. "dependency license provenance," "secret
handling in CI," "data-loss on crash") is a candidate to transfer here even if that session's
repo was unrelated.

---

## 1. Session roster

| # | Repo | Model | Access model it assumed | Scope it chose | Output captured? |
|---|------|-------|-------------------------|----------------|------------------|
| 0 | YES Stems (this) | Opus 4.8 | agentic | technical only | ✅ this framework |
| 1 | _tbd_ | Opus 4.8 | | | ⬜ paste below |
| 2 | _tbd_ | Opus 4.8 | | | ⬜ |
| 3 | _tbd_ | Opus 4.8 | | | ⬜ |
| 4 | _tbd_ | Opus 4.8 | | | ⬜ |

---

## 2. Component convergence matrix

For each framework component, note whether the siblings **converged** (validates it),
**diverged** (blend candidate), or **added something we lack** (import it).

| Component | Ours | Sib 1 | Sib 2 | Sib 3 | Sib 4 | Verdict / merge action |
|-----------|------|-------|-------|-------|-------|------------------------|
| §1 Role / operating model | relay + "make the decisions" | | | | | |
| §2 Context bootstrap | read docs → verify vs code, flag drift | | | | | |
| §3 Mandate + cook license | "what am I not asking" + big-fork invite | | | | | |
| §4 Seed-list method | mine STATUS/roadmap/deferred | | | | | |
| §5 Output: two layers | strategy + tasks | | | | | |
| §6 Task schema | decision-complete (mini-ADR inline) | | | | | |
| §7 Decision-forcing | pick + record runner-up | | | | | |
| §8 Self-red-team | attack own plan | | | | | |
| §9 Budget meta | dense decision format; mark routine | | | | | |
| Budget strategy | 2-pass decision/typing split | | | | | |
| *(new component?)* | — | | | | | |

---

## 3. Distinctive moves per sibling

*Paste the standout idea(s) each sibling produced that ours did not. One block per session.*

### Sibling 1 — <repo>
- 

### Sibling 2 — <repo>
- 

### Sibling 3 — <repo>
- 

### Sibling 4 — <repo>
- 

---

## 4. "What we may have missed" — running list

Candidate gaps to pressure-test against YES Stems specifically. Seeded with likely blind spots
in *our* pass; extend as siblings come in.

- [ ] **Cross-cutting concern types** siblings raised that transfer here (license provenance,
      CI secret handling, crash-safety / partial-write recovery, telemetry-by-consent, i18n,
      accessibility, data retention of the `$APPDATA/working-stems/` folder).
- [ ] **Did our seed list over-fit STATUS.md?** STATUS.md is self-authored — it may share our
      blind spots. What would a fresh reader flag that STATUS.md never mentions?
- [ ] **Did we cap Fable anywhere?** Re-read the master prompt for any narrow instruction not
      wrapped in a broad mandate.
- [ ] **Scope boundary risk:** we excluded GTM/business. Are there *technical* decisions
      (e.g. pricing-tier feature gating, license-key enforcement, update entitlement) that our
      "technical only" scope wrongly excludes?
- [ ] **Verification of the plan itself:** how will we know a Fable plan is *good* before
      spending cheap-model tokens implementing it? (Define an acceptance bar for the plan.)
- [ ] **Handoff fidelity test:** pick one decision-complete task and dry-run whether a Haiku-tier
      model could implement it with zero further decisions. If not, the schema needs more.

---

## 5. Merge log

*Record each accepted merge so the master framework's provenance is auditable.*

| Date | From | Change to master | Rationale |
|------|------|------------------|-----------|
| | | | |
