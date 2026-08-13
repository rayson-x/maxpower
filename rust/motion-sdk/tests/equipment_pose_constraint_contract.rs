use std::{
    collections::VecDeque,
    sync::{Arc, atomic::AtomicUsize},
};

use maxpower_motion_sdk::{
    AdapterCapabilities, ContinuityMode, ContinuityReason, ContractVersion, DiagnosticLevel,
    EquipmentAttributes, EquipmentKind, EquipmentObservation, EquipmentSource, ExerciseMaturity,
    ExerciseProfile, ExerciseSignal, ExerciseSignalKind, FrameLease, FrameObservations,
    InferenceAdapter, InferenceResult, LandmarkSource, MotionError, MotionSession,
    MovementDirection, NormalizedRect, PROFILE_CAP_CANONICAL_LANDMARKS, PROFILE_CAP_SUBJECT_LOCK,
    PoseCandidate, PoseObservation, PoseSchemaId, RecordingOutputAdapter, SessionConfig,
    SubjectPolicy,
};

#[derive(Clone)]
struct ObservationSequence {
    frames: VecDeque<FrameObservations>,
}

impl InferenceAdapter for ObservationSequence {
    fn infer(&mut self, _frame: &FrameLease) -> Result<InferenceResult, MotionError> {
        Ok(self.frames.pop_front().unwrap())
    }
}

fn front_bench_equipment_profile() -> ExerciseProfile {
    let mut profile = ExerciseProfile {
        identity: "barbell-bench-press/front/bilateral/barbell/equipment-pose-test-v1".into(),
        content_hash: 0,
        maturity: ExerciseMaturity::Provisional,
        schema: PoseSchemaId::Halpe26,
        coordinate_unit: "image-angle-deg".into(),
        state_machine_id: "barbell-axis-primary-ready-effort-return/v1".into(),
        required_capabilities: PROFILE_CAP_CANONICAL_LANDMARKS | PROFILE_CAP_SUBJECT_LOCK,
        primary_signal: ExerciseSignal {
            kind: ExerciseSignalKind::JointAngle,
            landmarks: vec![6, 8, 10],
        },
        secondary_signal: ExerciseSignal {
            kind: ExerciseSignalKind::JointAngle,
            landmarks: vec![5, 7, 9],
        },
        direction: MovementDirection::Decreasing,
        start_amplitude: 10.0,
        min_primary_amplitude: 30.0,
        min_secondary_amplitude: 30.0,
        return_hysteresis: 15.0,
        ready_tolerance: 8.0,
        max_gap_ms: 500,
        min_rep_duration_ms: 450,
        max_rep_duration_ms: 6_000,
    };
    profile.content_hash = profile.computed_content_hash();
    profile
}

fn pose(left_wrist_y: f32, right_wrist_y: f32, wrist_score: f32) -> PoseCandidate {
    let mut observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.9); 26];
    observations[5] = PoseObservation::new(0.42, 0.42, -0.02, 0.9);
    observations[7] = PoseObservation::new(0.35, 0.45, -0.01, 0.9);
    observations[9] = PoseObservation::new(0.29, left_wrist_y, 0.01, wrist_score);
    observations[6] = PoseObservation::new(0.58, 0.42, -0.02, 0.9);
    observations[8] = PoseObservation::new(0.65, 0.45, -0.01, 0.9);
    observations[10] = PoseObservation::new(0.71, right_wrist_y, 0.01, wrist_score);
    PoseCandidate {
        id: 7,
        bbox: NormalizedRect::new(0.10, 0.05, 0.80, 0.90),
        observations,
        torso_color: [0.2, 0.3, 0.4],
    }
}

fn bar(center_y: f32) -> EquipmentObservation {
    EquipmentObservation {
        proposal_id: 70,
        kind: EquipmentKind::BarbellShaft,
        bbox: NormalizedRect::new(0.20, center_y - 0.01, 0.60, 0.02),
        axis: None,
        score: 0.95,
        uncertainty_px: Some(2.0),
        source: EquipmentSource::Geometry,
        attributes: EquipmentAttributes::default(),
    }
}

fn run(frames: Vec<FrameObservations>) -> Vec<maxpower_motion_sdk::MotionPacket> {
    let inference = ObservationSequence {
        frames: frames.into(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-pose-constraint".into(),
            contract: ContractVersion { major: 1, minor: 7 },
            diagnostics: DiagnosticLevel::Summary,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: ContinuityMode::Fusion,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        inference,
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(front_bench_equipment_profile())
        .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..3 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                1_000 + frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    output.packets()
}

#[test]
fn reliable_bar_path_constrains_only_an_unreliable_wrist_after_a_pose_baseline() {
    let packets = run(vec![
        FrameObservations {
            pose_candidates: vec![pose(0.45, 0.45, 0.95)],
            equipment: vec![bar(0.45)],
        },
        FrameObservations {
            pose_candidates: vec![pose(0.88, 0.86, 0.10)],
            equipment: vec![bar(0.56)],
        },
        FrameObservations {
            pose_candidates: vec![pose(0.70, 0.70, 0.95)],
            equipment: vec![bar(0.60)],
        },
    ]);

    for wrist in [9_usize, 10] {
        let constrained = &packets[1].canonical[wrist];
        assert_eq!(
            constrained.source,
            LandmarkSource::Predicted,
            "an equipment-constrained wrist is not an independent pose measurement"
        );
        assert_eq!(
            constrained.reason,
            Some(ContinuityReason::EquipmentPathConstraint)
        );
        assert!((constrained.y.unwrap() - 0.56).abs() < 0.015);

        let reliable_measurement = &packets[2].canonical[wrist];
        assert_eq!(reliable_measurement.source, LandmarkSource::Measured);
        assert_eq!(reliable_measurement.reason, None);
        assert!((reliable_measurement.y.unwrap() - 0.70).abs() < 0.001);
    }
}

#[test]
fn bar_path_without_a_pose_baseline_does_not_fabricate_wrists() {
    let weak = FrameObservations {
        pose_candidates: vec![pose(0.88, 0.86, 0.05)],
        equipment: vec![bar(0.56)],
    };
    let packets = run(vec![weak.clone(), weak.clone(), weak]);

    for packet in packets {
        for wrist in [9_usize, 10] {
            assert_eq!(packet.canonical[wrist].source, LandmarkSource::Unknown);
            assert_eq!(packet.canonical[wrist].x, None);
            assert_eq!(packet.canonical[wrist].y, None);
        }
    }
}
