# 13 — Straight-arm pulldown quality proposal slice

**What to build:** Produce exercise-specific Rust endpoints and direct quality proposals for annotated straight-arm pulldown views.

**Blocked by:** Nothing for Audit A; 02 and source-independent executable evidence for Audit B.

**Status:** ready-for-human (Audit A) / data-gated (Audit B)

**Evidence state:** evidence-gated for blind-run/model acceptance.

Delivered implementation, not an accuracy claim:

- [x] The action contract distinguishes straight-arm pulldown from lat pulldown and row.
- [x] Front-left-45 and front-right-45 share a handedness-preserving semantic family while retaining separate evidence buckets.
- [x] Task/ROM/phase/support/path/confidence facts remain capability-bounded; unsupported bilateral/reference conclusions and missing handle tracking abstain.

Evidence still required:

- [x] Fresh proposals for both oblique views are exposed for Audit A.
- [ ] Provide source-independent executable profiles plus untouched/new sources.
- [ ] Publish fresh blind Rep/start/end and proposal/abstention metrics by view before Audit B.
