# 14 — Lateral raise quality proposal slice

**What to build:** Produce bottom-start Rust phase semantics and observable shoulder-raise proposals for annotated front-view lateral raise.

**Blocked by:** Nothing for Audit A; 02 and source-independent executable evidence for Audit B.

**Status:** ready-for-human (Audit A) / data-gated (Audit B)

**Evidence state:** evidence-gated for blind-run/model acceptance.

Delivered implementation, not an accuracy claim:

- [x] The action contract starts with the correct concentric/eccentric order while retaining the common three-endpoint structure.
- [x] Shared Rust facts cover task/ROM/phase/support/bilateral/path/confidence with explicit abstentions.
- [x] Wrist trajectories remain pose evidence when no verified dumbbell producer exists, and a possible momentum cue requires more than one noisy frame/feature.

Evidence still required:

- [x] Fresh front-view full-data proposals are exposed for Audit A.
- [ ] Provide source-independent executable profiles plus untouched/new sources.
- [ ] Publish fresh blind Rep/start/end and proposal/abstention metrics before Audit B.
