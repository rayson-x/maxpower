# 04 — Cable and moving-handle fixed-equipment reuse

**What to build:** Reuse the complete motion-understanding engine for current fixed-equipment actions whose meaningful moving evidence is a cable bar or handle, while retaining useful pose-only conclusions when that moving part is not observable.

**Blocked by:** 02 — First complete motion-understanding tracer.

**Status:** completed

- [x] Lat pulldown, seated row, straight-arm pulldown and single-arm cable lateral raise resolve action-specific cable/handle equipment semantics from ActionDefinition.
- [x] The adapter tracks the applicable moving bar or handle independently from fixed machine structure and from pose evidence.
- [x] When the moving part is not visible, equipment-dependent features abstain while pose-supported task, Rep and quality facts remain available where the ExecutionContract permits them.
- [x] Unilateral cable motion binds to an anatomical side only when observed motion evidence establishes it; ambiguous or occluded side remains unknown.
- [x] Each supported context completes the full evidence→Rep→Feature→Comparison→Rep rules→Set aggregation→Set rules→Trace→SealedSetAssessment chain.
- [x] Conflict between pose phase and moving-handle phase is preserved as conflict/cannot-judge rather than forced agreement.
- [x] Governed replays cover all current cable/handle action/view contexts and report per-context evidence and quality-dimension availability.
