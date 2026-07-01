# Fable 5 Plan-Elicitation Framework

*A reusable methodology for extracting decision-complete architectural plans from a
scarce, high-intelligence model (Fable 5), so that cheaper models can implement them
without exercising judgment.*

> **Portable.** This file is repo-agnostic. Only components **§2** and **§4** are filled
> per-repo. Keep the master copy central; drop a repo-specific instantiation
> (e.g. `<repo>-fable5-brief.md`) into each project.

---

## 0. The operating model this is built for

You have a scarce frontier model (Fable 5) and a fleet of cheaper models (Opus/Sonnet/Haiku).
The winning strategy is **not** to have Fable write code. It is to have Fable **make every
decision** and encode those decisions so densely that a cheaper model's only remaining job is
typing.

**Principle — decisions live in the plan, not in the implementation.**
Any choice a cheaper model *could* make (which file, which approach, which signature, which
library, which tradeoff) is a choice Fable *must* make and record. A plan that leaves decisions
open is not a plan; it is a lower-intelligence model deciding your code with extra steps.

---

## 1. The philosophy (why the prompt is shaped the way it is)

- **Precision is a ceiling, not a floor.** Frontier models satisfice — they answer exactly
  what you asked and stop. A narrow question *caps* the model. Never ship a narrow question
  without a broad mandate wrapped around it.
- **Mandate uncaps.** Role + authority + an explicit "expand beyond what I asked" license is
  what turns an advisor into an owner.
- **The rejected alternatives ARE the intelligence.** When a cheap model implements a Fable
  decision, the judgment is invisible unless Fable wrote down what it *didn't* choose and why.
  Capturing rejected options is how you transport judgment across the intelligence gap.
- **Make it verify reality itself.** Never let it plan from your summary alone. Agentic access
  means it reconstructs current state from the code, and catches doc drift.
- **Ask it where it isn't needed.** The expensive model should tell you which tasks are routine
  so you don't burn its budget on boilerplate.

---

## 2. Component library (the meta-prompt, part by part)

Each `§` is a modular block. During crowd-blending we can swap any block for a better version
from another session — see `fable5-crowdsource-gaps.md`.

### §1 — Role & operating model *(reusable verbatim)*
Cast Fable as the accountable principal architect and state the relay out loud:
> "You are the most capable model that will ever touch this repo. Cheaper models will implement
> your plan verbatim and will not exercise independent judgment. Every decision you leave open,
> they will make — and make worse. Your job is to make the decisions so they don't have to."

### §2 — Agentic context bootstrap *(REPO-SPECIFIC)*
> "Before planning: read `<key docs>`. Then read the code those docs describe and **verify the
> docs against the code** — do not trust any summary, including the docs or me. Reconstruct the
> true current state yourself and flag every place the docs have drifted from reality."

### §3 — Broad mandate + the "cook" license *(reusable verbatim)*
> "Take `<repo>` from its current state to `<definition of shippable>`. You have full authority
> to challenge the architecture, reorder priorities, and add work I never imagined. **Tell me
> what I should be asking that I'm not — the risks and decisions I am blind to.** If a single
> large fork would eliminate several problems at once, name it even if I didn't."

### §4 — Seed list of known concerns *(REPO-SPECIFIC)*
Framed as **"address at least these; do not limit yourself to them."** This is the narrow half.
It guarantees your known ship-blockers get covered without capping discovery.

### §5 — Output contract: two layers *(reusable verbatim)*
- **Strategy layer:** phases, sequencing rationale, an explicit dependency graph, a risk
  register, and a decision log.
- **Task layer:** decision-complete tasks per the schema in §6.

### §6 — The decision-complete task schema *(reusable verbatim — the heart)*
Every task MUST contain:
```
ID · phase · depends-on
Goal (one line)
Files to create/modify (exact paths)
Chosen approach + rejected alternatives + WHY   ← the judgment transport (mini-ADR)
Interface changes (types, fn signatures, command/API contracts)
Acceptance criteria (tied to real verify lanes / named tests)
Risk + rollback note
Definition of done (one line)
```

### §7 — Decision-forcing directive *(reusable verbatim)*
> "Where you would normally hedge or list options, **pick**, and record the runner-up and why.
> Ambiguity is a defect — the implementers cannot choose."

### §8 — Self-red-team pass *(reusable verbatim)*
> "Now attack your own plan. What is the weakest task? Which ordering assumption is most likely
> wrong? What would make this fail for a real user in the field? Revise before you finish."

### §9 — Budget meta-instruction *(reusable verbatim)*
> "Spend your reasoning on judgment, not typing. Write tasks in **dense decision format** — high
> decision-density, low prose. Where a task needs no real judgment, mark it
> `[routine — any model can detail]` so I don't spend your budget on boilerplate."

---

## 3. The two-pass budget strategy

Exploit the decision/typing split to stretch a limited Fable budget:

1. **Fable 5 (expensive) → decisions.** One dense session per repo produces the strategy layer
   + decision-complete task *stubs* (every choice made, terse prose). This is where its
   intelligence lives.
2. **Cheaper model → typing.** Inflate each stub into full step-by-step prose and implement,
   making **zero** new decisions. Fable already made them.

**Optional token-saver:** have a cheap model pre-write a *current-state + open-questions brief*
that Fable **corrects** rather than reconstructs from scratch. Composes with agentic access —
Fable verifies the brief against the code instead of building blind.

---

## 4. Instantiating for a new repo (checklist)

- [ ] Fill **§2** with the repo's canonical docs + entry-point source files.
- [ ] Fill **§4** by mining the repo's own status/roadmap docs + a quick read of TODOs, deferred
      lists, and known-risk sections. Group by subsystem.
- [ ] Define "shippable" for **§3** (technical-only? technical + GTM? — decide the scope).
- [ ] Paste §1–§9 into a fresh agentic Fable session in the repo.
- [ ] Run the **question bank** openers if budget allows a second pass.

---

## 5. Crowd-blend status

This framework is the YES Stems / Claude-Opus-4.8 baseline ("ours"). It will be blended with
four sibling sessions. Track merges and gaps in `fable5-crowdsource-gaps.md`.
