# Form Coach context

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
- **Simulation baseline**: a five-split 32-node phase template. It can guide exploratory trajectory comparison and recommended camera position, but cannot produce a correctness score, medical claim, or automatic rep rejection.

## Non-negotiable invariants

1. The Rust canonical packet is the only source for rendering, persistence, exported data, rep boundaries, and trajectory evidence.
2. User workout footage may calibrate observation conditions only after explicit approval; it must not silently become a standard-form trajectory.
3. Missing landmarks remain unknown. The system never fills them from another person, mirrors them without evidence, or fabricates coordinates.
4. Historical source video, canonical packets, annotations, and approved analysis versions are immutable. New analysis creates a new version.

## Current implementation state (2026-08-05)

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
- Simulated priors guide capture, phase labels and exploratory comparison only.
  They cannot emit a correctness score, a medical claim, or automatically
  reject a user movement.

### Home-workout technical validation

- Four provisional, front-view bodyweight profiles now share the Rust
  `alternating-ready-effort-return/v1` graph: `march_in_place`,
  `side_step_touch`, `alternating_knee_raise`, and `step_jack`. One complete
  unilateral excursion and return is one rep; the selected profile is fixed
  before the set and is never inferred from free movement.
- Web/WASM and Android consume canonical packet minor `1.5` from the same Rust
  crate. Android uses the MediaPipe lite model by default, latest-frame CameraX
  scheduling, and the Rust native ABI; Kotlin and TypeScript do not own a
  second counter. Apple native library generation also uses the same crate,
  while the full iOS client build is deferred from this delivery.
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
