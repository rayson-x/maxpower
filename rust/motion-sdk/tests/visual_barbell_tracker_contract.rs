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
fn raw_detector_preserves_both_shaft_candidates_before_hand_association() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let subject = subject_with_wrists(1, 0.34, 0.52);
    let evidence = process_frame_halpe26(
        &mut tracker,
        &frame_with_two_shafts(0.29, 0.52),
        1_000,
        &[subject],
    );
    assert!(
        evidence
            .raw_observations
            .iter()
            .any(|candidate| (candidate.bbox.y + candidate.bbox.height * 0.5 - 0.29).abs() < 0.03)
    );
    assert!(
        evidence
            .raw_observations
            .iter()
            .any(|candidate| (candidate.bbox.y + candidate.bbox.height * 0.5 - 0.52).abs() < 0.03)
    );
}

#[test]
fn shared_rust_tracker_searches_below_the_shoulders_for_a_row_held_at_the_wrists() {
    let mut tracker = BarbellAxisVisualTracker::default();
    // Matches the governed front-left row failure: shoulders are near 0.30,
    // while both hands and the real shaft are near 0.61. The former
    // shoulder-only search ended at 0.50 and could only see the rack line.
    let subject = subject_with_wrists(1, 0.30, 0.61);
    let evidence = process_frame_halpe26(
        &mut tracker,
        &frame_with_two_shafts(0.466, 0.61),
        1_000,
        &[subject],
    );
    assert!(
        evidence
            .raw_observations
            .iter()
            .any(|candidate| (candidate.bbox.y + candidate.bbox.height * 0.5 - 0.61).abs() < 0.03)
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
    let evidence = process_frame_halpe26(
        &mut tracker,
        &frame_with_two_shafts(0.29, 0.52),
        1_100,
        &[effort],
    );
    assert!(
        evidence
            .raw_observations
            .iter()
            .any(|candidate| (candidate.bbox.y + candidate.bbox.height * 0.5 - 0.52).abs() < 0.03)
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
fn a_single_long_scene_edge_is_not_a_measured_barbell_shaft() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let subject = subject_with_wrists(1, 0.34, 0.42);
    let mut frame = blank_frame();
    let boundary_y = (0.42 * HEIGHT as f32).round() as usize;
    for y in boundary_y..HEIGHT {
        for x in 0..WIDTH {
            frame[y * WIDTH + x] = 224;
        }
    }

    let evidence = process_frame_halpe26(&mut tracker, &frame, 1_000, &[subject]);
    assert!(
        evidence.raw_observations.is_empty(),
        "a wall/rack boundary has one image edge; a shaft requires two bounded parallel edges",
    );
    assert!(evidence.display_axis.is_none());
}

#[test]
fn visual_loss_uses_prediction_not_a_wrist_generated_bar() {
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
        .expect("bounded visual prediction may bridge display continuity");
    assert_eq!(fused.source, BarbellAxisSource::Predicted);
    assert!(
        fused.equipment_observation().is_none(),
        "pose-derived fusion may bridge display continuity but is not an independent equipment observation"
    );
}

#[test]
fn wrist_motion_does_not_turn_a_static_rack_line_into_a_pose_generated_bar() {
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
    assert_eq!(fused.source, BarbellAxisSource::Measured, "{fused:?}");
    assert!(fused.center_y < 0.40, "{fused:?}");
}

#[test]
fn raw_detector_publishes_only_the_visible_image_segment_not_a_wrist_length() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let left_x = 0.44;
    let right_x = 0.57;
    let subject = subject_with_wrist_points(1, 0.30, left_x, 0.42, right_x, 0.42);
    let measured = process_halpe26(&mut tracker, &frame_with_shaft(0.42), 1_000, &[subject])
        .expect("the hand-associated shaft should be measured");

    let published_span = measured.x2 - measured.x1;
    assert!(
        published_span > 0.60,
        "the visible segment was cropped to the grip: {measured:?}"
    );
    assert!(
        measured.x1 <= left_x && measured.x2 >= right_x,
        "{measured:?}"
    );
}

#[test]
fn raw_detector_keeps_a_line_that_misses_a_wrist_for_later_association() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let subject = subject_with_wrist_points(1, 0.30, 0.40, 0.42, 0.60, 0.50);

    let measured = process_halpe26(&mut tracker, &frame_with_shaft(0.42), 1_000, &[subject])
        .expect("image geometry is independent of hand association");
    assert_eq!(measured.source, BarbellAxisSource::Measured);
}

#[test]
fn close_grip_visual_occlusion_remains_prediction_only() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let ready = subject_with_wrist_points(1, 0.30, 0.44, 0.38, 0.57, 0.38);
    process_halpe26(
        &mut tracker,
        &frame_with_shaft(0.38),
        1_000,
        &[ready.clone()],
    )
    .expect("ready shaft should calibrate");
    process_halpe26(&mut tracker, &frame_with_shaft(0.38), 1_100, &[ready])
        .expect("ready shaft should remain measured");
    let peak = subject_with_wrist_points(1, 0.30, 0.44, 0.56, 0.57, 0.56);
    process_halpe26(&mut tracker, &frame_with_shaft(0.56), 1_200, &[peak])
        .expect("peak shaft should establish the visible range");

    let return_pose = subject_with_wrist_points(1, 0.30, 0.44, 0.48, 0.57, 0.48);
    let bridged = process_halpe26(&mut tracker, &blank_frame(), 1_300, &[return_pose])
        .expect("close-grip wrists should bridge a short visual occlusion");
    assert_eq!(bridged.source, BarbellAxisSource::Predicted, "{bridged:?}");
}

#[test]
fn raw_visual_geometry_is_invariant_when_only_wrists_move() {
    let frame = frame_with_shaft(0.42);
    let mut first_tracker = BarbellAxisVisualTracker::default();
    let first = process_halpe26(
        &mut first_tracker,
        &frame,
        1_000,
        &[subject_with_wrist_points(1, 0.30, 0.20, 0.24, 0.80, 0.24)],
    )
    .expect("the image contains a shaft");

    let mut second_tracker = BarbellAxisVisualTracker::default();
    let second = process_halpe26(
        &mut second_tracker,
        &frame,
        1_000,
        &[subject_with_wrist_points(1, 0.30, 0.43, 0.62, 0.57, 0.62)],
    )
    .expect("the same image contains the same shaft");

    assert_eq!(first.source, BarbellAxisSource::Measured);
    assert_eq!(second.source, BarbellAxisSource::Measured);
    assert_eq!(
        (first.x1, first.y1, first.x2, first.y2),
        (second.x1, second.y1, second.x2, second.y2)
    );
}

#[test]
fn wrists_never_generate_canonical_equipment_when_the_shaft_disappears() {
    let mut tracker = BarbellAxisVisualTracker::default();
    let subject = subject_with_wrists(1, 0.30, 0.42);
    process_halpe26(
        &mut tracker,
        &frame_with_shaft(0.42),
        1_000,
        &[subject.clone()],
    )
    .expect("visual measurement establishes a track");

    let continuity = process_halpe26(&mut tracker, &blank_frame(), 1_100, &[subject])
        .expect("short visual loss may retain bounded display continuity");
    assert_eq!(continuity.source, BarbellAxisSource::Predicted);
    assert_ne!(continuity.source, BarbellAxisSource::Fused);
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

fn process_frame_halpe26(
    tracker: &mut BarbellAxisVisualTracker,
    luma: &[u8],
    timestamp_ms: u64,
    subjects: &[PoseCandidate],
) -> maxpower_motion_sdk::BarbellAxisFrameEvidence {
    tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            luma,
            WIDTH,
            HEIGHT,
            timestamp_ms,
            subjects,
        )
        .expect("Halpe-26 must be accepted")
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
    subject_with_wrist_points(id, shoulder_y, 0.25, wrist_y, 0.75, wrist_y)
}

fn subject_with_wrist_points(
    id: u64,
    shoulder_y: f32,
    left_x: f32,
    left_y: f32,
    right_x: f32,
    right_y: f32,
) -> PoseCandidate {
    let mut observations = vec![PoseObservation::new(0.5, shoulder_y, 0.0, 0.0); 26];
    observations[5] = PoseObservation::new(0.40, shoulder_y, 0.0, 0.9);
    observations[6] = PoseObservation::new(0.60, shoulder_y, 0.0, 0.9);
    observations[9] = PoseObservation::new(left_x, left_y, 0.0, 0.8);
    observations[10] = PoseObservation::new(right_x, right_y, 0.0, 0.8);
    PoseCandidate {
        id,
        bbox: NormalizedRect::new(0.2, 0.15, 0.6, 0.82),
        observations,
        torso_color: [0.3, 0.3, 0.3],
    }
}
