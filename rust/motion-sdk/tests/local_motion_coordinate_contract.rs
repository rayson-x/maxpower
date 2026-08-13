use maxpower_motion_sdk::{
    AdapterCapabilities, ContinuityMode, ContractVersion, DiagnosticLevel, EquipmentAttributes,
    EquipmentAxis2d, EquipmentKind, EquipmentObservation, EquipmentSource, ExerciseProfile,
    FrameLease, FrameObservations, InferenceAdapter, MotionError, MotionSession, NormalizedRect,
    PoseCandidate, PoseObservation, RecordingOutputAdapter, RepDisposition, SessionConfig,
    SubjectPolicy,
};
use std::{
    collections::VecDeque,
    sync::{Arc, atomic::AtomicUsize},
};

fn local_bar_frame(progress: f32, angle: f32) -> FrameObservations {
    let cross = [angle.cos(), angle.sin()];
    let primary = [-cross[1], cross[0]];
    let center = [0.5 + primary[0] * progress, 0.35 + primary[1] * progress];
    let half = 0.25;
    let axis = EquipmentAxis2d {
        x1: center[0] - cross[0] * half,
        y1: center[1] - cross[1] * half,
        x2: center[0] + cross[0] * half,
        y2: center[1] + cross[1] * half,
    };
    FrameObservations {
        pose_candidates: vec![PoseCandidate {
            id: 7,
            bbox: NormalizedRect::new(0.05, 0.02, 0.90, 0.94),
            observations: vec![PoseObservation::new(0.5, 0.5, 0.0, 0.10); 26],
            torso_color: [0.2, 0.3, 0.4],
        }],
        equipment: vec![EquipmentObservation {
            proposal_id: 11,
            kind: EquipmentKind::BarbellShaft,
            bbox: NormalizedRect::new(
                axis.x1.min(axis.x2),
                axis.y1.min(axis.y2),
                (axis.x2 - axis.x1).abs(),
                (axis.y2 - axis.y1).abs().max(0.005),
            ),
            axis: Some(axis),
            score: 0.96,
            uncertainty_px: Some(1.0),
            source: EquipmentSource::Geometry,
            attributes: EquipmentAttributes::default(),
        }],
    }
}

#[derive(Clone)]
struct LocalProfileFixture {
    frames: VecDeque<FrameObservations>,
}

impl InferenceAdapter for LocalProfileFixture {
    fn infer(&mut self, _frame: &FrameLease) -> Result<FrameObservations, MotionError> {
        Ok(self.frames.pop_front().unwrap())
    }
}

struct ObliqueBarFixture {
    frames: Vec<f32>,
}

impl InferenceAdapter for ObliqueBarFixture {
    fn infer(&mut self, _frame: &FrameLease) -> Result<FrameObservations, MotionError> {
        let center_y = self.frames.remove(0);
        Ok(FrameObservations {
            pose_candidates: vec![PoseCandidate {
                id: 7,
                bbox: NormalizedRect::new(0.10, 0.08, 0.80, 0.84),
                observations: vec![PoseObservation::new(0.5, 0.5, 0.0, 0.95); 26],
                torso_color: [0.2, 0.3, 0.4],
            }],
            equipment: vec![EquipmentObservation {
                proposal_id: 11,
                kind: EquipmentKind::BarbellShaft,
                bbox: NormalizedRect::new(0.20, center_y - 0.06, 0.60, 0.12),
                axis: Some(EquipmentAxis2d {
                    x1: 0.20,
                    y1: center_y - 0.04,
                    x2: 0.80,
                    y2: center_y + 0.04,
                }),
                score: 0.94,
                uncertainty_px: Some(1.5),
                source: EquipmentSource::Geometry,
                attributes: EquipmentAttributes::default(),
            }],
        })
    }
}

#[test]
fn canonical_equipment_preserves_the_measured_oblique_shaft() {
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:oblique-shaft:v1.9".into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        ObliqueBarFixture { frames: vec![0.44] },
        output.clone(),
    )
    .unwrap();

    session
        .offer(FrameLease::fixture(1, 1_000, Arc::new(AtomicUsize::new(0))))
        .unwrap();

    let packet = output.packets().into_iter().next().unwrap();
    let axis = packet.equipment.tracks[0].axis.unwrap();
    assert_eq!(axis.x1, 0.20);
    assert_eq!(axis.y1, 0.40);
    assert_eq!(axis.x2, 0.80);
    assert_eq!(axis.y2, 0.48);
    assert!(axis.image_angle_radians() > 0.0);
}

fn run_coordinate_sequence(
    axis_rotation_radians: f32,
    translation: [f32; 2],
    scale: f32,
    centers: Vec<f32>,
) -> Vec<maxpower_motion_sdk::LocalMotionCoordinateEvidence> {
    struct TransformFixture {
        centers: Vec<f32>,
        angle: f32,
        translation: [f32; 2],
        scale: f32,
    }
    impl InferenceAdapter for TransformFixture {
        fn infer(&mut self, _frame: &FrameLease) -> Result<FrameObservations, MotionError> {
            let progress = self.centers.remove(0);
            let cross = [self.angle.cos(), self.angle.sin()];
            let primary = [-cross[1], cross[0]];
            let center = [
                self.translation[0] + self.scale * (0.50 + primary[0] * progress),
                self.translation[1] + self.scale * (0.50 + primary[1] * progress),
            ];
            let half_length = 0.25 * self.scale;
            let axis = EquipmentAxis2d {
                x1: center[0] - cross[0] * half_length,
                y1: center[1] - cross[1] * half_length,
                x2: center[0] + cross[0] * half_length,
                y2: center[1] + cross[1] * half_length,
            };
            Ok(FrameObservations {
                pose_candidates: vec![PoseCandidate {
                    id: 7,
                    bbox: NormalizedRect::new(0.0, 0.0, 1.0, 1.0),
                    observations: vec![PoseObservation::new(0.5, 0.5, 0.0, 0.10); 26],
                    torso_color: [0.2, 0.3, 0.4],
                }],
                equipment: vec![EquipmentObservation {
                    proposal_id: 11,
                    kind: EquipmentKind::BarbellShaft,
                    bbox: NormalizedRect::new(
                        axis.x1.min(axis.x2),
                        axis.y1.min(axis.y2),
                        (axis.x2 - axis.x1).abs(),
                        (axis.y2 - axis.y1).abs().max(0.005),
                    ),
                    axis: Some(axis),
                    score: 0.95,
                    uncertainty_px: Some(1.0),
                    source: EquipmentSource::Geometry,
                    attributes: EquipmentAttributes::default(),
                }],
            })
        }
    }

    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:local-coordinate:invariance".into(),
            contract: ContractVersion { major: 1, minor: 9 },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        TransformFixture {
            centers: centers.clone(),
            angle: axis_rotation_radians,
            translation,
            scale,
        },
        output.clone(),
    )
    .unwrap();
    session.begin_set();
    for index in 0..centers.len() {
        session
            .offer(FrameLease::fixture(
                index as u64 + 1,
                1_000 + index as u64 * 50,
                Arc::new(AtomicUsize::new(0)),
            ))
            .unwrap();
    }
    output
        .packets()
        .into_iter()
        .map(|packet| packet.local_motion_coordinate)
        .collect()
}

#[test]
fn per_set_coordinate_is_causal_and_invariant_to_camera_plane_transform() {
    let progress = vec![0.0, 0.005, 0.025, 0.050, 0.080];
    let baseline = run_coordinate_sequence(0.10, [0.0, 0.0], 1.0, progress.clone());
    let transformed = run_coordinate_sequence(0.55, [0.08, -0.05], 0.75, progress);
    assert_eq!(baseline.len(), transformed.len());
    let baseline_last = baseline.last().unwrap();
    let transformed_last = transformed.last().unwrap();
    assert_eq!(
        baseline_last.state,
        maxpower_motion_sdk::LocalCoordinateState::Frozen
    );
    assert_eq!(baseline_last.state, transformed_last.state);
    let baseline_progress = baseline_last.equipment.unwrap().along_axis_progress;
    let transformed_progress = transformed_last.equipment.unwrap().along_axis_progress;
    assert!((baseline_progress - transformed_progress).abs() < 0.02);
    assert_ne!(
        baseline_last.raw_bar_angle_radians,
        transformed_last.raw_bar_angle_radians
    );
}

#[test]
fn future_frames_cannot_rewrite_already_emitted_coordinate_facts() {
    let shared_prefix = vec![0.0, 0.005, 0.025, 0.050];
    let mut first = shared_prefix.clone();
    first.extend([0.08, 0.12]);
    let mut changed_future = shared_prefix;
    changed_future.extend([-0.18, -0.30]);
    let first = run_coordinate_sequence(0.18, [0.0, 0.0], 1.0, first);
    let changed_future = run_coordinate_sequence(0.18, [0.0, 0.0], 1.0, changed_future);
    assert_eq!(&first[..4], &changed_future[..4]);
}

#[test]
fn opt_in_local_bench_profile_consumes_normalized_progress_and_seals_endpoint_snapshots() {
    let progress = [0.0; 12]
        .into_iter()
        .chain([
            0.02, 0.06, 0.12, 0.20, 0.30, 0.34, 0.33, 0.30, 0.22, 0.12, 0.04, 0.01,
        ])
        .chain([0.0; 6])
        .collect::<Vec<_>>();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:local-bench-profile".into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        LocalProfileFixture {
            frames: progress
                .iter()
                .copied()
                .map(|value| local_bar_frame(value, 0.28))
                .collect(),
        },
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(
            ExerciseProfile::barbell_bench_press_local_front_left_provisional(),
        )
        .unwrap();
    session.begin_set();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..progress.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    let mut reps = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .collect::<Vec<_>>();
    reps.extend(session.finish_set());
    let rep = reps
        .iter()
        .find(|rep| rep.disposition != RepDisposition::Rejected)
        .expect("normalized candidate must produce one reviewable rep");
    let endpoints = rep
        .normalized_endpoints
        .as_ref()
        .expect("three normalized snapshots");
    assert_eq!(rep.disposition, RepDisposition::NeedsReview);
    assert_eq!(
        rep.evidence_reason,
        Some(maxpower_motion_sdk::RepEvidenceReason::CoordinateProvisional),
    );
    assert_ne!(
        endpoints.start_anchor.state,
        maxpower_motion_sdk::LocalCoordinateState::Frozen,
        "the first causal anchor must retain its pre-freeze coordinate state",
    );
    assert_eq!(
        endpoints.coordinate_frame_id,
        endpoints.start_anchor.coordinate_frame_id
    );
    assert!(
        endpoints
            .primary_turnaround
            .equipment
            .unwrap()
            .along_axis_progress
            > 0.5
    );
    assert!(
        endpoints
            .end_return
            .equipment
            .unwrap()
            .along_axis_progress
            .abs()
            < 0.10
    );
    assert!(endpoints.primary_turnaround.raw_bar_axis.is_some());
}

#[test]
fn seated_barbell_shoulder_press_has_distinct_local_profile_and_dumbbell_does_not_enable_it() {
    let barbell = ExerciseProfile::seated_barbell_shoulder_press_local_front_left_provisional();
    let dumbbell = ExerciseProfile::dumbbell_shoulder_press_front_provisional();
    assert_eq!(barbell.coordinate_unit, "set-normalized-local-motion");
    assert_eq!(
        barbell.state_machine_id,
        "local-barbell-shoulder-press-ready-effort-return/v1"
    );
    assert!(barbell.identity.contains("/barbell/"));
    assert!(dumbbell.identity.contains("/dumbbell/"));
    assert_ne!(barbell.state_machine_id, dumbbell.state_machine_id);
    assert_ne!(
        barbell.start_amplitude,
        ExerciseProfile::barbell_bench_press_local_front_provisional().start_amplitude
    );
}

#[test]
fn seated_barbell_shoulder_press_runs_its_own_causal_local_profile() {
    let progress = [0.0; 12]
        .into_iter()
        .chain([
            0.03, 0.08, 0.15, 0.24, 0.33, 0.38, 0.37, 0.33, 0.24, 0.14, 0.05, 0.01,
        ])
        .chain([0.0; 6])
        .collect::<Vec<_>>();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:local-seated-barbell-shoulder-press".into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        LocalProfileFixture {
            frames: progress
                .iter()
                .copied()
                .map(|value| local_bar_frame(value, 0.28))
                .collect(),
        },
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(
            ExerciseProfile::seated_barbell_shoulder_press_local_front_left_provisional(),
        )
        .unwrap();
    session.begin_set();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..progress.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    let mut reps = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .collect::<Vec<_>>();
    reps.extend(session.finish_set());
    let rep = reps
        .iter()
        .find(|rep| rep.disposition != RepDisposition::Rejected)
        .expect("shoulder-press candidate must produce one reviewable rep");
    assert_eq!(
        rep.profile_identity,
        "seated-shoulder-press/front-left-45/bilateral/barbell/local-v1",
    );
    assert!(rep.normalized_endpoints.is_some());
}

#[test]
fn predicted_or_weak_wrists_do_not_double_count_equipment_as_pose_corroboration() {
    let evidence =
        run_coordinate_sequence(0.22, [0.0, 0.0], 1.0, vec![0.0, 0.005, 0.025, 0.050, 0.080]);
    let frozen = evidence.last().expect("coordinate evidence");
    assert_eq!(
        frozen.channel_agreement,
        maxpower_motion_sdk::LocalChannelAgreement::EquipmentOnly,
    );
    assert!(frozen.equipment.is_some());
    assert!(frozen.pose.is_none());
    assert_eq!(
        frozen.equipment.unwrap().provenance,
        maxpower_motion_sdk::LocalChannelProvenance::EquipmentMeasured,
    );
    assert!(frozen.equipment.unwrap().coverage > 0.0);
    assert!(frozen.equipment.unwrap().uncertainty >= 0.0);
    assert_eq!(
        frozen.endpoint_order_mapping,
        maxpower_motion_sdk::EndpointOrderMapping::ScreenOrderedAnatomyUnknown,
    );
}

#[test]
fn a_missing_shaft_clears_frame_local_trajectory_instead_of_reusing_stale_progress() {
    let mut frames = [0.0, 0.005, 0.025, 0.050, 0.080]
        .into_iter()
        .map(|value| {
            let mut frame = local_bar_frame(value, 0.22);
            frame.pose_candidates[0].observations[9] =
                PoseObservation::new(0.46, 0.50 + value, 0.0, 0.95);
            frame.pose_candidates[0].observations[10] =
                PoseObservation::new(0.54, 0.50 + value, 0.0, 0.95);
            frame
        })
        .collect::<Vec<_>>();
    frames.push(FrameObservations {
        pose_candidates: vec![PoseCandidate {
            id: 7,
            bbox: NormalizedRect::new(0.05, 0.02, 0.90, 0.94),
            observations: vec![PoseObservation::new(0.5, 0.5, 0.0, 0.95); 26],
            torso_color: [0.2, 0.3, 0.4],
        }],
        equipment: Vec::new(),
    });
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:local-coordinate:equipment-loss".into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        LocalProfileFixture {
            frames: frames.into(),
        },
        output.clone(),
    )
    .unwrap();
    session.begin_set();
    for frame_id in 0..6 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                1_000 + frame_id * 50,
                Arc::new(AtomicUsize::new(0)),
            ))
            .unwrap();
    }
    let coordinate = output
        .packets()
        .last()
        .expect("loss packet")
        .local_motion_coordinate
        .clone();
    assert_eq!(
        coordinate.reason,
        Some(maxpower_motion_sdk::LocalCoordinateReason::NoMeasuredBarAxis),
    );
    assert!(coordinate.equipment.is_none());
    assert!(coordinate.raw_bar_axis.is_none());
    assert_eq!(
        coordinate.channel_agreement,
        maxpower_motion_sdk::LocalChannelAgreement::PoseOnly,
    );
    assert!(coordinate.pose.is_some());
    assert!(coordinate.pose.unwrap().coverage > 0.0);
}
