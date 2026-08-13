use maxpower_motion_sdk::web_abi::{
    motion_sdk_begin_profile_identity, motion_sdk_close, motion_sdk_install_profile,
    motion_sdk_reset, motion_sdk_set_pose_schema, motion_sdk_set_profile_identity_byte,
};
use maxpower_motion_sdk::{
    ExerciseMaturity, ExerciseProfile, ExerciseSignal, ExerciseSignalKind, MovementDirection,
    PoseSchemaId,
};
use std::sync::Mutex;

static ABI_TEST_LOCK: Mutex<()> = Mutex::new(());

fn profile_with_joints(joints: [usize; 2]) -> ExerciseProfile {
    let mut profile = ExerciseProfile {
        identity: "halpe-contract/front/bilateral/bodyweight/v1".into(),
        content_hash: 0,
        maturity: ExerciseMaturity::Provisional,
        schema: PoseSchemaId::Halpe26,
        coordinate_unit: "image-normalized-y".into(),
        state_machine_id: "ready-effort-peak-return/v1".into(),
        required_capabilities: 3,
        primary_signal: ExerciseSignal {
            kind: ExerciseSignalKind::LandmarkY,
            landmarks: joints.to_vec(),
        },
        secondary_signal: ExerciseSignal {
            kind: ExerciseSignalKind::LandmarkY,
            landmarks: vec![5, 6],
        },
        direction: MovementDirection::Increasing,
        start_amplitude: 0.05,
        min_primary_amplitude: 0.20,
        min_secondary_amplitude: 0.18,
        return_hysteresis: 0.05,
        ready_tolerance: 0.06,
        max_gap_ms: 700,
        min_rep_duration_ms: 450,
        max_rep_duration_ms: 8_000,
    };
    profile.content_hash = profile.computed_content_hash();
    profile
}

fn install(profile: &ExerciseProfile) -> i32 {
    let identity = profile.identity.as_bytes();
    assert_eq!(motion_sdk_begin_profile_identity(identity.len() as u32), 0);
    for (index, value) in identity.iter().enumerate() {
        assert_eq!(
            motion_sdk_set_profile_identity_byte(index as u32, u32::from(*value)),
            0,
        );
    }
    motion_sdk_install_profile(
        profile.content_hash as u32,
        (profile.content_hash >> 32) as u32,
        0,
        1,
        0,
        0,
        profile.required_capabilities,
        0,
        0,
        profile.primary_signal.landmarks[0] as u32,
        profile.primary_signal.landmarks[1] as u32,
        u32::MAX,
        0,
        5,
        6,
        u32::MAX,
        profile.start_amplitude,
        profile.min_primary_amplitude,
        profile.min_secondary_amplitude,
        profile.return_hysteresis,
        profile.ready_tolerance,
        profile.max_gap_ms as u32,
        profile.min_rep_duration_ms as u32,
        profile.max_rep_duration_ms as u32,
    )
}

#[test]
fn halpe26_accepts_unchanged_coco_indices_and_additive_foot_indices() {
    let _guard = ABI_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(720, 1280, 1), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    assert_eq!(install(&profile_with_joints([9, 10])), 0);
    assert_eq!(install(&profile_with_joints([24, 25])), 0);
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn halpe26_rejects_an_index_outside_its_26_point_schema() {
    let _guard = ABI_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(720, 1280, 1), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    assert_eq!(install(&profile_with_joints([25, 26])), -6);
    assert_eq!(motion_sdk_close(), 0);
}
