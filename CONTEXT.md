# MaxPower context

## Canonical terms

- **Canonical packet**: the immutable Rust-produced pose packet. Rendering, recording, export, recognition, and review consume the same packet; no consumer recomputes pose state.
- **Recognition profile**: data that configures rep segmentation, counting, and anti-interference for one exercise context. It is never a standard-form reference.
- **Trajectory baseline**: a simulated or calibrated phase trajectory used to describe an observed sealed rep. A simulated baseline is explicitly uncalibrated.
- **Reference trajectory profile**: a strict same-context trajectory profile whose evidence is sufficient for descriptive comparison. It is distinct from a recognition profile.
- **Training set**: the interval beginning when recording starts and ending when recording stops. It may contain preparation, pauses, and training reps.
- **Rep candidate**: a complete motion cycle proposed by the recognition module but not yet necessarily included in training volume.
- **Confirmed rep**: a candidate with sufficient subject, landmark, segmentation, and continuity evidence; it contributes to formal training volume.
- **Needs-review rep**: a candidate with a usable but insufficiently reliable observation, preserved for user review and excluded from formal volume until approved.
- **Rejected candidate**: a proposed cycle that failed a stated evidence rule; it is retained as diagnostic evidence but is not a rep.
- **Simulation baseline**: a five-split 32-node phase template. It can guide internal exploratory trajectory comparison and recommended camera position, but it does not qualify an exercise for user-facing calibrated trajectory or validated-analysis capability and cannot produce a correctness score, medical claim, automatic rep rejection, or specific technique cue.
- **Expected muscle association**: curated exercise knowledge linking an exact exercise context and phase to muscles that commonly contribute mechanically. It is metadata, never an observation of activation or force in the current athlete.
- **Exercise module**: the reviewable expansion unit for one exact exercise context. It joins an exercise identity, expected muscle association, phase-level observable joint motions, capture recommendation, and an explicitly optional recognition or trajectory profile. A catalog entry alone is not a complete or validated exercise module.
- **Observed movement strategy**: canonical-packet evidence describing how visible joints moved within a matched exercise context, such as relative hip/knee excursion, phase timing, or bilateral rhythm. It does not name the muscles that actually produced the movement.
- **Mechanical-demand tendency**: a conditional, evidence-labelled interpretation that an observed movement strategy may shift mechanical demand toward a joint action or muscle group under the same exercise, load, and view context. It is not a muscle-activation percentage or a correctness verdict.
- **Training execution assessment**: an evidence-bounded assessment of whether a performed rep completed the intended movement task, followed the selected technique constraints, and remained compatible with the declared training intent. It joins observed facts and coach inference without pretending to measure force or muscle activation.
- **Movement task completion**: whether the selected exercise produced a confirmable full cycle, reached its required observable endpoint, and returned. It answers whether the task happened, not whether the technique was ideal.
- **Training intent contract**: the versioned context against which an execution is assessed: exact exercise variant, training purpose, intended range and tempo, permitted technique variation, equipment, side, and camera view. When the user has not selected a special variant, the product may use an explicit `standard_variant` default and must show that assumption.
- **Technique adherence**: the degree to which observable defining and stabilizing features stayed inside the selected variant's reviewed execution envelope. It is dimensioned evidence, not a universal form score.
- **Visible movement strategy**: the phase-aligned description of how the user completed the task through observable joint paths, torso motion, bilateral timing, and equipment trajectory. It does not by itself label the strategy correct or identify muscle activation.
- **Coach inference**: a practical, probabilistic interpretation produced from multiple persistent observations and an applicable knowledge pattern, such as likely momentum borrowing or a likely shift of mechanical demand. It must carry supporting evidence, alternative explanations, confidence, and a refusal state.
- **Stimulus compatibility**: whether the observed movement strategy remains consistent with the selected training purpose and exercise variant. It describes likely compatibility or drift; it never claims measured muscle recruitment, force, or injury risk.
- **Effort and dose context**: the combination of observable velocity decay, pauses and failure pattern with user- or record-supplied load, RPE/RIR, set volume and training intent. Video may contribute performance drift evidence but cannot supply subjective effort or actual force.
- **Observation confidence**: a dimension-specific account of whether the required person, pose, equipment, phase and context evidence was available and reliable enough for a judgement. Low confidence produces `cannot_judge`; it is never hidden by a composite score.
- **Deviation-effect pattern**: a reviewed, reusable knowledge rule joining a training purpose, standard execution features, a persistent visible deviation, its likely mechanical or stimulus consequence, alternative explanations, observability requirements, and an actionable coaching cue. A pattern is not enabled for an exercise until explicitly mapped and validated for that exact context.
- **Goal contract**: the versioned agreement describing the user's primary goal, secondary goals, success measures, horizon, constraints, and confidence. A forecast is an evaluation of this contract, not a promise.
- **User profile**: the versioned set of relatively stable facts, capacities, preferences, environments, and constraints about the user. It does not own goals, permissions, performed history, current recovery, or plans.
- **User dossier**: the client-facing composite view commonly called “用户档案”. It joins the current User profile, Goal contract, Coaching mandate, Permission set, Safety constraints, and selected Timeline baselines without merging their ownership or provenance.
- **Onboarding draft**: the editable, provenance-bearing intake state used to assemble the first User dossier. Conversation and form input update the same draft; completion creates or revises the owned domain records only after user confirmation.
- **Baseline intake**: the only three universally required onboarding inputs are age, height, and current weight. A free-language goal is optional: when present it enters Goal negotiation; when absent the confirmed dossier enters record-first without inventing a Goal or Plan. Every other dossier field is captured from the conversation, requested only when material to the next decision, derived as a reviewable candidate, observed later, or left unknown.
- **Training background**: user-confirmed history such as training duration, continuity, recent split, comparable sets, exercise familiarity, and time away from training. It is evidence for assessment, not a self-assigned level.
- **Coaching level assessment**: a versioned, evidence-bounded judgement of the user's current planning and execution needs across separate dimensions. It may use conversation, Training background, comparable performance, and observed execution; it is never treated as a user-confirmed fact or reduced to vocabulary fluency alone.
- **Readiness state**: a time-bounded assessment of what the user can reasonably execute now, derived from recent sleep, fatigue, soreness, performance, schedule, and other confirmed Records. It is not a stable User profile field and must expire or be reevaluated.
- **Current plan stage**: the bounded, currently executable strategy for one Goal contract. It owns the active Plan revision's near-term training intent, progression and observation contract; later stages are generated only after reviewing real Records and never exist as a second goal model.
- **Stimulus slot**: a goal- and context-specific demand that a session must satisfy. It can resolve to different exercise variants without changing its training intent.
- **Exercise variant**: one exact exercise identity including variation and equipment context. Similar names do not make two variants interchangeable.
- **Action motion definition**: the sole view-independent movement-semantic authority for one exact Exercise variant. It names the body and load relations that must move, should coordinate, should remain stable, and indicate substitution, and explains why every required trajectory or joint relation is evidence for that variant; projected plans, profiles, features, and rules may implement or validate it but never redefine it.
- **Action evidence explanation**: the structured, derived account of how an Action motion definition recognizes one Rep: its identity relation, equipment trajectories, skeleton trajectories, joint angles, evidence roles, and the consequence of missing evidence. It exposes the definition without inventing a second movement truth.
- **Required motion relation**: a joint, segment, body-to-load, or load-to-anchor relation that must change direction and traverse an evidence-bounded range for the selected movement task to occur. Avoid: active joint, working muscle.
- **Identity-defining motion relation**: a Required motion relation whose observation distinguishes the selected Exercise variant and is necessary to confirm its Rep. If it cannot be expressed or observed, related endpoint motion may be retained as evidence but cannot become that variant's Confirmed rep.
- **Stability relation**: a relative body, support, or equipment relation expected to remain inside an evidence-bounded corridor while the required motion occurs. “Stable” never means zero image motion or a medical claim of joint safety.
- **Substitution relation**: motion outside the selected variant's required task that may be used to complete the visible load path, such as hip and trunk extension driving a strict barbell row. It becomes a deviation only when observable, persistent, and covered by an applicable rule.
- **Primary motion track**: the subject-associated body or equipment trajectory that defines Rep direction and endpoints for one exact Exercise variant. A wrist track is not a barbell, dumbbell, cable handle, or machine-handle track.
- **Capability refusal**: an explicit result for a complete Exercise variant whose Identity-defining motion relation cannot be expressed or observed under the declared visual context. Missing or conflicting action definitions are definition failures, not capability refusals.
- **Week plan**: the planned intent, schedule, and stimulus budget for one week inside the current Plan revision.
- **Exercise slot**: the resolved place inside a stimulus slot that references one ExerciseVariant and its planned sets, repetitions, load, rest, and effort while preserving the parent stimulus intent.
- **Plan revision**: an immutable version of the current-stage WeekPlan, TrainingSessionPlan, StimulusSlot, and ExerciseSlot content, bound directly to one Goal contract revision. A newer revision never rewrites performed or observed history.
- **Training plan**: the user-facing current-stage arrangement of training days, session purposes, exercises, sets, repetitions, load, rest, effort, and progression for a Goal contract. Avoid: prescription, exercise prescription, training prescription, 处方. In code this is `PlannedSessionData` / `PlannedExerciseTask` / `PlannedExerciseSet` / `PlannedSessionRef`; the older `*Prescription*` type names no longer exist.
- **Training session plan**: the planned tasks, targets, constraints, and intent for one training occasion. Avoid: session prescription, 单次处方.
- **Ledger wire names**: a handful of persisted DomainEvent names and payload keys still spell the old vocabulary — `workout.prescription_revised`, `prescriptionRef`, `frozenPrescription`, `prescriptionSetId`, `prescriptionMode`. They are storage identifiers of already-committed facts, not domain language, and only a ledger schema migration may rename them. New code must not spread these spellings into type or function names.
- **Workout session**: the real execution of a training session plan, including partial, interrupted, skipped, substituted, and unplanned outcomes.
- **Recovery constraint**: a graded, time-bounded limit derived from recovery facts. It constrains planning but does not itself choose exercises, sets, repetitions, or load.
- **Nutrition strategy**: a versioned energy, macronutrient, timing, and adherence strategy coordinated with the active Goal contract and current Plan revision. It is not a food database or a medical diet.
- **Record**: the durable, user-confirmed account of something that happened. A Record is represented by one or more Timeline facts and is the sole source for history, trends, energy accounting, and plan feedback.
- **Capture**: raw input that may describe a Record: manual fields, text, voice, photo, camera output, or imported health data. Capture is not a Timeline fact and is allowed to be incomplete or ambiguous.
- **Record draft**: a typed, editable proposal that translates a Capture into one or more Record candidates, retaining its source and any estimates. It is required for inferred, ambiguous, or incomplete input; a Coach may directly execute a clear user-stated Record only when the active Coaching mandate grants that authority.
- **Record confirmation**: either an explicit user acceptance of a Record draft, or the delegated execution of a clear user-stated Capture under the active Coaching mandate. Inferred values, missing facts, and uncertain source data always require explicit confirmation. Confirmation never erases the original Capture or estimate provenance.
- **Timeline**: the append-only, provenance-bearing history of Records: what actually happened to or was reported by the user. Plans, proposals, Captures, and unconfirmed model estimates are not Timeline facts.
- **Correction event**: a new fact that corrects an earlier Timeline or user-reported outcome without deleting the original evidence.
- **Coaching mandate**: the user's versioned grant of manual, collaborative, or managed authority, scoped by action type, impact radius, limits, locks, and expiry.
- **Coach session**: a durable, discoverable interaction record containing messages, runs, tool calls, artifacts, and pending human decisions for one task context. It can reference facts but is not their authoritative owner.
- **Artifact**: an immutable, versioned, typed result produced from validated local tools or rules and rendered by a fixed client registry.
- **Working memory item**: a non-authoritative, provenance-bearing Coach note or preference that can be reviewed, edited, pinned, forgotten, or proposed for promotion to a fact.
- **Action log**: the append-only history of meaningful Agent, rule, user, sensor, and sync operations, including their evidence, policy decision, causal links, and compensating undo.

## Non-negotiable invariants

1. The Rust canonical packet is the only source for rendering, persistence, exported data, rep boundaries, and trajectory evidence. Android may run either a built-in or data-installed recognition profile. Profile evidence maturity never authorizes a second counter: when an executable profile is active, phase and rep boundaries come only from Rust; when no exact profile resolves, counting is disabled. A recognition initializer may count/segment motion but must never be presented as a correctness claim or score.
2. User workout footage may calibrate observation conditions only after explicit approval; it must not silently become a standard-form trajectory.
3. Missing landmarks remain unknown. The system never fills them from another person, mirrors them without evidence, or fabricates coordinates.
4. Historical source video, canonical packets, annotations, and approved analysis versions are immutable. New analysis creates a new version.
5. Planned, performed, and observed records never overwrite one another. Corrections and undo create new linked revisions or events.
6. LLM text, proposals, assessments, and Working Memory do not become facts without a typed local action accepted under the active coaching mandate.
7. Real-time coaching consumes canonical Rust evidence and never owns a second counter, phase boundary, skeleton, or trajectory truth. The LLM may explain structured evidence but must not create an unobserved deviation or physiological claim.

## Target client motion data flow

- The product target is `Client CameraInputStream → Rust Motion SDK → CanonicalMotionOutput → client projection/Coach tools`.
- Android/iOS own permission, lens selection, preview, orientation and frame lifecycle. They submit versioned frame inputs; they do not own a parallel pose/skeleton/rep-analysis truth.
- Rust Motion SDK owns pose inference or its hidden backend orchestration, skeleton normalization, landmark identity/confidence/unknown semantics, CanonicalPacket, phase/rep disposition/tempo/findings and sealed set output.
- Skeleton points and analysis travel in one versioned output lineage. TypeScript/Kotlin/Swift may render and project them but must not fill landmarks, resegment reps, reinterpret mirroring or persist a second result.
- The frame bridge uses bounded latest-frame/backpressure and explicit begin/pause/resume/finish/reset commands so camera lifecycle and profile changes cannot leak stale frames across sets.
- Current Android code may still contain platform pose preprocessing; that is implementation debt to migrate behind the Rust SDK boundary and must not be treated as the target architecture.

## Current implementation state (2026-08-07)

### Canonical Rust recognition

- Rust/WASM is the canonical producer for pose packets, sealed rep boundaries,
  candidate disposition and profile provenance. TypeScript decodes and renders
  those immutable outcomes; it must not recompute a second rep boundary for a
  Rust-supported context.
- Packet minor `1.5` carries `observation_findings`: primary/secondary range
  below the profile expectation and faster-than-expected cycle. These are
  descriptive evidence, never a form score or a reason to hide a coherent
  small-range movement.
- `Auto` direction is now locked after the first sealed cycle for the active
  set. This prevents a return phase from reopening as an opposite-direction
  ghost rep; `begin_set` resets that lock for the next recorded set.
- A complete but faster-than-expected cycle is `NeedsReview`, not formal
  training volume. It remains in the canonical packet with its evidence.

### Current profile behaviour

- Observed lateral raise / front uses the bounded `soft-cycle/v1` compatibility
  policy; it is a counting initializer, not a normative range requirement.
- Observed rear-delt fly / front uses the versioned
  `wrist-spread-cycle/v2` profile. It segments bilateral wrist spread rather
  than projected shoulder/elbow folds, which markedly reduced false cycles in
  the local replay. Do not mutate the archived v1 profile; add future profile
  versions instead.
- The five-split catalog has uncalibrated simulated trajectory priors. Lower
  body includes bodyweight squat, barbell back squat, Romanian deadlift, and
  conventional deadlift. Conventional and Romanian deadlift are intentionally
  separate identities and never share trajectory gates.
- Simulated priors may produce broad recognition/counting initializers for a
  known action and supported camera position. The initializer configures the
  canonical Rust rep engine; it is not a standard-form reference and cannot
  emit a correctness score, a medical claim, or automatically reject a user
  movement.

### Android motion integration

- Android has an exercise library, camera-position guidance, live recognition
  and a set-report surface. The current product MVP consumes this only through
  the shared `Client CameraInputStream → Rust Motion SDK →
  CanonicalMotionOutput` boundary; recording/training-video capture is not a
  client MVP requirement.
- Android capability is resolver-based, not maturity-tier based. Shared
  TypeScript resolves an exact action×view context to either a built-in Rust
  code, a complete data-installed profile, or none. Both built-in and data
  profiles may emit canonical phase and rep boundaries; evidence maturity is
  separate metadata and does not switch recognition off.
- The Android native view receives one versioned profile envelope. Kotlin
  validates the envelope and installs it through JNI; it does not duplicate
  action×view profile tables or interpret recognition thresholds.
- Dual camera modes: front lens = recognition (user watches the screen),
  back lens = observation (set report is the only feedback loop). Lens
  switching rebinds CameraX; mirroring follows the active lens.
- Live output may be rendered and sealed into the active WorkoutSession through
  the canonical packet lineage. It is not a separate recording demo, and the
  client does not upload it or derive a form score from it.

### Home-workout technical validation

- Four provisional, front-view bodyweight profiles now share the Rust
  `alternating-ready-effort-return/v1` graph: `march_in_place`,
  `side_step_touch`, `alternating_knee_raise`, and `step_jack`. One complete
  unilateral excursion and return is one rep; the selected profile is fixed
  before the set and is never inferred from free movement.
- Web/WASM and Android consume canonical packet minor `1.5` from the same Rust
  crate. Android uses the MediaPipe lite model by default, latest-frame CameraX
  scheduling, and the Rust native ABI; Kotlin and TypeScript do not own a
  second counter. Apple native library generation also uses the same crate.
  The full iOS client was deferred only from the 2026-08-07 home-workout
  validation slice; the complete adaptive Coach MVP requires a production iOS
  client and Android parity.
- The validation harness intentionally reports participant accuracy and
  physical-device performance as `unmeasured` until labeled 45-second rounds
  and a declared eight-minute phone run are supplied. Implemented thresholds
  are <=10% per-action count error, <=1 second start/stop latency, <=1 false rep
  per 30-second rest, >=90% valid frames, >=15 processed FPS, bounded backlog,
  and crash-free execution.

### What 2D video can and cannot establish

- With a matching action/view profile and reliable rep boundary, 2D data can
  align a rep to common phase and compare **projection** evidence: relative
  joint angle, height, bilateral timing, path continuity and tempo.
- 2D data cannot establish muscle activation or "which muscle is working",
  true 3D joint angles, load/force, scapular/spinal state behind occlusion, or
  injury/medical conclusions. Present results as measured evidence or unknown,
  never as a verdict about actual muscle recruitment.
- Local replay evidence is recorded in the ignored report
  `docs/reports/2d-pose-observability-and-phase-alignment-2026-08-05.md`.
  It found good phase alignment for front lateral raise and rear lat pulldown;
  front seated press has an unstable peak proxy; rear-left pulldown and front
  rear-delt fly frequently lack sufficient keypoints. DTW is diagnostic only:
  it must not decide rep count, boundary, or quality verdict.

### Local-data policy

- Field videos, pose sidecars, training annotations and data-derived reports
  stay local and are not committed. `/data/`, local capture archives, training
  data and generated WASM/build outputs are ignored.
- Commit source, tests, public contracts and this context only. Never stage
  archived footage, user annotations or reports containing per-capture results
  unless the user explicitly requests a de-identified publication.

### Next implementation priorities

1. Collect the home-workout validation matrix: at least five held-out users,
   three 45-second rounds per action, 30-second rest negatives, and one
   eight-minute run on the declared mid-range Android phone. Do not promote
   the provisional thresholds before this evidence passes.
2. Remove remaining TypeScript-side re-segmentation/export paths where a Rust
   observed or simulated profile is installed; rendering, persistence and
   review must consume the same canonical packet.
3. Publish a final Rust packet/snapshot for `finish_set` so lifecycle state and
   rejected partial attempts are rendered and persisted canonically.
4. Calibrate one exact action × variation × equipment × camera identity at a
   time using held-out labelled video before using phase comparisons for user
   feedback. Start with front lateral raise or rear lat pulldown, not a weak
   visibility bucket.
