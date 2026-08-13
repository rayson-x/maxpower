# 16 — Unilateral cable lateral raise quality proposal slice

**What to build:** Preserve the four split contexts, count each side's complete cycle independently, and produce side-aware Rust endpoints and proposals under each exact view window.

**Blocked by:** Nothing for Audit A; 02 and source-independent executable evidence for Audit B.

**Status:** ready-for-human (Audit A) / data-gated (Audit B)

**Evidence state:** evidence-gated for blind-run/model acceptance.

Delivered implementation, not an accuracy claim:

- [x] Front-left and rear-right timeline windows remain intentional context splits for immutable source videos.
- [x] Each unilateral cycle is one Rep with anatomical side; left-right alternation is not required or invented.
- [x] Side-specific endpoints, phase semantics, capability and abstention states are represented by the shared Rust contract.
- [x] Missing cable-handle tracking and view/side ambiguity stay explicit rather than swapping anatomical labels.

Evidence still required:

- [x] Fresh proposals for every split context are exposed for Audit A.
- [ ] Provide source-independent executable profiles plus untouched/new sources.
- [ ] Publish fresh blind Rep/start/end and proposal/abstention metrics by exact context window before Audit B.
