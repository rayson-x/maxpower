use maxpower_motion_sdk::{
    CanonicalLandmark, EquipmentAssociationStage, EquipmentFrameInput, EquipmentFusionEngine,
    EquipmentHand, EquipmentKind, LandmarkSource, NormalizedRect, PointEquipmentMode,
    PointEquipmentVisualTracker, PoseCandidate, PoseObservation, PoseSchemaId,
};

const WIDTH: usize = 320;
const HEIGHT: usize = 240;

#[test]
fn point_equipment_geometry_comes_from_pixels_not_wrists() {
    let frame = frame_with_rectangles(&[(76, 128, 28, 24), (214, 128, 28, 24)]);
    let mut first = PointEquipmentVisualTracker::new(PointEquipmentMode::Dumbbell);
    first
        .process_frame(
            PoseSchemaId::Halpe26,
            &blank_frame(),
            WIDTH,
            HEIGHT,
            900,
            &[subject(0.20, 0.80, 0.54)],
        )
        .unwrap();
    let first = first
        .process_frame(
            PoseSchemaId::Halpe26,
            &frame,
            WIDTH,
            HEIGHT,
            1_000,
            &[subject(0.20, 0.80, 0.54)],
        )
        .unwrap();
    let mut second = PointEquipmentVisualTracker::new(PointEquipmentMode::Dumbbell);
    second
        .process_frame(
            PoseSchemaId::Halpe26,
            &blank_frame(),
            WIDTH,
            HEIGHT,
            900,
            &[subject(0.44, 0.56, 0.30)],
        )
        .unwrap();
    let second = second
        .process_frame(
            PoseSchemaId::Halpe26,
            &frame,
            WIDTH,
            HEIGHT,
            1_000,
            &[subject(0.44, 0.56, 0.30)],
        )
        .unwrap();

    assert_eq!(first.raw_observations.len(), 2, "{first:?}");
    assert_eq!(first.raw_observations, second.raw_observations);
    assert!(
        first
            .raw_observations
            .iter()
            .all(|observation| observation.kind == EquipmentKind::Dumbbell
                && observation.axis.is_none())
    );
}

#[test]
fn removing_the_visual_object_removes_raw_equipment_even_when_wrists_remain() {
    let mut tracker = PointEquipmentVisualTracker::new(PointEquipmentMode::MachineHandle);
    let pose = subject(0.36, 0.64, 0.54);
    tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &blank_frame(),
            WIDTH,
            HEIGHT,
            900,
            &[pose.clone()],
        )
        .unwrap();
    let measured = tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &frame_with_rectangles(&[(104, 128, 28, 24)]),
            WIDTH,
            HEIGHT,
            1_000,
            &[pose.clone()],
        )
        .unwrap();
    assert!(!measured.raw_observations.is_empty());

    let missing = tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &blank_frame(),
            WIDTH,
            HEIGHT,
            1_100,
            &[pose],
        )
        .unwrap();
    assert!(missing.raw_observations.is_empty());
}

#[test]
fn visual_provider_then_fusion_requires_temporal_common_motion_for_grip() {
    let subject = subject(0.36, 0.64, 0.54);
    let mut tracker = PointEquipmentVisualTracker::new(PointEquipmentMode::MachineHandle);
    let mut fusion = EquipmentFusionEngine::new();
    tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &blank_frame(),
            WIDTH,
            HEIGHT,
            900,
            &[subject.clone()],
        )
        .unwrap();

    let mut final_stage = EquipmentAssociationStage::RawDetected;
    for (step, x) in [104usize, 108, 112, 116].into_iter().enumerate() {
        let timestamp_ms = 1_000 + step as u64 * 100;
        let image = frame_with_rectangles(&[(x, 128, 28, 24)]);
        let raw = tracker
            .process_frame(
                PoseSchemaId::Halpe26,
                &image,
                WIDTH,
                HEIGHT,
                timestamp_ms,
                &[subject.clone()],
            )
            .unwrap();
        let center_x = (x as f32 + 14.0) / WIDTH as f32;
        let canonical = canonical_with_left_wrist(center_x, 140.0 / HEIGHT as f32);
        let evidence = fusion.process(EquipmentFrameInput {
            timestamp_ms,
            selected_subject: Some(&subject),
            canonical: &canonical,
            equipment: &raw.raw_observations,
        });
        let track = evidence.tracks.first().expect("measured handle track");
        assert_eq!(track.held_by, EquipmentHand::Left);
        final_stage = track.association_stage;
    }
    assert_eq!(final_stage, EquipmentAssociationStage::GripEstablished);
}

fn blank_frame() -> Vec<u8> {
    vec![28; WIDTH * HEIGHT]
}

fn frame_with_rectangles(rectangles: &[(usize, usize, usize, usize)]) -> Vec<u8> {
    let mut frame = blank_frame();
    for &(left, top, width, height) in rectangles {
        for y in top..top + height {
            for x in left..left + width {
                frame[y * WIDTH + x] = 224;
            }
        }
    }
    frame
}

fn subject(left_wrist_x: f32, right_wrist_x: f32, wrist_y: f32) -> PoseCandidate {
    let mut observations = vec![PoseObservation::new(0.5, 0.3, 0.0, 0.0); 26];
    observations[5] = PoseObservation::new(0.40, 0.30, 0.0, 0.9);
    observations[6] = PoseObservation::new(0.60, 0.30, 0.0, 0.9);
    observations[9] = PoseObservation::new(left_wrist_x, wrist_y, 0.0, 0.9);
    observations[10] = PoseObservation::new(right_wrist_x, wrist_y, 0.0, 0.9);
    PoseCandidate {
        id: 41,
        bbox: NormalizedRect::new(0.15, 0.08, 0.70, 0.86),
        observations,
        torso_color: [0.2, 0.3, 0.4],
    }
}

fn canonical_with_left_wrist(x: f32, y: f32) -> Vec<CanonicalLandmark> {
    let mut canonical = vec![CanonicalLandmark::unknown(0.0, None); 26];
    canonical[9] = CanonicalLandmark {
        x: Some(x),
        y: Some(y),
        z: None,
        observation_score: 0.95,
        canonical_confidence: 0.95,
        uncertainty: Some(0.01),
        source: LandmarkSource::Measured,
        renderable: true,
        reason: None,
    };
    canonical
}
