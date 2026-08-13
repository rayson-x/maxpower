# 03 — Manual per-conclusion review and export

**What to build:** Provide a launchable Web surface for frozen Rust proposals where the user can inspect synchronized evidence, review each endpoint and conclusion independently, and explicitly export immutable review decisions as JSON.

**Blocked by:** 01 — Canonical Rust assessment spine. Audit A also requires the fresh release assembled by 17; Audit B additionally requires 02.

**Status:** ready-for-human (Audit A) / data-gated (Audit B)

**Audit lane:** Audit A is open on the fresh full-data calibration release and its current tests are recorded. Loading untouched model-acceptance proposals remains data-gated with 02.

Delivered implementation evidence:

- [x] Every Rep exposes separate controls for each endpoint and each concrete quality conclusion rather than one whole-Rep verdict.
- [x] Decisions support `correct`, `incorrect` and `cannot_judge`; corrected value and note are optional, including `incorrect + corrected_value=null`.
- [x] Endpoint corrections preserve Rust's original proposal and proposal hash.
- [x] Video playback, frame stepping, skeleton, equipment path, proposal timeline and human start/end overlay share one timestamp.
- [x] Review actions auto-save only to browser `localStorage`, scoped by release ID and frozen hash, and restore after refresh; explicit Export remains required for a portable review artifact.
- [x] No review action writes to the server or performs automatic training, Profile mutation or production promotion.
- [x] The export contract carries proposal hashes, per-target decisions, optional corrections and reviewer/export lineage and preserves null corrections on round trip.

Fresh-release gate:

- [x] Rebuild the current full-data release and verify the page loads its exact proposal bytes, hashes, evidence and confidence unchanged.
- [x] Re-run document/UI/server/export tests against that release and record fresh counts in `REVIEW-HANDOFF.md`.
- [ ] For Audit B only, repeat the same immutable loading behavior on a future untouched model-acceptance release.
