use maxpower_motion_sdk::web_abi::{
    motion_sdk_begin_candidate, motion_sdk_begin_multi, motion_sdk_begin_visual_equipment_frame,
    motion_sdk_close, motion_sdk_commit_candidate, motion_sdk_copy_visual_equipment_luma,
    motion_sdk_detect_barbell_axis, motion_sdk_process_multi, motion_sdk_reset,
    motion_sdk_set_landmark, motion_sdk_visual_barbell_axis_number,
    motion_sdk_visual_barbell_axis_source,
};

const WIDTH: usize = 640;
const HEIGHT: usize = 360;

#[test]
fn native_visual_abi_runs_the_shared_detector_before_the_same_multi_frame() {
    assert_eq!(motion_sdk_reset(WIDTH as u32, HEIGHT as u32, 1), 0);
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
