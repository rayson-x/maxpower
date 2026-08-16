use maxpower_motion_sdk::ExerciseProfile;
use maxpower_motion_sdk::web_abi::{
    motion_sdk_begin_frame, motion_sdk_begin_replay_set, motion_sdk_begin_sequence,
    motion_sdk_builtin_profile_hash_high, motion_sdk_builtin_profile_hash_low, motion_sdk_close,
    motion_sdk_commit_sequence, motion_sdk_contract_major, motion_sdk_contract_minor,
    motion_sdk_copy_packet, motion_sdk_current_frame_valid, motion_sdk_packet_len,
    motion_sdk_process_frame, motion_sdk_reset, motion_sdk_set_landmark,
    motion_sdk_set_pose_schema, motion_sdk_set_profile, motion_sdk_set_sequence_byte,
};
use std::sync::Mutex;

static ABI_TEST_LOCK: Mutex<()> = Mutex::new(());

fn builtin_profile_hash(profile_code: u32) -> u64 {
    u64::from(motion_sdk_builtin_profile_hash_low(profile_code))
        | (u64::from(motion_sdk_builtin_profile_hash_high(profile_code)) << 32)
}

fn packet_active_profile_hash(packet: &[u8]) -> Option<u64> {
    let marker = packet.windows(4).rposition(|window| window == b"VER1")?;
    let mut cursor = marker + 4;
    for _ in 0..3 {
        let length = u16::from_le_bytes(packet.get(cursor..cursor + 2)?.try_into().ok()?) as usize;
        cursor += 2 + length;
    }
    if *packet.get(cursor)? == 0 {
        return None;
    }
    cursor += 1;
    Some(u64::from_le_bytes(
        packet.get(cursor..cursor + 8)?.try_into().ok()?,
    ))
}

#[test]
fn native_abi_self_attests_every_builtin_profile_hash() {
    let profiles = [
        (1, ExerciseProfile::lat_pulldown_provisional()),
        (2, ExerciseProfile::seated_shoulder_press_provisional()),
        (3, ExerciseProfile::lat_pulldown_rear_left_45_provisional()),
        (
            4,
            ExerciseProfile::seated_shoulder_press_front_provisional(),
        ),
        (5, ExerciseProfile::march_in_place_front_provisional()),
        (6, ExerciseProfile::side_step_touch_front_provisional()),
        (
            7,
            ExerciseProfile::alternating_knee_raise_front_provisional(),
        ),
        (8, ExerciseProfile::step_jack_front_provisional()),
        (
            109,
            ExerciseProfile::barbell_bench_press_local_front_provisional(),
        ),
        (
            110,
            ExerciseProfile::barbell_bench_press_local_front_left_provisional(),
        ),
        (
            111,
            ExerciseProfile::barbell_bench_press_local_front_right_provisional(),
        ),
        (
            112,
            ExerciseProfile::seated_barbell_shoulder_press_local_front_provisional(),
        ),
        (
            113,
            ExerciseProfile::seated_barbell_shoulder_press_local_front_left_provisional(),
        ),
        (
            114,
            ExerciseProfile::seated_barbell_shoulder_press_local_front_right_provisional(),
        ),
    ];

    for (profile_code, profile) in profiles {
        let attested_hash = builtin_profile_hash(profile_code);
        assert_ne!(attested_hash, 0);
        assert_eq!(
            motion_sdk_builtin_profile_hash_low(profile_code),
            profile.content_hash as u32
        );
        assert_eq!(
            motion_sdk_builtin_profile_hash_high(profile_code),
            (profile.content_hash >> 32) as u32
        );
        assert_eq!(attested_hash, profile.content_hash);
        assert_eq!(attested_hash, profile.computed_content_hash());
    }

    for profile_code in 1..=8 {
        assert_ne!(builtin_profile_hash(profile_code), 0);
    }
    for profile_code in 101..=115 {
        assert_ne!(builtin_profile_hash(profile_code), 0);
    }
}

#[test]
fn exercise_profile_hash_changes_when_its_executable_definition_changes() {
    let profile = ExerciseProfile::barbell_bench_press_local_front_provisional();
    let mut changed_profile = profile.clone();
    changed_profile.min_primary_amplitude += 0.01;

    assert_ne!(
        profile.computed_content_hash(),
        changed_profile.computed_content_hash()
    );
}

#[test]
fn native_abi_returns_zero_hash_for_none_and_unknown_profile_codes() {
    for profile_code in [0, 9, 100, 116, u32::MAX] {
        assert_eq!(motion_sdk_builtin_profile_hash_low(profile_code), 0);
        assert_eq!(motion_sdk_builtin_profile_hash_high(profile_code), 0);
    }
}

#[test]
fn every_attested_builtin_profile_code_is_accepted_by_the_runtime_factory() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(720, 1280, 0), 0);
    for profile_code in 1..=8 {
        assert_ne!(builtin_profile_hash(profile_code), 0);
        assert_eq!(motion_sdk_set_profile(profile_code), 0);
    }

    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    for profile_code in 101..=115 {
        assert_ne!(builtin_profile_hash(profile_code), 0);
        assert_eq!(motion_sdk_set_profile(profile_code), 0);
    }
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn installed_runtime_packet_reports_the_self_attested_profile_hash() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(720, 1280, 0), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    assert_eq!(motion_sdk_set_profile(109), 0);
    assert_eq!(motion_sdk_begin_replay_set(), 0);
    assert_eq!(motion_sdk_begin_frame(100, 0, 0), 0);
    assert_eq!(motion_sdk_process_frame(), 0);

    let mut packet = vec![0_u8; motion_sdk_packet_len() as usize];
    // SAFETY: `packet` is writable for exactly the capacity passed to the ABI.
    let copied = unsafe { motion_sdk_copy_packet(packet.as_mut_ptr(), packet.len()) };
    assert_eq!(copied, packet.len() as isize);
    assert_eq!(
        packet_active_profile_hash(&packet),
        Some(builtin_profile_hash(109)),
    );
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn replay_can_install_its_legacy_profile_before_the_first_observation_only() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(720, 1280, 0), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    assert_eq!(motion_sdk_begin_replay_set(), 0);
    assert_eq!(
        motion_sdk_set_profile(109),
        0,
        "offline replay constructors may bind a legacy profile before frame zero",
    );
    assert_eq!(motion_sdk_begin_frame(100, 0, 0), 0);
    assert_eq!(motion_sdk_process_frame(), 0);
    assert_eq!(
        motion_sdk_set_profile(109),
        -5,
        "profile semantics freeze after the first replay observation",
    );
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn native_abi_copies_the_same_versioned_profile_packet_into_host_memory() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);
    let sequence = b"native-home-workout-contract";
    assert_eq!(motion_sdk_begin_sequence(sequence.len() as u32), 0);
    for (index, value) in sequence.iter().enumerate() {
        assert_eq!(
            motion_sdk_set_sequence_byte(index as u32, u32::from(*value)),
            0
        );
    }
    assert_eq!(motion_sdk_commit_sequence(), 0);
    assert_eq!(motion_sdk_reset(720, 1280, 0), 0);
    assert_eq!(motion_sdk_set_profile(5), 0);
    assert_eq!(motion_sdk_begin_replay_set(), 0);
    assert_eq!(motion_sdk_begin_frame(100, 0, 0), 0);
    assert_eq!(motion_sdk_process_frame(), 0);

    let mut packet = vec![0_u8; motion_sdk_packet_len() as usize];
    // SAFETY: `packet` is writable for exactly the capacity passed to the ABI.
    let copied = unsafe { motion_sdk_copy_packet(packet.as_mut_ptr(), packet.len()) };
    assert_eq!(copied, packet.len() as isize);
    assert_eq!(&packet[..4], b"MOTN");
    assert_eq!(
        u16::from_le_bytes([packet[4], packet[5]]),
        motion_sdk_contract_major() as u16
    );
    assert_eq!(
        u16::from_le_bytes([packet[6], packet[7]]),
        motion_sdk_contract_minor() as u16
    );
    assert!(
        packet
            .windows(sequence.len())
            .any(|window| window == sequence)
    );
    assert!(
        packet
            .windows(b"march-in-place/front/bilateral/bodyweight/v1".len())
            .any(|window| window == b"march-in-place/front/bilateral/bodyweight/v1")
    );
    assert!(packet.windows(4).any(|window| window == b"ANG1"));
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn native_abi_rejects_non_monotonic_frame_timestamps() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(720, 1280, 0), 0);
    assert_eq!(motion_sdk_begin_frame(100, 0, 0), 0);
    assert_eq!(motion_sdk_process_frame(), 0);
    assert_eq!(motion_sdk_begin_frame(100, 0, 0), -3);
    assert_eq!(motion_sdk_begin_frame(99, 0, 0), -3);
    assert_eq!(motion_sdk_begin_frame(101, 0, 0), 0);
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn native_abi_reports_profile_observability_from_the_canonical_frame() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(720, 1280, 0), 0);
    assert_eq!(motion_sdk_set_profile(5), 0);
    assert_eq!(motion_sdk_begin_frame(100, 0, 0), 0);
    assert_eq!(motion_sdk_process_frame(), 0);
    assert_eq!(motion_sdk_current_frame_valid(), 0);

    assert_eq!(motion_sdk_begin_frame(200, 0, 33), 0);
    for index in 0..33 {
        let (x, y) = match index {
            11 => (0.44, 0.30),
            12 => (0.56, 0.30),
            23 => (0.44, 0.50),
            24 => (0.56, 0.50),
            25 => (0.44, 0.68),
            26 => (0.56, 0.68),
            _ => (0.50, 0.50),
        };
        assert_eq!(motion_sdk_set_landmark(index, x, y, 0.0, 1.0), 0);
    }
    assert_eq!(motion_sdk_process_frame(), 0);
    assert_eq!(motion_sdk_current_frame_valid(), 1);
    assert_eq!(motion_sdk_close(), 0);
}
