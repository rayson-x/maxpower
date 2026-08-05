use form_coach_motion_sdk::web_abi::{
    motion_sdk_begin_sequence, motion_sdk_begin_set, motion_sdk_close,
    motion_sdk_commit_sequence, motion_sdk_packet_len, motion_sdk_reset,
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
