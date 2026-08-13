use std::{
    collections::VecDeque,
    sync::{Arc, atomic::AtomicUsize},
};

use maxpower_motion_sdk::{
    AdapterCapabilities, ContinuityMode, ContractVersion, DiagnosticLevel, EquipmentAttributes,
    EquipmentKind, EquipmentObservation, EquipmentSource, ExerciseMaturity, ExerciseProfile,
    ExerciseSignal, ExerciseSignalKind, FrameLease, FrameObservations, InferenceAdapter,
    InferenceResult, MotionError, MotionSession, MovementDirection, NormalizedRect,
    PROFILE_CAP_CANONICAL_LANDMARKS, PROFILE_CAP_SUBJECT_LOCK, PoseCandidate, PoseObservation,
    PoseSchemaId, RecordingOutputAdapter, RepDisposition, RepObservationFinding, SessionConfig,
    SubjectPolicy,
};

#[derive(Clone)]
struct ObservationSequence {
    frames: VecDeque<FrameObservations>,
}

impl InferenceAdapter for ObservationSequence {
    fn infer(&mut self, _frame: &FrameLease) -> Result<InferenceResult, MotionError> {
        Ok(self.frames.pop_front().unwrap_or(FrameObservations {
            pose_candidates: Vec::new(),
            equipment: Vec::new(),
        }))
    }
}

fn weak_subject() -> PoseCandidate {
    PoseCandidate {
        id: 7,
        bbox: NormalizedRect::new(0.12, 0.05, 0.76, 0.90),
        observations: vec![PoseObservation::new(0.5, 0.5, 0.0, 0.05); 26],
        torso_color: [0.2, 0.3, 0.4],
    }
}

fn frame(bar_center_y: f32) -> FrameObservations {
    FrameObservations {
        pose_candidates: vec![weak_subject()],
        equipment: vec![EquipmentObservation {
            proposal_id: 1,
            kind: EquipmentKind::BarbellShaft,
            bbox: NormalizedRect::new(0.20, bar_center_y - 0.01, 0.60, 0.02),
            axis: None,
            score: 0.90,
            uncertainty_px: Some(2.0),
            source: EquipmentSource::Geometry,
            attributes: EquipmentAttributes::default(),
        }],
    }
}

fn frame_with_subject_bbox(bar_center_y: f32, subject_bbox: NormalizedRect) -> FrameObservations {
    let mut subject = weak_subject();
    subject.bbox = subject_bbox;
    FrameObservations {
        pose_candidates: vec![subject],
        equipment: vec![EquipmentObservation {
            proposal_id: 1,
            kind: EquipmentKind::BarbellShaft,
            bbox: NormalizedRect::new(0.20, bar_center_y - 0.01, 0.60, 0.02),
            axis: None,
            score: 0.90,
            uncertainty_px: Some(2.0),
            source: EquipmentSource::Geometry,
            attributes: EquipmentAttributes::default(),
        }],
    }
}

fn pose_only_frame() -> FrameObservations {
    FrameObservations {
        pose_candidates: vec![weak_subject()],
        equipment: Vec::new(),
    }
}

fn front_bench_equipment_profile() -> ExerciseProfile {
    let mut profile = ExerciseProfile {
        identity: "barbell-bench-press/front/bilateral/barbell/equipment-primary-test-v1".into(),
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

#[test]
fn reliable_bar_axis_seals_reps_when_pose_cannot_establish_the_turnaround() {
    let ready = [0.25; 10];
    let first = [0.31, 0.38, 0.47, 0.56, 0.50, 0.42, 0.33, 0.27];
    let pause = [0.25; 10];
    let second = [0.31, 0.39, 0.49, 0.57, 0.51, 0.41, 0.32, 0.26];
    let tail = [0.25; 4];
    let positions = ready
        .into_iter()
        .chain(first)
        .chain(pause)
        .chain(second)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-rep-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    let completed = packets
        .iter()
        .cloned()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .collect::<Vec<_>>();
    assert_eq!(
        completed.len(),
        2,
        "states={:?}",
        packets
            .iter()
            .map(|packet| (
                &packet.target.state,
                &packet.equipment.status,
                &packet.rep_state.phase
            ))
            .collect::<Vec<_>>()
    );
    assert_eq!(completed[0].start_timestamp_ms, 500);
    assert_eq!(completed[0].peak_timestamp_ms, 1_300);
    assert_eq!(completed[0].end_timestamp_ms, 2_000);
    assert_eq!(completed[1].peak_timestamp_ms, 3_100);
    assert!(
        completed
            .iter()
            .all(|rep| rep.disposition == RepDisposition::Confirmed)
    );
    assert!(completed.iter().all(|rep| {
        rep.observation_findings
            .contains(&RepObservationFinding::EquipmentPrimaryBoundary)
            && rep
                .observation_findings
                .contains(&RepObservationFinding::PoseUnavailableAtTurnaround)
    }));
}

#[test]
fn equipment_coverage_counts_missing_equipment_frames_in_the_active_rep() {
    let positions = [0.25; 10]
        .into_iter()
        .chain([0.31, 0.38, 0.47, 0.56, 0.50, 0.42, 0.33, 0.27])
        .chain([0.25; 4])
        .collect::<Vec<_>>();
    let mut frames = positions.iter().copied().map(frame).collect::<Vec<_>>();
    // Four missing frames during the active cycle are real coverage loss, not
    // an opportunity to shrink the denominator to observed equipment only.
    frames[11] = pose_only_frame();
    frames[13] = pose_only_frame();
    frames[15] = pose_only_frame();
    frames[17] = pose_only_frame();
    let inference = ObservationSequence {
        frames: frames.into(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-coverage-missing-frame-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    let completed = session.finish_set();
    let repeated = session.finish_set();
    assert_eq!(completed.len(), 1, "{completed:?}");
    assert_eq!(
        repeated, completed,
        "finish_set must return the same immutable terminal result"
    );
    assert_eq!(completed[0].disposition, RepDisposition::NeedsReview);
    assert!(
        completed[0]
            .observation_findings
            .contains(&RepObservationFinding::EquipmentPathCoverageLow)
    );
}

#[test]
fn active_rep_keeps_causal_bar_path_when_pose_subject_temporarily_changes_identity() {
    let ready = [0.34; 10];
    let first = [0.36, 0.42, 0.52, 0.65, 0.58, 0.48, 0.39, 0.34];
    let between = [0.34; 10];
    let second = [0.36, 0.42, 0.51, 0.64, 0.57, 0.47, 0.39, 0.34];
    let third = [0.36, 0.50, 0.54, 0.56, 0.54, 0.48, 0.39, 0.34];
    let tail = [0.34; 5];
    let mut frames = ready
        .into_iter()
        .chain(first)
        .chain(between)
        .chain(second)
        .chain(between)
        .chain(third)
        .chain(tail)
        .map(frame)
        .collect::<Vec<_>>();
    let third_start = 10 + first.len() + between.len() + second.len() + between.len();
    // During the lowest part of the third rep, the pose detector switches to
    // a box that cannot spatially own the already calibrated foreground bar.
    // The measured bar line remains continuous and must preserve rep phase,
    // while public pose/equipment confidence remains conservative.
    let mismatched_subject = NormalizedRect::new(0.10, 0.05, 0.30, 0.90);
    for index in 2..=5 {
        frames[third_start + index] = frame_with_subject_bbox(third[index], mismatched_subject);
    }
    let inference = ObservationSequence {
        frames: frames.into(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-active-subject-switch-contract".into(),
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
    for frame_id in 0..(third_start + third.len() + tail.len()) as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    let packets = output.packets();
    let completed = packets
        .iter()
        .cloned()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .filter(|rep| rep.disposition != RepDisposition::Rejected)
        .collect::<Vec<_>>();
    assert_eq!(
        completed.len(),
        3,
        "completed={completed:?}; states={:?}",
        packets
            .iter()
            .enumerate()
            .map(|(index, packet)| (
                index,
                packet.target.state,
                packet.rep_state.phase,
                packet.rep_state.active_rep_id,
                packet.rep_state.partial_attempts,
                packet.equipment.status,
                packet.equipment.tracks.first().map(|track| track.center_y),
                packet.set_state.lifecycle,
            ))
            .collect::<Vec<_>>()
    );
    assert_eq!(completed[2].disposition, RepDisposition::NeedsReview);
    assert!(
        completed[2]
            .observation_findings
            .contains(&RepObservationFinding::EquipmentPathCoverageLow)
    );
}

#[test]
fn preset_barbell_bench_accepts_one_complete_equipment_cycle_when_the_set_finishes() {
    let ready = [0.25; 10];
    let rep = [0.31, 0.38, 0.47, 0.56, 0.50, 0.42, 0.33, 0.27];
    let tail = [0.25; 45];
    let positions = ready.into_iter().chain(rep).chain(tail).collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "preset-single-equipment-rep-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let terminal = session.finish_set();
    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .chain(terminal)
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 1, "{completed:?}");
    assert_eq!(completed[0].disposition, RepDisposition::Confirmed);
    assert_eq!(completed[0].peak_timestamp_ms, 1_300);
}

#[test]
fn preset_barbell_bench_rejects_inconsistent_setup_cycles_before_the_real_set_signature() {
    let ready = [0.25; 10];
    let large_setup = [0.31, 0.48, 0.68, 0.58, 0.42, 0.28];
    let pause = [0.25; 12];
    let small_setup = [0.30, 0.33, 0.35, 0.32, 0.28, 0.26];
    let long_pause = [0.25; 50];
    let first = [0.31, 0.38, 0.47, 0.56, 0.50, 0.42, 0.33, 0.27];
    let between = [0.25; 6];
    let second = [0.31, 0.39, 0.49, 0.57, 0.51, 0.41, 0.32, 0.26];
    let tail = [0.25; 4];
    let positions = ready
        .into_iter()
        .chain(large_setup)
        .chain(pause)
        .chain(small_setup)
        .chain(long_pause)
        .chain(first)
        .chain(between)
        .chain(second)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-setup-filter-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .collect::<Vec<_>>();
    let confirmed = completed
        .iter()
        .filter(|rep| rep.disposition == RepDisposition::Confirmed)
        .collect::<Vec<_>>();
    let rejected = completed
        .iter()
        .filter(|rep| rep.disposition == RepDisposition::Rejected)
        .collect::<Vec<_>>();

    assert_eq!(confirmed.len(), 2, "{completed:?}");
    assert_eq!(rejected.len(), 2, "{completed:?}");
    assert!(confirmed[0].start_timestamp_ms > 7_000, "{completed:?}");
}

#[test]
fn preset_barbell_bench_rejects_a_post_set_rack_cycle_outside_the_learned_range() {
    let ready = [0.25; 10];
    let first = [0.31, 0.38, 0.47, 0.56, 0.50, 0.42, 0.33, 0.27];
    let between = [0.25; 6];
    let second = [0.31, 0.39, 0.49, 0.57, 0.51, 0.41, 0.32, 0.26];
    let pause = [0.25; 12];
    let rack = [0.34, 0.52, 0.76, 0.65, 0.47, 0.30, 0.26];
    let tail = [0.25; 4];
    let positions = ready
        .into_iter()
        .chain(first)
        .chain(between)
        .chain(second)
        .chain(pause)
        .chain(rack)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-rack-filter-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .collect::<Vec<_>>();
    assert_eq!(
        completed
            .iter()
            .filter(|rep| rep.disposition == RepDisposition::Confirmed)
            .count(),
        2,
        "{completed:?}"
    );
    assert_eq!(
        completed
            .iter()
            .filter(|rep| rep.disposition == RepDisposition::Rejected)
            .count(),
        1,
        "{completed:?}"
    );
}

#[test]
fn preset_barbell_bench_keeps_real_reps_when_rom_changes_within_the_established_set() {
    let ready = [0.25; 10];
    let first = [0.31, 0.38, 0.47, 0.56, 0.50, 0.42, 0.33, 0.27];
    let between = [0.25; 6];
    let second = [0.31, 0.39, 0.49, 0.57, 0.51, 0.41, 0.32, 0.26];
    // 0.20 image-height ROM: below the old 0.70 ratio, but still a coherent
    // bench cycle in the same cadence group.
    let shorter_rom = [0.30, 0.35, 0.40, 0.45, 0.41, 0.35, 0.30, 0.26];
    // The following rep expands again; the slowly adapted signature must not
    // reject a legitimate within-set change in the other direction.
    let larger_rom = [0.32, 0.44, 0.58, 0.70, 0.59, 0.45, 0.33, 0.26];
    let tail = [0.25; 4];
    let positions = ready
        .into_iter()
        .chain(first)
        .chain(between)
        .chain(second)
        .chain(between)
        .chain(shorter_rom)
        .chain(between)
        .chain(larger_rom)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-within-set-rom-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .collect::<Vec<_>>();
    assert_eq!(
        completed
            .iter()
            .filter(|rep| rep.disposition == RepDisposition::Confirmed)
            .count(),
        4,
        "{completed:?}"
    );
    assert!(
        completed
            .iter()
            .all(|rep| rep.disposition == RepDisposition::Confirmed),
        "{completed:?}"
    );
}

#[test]
fn preset_barbell_bench_keeps_ready_history_during_a_long_top_dwell() {
    let ready = [0.25; 30];
    let slow_onset = [
        0.255, 0.260, 0.270, 0.285, 0.305, 0.380, 0.470, 0.560, 0.500, 0.420, 0.330, 0.270,
    ];
    let between = [0.25; 6];
    let second = [0.31, 0.39, 0.49, 0.57, 0.51, 0.41, 0.32, 0.26];
    let tail = [0.25; 4];
    let positions = ready
        .into_iter()
        .chain(slow_onset)
        .chain(between)
        .chain(second)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-long-ready-dwell-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .filter(|rep| rep.disposition == RepDisposition::Confirmed)
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 2, "{completed:?}");
    assert!(
        completed[0].start_timestamp_ms <= 3_100,
        "the long top dwell must remain available to causal start backtracking: {completed:?}"
    );
}

#[test]
fn preset_barbell_bench_reports_the_midpoint_of_a_bounded_start_uncertainty_interval() {
    let ready = [0.25; 10];
    let first = [0.31, 0.38, 0.47, 0.56, 0.50, 0.42, 0.33, 0.27];
    // 700 ms from the prior endpoint to threshold-confirmed motion.
    let between = [0.25; 7];
    let second = [0.31, 0.39, 0.49, 0.57, 0.51, 0.41, 0.32, 0.26];
    let tail = [0.25; 4];
    let positions = ready
        .into_iter()
        .chain(first)
        .chain(between)
        .chain(second)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-bounded-start-uncertainty-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .filter(|rep| rep.disposition == RepDisposition::Confirmed)
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 2, "{completed:?}");
    assert_eq!(completed[0].end_timestamp_ms, 2_000);
    assert_eq!(completed[1].start_timestamp_ms, 2_400, "{completed:?}");
}

#[test]
fn preset_barbell_bench_does_not_attach_a_slow_next_onset_to_the_previous_lockout() {
    let ready = [0.25; 10];
    let first = [0.31, 0.38, 0.47, 0.56, 0.50, 0.42, 0.33, 0.27];
    let short_lockout = [0.25; 2];
    // The bar leaves the strict ready band gradually. The last stable sample
    // is only 200 ms after the previous endpoint, while 5%-of-frame movement
    // is not confirmed until 500 ms later. Reporting the stable sample itself
    // incorrectly attaches the next rep to the previous lockout.
    let slow_onset = [0.26, 0.27, 0.28, 0.29, 0.31];
    let second_tail = [0.39, 0.49, 0.57, 0.51, 0.41, 0.32, 0.26];
    let tail = [0.25; 4];
    let positions = ready
        .into_iter()
        .chain(first)
        .chain(short_lockout)
        .chain(slow_onset)
        .chain(second_tail)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-slow-next-onset-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .filter(|rep| rep.disposition == RepDisposition::Confirmed)
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 2, "{completed:?}");
    assert_eq!(completed[0].end_timestamp_ms, 1_900);
    assert_eq!(completed[1].start_timestamp_ms, 2_200, "{completed:?}");
}

#[test]
fn preset_barbell_bench_does_not_let_two_small_setup_cycles_establish_the_set() {
    let ready = [0.25; 10];
    let small = [0.27, 0.29, 0.31, 0.323, 0.30, 0.28, 0.26, 0.25];
    let between = [0.25; 5];
    let work = [0.28, 0.34, 0.40, 0.46, 0.40, 0.34, 0.28, 0.25];
    let tail = [0.25; 5];
    let positions = ready
        .into_iter()
        .chain(small)
        .chain(between)
        .chain(small)
        .chain(between)
        .chain(work)
        .chain(between)
        .chain(work)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-small-setup-cycles-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .filter(|rep| rep.disposition == RepDisposition::Confirmed)
        .collect::<Vec<_>>();
    assert_eq!(
        completed.len(),
        2,
        "setup cycles must not establish a set: {completed:?}"
    );
    assert!(completed.iter().all(|rep| rep.peak_timestamp_ms >= 3_900));
}

#[test]
fn preset_barbell_bench_rejects_a_rep_like_unrack_path_that_finishes_at_a_new_height() {
    let ready = [0.25; 10];
    let work = [0.28, 0.34, 0.40, 0.46, 0.40, 0.34, 0.28, 0.25];
    let between = [0.25; 5];
    let unrack = [0.29, 0.38, 0.48, 0.58, 0.47, 0.36, 0.31, 0.30];
    let tail = [0.30; 5];
    let positions = ready
        .into_iter()
        .chain(work)
        .chain(between)
        .chain(work)
        .chain(between)
        .chain(unrack)
        .chain(tail)
        .collect::<Vec<_>>();
    let inference = ObservationSequence {
        frames: positions.iter().copied().map(frame).collect(),
    };
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "equipment-unrack-endpoint-drift-contract".into(),
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
    for frame_id in 0..positions.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let completed = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .filter(|rep| rep.disposition == RepDisposition::Confirmed)
        .collect::<Vec<_>>();
    assert_eq!(
        completed.len(),
        2,
        "unrack path must not be counted: {completed:?}"
    );
}
