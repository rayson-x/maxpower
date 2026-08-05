use form_coach_motion_sdk::web_abi::{
    motion_sdk_begin_frame, motion_sdk_begin_replay_set, motion_sdk_begin_sequence,
    motion_sdk_close, motion_sdk_commit_sequence, motion_sdk_contract_major,
    motion_sdk_contract_minor, motion_sdk_copy_packet, motion_sdk_packet_len,
    motion_sdk_process_frame, motion_sdk_reset, motion_sdk_set_profile,
    motion_sdk_set_sequence_byte,
};

#[test]
fn native_abi_copies_the_same_versioned_profile_packet_into_host_memory() {
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
    assert_eq!(motion_sdk_close(), 0);
}
