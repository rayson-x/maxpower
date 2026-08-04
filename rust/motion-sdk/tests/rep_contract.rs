use std::sync::{Arc, atomic::AtomicUsize};

use form_coach_motion_sdk::{
    AdapterCapabilities, ContinuityMode, ContractVersion, DiagnosticLevel, ExerciseProfile,
    ExerciseMaturity, ExerciseSignal, ExerciseSignalKind, FixtureInferenceAdapter, FrameLease,
    MotionSession, MovementDirection, PoseObservation, PoseSchemaId, RecordingOutputAdapter,
    RepBoundaryRevision, RepDisposition, RepEvidenceReason, RepObservationFinding, RepPhase, SessionConfig, SetLifecycle, SubjectPolicy,
};

fn config() -> SessionConfig {
    SessionConfig {
        sequence_id: "rep:lat-pulldown".into(),
        contract: ContractVersion { major: 1, minor: 0 },
        diagnostics: DiagnosticLevel::Summary,
        image_width_px: 1_000,
        image_height_px: 1_000,
        continuity: ContinuityMode::Fusion,
        subject_policy: SubjectPolicy::AssumeSingle,
    }
}

#[test]
fn full_multi_joint_cycle_seals_one_immutable_rep_with_shared_boundaries() {
    let wrist_y = [
        0.20, 0.22, 0.30, 0.45, 0.65, 0.78, 0.75, 0.60, 0.40, 0.25, 0.21,
    ];
    let elbow_y = [
        0.30, 0.31, 0.36, 0.43, 0.53, 0.60, 0.59, 0.51, 0.41, 0.33, 0.30,
    ];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(rep_frames(&wrist_y, &elbow_y)),
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(ExerciseProfile::lat_pulldown_provisional())
        .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..wrist_y.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    let completed = packets
        .iter()
        .flat_map(|packet| packet.completed_reps.iter())
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 1);
    let rep = completed[0];
    assert_eq!(rep.rep_id, 1);
    assert_eq!(rep.start_frame_id, 1);
    assert_eq!(rep.peak_frame_id, 5);
    assert_eq!(rep.end_frame_id, 8);
    assert!(rep.canonical_slice_hash != 0);
    assert_eq!(rep.revision, 0);
    assert_eq!(rep.profile_maturity, "provisional");
    assert!(rep.quality_verdict.is_none());
    assert_eq!(packets.last().unwrap().rep_state.phase, RepPhase::Ready);

    let original = rep.clone();
    let revised = session
        .revise_sealed_rep(
            &original,
            RepBoundaryRevision {
                start_frame_id: 2,
                start_timestamp_ms: 200,
                peak_frame_id: 5,
                peak_timestamp_ms: 500,
                end_frame_id: 9,
                end_timestamp_ms: 900,
                canonical_slice_hash: 0xfeed_beef,
            },
        )
        .unwrap();
    assert_eq!(
        original.revision, 0,
        "historical algorithm result is unchanged"
    );
    assert_eq!(original.start_frame_id, 1);
    assert_eq!(revised.rep_id, original.rep_id);
    assert_eq!(revised.revision, 1);
    assert_eq!(revised.start_frame_id, 2);
    assert_eq!(revised.profile_hash, original.profile_hash);
    assert!(revised.quality_verdict.is_none());
}

#[test]
fn explicit_set_arming_excludes_setup_motion_and_finish_never_seals_a_partial_rep() {
    // This would be a complete cycle in the legacy always-on replay mode, but
    // the set began immediately before it and has not yet observed a stable
    // setup pose for the arming window.
    let wrist_y = [0.20, 0.28, 0.45, 0.65, 0.78, 0.75, 0.60, 0.40, 0.25];
    let elbow_y = [0.30, 0.34, 0.43, 0.53, 0.60, 0.59, 0.51, 0.41, 0.33];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(rep_frames(&wrist_y, &elbow_y)),
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(ExerciseProfile::lat_pulldown_provisional())
        .unwrap();
    session.begin_set();
    assert_eq!(session.set_state().lifecycle, SetLifecycle::Arming);

    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..wrist_y.len() as u64 {
        session
            .offer(FrameLease::fixture(frame, frame * 100, Arc::clone(&releases)))
            .unwrap();
    }
    assert_eq!(session.set_state().lifecycle, SetLifecycle::Arming);
    assert_eq!(
        output
            .packets()
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        0,
        "moving during arming can never become a sealed rep",
    );

    session.finish_set();
    assert_eq!(session.set_state().lifecycle, SetLifecycle::Finished);
}

#[test]
fn an_idle_recorded_set_pauses_then_resumes_on_a_real_excursion() {
    let mut wrist_y = vec![0.20; 23]; // stable setup plus more than 1.5s rest
    wrist_y.extend([0.205, 0.210, 0.220]);
    let elbow_y = wrist_y.iter().map(|value| value + 0.10).collect::<Vec<_>>();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(rep_frames(&wrist_y, &elbow_y)),
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(ExerciseProfile::lat_pulldown_provisional())
        .unwrap();
    session.begin_set();

    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..wrist_y.len() as u64 {
        session
            .offer(FrameLease::fixture(frame, frame * 100, Arc::clone(&releases)))
            .unwrap();
    }
    assert!(
        output
            .packets()
            .iter()
            .any(|packet| packet.set_state.lifecycle == SetLifecycle::Paused),
        "a stationary rest inside a recording is visible as paused",
    );
    assert_eq!(session.set_state().lifecycle, SetLifecycle::Active);
}

#[test]
fn profile_bundle_rejects_tampering_and_unsupported_contract_fields() {
    for mutation in 0..5 {
        let mut profile = ExerciseProfile::lat_pulldown_provisional();
        match mutation {
            0 => profile.start_amplitude += 0.01, // stale hash
            1 => {
                profile.coordinate_unit = "pixels".into();
                profile.content_hash = profile.computed_content_hash();
            }
            2 => {
                profile.required_capabilities = 1;
                profile.content_hash = profile.computed_content_hash();
            }
            3 => {
                profile.state_machine_id = "arbitrary-code/v1".into();
                profile.content_hash = profile.computed_content_hash();
            }
            _ => {
                profile.primary_signal.landmarks = vec![15, 15];
                profile.content_hash = profile.computed_content_hash();
            }
        }
        let result = MotionSession::open(
            config(),
            AdapterCapabilities::fixture(),
            FixtureInferenceAdapter::sequence(Vec::new()),
            RecordingOutputAdapter::default(),
        )
        .unwrap()
        .install_exercise_profile(profile);
        assert!(result.is_err(), "mutation {mutation} must fail closed");
    }
}

#[test]
fn a_joint_angle_profile_seals_a_rep_without_vertical_motion() {
    let angles = [90.0, 92.0, 105.0, 128.0, 150.0, 147.0, 125.0, 102.0, 91.0];
    let frames = angles.into_iter().map(angle_frame).collect::<Vec<_>>();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    let mut profile = ExerciseProfile {
        identity: "test-elbow-flexion/front/bilateral/bodyweight/v1".into(),
        content_hash: 0,
        maturity: ExerciseMaturity::Provisional,
        schema: PoseSchemaId::BlazePose33,
        coordinate_unit: "image-angle-deg".into(),
        state_machine_id: "ready-effort-peak-return/v1".into(),
        required_capabilities: 3,
        primary_signal: ExerciseSignal {
            kind: ExerciseSignalKind::JointAngle,
            landmarks: vec![11, 13, 15],
        },
        secondary_signal: ExerciseSignal {
            kind: ExerciseSignalKind::JointAngle,
            landmarks: vec![12, 14, 16],
        },
        direction: MovementDirection::Auto,
        start_amplitude: 5.0,
        min_primary_amplitude: 20.0,
        min_secondary_amplitude: 20.0,
        return_hysteresis: 5.0,
        ready_tolerance: 6.0,
        max_gap_ms: 700,
        min_rep_duration_ms: 450,
        max_rep_duration_ms: 8_000,
    };
    profile.content_hash = profile.computed_content_hash();
    session.install_exercise_profile(profile.clone()).unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..angles.len() as u64 {
        session.offer(FrameLease::fixture(frame, frame * 100, Arc::clone(&releases))).unwrap();
    }
    assert_eq!(
        output.packets().iter().map(|packet| packet.completed_reps.len()).sum::<usize>(),
        1,
    );

    // An annotation's "peak" can refer to the physical bottom of a press.
    // Auto orientation must therefore also seal a cycle whose first excursion
    // decreases the elbow angle rather than increases it.
    let reverse_angles = [150.0, 148.0, 135.0, 112.0, 90.0, 93.0, 115.0, 140.0, 150.0];
    let reverse_frames = reverse_angles.into_iter().map(angle_frame).collect::<Vec<_>>();
    let reverse_output = RecordingOutputAdapter::default();
    let mut reverse_session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(reverse_frames),
        reverse_output.clone(),
    )
    .unwrap();
    reverse_session.install_exercise_profile(profile.clone()).unwrap();
    for frame in 0..reverse_angles.len() as u64 {
        reverse_session
            .offer(FrameLease::fixture(frame, frame * 100, Arc::clone(&releases)))
            .unwrap();
    }
    assert_eq!(
        reverse_output
            .packets()
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        1,
    );

    let two_cycles = [
        90.0, 92.0, 105.0, 128.0, 150.0, 147.0, 125.0, 102.0, 91.0,
        93.0, 106.0, 129.0, 151.0, 146.0, 124.0, 101.0, 90.0,
    ];
    let two_cycle_frames = two_cycles.into_iter().map(angle_frame).collect::<Vec<_>>();
    let two_cycle_output = RecordingOutputAdapter::default();
    let mut two_cycle_session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(two_cycle_frames),
        two_cycle_output.clone(),
    )
    .unwrap();
    two_cycle_session.install_exercise_profile(profile).unwrap();
    for frame in 0..two_cycles.len() as u64 {
        two_cycle_session
            .offer(FrameLease::fixture(frame, frame * 100, Arc::clone(&releases)))
            .unwrap();
    }
    assert_eq!(
        two_cycle_output
            .packets()
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        2,
        "auto direction must not turn one return into an opposite-direction rep",
    );
}

#[test]
fn bottom_oscillation_does_not_double_count_and_limited_cycle_keeps_feedback() {
    let full_wrist = [
        0.20, 0.25, 0.45, 0.70, 0.78, 0.74, 0.79, 0.73, 0.55, 0.32, 0.21,
    ];
    let full_elbow = [
        0.30, 0.33, 0.43, 0.56, 0.62, 0.60, 0.62, 0.59, 0.48, 0.35, 0.30,
    ];
    let full = replay(&full_wrist, &full_elbow);
    assert_eq!(
        full.iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        1
    );

    let half_wrist = [0.20, 0.28, 0.38, 0.44, 0.35, 0.24, 0.20];
    let half_elbow = [0.30, 0.34, 0.39, 0.42, 0.38, 0.32, 0.30];
    let half = replay(&half_wrist, &half_elbow);
    let half_outcomes = half
        .iter()
        .flat_map(|packet| packet.completed_reps.iter())
        .collect::<Vec<_>>();
    assert_eq!(half_outcomes.len(), 1);
    assert_eq!(half_outcomes[0].disposition, RepDisposition::Confirmed);
    assert_eq!(half_outcomes[0].evidence_reason, None);
    assert_eq!(
        half_outcomes[0].observation_findings,
        vec![RepObservationFinding::SecondaryRangeBelowExpectation],
    );
    assert_eq!(half.last().unwrap().rep_state.partial_attempts, 0);
}

#[test]
fn limited_cycles_keep_unique_immutable_ids_and_findings() {
    let half_wrist = [
        0.20, 0.28, 0.38, 0.44, 0.35, 0.24, 0.20,
        0.20, 0.28, 0.38, 0.44, 0.35, 0.24, 0.20,
    ];
    let half_elbow = [
        0.30, 0.34, 0.39, 0.42, 0.38, 0.32, 0.30,
        0.30, 0.34, 0.39, 0.42, 0.38, 0.32, 0.30,
    ];
    let packets = replay(&half_wrist, &half_elbow);
    let outcomes = packets
        .iter()
        .flat_map(|packet| packet.completed_reps.iter())
        .collect::<Vec<_>>();
    assert_eq!(outcomes.len(), 2);
    assert!(outcomes.iter().all(|rep| rep.disposition == RepDisposition::Confirmed));
    assert!(outcomes.iter().all(|rep| rep.observation_findings
        .contains(&RepObservationFinding::SecondaryRangeBelowExpectation)));
    assert_eq!(outcomes[0].rep_id, 1);
    assert_eq!(outcomes[1].rep_id, 2);
    assert_ne!(outcomes[0].canonical_slice_hash, outcomes[1].canonical_slice_hash);
}

#[test]
fn small_but_coherent_multi_joint_cycle_counts_with_range_feedback() {
    let wrist_y = [0.20, 0.23, 0.30, 0.36, 0.32, 0.25, 0.20];
    let elbow_y = [0.30, 0.32, 0.36, 0.44, 0.40, 0.33, 0.30];
    let packets = replay(&wrist_y, &elbow_y);
    let outcomes = packets
        .iter()
        .flat_map(|packet| packet.completed_reps.iter())
        .collect::<Vec<_>>();

    assert_eq!(outcomes.len(), 1);
    assert_eq!(outcomes[0].disposition, RepDisposition::Confirmed);
    assert_eq!(
        outcomes[0].observation_findings,
        vec![
            RepObservationFinding::PrimaryRangeBelowExpectation,
            RepObservationFinding::SecondaryRangeBelowExpectation,
        ],
    );
}

#[test]
fn short_unknown_gap_recovers_but_long_gap_aborts_without_fabricated_coordinates() {
    let wrist_y = [0.20, 0.30, 0.50, 0.70, 0.78, 0.70, 0.55, 0.35, 0.21];
    let elbow_y = [0.30, 0.35, 0.45, 0.55, 0.61, 0.57, 0.49, 0.37, 0.30];
    let mut frames = rep_frames(&wrist_y, &elbow_y);
    for index in [15, 16, 13, 14] {
        frames[5][index].visibility = 0.0;
    }
    let packets = replay_frames(frames, 100);
    let completed = packets
        .iter()
        .flat_map(|packet| &packet.completed_reps)
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 1);
    assert!(completed[0].recovered_across_gap);
    assert_eq!(completed[0].disposition, RepDisposition::NeedsReview);

    let mut long_frames = rep_frames(&wrist_y, &elbow_y);
    for frame in &mut long_frames[4..8] {
        for index in [15, 16, 13, 14] {
            frame[index].visibility = 0.0;
        }
    }
    let long = replay_frames(long_frames, 250);
    let long_outcomes = long
        .iter()
        .flat_map(|packet| packet.completed_reps.iter())
        .collect::<Vec<_>>();
    assert_eq!(long_outcomes.len(), 1);
    assert_eq!(long_outcomes[0].disposition, RepDisposition::Rejected);
    assert_eq!(
        long_outcomes[0].evidence_reason,
        Some(RepEvidenceReason::RequiredJointLoss),
    );
    assert!(long.last().unwrap().rep_state.partial_attempts >= 1);
}

#[test]
fn shoulder_press_is_added_by_profile_data_without_a_new_state_machine() {
    let wrist_y = [
        0.72, 0.68, 0.56, 0.42, 0.28, 0.20, 0.24, 0.34, 0.48, 0.63, 0.71,
    ];
    let elbow_y = [
        0.58, 0.56, 0.50, 0.43, 0.35, 0.29, 0.31, 0.38, 0.46, 0.53, 0.58,
    ];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(rep_frames(&wrist_y, &elbow_y)),
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(ExerciseProfile::seated_shoulder_press_provisional())
        .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..wrist_y.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    assert_eq!(
        output
            .packets()
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        1
    );
}

#[test]
fn body_translation_and_handle_adjustment_are_rejected_but_the_paired_action_counts() {
    let apparent_cycle = [
        0.20, 0.22, 0.30, 0.45, 0.65, 0.78, 0.75, 0.60, 0.40, 0.25, 0.21,
    ];
    let torso_shift = apparent_cycle.map(|value| value - 0.20);
    let whole_body_frames = torso_shift
        .iter()
        .map(|shift| {
            let mut landmarks = vec![PoseObservation::new(0.5, 0.5 + shift, 0.0, 0.95); 33];
            landmarks[15] = PoseObservation::new(0.35, 0.20 + shift, 0.0, 0.95);
            landmarks[16] = PoseObservation::new(0.65, 0.20 + shift, 0.0, 0.95);
            landmarks[13] = PoseObservation::new(0.40, 0.30 + shift, 0.0, 0.95);
            landmarks[14] = PoseObservation::new(0.60, 0.30 + shift, 0.0, 0.95);
            landmarks
        })
        .collect();
    let translated = replay_frames(whole_body_frames, 100);
    assert_eq!(
        translated
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        0,
        "whole-body/camera translation is not an exercise cycle",
    );

    let stationary_elbows = [0.30; 11];
    let handle_adjustment = replay(&apparent_cycle, &stationary_elbows);
    let handle_outcomes = handle_adjustment
        .iter()
        .flat_map(|packet| packet.completed_reps.iter())
        .collect::<Vec<_>>();
    assert_eq!(
        handle_outcomes.iter().filter(|rep| rep.disposition == RepDisposition::Confirmed).count(),
        0,
        "wrist-only handle movement can never become formal training volume",
    );
    assert_eq!(handle_outcomes.len(), 1);
    assert_eq!(handle_outcomes[0].disposition, RepDisposition::Rejected);
    assert_eq!(handle_outcomes[0].evidence_reason, Some(RepEvidenceReason::IncompleteCycle));

    let action_elbows = [
        0.30, 0.31, 0.36, 0.43, 0.53, 0.60, 0.59, 0.51, 0.41, 0.33, 0.30,
    ];
    let action = replay(&apparent_cycle, &action_elbows);
    assert_eq!(
        action
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        1,
        "the paired multi-joint action remains countable",
    );
}

#[test]
fn a_valid_rep_survives_missing_shoulders_when_the_hip_pair_is_stable() {
    let wrist_y = [
        0.20, 0.22, 0.30, 0.45, 0.65, 0.78, 0.75, 0.60, 0.40, 0.25, 0.21,
    ];
    let elbow_y = [
        0.30, 0.31, 0.36, 0.43, 0.53, 0.60, 0.59, 0.51, 0.41, 0.33, 0.30,
    ];
    let mut frames = rep_frames(&wrist_y, &elbow_y);
    for frame in &mut frames {
        frame[11].visibility = 0.0;
        frame[12].visibility = 0.0;
    }

    let packets = replay_frames(frames, 100);
    assert_eq!(
        packets
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        1,
    );
}

fn replay(wrist_y: &[f32], elbow_y: &[f32]) -> Vec<form_coach_motion_sdk::MotionPacket> {
    replay_frames(rep_frames(wrist_y, elbow_y), 100)
}

fn replay_frames(
    frames: Vec<Vec<PoseObservation>>,
    frame_interval_ms: u64,
) -> Vec<form_coach_motion_sdk::MotionPacket> {
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames.clone()),
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(ExerciseProfile::lat_pulldown_provisional())
        .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..frames.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * frame_interval_ms,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    output.packets()
}

fn rep_frames(wrist_y: &[f32], elbow_y: &[f32]) -> Vec<Vec<PoseObservation>> {
    wrist_y
        .iter()
        .zip(elbow_y)
        .map(|(&wrist, &elbow)| {
            let mut landmarks = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.95); 33];
            landmarks[15] = PoseObservation::new(0.35, wrist, 0.0, 0.95);
            landmarks[16] = PoseObservation::new(0.65, wrist, 0.0, 0.95);
            landmarks[13] = PoseObservation::new(0.40, elbow, 0.0, 0.95);
            landmarks[14] = PoseObservation::new(0.60, elbow, 0.0, 0.95);
            landmarks
        })
        .collect()
}

fn angle_frame(angle_degrees: f32) -> Vec<PoseObservation> {
    let mut landmarks = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.95); 33];
    for (shoulder, elbow, wrist, x) in [(11, 13, 15, 0.35), (12, 14, 16, 0.65)] {
        let elbow_y = 0.50;
        let radius = 0.10;
        let radians = angle_degrees.to_radians();
        landmarks[shoulder] = PoseObservation::new(x, elbow_y - radius, 0.0, 0.95);
        landmarks[elbow] = PoseObservation::new(x, elbow_y, 0.0, 0.95);
        landmarks[wrist] = PoseObservation::new(
            x + radius * radians.sin(),
            elbow_y - radius * radians.cos(),
            0.0,
            0.95,
        );
    }
    landmarks
}
