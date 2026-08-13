# 01 — Canonical Rust assessment spine

**What to build:** Make one complete training set flow through the existing Rust Motion SDK lifecycle and emerge as one immutable canonical packet containing three causal endpoint snapshots and eight facts-only quality dimensions. Web and native consumers decode the same additive quality payload without owning a second interpretation engine.

**Blocked by:** None.

**Status:** ready-for-human

**Evidence scope:** implementation contract and cross-runtime behavior only; this ticket does not establish action-recognition accuracy.

- [x] A configured set can begin, consume chronologically ordered observations and finish with `start_anchor`, `primary_turnaround` and `end_return` snapshots for every sealed Rep.
- [x] Each turnaround distinguishes occurrence from causal confirmation; confirmation never precedes occurrence.
- [x] The final canonical packet carries an additive, length-prefixed QLT1 proposal while preserving existing Rep, landmark, angle and equipment semantics.
- [x] All eight quality dimensions support explicit facts, `cannot_judge` and `not_applicable` states with evidence and reasons; no aggregate standardness score exists.
- [x] Repeated set finalization returns the same sealed proposal and content hash rather than running analysis again.
- [x] Equipment-constrained landmarks remain predicted and cannot be counted as an independent measured pose channel.
- [x] Compatibility and cross-runtime tests cover legacy packets, malformed/oversized payloads and structured QLT1 projection.
- [x] Client adapters decode and project Rust output without introducing TypeScript, Kotlin or Swift quality recalculation.

This ticket is ready for implementation review, not marked as model-acceptance complete.
