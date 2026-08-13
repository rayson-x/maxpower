# 08 — Seated shoulder press quality proposal slice

**What to build:** Produce view-bounded Rust endpoints and quality proposals for annotated front-view seated shoulder press without reusing bench geometry.

**Blocked by:** Nothing for Audit A; 02 and source-independent executable evidence for Audit B.

**Status:** ready-for-human (Audit A) / data-gated (Audit B)

**Evidence state:** evidence-gated for blind-run/model acceptance.

Delivered implementation, not an accuracy claim:

- [x] The action contract maps shared endpoints to the correct press phase order independently from bench.
- [x] Task/ROM/phase/support/bilateral/path/confidence facts and abstention states are available through the shared Rust contract.
- [x] Missing load tracking and unreliable/occluded upper-limb evidence remain explicit rather than being interpolated into measured truth.

Evidence still required:

- [x] Fresh full-data proposals expose every target for Audit A.
- [ ] Provide a source-independent executable profile plus untouched/new sources.
- [ ] Publish fresh blind Rep/start/end and proposal/abstention metrics before Audit B.
