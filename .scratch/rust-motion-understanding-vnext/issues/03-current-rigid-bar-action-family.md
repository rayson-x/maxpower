# 03 — Current rigid-bar action-family reuse

**What to build:** Reuse the complete tracer engine for every currently annotated rigid-bar action and supported view, expressing action differences through versioned Bundles rather than adding action-specific engine branches.

**Blocked by:** 02 — First complete motion-understanding tracer.

**Status:** completed

- [x] Barbell bench press, barbell row and seated barbell shoulder press resolve distinct exact-context Bundles with their own phase order, task endpoints, supported views and observability rules.
- [x] Every supported context runs the complete evidence→Rep→Feature→Comparison→Rep rules→Set aggregation→Set rules→Trace→SealedSetAssessment chain.
- [x] Rigid-bar local-coordinate facts remain causal and view-normalized across current front and oblique views without claiming world 3D or a true horizon.
- [x] Pose and bar evidence may agree, support one available channel, conflict or refuse; the engine never duplicates bar-derived pose as independent evidence.
- [x] Each action produces applicable movement-task, visible range/return, phase control, trajectory, support/bilateral and observation-confidence findings, with unsupported dimensions explicitly abstaining.
- [x] The same-workout reference accepts only compatible action, view, subject, coordinate and load context and never rewrites the evaluated set.
- [x] Governed replay tests cover every current rigid-bar action/view combination and preserve existing Rep-engine regressions.

Implementation note: nine governed rigid-bar action/view contexts are executable. Their exact-context RecognitionProfiles are provisional known-video counting initializers; governed replay provides regression evidence, not an unseen-user accuracy or technique-quality claim. Dimensions without governed quality thresholds remain explicit abstentions.
