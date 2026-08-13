# 01 — Canonical Rust assessment spine

**What to build:** Make one complete training set flow through the existing Rust Motion SDK lifecycle and emerge as one immutable canonical packet containing three causal endpoint snapshots and eight facts-only quality dimensions. Web and native consumers decode the same additive quality payload without owning a second interpretation engine.

**Blocked by:** None — can start immediately.

**Status:** review-ready

- [ ] A configured set can begin, consume chronologically ordered observations and finish with `start_anchor`, `primary_turnaround` and `end_return` snapshots for every sealed Rep.
- [ ] Each turnaround distinguishes when reversal occurred from when enough future evidence causally confirmed it; confirmation never precedes occurrence.
- [ ] The final canonical packet carries an additive, length-prefixed QLT1 proposal while preserving all existing Rep, landmark, angle and equipment semantics.
- [ ] All eight quality dimensions are present and initially support explicit facts, `cannot_judge` and `not_applicable` states with evidence and reasons; no aggregate standardness score exists.
- [ ] Repeated set finalization returns the same sealed proposal and content hash rather than running analysis again.
- [ ] Equipment-constrained landmarks remain predicted and cannot be counted as an independent measured pose channel.
- [ ] Legacy packets remain readable, new decoders read legacy packets, malformed or oversized quality payloads fail deterministically, and WASM/native golden tests agree on structured output.
- [ ] Client adapters only decode and project the Rust proposal; no TypeScript, Kotlin or Swift quality recalculation is introduced.
