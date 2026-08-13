use maxpower_motion_sdk::{
    BarbellAxisSource, BarbellAxisVisualTracker, NormalizedRect, PoseCandidate, PoseObservation,
    PoseSchemaId, VisualEquipmentError,
};

const WIDTH: usize = 640;
const HEIGHT: usize = 360;

#[test]
fn visual_barbell_tracker_rejects_blazepose_before_reading_coco_indices() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let result = tracker.process(
        PoseSchemaId::BlazePose33,
        &frame_with_shaft(0.42),
        WIDTH,
        HEIGHT,
        1_000,
        &[subject(1, 0.48)],
    );

    assert_eq!(result, Err(VisualEquipmentError::UnsupportedPoseSchema));
}

#[test]
fn shared_rust_tracker_measures_a_long_shaft_and_bounds_prediction() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let subject = subject(1, 0.48);
    let measured = process_halpe26(
        &mut tracker,
        &frame_with_shaft(0.42),
        1_000,
        &[subject.clone()],
    )
    .expect("shaft should be measured");
    assert_eq!(measured.source, BarbellAxisSource::Measured);
    assert!((measured.center_y - 0.42).abs() < 0.025, "{measured:?}");
    assert!(measured.confidence >= 0.5, "{measured:?}");
    assert!(measured.equipment_observation().is_some());

    let predicted = process_halpe26(&mut tracker, &blank_frame(), 1_100, &[subject])
        .expect("one missing frame should retain private continuity");
    assert_eq!(predicted.source, BarbellAxisSource::Predicted);
    assert!(predicted.equipment_observation().is_none());
}

#[test]
fn shared_rust_tracker_does_not_choose_the_first_person_in_a_mirror_scene() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let reflection = subject(2, 0.24);
    let foreground = subject(1, 0.48);
    let measured = process_halpe26(
        &mut tracker,
        &frame_with_shaft(0.42),
        1_000,
        &[reflection, foreground],
    )
    .expect("all current-frame candidates should contribute search context");
    assert_eq!(measured.source, BarbellAxisSource::Measured);
    assert!((measured.center_y - 0.42).abs() < 0.025, "{measured:?}");
}

#[test]
fn shared_rust_tracker_prefers_the_shaft_through_the_wrists_over_a_static_rack_line() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let subject = subject_with_wrists(1, 0.34, 0.52);
    let measured = process_halpe26(
        &mut tracker,
        &frame_with_two_shafts(0.29, 0.52),
        1_000,
        &[subject],
    )
    .expect("the hand-associated shaft should be measured");
    assert_eq!(measured.source, BarbellAxisSource::Measured);
    assert!(
        (measured.center_y - 0.52).abs() < 0.03,
        "static rack line won over the hand-associated shaft: {measured:?}"
    );
}

#[test]
fn shared_rust_tracker_reacquires_the_hand_associated_shaft_after_a_static_lock() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let ready = subject_with_wrists(1, 0.34, 0.34);
    process_halpe26(
        &mut tracker,
        &frame_with_two_shafts(0.29, 0.34),
        1_000,
        &[ready],
    )
    .expect("ready shaft should initialize the tracker");
    let effort = subject_with_wrists(1, 0.34, 0.52);
    let measured = process_halpe26(
        &mut tracker,
        &frame_with_two_shafts(0.29, 0.52),
        1_100,
        &[effort],
    )
    .expect("moving shaft should remain measurable");
    assert!(
        measured.center_y > 0.43,
        "continuity kept the static rack line instead of reacquiring: {measured:?}"
    );
}

#[test]
fn shared_rust_tracker_never_invents_a_shaft_from_uncalibrated_wrists() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let subject = subject_with_wrists(1, 0.34, 0.52);
    assert!(
        process_halpe26(&mut tracker, &blank_frame(), 1_000, &[subject]).is_none(),
        "pose alone must not create equipment evidence before visual calibration"
    );
}

#[test]
fn shared_rust_tracker_fuses_wrists_only_after_visual_full_range_calibration() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let ready = subject_with_wrists(1, 0.34, 0.38);
    process_halpe26(
        &mut tracker,
        &frame_with_shaft(0.34),
        1_000,
        &[ready.clone()],
    )
    .expect("ready shaft should calibrate");
    process_halpe26(&mut tracker, &frame_with_shaft(0.34), 1_100, &[ready])
        .expect("ready shaft should remain measured");
    let peak = subject_with_wrists(1, 0.34, 0.56);
    process_halpe26(&mut tracker, &frame_with_shaft(0.52), 1_200, &[peak])
        .expect("peak shaft should establish calibration range");
    let occluded_return = subject_with_wrists(1, 0.34, 0.48);
    let fused = process_halpe26(&mut tracker, &blank_frame(), 1_300, &[occluded_return])
        .expect("calibrated wrists should bridge visual shaft occlusion");
    assert_eq!(fused.source, BarbellAxisSource::Fused);
    assert!((fused.center_y - 0.44).abs() < 0.04, "{fused:?}");
    assert!(
        fused.equipment_observation().is_none(),
        "pose-derived fusion may bridge display continuity but is not an independent equipment observation"
    );
}

#[test]
fn shared_rust_tracker_rejects_a_static_rack_line_after_wrist_calibration() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let ready = subject_with_wrists(1, 0.34, 0.38);
    process_halpe26(
        &mut tracker,
        &frame_with_shaft(0.34),
        1_000,
        &[ready.clone()],
    )
    .expect("ready shaft should calibrate");
    process_halpe26(&mut tracker, &frame_with_shaft(0.34), 1_100, &[ready])
        .expect("ready shaft should remain measured");
    let peak = subject_with_wrists(1, 0.34, 0.56);
    process_halpe26(&mut tracker, &frame_with_shaft(0.52), 1_200, &[peak])
        .expect("peak shaft should establish calibration range");

    let moving_wrists = subject_with_wrists(1, 0.34, 0.50);
    let fused = process_halpe26(
        &mut tracker,
        &frame_with_shaft(0.29),
        1_300,
        &[moving_wrists],
    )
    .expect("calibrated wrist path should survive a visible static rack line");
    assert_eq!(fused.source, BarbellAxisSource::Fused, "{fused:?}");
    assert!(fused.center_y > 0.40, "{fused:?}");
}

fn blank_frame() -> Vec<u8> {
    vec![30; WIDTH * HEIGHT]
}

fn process_halpe26(
    tracker: &mut BarbellAxisVisualTracker,
    luma: &[u8],
    timestamp_ms: u64,
    subjects: &[PoseCandidate],
) -> Option<maxpower_motion_sdk::BarbellAxisObservation> {
    tracker
        .process(
            PoseSchemaId::Halpe26,
            luma,
            WIDTH,
            HEIGHT,
            timestamp_ms,
            subjects,
        )
        .expect("Halpe-26 must be accepted by the visual equipment tracker")
}

fn frame_with_shaft(normalized_y: f32) -> Vec<u8> {
    let mut frame = blank_frame();
    draw_shaft(&mut frame, normalized_y);
    frame
}

fn frame_with_two_shafts(first_y: f32, second_y: f32) -> Vec<u8> {
    let mut frame = blank_frame();
    draw_shaft(&mut frame, first_y);
    draw_shaft(&mut frame, second_y);
    frame
}

fn draw_shaft(frame: &mut [u8], normalized_y: f32) {
    let center_y = (normalized_y * HEIGHT as f32).round() as usize;
    for y in center_y.saturating_sub(3)..=(center_y + 3).min(HEIGHT - 1) {
        for x in 105..=535 {
            frame[y * WIDTH + x] = 224;
        }
    }
}

fn subject(id: u64, shoulder_y: f32) -> PoseCandidate {
    subject_with_wrists(id, shoulder_y, 0.42)
}

fn subject_with_wrists(id: u64, shoulder_y: f32, wrist_y: f32) -> PoseCandidate {
    let mut observations = vec![PoseObservation::new(0.5, shoulder_y, 0.0, 0.0); 26];
    observations[5] = PoseObservation::new(0.40, shoulder_y, 0.0, 0.9);
    observations[6] = PoseObservation::new(0.60, shoulder_y, 0.0, 0.9);
    observations[9] = PoseObservation::new(0.25, wrist_y, 0.0, 0.8);
    observations[10] = PoseObservation::new(0.75, wrist_y, 0.0, 0.8);
    PoseCandidate {
        id,
        bbox: NormalizedRect::new(0.2, 0.15, 0.6, 0.82),
        observations,
        torso_color: [0.3, 0.3, 0.3],
    }
}
