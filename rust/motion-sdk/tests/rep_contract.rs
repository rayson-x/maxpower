use std::sync::{Arc, atomic::AtomicUsize};

use form_coach_motion_sdk::{
    AdapterCapabilities, ContinuityMode, ContractVersion, DiagnosticLevel, ExerciseProfile,
    FixtureInferenceAdapter, FrameLease, MotionSession, PoseObservation, RecordingOutputAdapter,
    RepPhase, SessionConfig, SubjectPolicy,
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
}

#[test]
fn bottom_oscillation_does_not_double_count_and_half_cycle_is_partial() {
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
    assert_eq!(
        half.iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        0
    );
    assert!(half.last().unwrap().rep_state.partial_attempts >= 1);
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

    let mut long_frames = rep_frames(&wrist_y, &elbow_y);
    for frame in &mut long_frames[4..8] {
        for index in [15, 16, 13, 14] {
            frame[index].visibility = 0.0;
        }
    }
    let long = replay_frames(long_frames, 250);
    assert_eq!(
        long.iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        0
    );
    assert!(long.last().unwrap().rep_state.partial_attempts >= 1);
}

#[test]
fn shoulder_press_is_added_by_profile_data_without_a_new_state_machine() {
    let wrist_y = [
        0.20, 0.24, 0.35, 0.50, 0.65, 0.72, 0.68, 0.55, 0.40, 0.25, 0.20,
    ];
    let elbow_y = [
        0.28, 0.30, 0.36, 0.44, 0.53, 0.58, 0.56, 0.49, 0.41, 0.32, 0.28,
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
    assert_eq!(
        handle_adjustment
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>(),
        0,
        "wrist-only handle movement lacks the required elbow trajectory",
    );

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
