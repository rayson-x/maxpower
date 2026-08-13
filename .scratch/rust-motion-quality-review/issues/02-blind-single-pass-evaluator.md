# 02 — Blind single-pass evaluator

**What to build:** Run existing personal videos exactly once through the canonical Rust set seam without exposing human Rep timestamps, freeze the prediction, then reveal existing truth and produce an auditable alignment report distinct from any full-data proposal run.

**Blocked by:** 01 — Canonical Rust assessment spine.

**Status:** review-ready

- [ ] The inference pack contains exercise and selected view context but excludes human Rep start/end, historical peak candidates, review decisions and same-source fitted derivatives.
- [ ] Every source video and all its derivatives stay in one split; the target source is excluded from fitted Profile or RulePack material during its blind run.
- [ ] Frames are submitted once, in source timestamp order, through the same client-format causal observation contract used by the SDK.
- [ ] Prediction bytes, proposal hashes, run manifest and versions are frozen before truth is loaded for scoring.
- [ ] The revealed report separately shows Rep precision, recall, exact-set rate, start error and end error by action, view and capability level.
- [ ] Blind-evaluation and full-data-proposal identities, directories and headings cannot be confused or aggregated into one accuracy claim.
- [ ] The known total of 464 intervals versus 465 expected Reps remains visible and is not silently repaired.
- [ ] A leakage test fails if any formal truth or same-source fitted trajectory enters inference before the frozen prediction exists.
