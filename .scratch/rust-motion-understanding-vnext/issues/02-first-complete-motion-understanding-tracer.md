# 02 — First complete motion-understanding tracer

**What to build:** Run one governed real rigid-bar exact context through the entire Rust motion-understanding lifecycle and return a non-empty, immutable, trace-backed set assessment. This tracer establishes the reusable engine implementation; it is not a bench-only product scope or a Rep-count-only milestone.

**Blocked by:** 01 — Video action context and atomic Bundle resolution.

**Status:** ready-for-agent

- [ ] A governed real rigid-bar video resolves its Bundle, produces subject-associated bar evidence, establishes or explicitly degrades its action-local coordinate, and preserves independent pose/equipment facts and fusion state.
- [ ] Legitimate long bar evidence is not rejected solely because the shaft extends outside the locked-subject box, while mirror, static and unrelated equipment negatives remain rejected.
- [ ] The existing RepEngine remains the sole owner of Rep candidates, causal endpoints, phase and Confirmed/Needs-review/Rejected disposition.
- [ ] `ExecutionAssessmentEngine` adapts the existing begin/process/pause/resume/finish lifecycle without creating a second counter or exposing internal stages to callers.
- [ ] A bounded typed FeatureProgram produces per-Rep facts with stable IDs, units, status, coverage, confidence, uncertainty, provenance and source ranges.
- [ ] Reference/comparison runtime supports self geometry, set prefix and same-workout snapshots with compare-before-update ordering and explicit cannot-compare states.
- [ ] Rep-scope and set-scope RulePack evaluation produce independent dimension findings or typed abstentions without reading raw landmark indexes directly.
- [ ] `finish_set` finalizes last/partial/rejected candidates, derives set-level persistence and late-set patterns, and returns a non-empty `SealedSetAssessment` rather than placeholder all-cannot-judge output.
- [ ] Every conclusion has one resolvable source→coordinate→fusion→Rep→Feature→Comparison→Rule→Set pattern→Conclusion trace root with stable version lineage and content hash.
- [ ] Repeated `finish_set` returns the same assessment identity and content; the sealed set may update only the reference used by later sets.
- [ ] No recognition, feature, rule or quality branch is keyed directly to the tracer action in the generic engine implementation; action behavior comes from the installed Bundle.
