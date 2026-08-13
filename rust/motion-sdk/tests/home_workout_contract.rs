use std::sync::{Arc, atomic::AtomicUsize};

use maxpower_motion_sdk::{
    AdapterCapabilities, ContinuityMode, ContractVersion, DiagnosticLevel, ExerciseProfile,
    FixtureInferenceAdapter, FrameLease, MotionSession, PoseObservation, RecordingOutputAdapter,
    RepDisposition, SessionConfig, SubjectPolicy,
};

fn config(sequence_id: &str) -> SessionConfig {
    SessionConfig {
        sequence_id: sequence_id.into(),
        contract: ContractVersion { major: 1, minor: 0 },
        diagnostics: DiagnosticLevel::Summary,
        image_width_px: 1_000,
        image_height_px: 1_000,
        continuity: ContinuityMode::Raw,
        subject_policy: SubjectPolicy::AssumeSingle,
    }
}

#[test]
fn march_profile_seals_each_unilateral_lift_and_return_once() {
    let lift = [0.0, 0.01, 0.04, 0.08, 0.12, 0.08, 0.04, 0.01, 0.0];
    let rest = [0.0; 9];
    let mut frames = knee_lift_frames(&lift, &rest);
    frames.extend(knee_lift_frames(&rest, &lift));

    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config("home-workout:march"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(ExerciseProfile::march_in_place_front_provisional())
        .unwrap();

    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..18_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let reps = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .collect::<Vec<_>>();
    assert_eq!(reps.len(), 2);
    assert!(
        reps.iter()
            .all(|rep| rep.disposition == RepDisposition::Confirmed)
    );
    assert!(
        reps.iter()
            .all(|rep| rep.profile_identity == "march-in-place/front/bilateral/bodyweight/v1")
    );
    assert!(reps.iter().all(|rep| rep.profile_hash != 0));
    assert!(reps.iter().all(|rep| {
        rep.start_timestamp_ms < rep.peak_timestamp_ms
            && rep.peak_timestamp_ms < rep.end_timestamp_ms
    }));
}

#[test]
fn march_profile_does_not_confirm_stationary_or_incomplete_motion() {
    let stationary = [0.0; 9];
    let incomplete = [0.0, 0.01, 0.04, 0.08, 0.12, 0.12, 0.12, 0.12, 0.12];
    let mut frames = knee_lift_frames(&stationary, &stationary);
    frames.extend(knee_lift_frames(&incomplete, &stationary));

    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config("home-workout:march-negative"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(ExerciseProfile::march_in_place_front_provisional())
        .unwrap();

    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..18_u64 {
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
            .flat_map(|packet| &packet.completed_reps)
            .filter(|rep| rep.disposition == RepDisposition::Confirmed)
            .count(),
        0,
    );
}

#[test]
fn march_and_knee_raise_do_not_count_a_heel_curl_without_knee_lift() {
    let heel_curl = [170.0, 168.0, 145.0, 105.0, 65.0, 105.0, 145.0, 168.0, 170.0];
    for profile in [
        ExerciseProfile::march_in_place_front_provisional(),
        ExerciseProfile::alternating_knee_raise_front_provisional(),
    ] {
        let output = run_profile(
            "home-workout:heel-curl-negative",
            profile,
            leg_angle_frames(&heel_curl, &[170.0; 9]),
        );
        assert_eq!(
            output
                .packets()
                .iter()
                .flat_map(|packet| &packet.completed_reps)
                .filter(|rep| rep.disposition == RepDisposition::Confirmed)
                .count(),
            0,
        );
    }
}

#[test]
fn all_four_home_workout_profiles_count_their_exact_unilateral_cycle() {
    let knee_raise = [0.0, 0.02, 0.06, 0.12, 0.18, 0.12, 0.06, 0.02, 0.0];
    assert_one_confirmed(
        "home-workout:knee-raise-left",
        ExerciseProfile::alternating_knee_raise_front_provisional(),
        knee_lift_frames(&knee_raise, &[0.0; 9]),
        "alternating-knee-raise/front/bilateral/bodyweight/v1",
    );
    assert_one_confirmed(
        "home-workout:knee-raise-right",
        ExerciseProfile::alternating_knee_raise_front_provisional(),
        knee_lift_frames(&[0.0; 9], &knee_raise),
        "alternating-knee-raise/front/bilateral/bodyweight/v1",
    );

    assert_one_confirmed(
        "home-workout:side-step-left",
        ExerciseProfile::side_step_touch_front_provisional(),
        side_step_frames(true, false),
        "side-step-touch/front/bilateral/bodyweight/v1",
    );
    assert_one_confirmed(
        "home-workout:side-step-right",
        ExerciseProfile::side_step_touch_front_provisional(),
        side_step_frames(false, true),
        "side-step-touch/front/bilateral/bodyweight/v1",
    );

    assert_one_confirmed(
        "home-workout:step-jack-left",
        ExerciseProfile::step_jack_front_provisional(),
        step_jack_frames(true, true),
        "step-jack/front/bilateral/bodyweight/v1",
    );
    assert_one_confirmed(
        "home-workout:step-jack-right",
        ExerciseProfile::step_jack_front_provisional(),
        step_jack_frames(false, true),
        "step-jack/front/bilateral/bodyweight/v1",
    );
}

#[test]
fn step_jack_requires_coordinated_arm_and_leg_motion() {
    let output = run_profile(
        "home-workout:step-jack-leg-only",
        ExerciseProfile::step_jack_front_provisional(),
        step_jack_frames(true, false),
    );
    assert_eq!(
        output
            .packets()
            .iter()
            .flat_map(|packet| &packet.completed_reps)
            .filter(|rep| rep.disposition == RepDisposition::Confirmed)
            .count(),
        0,
    );
}

fn assert_one_confirmed(
    sequence_id: &str,
    profile: ExerciseProfile,
    frames: Vec<Vec<PoseObservation>>,
    expected_identity: &str,
) {
    let output = run_profile(sequence_id, profile, frames);
    let all_reps = output
        .packets()
        .into_iter()
        .flat_map(|packet| packet.completed_reps)
        .collect::<Vec<_>>();
    let reps = all_reps
        .iter()
        .filter(|rep| rep.disposition == RepDisposition::Confirmed)
        .collect::<Vec<_>>();
    assert_eq!(reps.len(), 1, "{expected_identity}: {all_reps:?}");
    assert_eq!(reps[0].profile_identity, expected_identity);
}

fn run_profile(
    sequence_id: &str,
    profile: ExerciseProfile,
    frames: Vec<Vec<PoseObservation>>,
) -> RecordingOutputAdapter {
    let frame_count = frames.len();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(sequence_id),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    session.install_exercise_profile(profile).unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..frame_count as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    output
}

fn side_step_frames(left_leg: bool, right_leg: bool) -> Vec<Vec<PoseObservation>> {
    let excursion = [0.0, 0.01, 0.04, 0.10, 0.20, 0.10, 0.04, 0.01, 0.0];
    excursion
        .into_iter()
        .map(|amount| {
            standing_frame(
                if left_leg { -amount } else { 0.0 },
                if right_leg { amount } else { 0.0 },
                false,
                false,
            )
        })
        .collect()
}

fn step_jack_frames(left_side: bool, move_arm: bool) -> Vec<Vec<PoseObservation>> {
    let excursion = [
        0.0, 0.01, 0.03, 0.06, 0.12, 0.20, 0.20, 0.20, 0.12, 0.06, 0.03, 0.01, 0.0,
    ];
    excursion
        .into_iter()
        .map(|amount| {
            standing_frame(
                if left_side { -amount } else { 0.0 },
                if left_side { 0.0 } else { amount },
                left_side && move_arm,
                !left_side && move_arm,
            )
        })
        .collect()
}

fn standing_frame(
    left_ankle_offset: f32,
    right_ankle_offset: f32,
    move_left_arm: bool,
    move_right_arm: bool,
) -> Vec<PoseObservation> {
    let mut frame = vec![PoseObservation::new(0.5, 0.5, 0.0, 1.0); 33];
    frame[11] = PoseObservation::new(0.44, 0.30, 0.0, 1.0);
    frame[12] = PoseObservation::new(0.56, 0.30, 0.0, 1.0);
    frame[23] = PoseObservation::new(0.44, 0.50, 0.0, 1.0);
    frame[24] = PoseObservation::new(0.56, 0.50, 0.0, 1.0);
    frame[25] = PoseObservation::new(0.44, 0.68, 0.0, 1.0);
    frame[26] = PoseObservation::new(0.56, 0.68, 0.0, 1.0);
    frame[27] = PoseObservation::new(0.44 + left_ankle_offset, 0.86, 0.0, 1.0);
    frame[28] = PoseObservation::new(0.56 + right_ankle_offset, 0.86, 0.0, 1.0);
    frame[15] = if move_left_arm {
        let amount = left_ankle_offset.abs();
        PoseObservation::new(0.42 - amount * 1.5, 0.50 - amount * 2.5, 0.0, 1.0)
    } else {
        PoseObservation::new(0.42, 0.50, 0.0, 1.0)
    };
    frame[16] = if move_right_arm {
        let amount = right_ankle_offset.abs();
        PoseObservation::new(0.58 + amount * 1.5, 0.50 - amount * 2.5, 0.0, 1.0)
    } else {
        PoseObservation::new(0.58, 0.50, 0.0, 1.0)
    };
    frame
}

fn leg_angle_frames(left: &[f32], right: &[f32]) -> Vec<Vec<PoseObservation>> {
    left.iter()
        .zip(right)
        .map(|(&left_angle, &right_angle)| leg_angle_frame(left_angle, right_angle))
        .collect()
}

fn knee_lift_frames(left: &[f32], right: &[f32]) -> Vec<Vec<PoseObservation>> {
    left.iter()
        .zip(right)
        .map(|(&left_lift, &right_lift)| knee_lift_frame(left_lift, right_lift))
        .collect()
}

fn knee_lift_frame(left_lift: f32, right_lift: f32) -> Vec<PoseObservation> {
    let mut frame = leg_angle_frame(170.0, 170.0);
    for (knee, ankle, lift) in [(25, 27, left_lift), (26, 28, right_lift)] {
        frame[knee].y -= lift;
        frame[ankle].y -= lift;
    }
    frame
}

fn leg_angle_frame(left_angle: f32, right_angle: f32) -> Vec<PoseObservation> {
    let mut frame = vec![PoseObservation::new(0.5, 0.5, 0.0, 1.0); 33];
    set_leg(&mut frame, 23, 25, 27, 0.44, left_angle);
    set_leg(&mut frame, 24, 26, 28, 0.56, right_angle);
    frame[11] = PoseObservation::new(0.44, 0.30, 0.0, 1.0);
    frame[12] = PoseObservation::new(0.56, 0.30, 0.0, 1.0);
    frame
}

fn set_leg(
    frame: &mut [PoseObservation],
    hip: usize,
    knee: usize,
    ankle: usize,
    x: f32,
    angle_deg: f32,
) {
    let hip_point = (x, 0.50);
    let knee_point = (x, 0.68);
    let radians = (angle_deg - 90.0).to_radians();
    let ankle_point = (
        knee_point.0 + radians.cos() * 0.18,
        knee_point.1 + radians.sin() * 0.18,
    );
    frame[hip] = PoseObservation::new(hip_point.0, hip_point.1, 0.0, 1.0);
    frame[knee] = PoseObservation::new(knee_point.0, knee_point.1, 0.0, 1.0);
    frame[ankle] = PoseObservation::new(ankle_point.0, ankle_point.1, 0.0, 1.0);
}
