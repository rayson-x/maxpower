# 04 — Freeze pose/equipment fusion by ablation

**What to build:** Compare pose-only, equipment-only and candidate fused causal policies on identical inputs, record the evidence class, and select a versioned per-context policy only where eligible evidence supports it.

**Blocked by:** 01 — Canonical Rust assessment spine; 02 for model acceptance; missing equivalent equipment evidence for contexts where no comparison can be executed.

**Status:** needs-info

**Evidence state:** calibration diagnostic available; acceptance policy data-gated. Bench comparisons use `touched_benchmark` inputs, and row currently has no equivalent frozen equipment sidecar/winner evidence.

Delivered diagnostic evidence:

- [x] Candidate policies consume the same chronological observations, action/view context and frame schedule.
- [x] Diagnostic reports separate Rep count/alignment, endpoint coverage, conflict, abstention and confirmation latency rather than one blended score.
- [x] Historical peaks are excluded as turnaround truth and unreviewed quality accuracy is not claimed.
- [x] Fused lineage distinguishes measured equipment from equipment-constrained predicted pose and does not double-count them as independent channels.
- [x] The decision contract permits pose-only, equipment-only, fused or `no_winner` per exact context.
- [x] Bench and row are separate policy scopes rather than one universal equipment priority.

Acceptance evidence still required:

- [ ] Re-run and verify the selected per-view policy is consumed by the current full-data calibration release.
- [ ] Keep row at `no_winner` until comparable equipment observations exist; do not infer a row policy from bench.
- [ ] Validate any model-acceptance winner on untouched/new sources before promoting it beyond calibration diagnostics.
