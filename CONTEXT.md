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
