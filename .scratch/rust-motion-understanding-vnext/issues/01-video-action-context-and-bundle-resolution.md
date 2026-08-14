# 01 — Video action context and atomic Bundle resolution

**What to build:** Make every currently annotated video establish one immutable Rust recognition context before its first frame. The video supplies its existing action, capture position and source identity; the versioned ActionDefinition derives equipment semantics and resolves one complete assessment Bundle or returns a typed refusal.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] All 54 governed annotation records resolve a typed video context from source identity, exercise and capture position without requiring a repeated per-video equipment field.
- [x] Versioned ActionDefinitions map the current rigid-bar, cable/handle, constrained-machine, dual-dumbbell, body-only and fixed-support actions to their exact equipment semantics and Bundle identities.
- [x] Capture-position aliases normalize to explicit coarse views without claiming a measured physical angle.
- [x] The resolved Bundle atomically binds RecognitionProfile, ExecutionContract, local-coordinate strategy, equipment adapter, FeatureProgram, reference policy, RulePack and lineage.
- [x] Bundle installation rejects unknown action/view combinations, missing lineage, incompatible schema/version/hash, invalid Feature/Rule references and duplicate exact contexts before frame processing.
- [x] A set freezes its context and Bundle; a mid-set action, view, pose-schema or Bundle change produces a typed refusal rather than a hot switch.
- [x] Unilateral cable context may declare observed active-side resolution; when motion evidence cannot establish the side it remains unknown rather than mirrored or guessed.
- [x] Contract tests exercise only the public configure/start/refusal behavior and do not require callers to assemble private engine stages.

Implementation boundary: the current built-in Bundles are explicitly `context_resolution_only`. They resolve and freeze the complete pinned lineage, but reject frame execution and report generation with `BundleNotExecutable`. Ticket 02 is responsible for promoting its first Bundle to executable only after the real Profile → local-coordinate/fusion → Feature → Reference → Rule → aggregation → trace path exists.
