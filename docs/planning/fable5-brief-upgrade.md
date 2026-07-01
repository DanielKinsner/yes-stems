# yes-stems — Fable session cook card

> Add-on to [`yes-stems-fable5-brief.md`](yes-stems-fable5-brief.md) +
> [`fable5-plan-elicitation.md`](fable5-plan-elicitation.md) + the shared **Constitution**
> (`…/yes-master/docs/fable-planning/00-FABLE-SUITE-CONSTITUTION.md`). Your decision-complete task
> schema is best-in-class — keep it. This card is only the stuff **Fable can't derive from the
> code**: your intent, and where to let it cook. No bug lists — Fable reconstructs state from HEAD.

## What only you know (feed this; it's not in the code)

- The product is **local / offline stem separation that just works** — never OOMs on a normal
  laptop. Sacred non-goals: no cloud, no silent upload, no false multitrack claims, no unreviewed
  bundled weights.
- "Sellable" this pass is **technical**: signed, installable, fully offline, tested. Pricing/GTM
  are out of scope for the plan.
- This is one app in a family — a track can travel stems → voice → master, so consistency across
  the family matters.

## The one instruction that beats any hand-written status

Trust the code at HEAD over every doc — some of your own status notes contradict themselves and
each other. Reconstruct what actually works before you plan, and flag where the docs and code
disagree.

## Cook here — think past my framing

- If this were yours and you had 6 weeks: what do you cut, what do you refuse to ship without,
  and what do you build that's on no current list? Rule on each.
- The single **highest-leverage architectural change** that makes the most downstream problems
  disappear at once — argue both sides, then decide (and rule whether it belongs before or after
  the first ship).
- The "will it actually run on a real 8GB laptop" question as **one** coupled decision — memory,
  time, install size, cancellability — with real numbers, not four separate policies.

## Cross-repo note (not a dependency)
The sibling app **yes-voice already ships native `ort` (ONNX Runtime)** with a deterministic
fallback — the exact "Python sidecar vs native inference" fork stems is weighing. Have Fable look
at how voice did it as a reference point before deciding stems' path from scratch. That's a tip,
not a blocker — stems can decide on its own.
