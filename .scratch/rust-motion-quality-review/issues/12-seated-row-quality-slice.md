# 12 — Seated row quality proposal slice

**What to build:** Produce horizontal-pull-specific Rust endpoints and visible movement-strategy proposals for annotated seated-row views.

**Blocked by:** Nothing for Audit A; 02 and source-independent executable evidence for Audit B.

**Status:** ready-for-human (Audit A) / data-gated (Audit B)

**Evidence state:** evidence-gated for blind-run/model acceptance.

Delivered implementation, not an accuracy claim:

- [x] The action contract treats seated row independently from lat pulldown.
- [x] Front-left-45, rear-left-45 and right-side contexts have explicit observability/capability states.
- [x] Shared Rust facts cover visible ROM/phase/support/bilateral/path evidence without inventing cable-handle tracking; unavailable side-view bilateral evidence can abstain.

Evidence still required:

- [x] Fresh seated-row full-data proposals for every annotated view are exposed for Audit A.
- [ ] Provide source-independent executable profiles plus untouched/new sources.
- [ ] Publish fresh blind Rep/start/end and proposal/abstention metrics by view before Audit B.
