# 03 — Current rigid-bar action-family reuse

**What to build:** Reuse the complete tracer engine for every currently annotated rigid-bar action and supported view, expressing action differences through versioned Bundles rather than adding action-specific engine branches.

**Blocked by:** 02 — First complete motion-understanding tracer.

**Status:** ready-for-agent

- [ ] Barbell bench press, barbell row and seated barbell shoulder press resolve distinct exact-context Bundles with their own phase order, task endpoints, supported views and observability rules.
- [ ] Every supported context runs the complete evidence→Rep→Feature→Comparison→Rep rules→Set aggregation→Set rules→Trace→SealedSetAssessment chain.
- [ ] Rigid-bar local-coordinate facts remain causal and view-normalized across current front and oblique views without claiming world 3D or a true horizon.
- [ ] Pose and bar evidence may agree, support one available channel, conflict or refuse; the engine never duplicates bar-derived pose as independent evidence.
- [ ] Each action produces applicable movement-task, visible range/return, phase control, trajectory, support/bilateral and observation-confidence findings, with unsupported dimensions explicitly abstaining.
- [ ] The same-workout reference accepts only compatible action, view, subject, coordinate and load context and never rewrites the evaluated set.
- [ ] Governed replay tests cover every current rigid-bar action/view combination and preserve existing Rep-engine regressions.
