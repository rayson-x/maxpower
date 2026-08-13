# 05 — Barbell bench quality proposal slice

**What to build:** Produce Rust endpoints, pose/equipment trajectory evidence, direct observable findings and honest abstentions for front, front-left-45 and front-right-45 barbell bench, then separate calibration review from future model acceptance.

**Blocked by:** 03 — fresh calibration review release; 04 — verified policy consumption; 02 — untouched evidence for model acceptance.

**Status:** ready-for-human (Audit A) / data-gated (Audit B)

**Evidence state:** `touched_benchmark` for the six existing bench videos. Full-data proposals may enter Audit A after the fresh-release gate, but they cannot satisfy Audit B.

Delivered implementation evidence:

- [x] The bench action contract maps shared endpoints to bench eccentric/concentric semantics.
- [x] Rust can carry phase/external-load path evidence and pose-supported joint/trunk evidence with separate lineage.
- [x] The eight quality dimensions and concrete abstain reasons are represented per Rep without an aggregate score.
- [x] Front-oblique raw endpoint pixel slope is not presented as physical left/right height.
- [x] Persistent bilateral findings are phrased as visible imbalance and do not infer strength, force or muscle activation.

Evidence still required:

- [x] Regenerate and verify the full-data bench proposals under the selected per-view calibration policy, then expose every target in Audit A.
- [x] Insert fresh proposal/capability counts from the regenerated artifacts; do not reuse old counts.
- [ ] Evaluate an untouched/new-source bench set once before publishing model-acceptance Rep, phase, endpoint or quality metrics.
