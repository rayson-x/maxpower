use maxpower_motion_sdk::web_abi::{
    CANDIDATE_FIELD_BBOX_HEIGHT, CANDIDATE_FIELD_BBOX_WIDTH, CANDIDATE_FIELD_BBOX_X,
    CANDIDATE_FIELD_BBOX_Y, CANDIDATE_FIELD_DOMINANCE_SCORE, CANDIDATE_FIELD_ID,
    CANDIDATE_FIELD_SELECTED, CANDIDATE_FIELD_SWITCH_CONFIRM_MS, CANDIDATE_FIELD_SWITCH_THRESHOLD,
    motion_sdk_add_equipment_observation, motion_sdk_begin_candidate, motion_sdk_begin_multi,
    motion_sdk_begin_sequence, motion_sdk_begin_set, motion_sdk_candidate_count,
    motion_sdk_candidate_number, motion_sdk_close, motion_sdk_commit_candidate,
    motion_sdk_commit_sequence, motion_sdk_copy_packet, motion_sdk_packet_len,
    motion_sdk_process_multi, motion_sdk_reset, motion_sdk_set_landmark, motion_sdk_set_profile,
    motion_sdk_set_sequence_byte,
};
use std::sync::Mutex;

// The exported ABI intentionally owns one process-global runtime, matching a
// single WASM/native host session. Tests that exercise it must not interleave.
static ABI_TEST_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn beginning_a_live_set_before_the_next_camera_frame_still_publishes_a_packet() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);

    let sequence = b"web-set-boundary";
    assert_eq!(motion_sdk_begin_sequence(sequence.len() as u32), 0);
    for (index, byte) in sequence.iter().copied().enumerate() {
        assert_eq!(motion_sdk_set_sequence_byte(index as u32, byte as u32), 0);
    }
    assert_eq!(motion_sdk_commit_sequence(), 0);
    assert_eq!(motion_sdk_reset(640, 480, 1), 0);
    assert_eq!(motion_sdk_set_profile(5), 0);

    assert_eq!(motion_sdk_begin_set(), 0);
    assert!(
        motion_sdk_packet_len() > 0,
        "begin_set must publish a lifecycle packet even before the next camera frame",
    );

    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn candidate_debug_abi_keeps_named_field_slots_in_sync() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(640, 480, 1), 0);
    assert_eq!(motion_sdk_begin_multi(1, 0), 0);
    assert_eq!(
        motion_sdk_begin_candidate(42, 0, 0.1, 0.2, 0.5, 0.7, 0.2, 0.3, 0.4, 1),
        0,
    );
    assert_eq!(motion_sdk_set_landmark(0, 0.25, 0.5, 0.0, 0.95), 0);
    assert_eq!(motion_sdk_commit_candidate(), 0);
    assert_eq!(motion_sdk_process_multi(), 0);

    assert_eq!(motion_sdk_candidate_count(), 1);
    assert_eq!(motion_sdk_candidate_number(0, CANDIDATE_FIELD_ID), 42.0);
    assert_eq!(motion_sdk_candidate_number(0, CANDIDATE_FIELD_BBOX_X), 0.1);
    assert_eq!(motion_sdk_candidate_number(0, CANDIDATE_FIELD_BBOX_Y), 0.2);
    assert_eq!(
        motion_sdk_candidate_number(0, CANDIDATE_FIELD_BBOX_WIDTH),
        0.5,
    );
    assert_eq!(
        motion_sdk_candidate_number(0, CANDIDATE_FIELD_BBOX_HEIGHT),
        0.7,
    );
    assert!(motion_sdk_candidate_number(0, CANDIDATE_FIELD_DOMINANCE_SCORE).is_finite());
    assert_eq!(
        motion_sdk_candidate_number(0, CANDIDATE_FIELD_SELECTED),
        1.0,
    );
    assert_eq!(
        motion_sdk_candidate_number(0, CANDIDATE_FIELD_SWITCH_THRESHOLD),
        0.25,
    );
    assert_eq!(
        motion_sdk_candidate_number(0, CANDIDATE_FIELD_SWITCH_CONFIRM_MS),
        300.0,
    );
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn web_abi_associates_equipment_with_the_locked_subject_and_publishes_v1_8() {
    let _guard = ABI_TEST_LOCK.lock().unwrap();
    assert_eq!(motion_sdk_close(), 0);
    assert_eq!(motion_sdk_reset(640, 480, 1), 0);
    assert_eq!(motion_sdk_begin_multi(1_000, 0), 0);
    assert_eq!(
        motion_sdk_begin_candidate(42, 0, 0.1, 0.1, 0.8, 0.8, 0.2, 0.3, 0.4, 26),
        0,
    );
    for index in 0..26 {
        assert_eq!(motion_sdk_set_landmark(index, 0.5, 0.5, 0.0, 0.95), 0);
    }
    assert_eq!(motion_sdk_commit_candidate(), 0);
    // kind=barbell shaft, source=detector, flags=none. Detector proposal ids
    // are frame-local; Rust owns the stable track id in the packet.
    assert_eq!(
        motion_sdk_add_equipment_observation(77, 0, 1, 0.2, 0.4, 0.6, 0.04, 0.92, 2.0, 0, 0,),
        0,
    );
    assert_eq!(motion_sdk_process_multi(), 0);

    let mut packet = vec![0_u8; motion_sdk_packet_len() as usize];
    // SAFETY: `packet` is writable for exactly the capacity passed to the ABI.
    let copied = unsafe { motion_sdk_copy_packet(packet.as_mut_ptr(), packet.len()) };
    assert_eq!(copied, packet.len() as isize);
    assert_eq!(u16::from_le_bytes([packet[6], packet[7]]), 8);
    let equipment_offset = packet
        .windows(4)
        .position(|window| window == b"EQP1")
        .expect("v1.7 packet must contain canonical equipment evidence");
    assert_eq!(
        packet[equipment_offset + 4],
        0,
        "equipment must be observed"
    );
    assert_eq!(
        packet[equipment_offset + 5],
        0,
        "observed has no refusal reason"
    );
    assert_eq!(
        packet[equipment_offset + 6],
        1,
        "subject id must be present"
    );
    assert_eq!(
        u16::from_le_bytes([packet[equipment_offset + 23], packet[equipment_offset + 24],]),
        1,
        "one track must be published",
    );
    assert!(
        packet.windows(4).any(|window| window == b"QLT1"),
        "v1.8 packet must carry the additive Rust quality extension"
    );
    assert_eq!(motion_sdk_close(), 0);
}
