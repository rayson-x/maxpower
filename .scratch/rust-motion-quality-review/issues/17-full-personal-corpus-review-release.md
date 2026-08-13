# 17 — Full personal-corpus review release

**What to build:** Assemble the completed action slices into one frozen, launchable release that processes all existing personal videos, clearly separates blind evidence from full-data proposals and lets the user review and manually export Rust's first-pass turnaround and quality interpretations.

**Blocked by:** 05 — Barbell bench quality proposal slice; 06 — Barbell row quality proposal slice; 07 — Machine chest press quality proposal slice; 08 — Seated shoulder press quality proposal slice; 09 — Push-up quality proposal slice; 10 — Lat pulldown quality proposal slice; 11 — Pull-up quality proposal slice; 12 — Seated row quality proposal slice; 13 — Straight-arm pulldown quality proposal slice; 14 — Lateral raise quality proposal slice; 15 — Rear-delt fly quality proposal slice; 16 — Unilateral cable lateral raise quality proposal slice.

**Status:** review-ready

- [ ] The release inventory contains all 50 unique personal videos, 54 exact-context records and 464 existing human start/end intervals without asking for re-annotation.
- [ ] A frozen blind run exists before any full-data proposal run and the two artifacts cannot be mistaken for one another.
- [ ] Every exact context is labeled `quality_supported`, `phase_supported`, `observation_only` or `unsupported` according to delivered evidence.
- [ ] Reports expose Rep precision/recall/exact-set and start/end timing separately from turnaround proposal coverage and per-conclusion review status.
- [ ] Quality reporting includes each claim's proposal rate, abstention rate, false-finding rate where reviewed truth exists and limitations by action/view/capability; no blended standardness accuracy is produced.
- [ ] Historical peak candidates are displayed only as quarantined diagnostics and never scored as human turnaround truth.
- [ ] The review application opens the full proposal queue, preserves synchronized video/skeleton/equipment/timeline evidence and exports one versioned manual-review JSON artifact.
- [ ] The release performs no automatic training, Profile mutation, client product integration or production promotion.
- [ ] A reproducibility manifest pins the Rust engine, input model, action bundle, Profile/RulePack, packet schema and source hashes for every result.
- [ ] Final documentation states exactly what the single-user corpus proves and what it cannot establish about new users, new locations or physiological causes.
