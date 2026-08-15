use maxpower_motion_sdk::web_abi::{
    motion_sdk_begin_candidate, motion_sdk_begin_multi, motion_sdk_begin_visual_equipment_frame,
    motion_sdk_close, motion_sdk_commit_candidate, motion_sdk_copy_packet,
    motion_sdk_copy_visual_equipment_luma, motion_sdk_detect_barbell_axis,
    motion_sdk_detect_visual_equipment, motion_sdk_packet_len, motion_sdk_process_multi,
    motion_sdk_reset, motion_sdk_set_landmark, motion_sdk_set_pose_schema,
    motion_sdk_visual_barbell_axis_number, motion_sdk_visual_barbell_axis_source,
};
use std::sync::Mutex;

const WIDTH: usize = 640;
const HEIGHT: usize = 360;
static ABI_TEST_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn visual_equipment_abi_rejects_blazepose_before_allocating_a_coco_indexed_frame() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    assert_eq!(motion_sdk_reset(WIDTH as u32, HEIGHT as u32, 1), 0);
    assert_eq!(
        motion_sdk_begin_visual_equipment_frame(
            WIDTH as u32,
            HEIGHT as u32,
            (WIDTH * HEIGHT) as u32,
        ),
        -3,
    );
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn shared_visual_abi_runs_dumbbell_and_machine_pixels_without_host_geometry() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    for (mode, expected_kind) in [(2, 2_u8), (3, 3_u8)] {
        assert_eq!(motion_sdk_close(), 0);
        assert_eq!(motion_sdk_reset(320, 240, 1), 0);
        assert_eq!(motion_sdk_set_pose_schema(1), 0);
        submit_compact_frame(1_000, mode, &vec![28; 320 * 240]);

        let mut object = vec![28; 320 * 240];
        for y in 128..152 {
            for x in 104..132 {
                object[y * 320 + x] = 224;
            }
        }
        submit_compact_frame(1_100, mode, &object);

        let mut packet = vec![0_u8; motion_sdk_packet_len() as usize];
        // SAFETY: `packet` is writable for the declared capacity.
        assert_eq!(
            unsafe { motion_sdk_copy_packet(packet.as_mut_ptr(), packet.len()) },
            packet.len() as isize
        );
        let equipment_offset = packet
            .windows(4)
            .position(|window| window == b"EQP1")
            .expect("canonical packet contains equipment evidence");
        assert_eq!(
            u16::from_le_bytes([packet[equipment_offset + 23], packet[equipment_offset + 24]]),
            1,
            "one image-derived compact-equipment track must cross the shared ABI"
        );
        assert_eq!(packet[equipment_offset + 49], expected_kind);
    }
    assert_eq!(motion_sdk_close(), 0);
}

fn submit_compact_frame(timestamp_ms: u32, mode: u32, luma: &[u8]) {
    assert_eq!(motion_sdk_begin_multi(timestamp_ms, 0), 0);
    assert_eq!(
        motion_sdk_begin_candidate(41, 0, 0.15, 0.08, 0.70, 0.86, 0.2, 0.3, 0.4, 26),
        0,
    );
    for index in 0..26 {
        let (x, y, score) = match index {
            5 => (0.40, 0.30, 0.9),
            6 => (0.60, 0.30, 0.9),
            9 => (0.37, 0.58, 0.9),
            10 => (0.63, 0.58, 0.9),
            _ => (0.5, 0.4, 0.0),
        };
        assert_eq!(motion_sdk_set_landmark(index, x, y, 0.0, score), 0);
    }
    assert_eq!(motion_sdk_commit_candidate(), 0);
    assert_eq!(
        motion_sdk_begin_visual_equipment_frame(320, 240, luma.len() as u32),
        0,
    );
    // SAFETY: `luma` remains alive and readable for the call.
    assert_eq!(
        unsafe { motion_sdk_copy_visual_equipment_luma(luma.as_ptr(), luma.len()) },
        0
    );
    assert_eq!(motion_sdk_detect_visual_equipment(mode), 0);
    assert_eq!(motion_sdk_process_multi(), 0);
}

#[test]
fn native_visual_abi_runs_the_shared_detector_before_the_same_multi_frame() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    assert_eq!(motion_sdk_reset(WIDTH as u32, HEIGHT as u32, 1), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    assert_eq!(motion_sdk_begin_multi(1_000, 0), 0);
    assert_eq!(
        motion_sdk_begin_candidate(1, 0, 0.2, 0.15, 0.6, 0.82, 0.3, 0.3, 0.3, 26),
        0,
    );
    for index in 0..26 {
        let (x, y, score) = match index {
            5 => (0.40, 0.48, 0.9),
            6 => (0.60, 0.48, 0.9),
            9 => (0.25, 0.42, 0.8),
            10 => (0.75, 0.42, 0.8),
            _ => (0.5, 0.48, 0.0),
        };
        assert_eq!(motion_sdk_set_landmark(index, x, y, 0.0, score), 0);
    }
    assert_eq!(motion_sdk_commit_candidate(), 0);

    let luma = frame_with_shaft();
    assert_eq!(
        motion_sdk_begin_visual_equipment_frame(WIDTH as u32, HEIGHT as u32, luma.len() as u32),
        0,
    );
    // SAFETY: `luma` remains alive and readable for the duration of this call.
    assert_eq!(
        unsafe { motion_sdk_copy_visual_equipment_luma(luma.as_ptr(), luma.len()) },
        0
    );
    assert_eq!(motion_sdk_detect_barbell_axis(), 0);
    assert_eq!(motion_sdk_visual_barbell_axis_source(), 0);
    assert_eq!(motion_sdk_process_multi(), 0);
    assert_eq!(motion_sdk_visual_barbell_axis_source(), 1);
    assert!((motion_sdk_visual_barbell_axis_number(4) - 0.42).abs() < 0.025);
    assert_eq!(motion_sdk_close(), 0);
}

fn frame_with_shaft() -> Vec<u8> {
    let mut frame = vec![30; WIDTH * HEIGHT];
    let center_y = (0.42 * HEIGHT as f32).round() as usize;
    for y in center_y - 3..=center_y + 3 {
        for x in 105..=535 {
            frame[y * WIDTH + x] = 224;
        }
    }
    frame
}
