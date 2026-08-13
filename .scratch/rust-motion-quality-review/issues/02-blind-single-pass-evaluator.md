# 02 — Untouched single-pass model-acceptance evaluator

**What to build:** Process an untouched/new-source set exactly once through the canonical Rust set seam without exposing human Rep timestamps, freeze predictions, then reveal existing truth and produce an auditable alignment report distinct from touched diagnostics and full-data calibration proposals.

**Blocked by:** 01 — Canonical Rust assessment spine; an untouched/new source set and source-independent executable Profile/RulePack material.

**Status:** needs-info

**Evidence state:** model-acceptance-data-gated. The evaluator plumbing exists, but the current personal corpus cannot honestly satisfy this ticket's acceptance run.

Delivered implementation evidence:

- [x] Inference packs exclude human Rep start/end, historical peak candidates and review decisions before prediction freeze.
- [x] Frames are submitted once, in source timestamp order, through the client-format causal observation contract.
- [x] Prediction payloads, hashes, run manifest and versions are frozen before truth is loaded for scoring.
- [x] Report contracts separate Rep precision, recall, exact-set, start error and end error by action/view/capability.
- [x] Untouched evaluation, touched benchmark and full-data proposal identities are required to remain distinct.
- [x] The 464 human intervals and existing expected-count mismatch remain visible rather than being silently repaired.
- [x] Leakage checks fail closed when formal truth or same-source derivatives enter inference.

Acceptance evidence still required:

- [ ] Acquire an untouched/new user or source/session set that has not influenced training, thresholds, policy selection or result inspection.
- [ ] Resolve every evaluated context to a source-independent executable Profile/RulePack after grouping all same-source derivatives together.
- [ ] Run once, freeze before reveal, and publish fresh model-acceptance metrics with source/session limitations.

The six current bench videos are `touched_benchmark`; unsupported contexts are not successful blind predictions.
