# 04 — Freeze pose/equipment fusion by ablation

**What to build:** Compare pose-only, equipment-only and candidate fused causal policies on identical frozen barbell bench and barbell row inputs, then record a versioned per-context policy only where the evidence supports it.

**Blocked by:** 01 — Canonical Rust assessment spine; 02 — Blind single-pass evaluator.

**Status:** review-ready

- [ ] All candidates receive the same chronological observations, action/view context, frame schedule and blind truth split.
- [ ] Reports compare Rep count, start/end alignment, endpoint proposal coverage, evidence conflict, abstention and causal confirmation latency separately.
- [ ] The experiment does not use historical peak candidates as turnaround truth and does not claim unreviewed quality accuracy.
- [ ] A fused candidate preserves channel lineage and cannot reuse equipment-constrained pose as independent corroboration.
- [ ] The decision may select pose-only, equipment-only, a fused policy or no winner for each exact action/view context; a winner is never forced.
- [ ] Any selected policy has a stable identity, content hash, evidence report and explicit claim scope consumed by later action slices.
- [ ] Bench and row results remain separate rather than creating one universal equipment priority.
