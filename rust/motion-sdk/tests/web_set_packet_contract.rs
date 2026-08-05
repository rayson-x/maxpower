use form_coach_motion_sdk::web_abi::{
    CANDIDATE_FIELD_BBOX_HEIGHT, CANDIDATE_FIELD_BBOX_WIDTH, CANDIDATE_FIELD_BBOX_X,
    CANDIDATE_FIELD_BBOX_Y, CANDIDATE_FIELD_DOMINANCE_SCORE, CANDIDATE_FIELD_ID,
    CANDIDATE_FIELD_SELECTED, CANDIDATE_FIELD_SWITCH_CONFIRM_MS, CANDIDATE_FIELD_SWITCH_THRESHOLD,
    motion_sdk_begin_candidate, motion_sdk_begin_multi, motion_sdk_begin_sequence,
    motion_sdk_begin_set, motion_sdk_candidate_count, motion_sdk_candidate_number,
    motion_sdk_close, motion_sdk_commit_candidate, motion_sdk_commit_sequence,
    motion_sdk_packet_len, motion_sdk_process_multi, motion_sdk_reset, motion_sdk_set_landmark,
    motion_sdk_set_profile, motion_sdk_set_sequence_byte,
};

#[test]
fn beginning_a_live_set_before_the_next_camera_frame_still_publishes_a_packet() {
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
