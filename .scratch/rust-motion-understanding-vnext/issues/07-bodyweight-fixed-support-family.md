# 07 — Body-only and fixed-support reuse

**What to build:** Reuse the complete motion-understanding engine for actions that need no moving external load: push-up uses body-only evidence and pull-up uses the body moving relative to a fixed support.

**Blocked by:** 02 — First complete motion-understanding tracer.

**Status:** completed

- [x] Push-up resolves a pose-only Bundle and never waits for or fabricates moving equipment evidence.
- [x] Pull-up resolves a fixed-support Bundle; the support may define a spatial relation without being treated as a moving trajectory.
- [x] Each supported context completes the full evidence→Rep→Feature→Comparison→Rep rules→Set aggregation→Set rules→Trace→SealedSetAssessment chain.
- [x] Task completion, visible range/return, phase control, support/trunk facts and observation confidence follow action/view-specific observability rules.
- [x] Fixed support or relevant body landmarks that are not observable produce dimension-level abstention rather than a fabricated endpoint.
- [x] Governed replay tests cover the current push-up and pull-up contexts and preserve complete trace lineage despite no moving equipment channel.
