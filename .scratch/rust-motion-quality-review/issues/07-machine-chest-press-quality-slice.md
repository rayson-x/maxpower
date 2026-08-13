# 07 — Machine chest press quality proposal slice

**What to build:** Produce press-specific Rust phase, endpoint and direct quality proposals for the annotated machine chest press contexts while declaring unavailable equipment tracking.

**Blocked by:** 03 for fresh Audit A release; 02 and source-independent executable evidence for Audit B.

**Status:** needs-info

**Evidence state:** evidence-gated for blind-run/model acceptance.

Delivered implementation, not an accuracy claim:

- [x] The action contract covers the annotated front and front-right-45 contexts and maps the shared endpoint schema to press phases.
- [x] Missing dedicated machine-handle tracking is represented as missing evidence rather than inferred from wrists.
- [x] Pose-supported task/ROM/phase/support/bilateral/path facts are capability-bounded, and standard-reference conclusions can abstain.

Evidence still required:

- [ ] Regenerate real full-data proposals and expose every target for Audit A.
- [ ] Provide source-independent executable profiles plus untouched/new sources.
- [ ] Publish fresh blind Rep/start/end and per-dimension proposal/abstention metrics by view before Audit B.
