# 17 — Full personal-corpus calibration review release

**What to build:** Assemble one frozen full-data Rust proposal release for the existing personal corpus, launch the per-target human calibration audit, and keep all model-acceptance evidence visibly separate and fail-closed.

**Blocked by:** Audit A implementation gates are complete. Model-acceptance output remains blocked by 02 and untouched/new-source evidence.

**Status:** ready-for-human (Audit A) / data-gated (Audit B)

**Audit split:** Audit A is `open` on the fresh release; Audit B is `data-gated`.

Delivered inventory/contract evidence:

- [x] The intended inventory is fixed at 50 unique personal videos, 54 exact-context records and 464 existing human start/end intervals without re-annotation.
- [x] Exact contexts can declare `quality_supported`, `phase_supported`, `observation_only` or `unsupported` independently from design intent.
- [x] Historical peak candidates are quarantined diagnostics and are not human turnaround truth.
- [x] The release/export flow performs no automatic training, Profile mutation, client product integration or production promotion.
- [x] Documentation prohibits a blended standardness score and physiological/generalization claims unsupported by the single-user corpus.

Audit A start gate:

- [x] Regenerate the full-data proposal release from current code and insert its actual ID, digest, proposal/capability/equipment counts into `REVIEW-HANDOFF.md`.
- [x] Confirm every full-data endpoint and quality conclusion is independently reviewable with synchronized video/skeleton/equipment/timeline evidence.
- [x] Re-run document, UI, server and export round-trip tests against that exact release and record fresh results.
- [x] Verify the reproducibility manifest resolves engine, input model, action bundle, Profile/RulePack, packet schema and source hashes through authoritative governance.
- [x] Start the human calibration audit only after the four preceding checks pass.

Audit B start gate:

- [ ] Acquire untouched/new-source data and source-independent executable profiles; current bench is touched and most other contexts cannot run after source exclusion.
- [ ] Freeze a single-pass model-acceptance run before revealing truth and publish fresh per-action/view metrics without mixing full-data or touched results.

Fresh counts and hashes are recorded once in `REVIEW-HANDOFF.md`; this ticket does not duplicate them.
