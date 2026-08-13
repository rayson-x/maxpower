# 03 — Manual per-conclusion review and export

**What to build:** Provide a launchable Web review surface for real frozen Rust runs where the user can inspect video, skeleton, equipment trajectory, endpoints and each individual quality conclusion, then explicitly export immutable review decisions as JSON.

**Blocked by:** 01 — Canonical Rust assessment spine; 02 — Blind single-pass evaluator.

**Status:** review-ready

- [ ] The page loads frozen blind proposals without changing their values, hashes, evidence or confidence.
- [ ] Every Rep exposes separate review controls for each endpoint and each concrete quality conclusion rather than one whole-Rep verdict.
- [ ] Each review decision supports `correct`, `incorrect` and `cannot_judge`; corrected value and note are optional, and `incorrect` with a null correction remains valid.
- [ ] Endpoint corrections can identify the reviewed turnaround while preserving Rust's original proposal.
- [ ] Video playback, frame stepping, skeleton, equipment path, proposal timeline and human start/end overlay stay synchronized.
- [ ] Review actions remain local page state until the user explicitly clicks Export.
- [ ] No review action performs background persistence, automatic training, Profile mutation or production promotion.
- [ ] The exported versioned JSON contains proposal hashes, per-conclusion decisions, optional corrections, reviewer/export metadata and enough lineage for deterministic round-trip validation.
- [ ] Reopening an export reproduces the same decisions without converting null corrections into missing or accepted truth.
