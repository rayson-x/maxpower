use maxpower_motion_sdk::web_abi::{
    motion_sdk_add_equipment_observation, motion_sdk_begin_candidate, motion_sdk_begin_multi,
    motion_sdk_begin_set, motion_sdk_begin_visual_equipment_frame, motion_sdk_close,
    motion_sdk_commit_candidate, motion_sdk_copy_packet, motion_sdk_copy_visual_equipment_luma,
    motion_sdk_detect_barbell_axis, motion_sdk_detect_visual_equipment, motion_sdk_packet_len,
    motion_sdk_process_multi, motion_sdk_reset, motion_sdk_select_visual_action_context,
    motion_sdk_set_landmark, motion_sdk_set_pose_schema, motion_sdk_set_profile,
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
fn shared_visual_abi_runs_the_action_plan_bound_dumbbell_provider_without_host_geometry() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    for (mode, expected_kind) in [(2, 2_u8)] {
        assert_eq!(motion_sdk_close(), 0);
        assert_eq!(motion_sdk_reset(320, 240, 1), 0);
        assert_eq!(motion_sdk_set_pose_schema(1), 0);
        let action = b"seated_dumbbell_shoulder_press";
        // SAFETY: `action` is a stable UTF-8 byte slice for this call.
        assert_eq!(
            unsafe { motion_sdk_select_visual_action_context(action.as_ptr(), action.len(), 0) },
            0,
        );
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
    let action = b"flat_barbell_bench_press";
    // SAFETY: `action` is a stable UTF-8 byte slice for this call.
    assert_eq!(
        unsafe { motion_sdk_select_visual_action_context(action.as_ptr(), action.len(), 0) },
        0,
    );
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

#[test]
fn caller_mode_cannot_replace_the_provider_selected_by_rust() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    assert_eq!(motion_sdk_reset(320, 240, 1), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    let action = b"seated_dumbbell_shoulder_press";
    // SAFETY: `action` is a stable UTF-8 byte slice for this call.
    assert_eq!(
        unsafe { motion_sdk_select_visual_action_context(action.as_ptr(), action.len(), 0) },
        0,
    );
    assert_eq!(motion_sdk_begin_multi(1_000, 0), 0);
    assert_eq!(
        motion_sdk_begin_visual_equipment_frame(320, 240, 320 * 240),
        0
    );
    let luma = vec![28; 320 * 240];
    // SAFETY: `luma` remains alive and readable for the call.
    assert_eq!(
        unsafe { motion_sdk_copy_visual_equipment_luma(luma.as_ptr(), luma.len()) },
        0
    );
    assert_eq!(motion_sdk_detect_visual_equipment(3), -4);
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn action_context_compiles_the_visual_provider_in_rust_before_pixels_arrive() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    assert_eq!(motion_sdk_reset(320, 240, 1), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    let action = b"flat_barbell_bench_press";
    // SAFETY: `action` is a stable UTF-8 byte slice for this call.
    assert_eq!(
        unsafe { motion_sdk_select_visual_action_context(action.as_ptr(), action.len(), 0) },
        0
    );
    assert_eq!(motion_sdk_begin_multi(1_000, 0), 0);
    assert_eq!(
        motion_sdk_begin_visual_equipment_frame(320, 240, 320 * 240),
        0
    );
    let luma = vec![28; 320 * 240];
    // SAFETY: `luma` remains alive and readable for the call.
    assert_eq!(
        unsafe { motion_sdk_copy_visual_equipment_luma(luma.as_ptr(), luma.len()) },
        0
    );
    assert_eq!(motion_sdk_detect_visual_equipment(2), -4);
    assert_eq!(motion_sdk_detect_visual_equipment(1), 0);
    assert_eq!(motion_sdk_set_profile(109), -4);
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn plan_bound_visual_context_rejects_host_equipment_geometry_and_legacy_profile_replacement() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    assert_eq!(motion_sdk_reset(320, 240, 1), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    let action = b"flat_barbell_bench_press";
    // SAFETY: `action` is a stable UTF-8 byte slice for this call.
    assert_eq!(
        unsafe { motion_sdk_select_visual_action_context(action.as_ptr(), action.len(), 0) },
        0
    );
    assert_eq!(
        motion_sdk_add_equipment_observation(7, 0, 1, 0.2, 0.4, 0.6, 0.02, 0.95, 2.0, 0, 0),
        -7,
        "an action-bound session accepts only its Rust-selected provider output"
    );
    assert_eq!(motion_sdk_set_profile(109), -4);
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn action_context_cannot_consume_geometry_queued_before_provider_selection() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    assert_eq!(motion_sdk_reset(320, 240, 1), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    assert_eq!(
        motion_sdk_add_equipment_observation(7, 0, 1, 0.2, 0.4, 0.6, 0.02, 0.95, 2.0, 0, 0),
        0,
        "legacy ingress remains available only before an action context is selected"
    );
    let action = b"flat_barbell_bench_press";
    // SAFETY: `action` is a stable UTF-8 byte slice for this call.
    assert_eq!(
        unsafe { motion_sdk_select_visual_action_context(action.as_ptr(), action.len(), 0) },
        -11,
        "selection is atomic and refuses a pre-queued host geometry channel"
    );
    assert_eq!(motion_sdk_close(), 0);
}

#[test]
fn active_set_cannot_clear_or_replace_an_installed_action_plan() {
    let _guard = ABI_TEST_LOCK.lock().expect("ABI test lock poisoned");
    assert_eq!(motion_sdk_reset(320, 240, 1), 0);
    assert_eq!(motion_sdk_set_pose_schema(1), 0);
    let bench = b"flat_barbell_bench_press";
    // SAFETY: `bench` is a stable UTF-8 byte slice for this call.
    assert_eq!(
        unsafe { motion_sdk_select_visual_action_context(bench.as_ptr(), bench.len(), 0) },
        0
    );
    assert_eq!(motion_sdk_begin_set(), 0);
    assert_eq!(
        motion_sdk_set_pose_schema(1),
        -4,
        "the schema setter may not clear plan/profile state during a recorded set"
    );
    let press = b"seated_dumbbell_shoulder_press";
    // SAFETY: `press` is a stable UTF-8 byte slice for this call.
    assert_eq!(
        unsafe { motion_sdk_select_visual_action_context(press.as_ptr(), press.len(), 0) },
        -12,
        "a second action context must start a new Rust set lifecycle"
    );
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
