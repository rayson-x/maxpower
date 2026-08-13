use maxpower_motion_sdk::{
    AdapterCapabilities, CanonicalLandmark, ContinuityMode, ContinuityReason, ContractVersion,
    DiagnosticLevel, EquipmentAttributes, EquipmentCannotJudgeReason, EquipmentFrameInput,
    EquipmentFrameStatus, EquipmentFusionEngine, EquipmentHand, EquipmentKind,
    EquipmentObservation, EquipmentSource, FrameLease, FrameObservations, InferenceAdapter,
    InferenceResult, LandmarkSource, MotionError, MotionSession, NormalizedRect, PoseCandidate,
    PoseObservation, RecordingOutputAdapter, SessionConfig, SubjectPolicy, encode_motion_packet,
};
use std::sync::{Arc, atomic::AtomicUsize};

fn subject() -> PoseCandidate {
    PoseCandidate {
        id: 41,
        bbox: NormalizedRect::new(0.20, 0.10, 0.60, 0.82),
        observations: vec![PoseObservation::new(0.5, 0.5, 0.0, 0.0); 26],
        torso_color: [0.2, 0.3, 0.4],
    }
}

fn unknown_canonical() -> Vec<CanonicalLandmark> {
    vec![CanonicalLandmark::unknown(0.0, None); 26]
}

fn observation(
    proposal_id: u64,
    kind: EquipmentKind,
    bbox: NormalizedRect,
) -> EquipmentObservation {
    EquipmentObservation {
        proposal_id,
        kind,
        bbox,
        score: 0.92,
        uncertainty_px: Some(2.0),
        source: EquipmentSource::Detector,
        attributes: EquipmentAttributes::default(),
    }
}

#[test]
fn foreground_subject_rejects_mirror_and_static_rack_equipment() {
    let subject = subject();
    let canonical = unknown_canonical();
    let actual = observation(
        700,
        EquipmentKind::Dumbbell,
        NormalizedRect::new(0.32, 0.48, 0.12, 0.12),
    );
    let mut reflection = observation(
        701,
        EquipmentKind::Dumbbell,
        NormalizedRect::new(0.78, 0.24, 0.12, 0.12),
    );
    reflection.attributes.is_reflection_candidate = true;
    let mut rack = observation(
        702,
        EquipmentKind::WeightPlate,
        NormalizedRect::new(0.24, 0.45, 0.12, 0.12),
    );
    rack.attributes.is_static_rack_candidate = true;
    let mut engine = EquipmentFusionEngine::new();

    let output = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_000,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[actual, reflection, rack],
    });

    assert_eq!(output.status, EquipmentFrameStatus::Observed);
    assert_eq!(output.subject_candidate_id, Some(41));
    assert_eq!(output.tracks.len(), 1);
    assert_eq!(output.tracks[0].kind, EquipmentKind::Dumbbell);
    assert_eq!(output.tracks[0].proposal_id, 700);
    assert_ne!(output.tracks[0].track_id, 700);
    assert_eq!(output.rejected_reflection_count, 1);
    assert_eq!(output.rejected_static_count, 1);
}

#[test]
fn bar_path_remains_observable_when_wrists_are_unknown_without_fabricating_pose() {
    let subject = subject();
    let canonical = unknown_canonical();
    let canonical_before = canonical.clone();
    let shaft = observation(
        90,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.22, 0.42, 0.56, 0.035),
    );
    let mut engine = EquipmentFusionEngine::new();

    let output = engine.process(EquipmentFrameInput {
        timestamp_ms: 2_000,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[shaft],
    });

    assert_eq!(output.status, EquipmentFrameStatus::Observed);
    assert_eq!(output.tracks.len(), 1);
    assert!(output.tracks[0].judgeable_path);
    assert_eq!(output.tracks[0].held_by, EquipmentHand::Unknown);
    assert_eq!(canonical, canonical_before);
    assert!(canonical.iter().all(|landmark| landmark.x.is_none()));
}

#[test]
fn a_missing_equipment_frame_publishes_cannot_judge_but_keeps_private_track_continuity() {
    let subject = subject();
    let canonical = unknown_canonical();
    let mut engine = EquipmentFusionEngine::new();
    let first = observation(
        10,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.22, 0.42, 0.56, 0.035),
    );
    let first_output = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_000,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[first],
    });
    let stable_track_id = first_output.tracks[0].track_id;

    let missing = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_100,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[],
    });
    assert_eq!(
        missing.status,
        EquipmentFrameStatus::CannotJudge(EquipmentCannotJudgeReason::NoEquipmentObservation)
    );
    assert!(missing.tracks.is_empty());

    let reacquired = observation(
        999,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.23, 0.43, 0.56, 0.035),
    );
    let reacquired_output = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_180,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[reacquired],
    });
    assert_eq!(reacquired_output.tracks[0].track_id, stable_track_id);
    assert_eq!(reacquired_output.tracks[0].proposal_id, 999);
}

#[test]
fn two_dumbbell_tracks_survive_detector_proposal_reordering() {
    let subject = subject();
    let canonical = unknown_canonical();
    let mut engine = EquipmentFusionEngine::new();
    let left = observation(
        1_000,
        EquipmentKind::Dumbbell,
        NormalizedRect::new(0.28, 0.48, 0.10, 0.10),
    );
    let right = observation(
        2_000,
        EquipmentKind::Dumbbell,
        NormalizedRect::new(0.62, 0.48, 0.10, 0.10),
    );
    let first = engine.process(EquipmentFrameInput {
        timestamp_ms: 3_000,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[left, right],
    });
    let first_ids = first
        .tracks
        .iter()
        .map(|track| (track.center_x, track.track_id))
        .collect::<Vec<_>>();

    let right_next = observation(
        3,
        EquipmentKind::Dumbbell,
        NormalizedRect::new(0.61, 0.47, 0.10, 0.10),
    );
    let left_next = observation(
        4,
        EquipmentKind::Dumbbell,
        NormalizedRect::new(0.29, 0.47, 0.10, 0.10),
    );
    let second = engine.process(EquipmentFrameInput {
        timestamp_ms: 3_067,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[right_next, left_next],
    });

    let left_track = second
        .tracks
        .iter()
        .min_by(|left, right| left.center_x.total_cmp(&right.center_x))
        .unwrap();
    let right_track = second
        .tracks
        .iter()
        .max_by(|left, right| left.center_x.total_cmp(&right.center_x))
        .unwrap();
    assert_eq!(left_track.track_id, first_ids[0].1);
    assert_eq!(right_track.track_id, first_ids[1].1);
}

#[test]
fn equipment_without_a_locked_subject_is_not_published() {
    let canonical = unknown_canonical();
    let dumbbell = observation(
        9,
        EquipmentKind::Dumbbell,
        NormalizedRect::new(0.32, 0.48, 0.12, 0.12),
    );
    let mut engine = EquipmentFusionEngine::new();

    let output = engine.process(EquipmentFrameInput {
        timestamp_ms: 4_000,
        selected_subject: None,
        canonical: &canonical,
        equipment: &[dumbbell],
    });

    assert_eq!(
        output.status,
        EquipmentFrameStatus::CannotJudge(EquipmentCannotJudgeReason::NoLockedSubject)
    );
    assert!(output.tracks.is_empty());
}

struct EquipmentFixtureAdapter;

impl InferenceAdapter for EquipmentFixtureAdapter {
    fn infer(&mut self, _frame: &FrameLease) -> Result<InferenceResult, MotionError> {
        Ok(FrameObservations {
            pose_candidates: vec![subject()],
            equipment: vec![observation(
                77,
                EquipmentKind::BarbellShaft,
                NormalizedRect::new(0.22, 0.42, 0.56, 0.035),
            )],
        })
    }
}

#[test]
fn motion_session_v1_7_publishes_rust_associated_equipment_in_the_canonical_packet() {
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:equipment:v1.7".into(),
            contract: ContractVersion { major: 1, minor: 7 },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        EquipmentFixtureAdapter,
        output.clone(),
    )
    .unwrap();

    session
        .offer(FrameLease::fixture(1, 1_000, Arc::new(AtomicUsize::new(0))))
        .unwrap();

    let packet = output.packets().into_iter().next().unwrap();
    assert_eq!(packet.equipment.status, EquipmentFrameStatus::Observed);
    assert_eq!(packet.equipment.tracks.len(), 1);
    assert_eq!(packet.equipment.tracks[0].proposal_id, 77);
    let encoded = encode_motion_packet(&packet).unwrap();
    assert!(encoded.windows(4).any(|window| window == b"EQP1"));
}

#[test]
fn motion_packet_stabilizes_one_ulp_equipment_association_drift() {
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:equipment:packet-stability:v1.7".into(),
            contract: ContractVersion { major: 1, minor: 7 },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        EquipmentFixtureAdapter,
        output.clone(),
    )
    .unwrap();

    session
        .offer(FrameLease::fixture(1, 1_000, Arc::new(AtomicUsize::new(0))))
        .unwrap();

    let packet = output.packets().into_iter().next().unwrap();
    let mut wasm_result = packet.clone();
    let mut native_result = packet;
    wasm_result.equipment.tracks[0].association_confidence = f32::from_bits(0x3f6b_4c21);
    native_result.equipment.tracks[0].association_confidence = f32::from_bits(0x3f6b_4c22);

    assert_eq!(
        encode_motion_packet(&wasm_result).unwrap(),
        encode_motion_packet(&native_result).unwrap(),
        "client-visible equipment evidence must be byte-stable across native and Wasm libm",
    );
}

#[test]
fn motion_packet_stabilizes_one_ulp_temporal_landmark_drift() {
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:temporal-landmark:packet-stability:v1.7".into(),
            contract: ContractVersion { major: 1, minor: 7 },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        EquipmentFixtureAdapter,
        output.clone(),
    )
    .unwrap();
    session
        .offer(FrameLease::fixture(1, 1_000, Arc::new(AtomicUsize::new(0))))
        .unwrap();

    let mut first = output.packets().into_iter().next().unwrap();
    let mut second = first.clone();
    for packet in [&mut first, &mut second] {
        let wrist = &mut packet.canonical[10];
        wrist.x = Some(0.71);
        wrist.y = Some(0.42);
        wrist.z = Some(0.01);
        wrist.observation_score = 0.29;
        wrist.canonical_confidence = 0.55;
        wrist.uncertainty = Some(f32::from_bits(0x3c9e_0652));
        wrist.source = LandmarkSource::Fused;
        wrist.renderable = true;
        wrist.reason = Some(ContinuityReason::EquipmentPathConstraint);
    }
    second.canonical[10].uncertainty = Some(f32::from_bits(0x3c9e_0653));

    assert_eq!(
        encode_motion_packet(&first).unwrap(),
        encode_motion_packet(&second).unwrap(),
        "client-visible temporal landmarks must be byte-stable across runtimes",
    );
}
