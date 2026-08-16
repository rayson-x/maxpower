use maxpower_motion_sdk::{
    AdapterCapabilities, CanonicalLandmark, ContinuityMode, ContinuityReason, ContractVersion,
    DiagnosticLevel, EquipmentAssociationStage, EquipmentAttributes, EquipmentCannotJudgeReason,
    EquipmentFrameInput, EquipmentFrameStatus, EquipmentFusionEngine, EquipmentHand, EquipmentKind,
    EquipmentObservation, EquipmentSource, FrameLease, FrameObservations, InferenceAdapter,
    InferenceResult, LandmarkSource, MotionError, MotionSession, NormalizedRect, PoseCandidate,
    PoseObservation, RecordingOutputAdapter, SessionConfig, SubjectPolicy, encode_motion_packet,
    rigid_bar_track_supports_turnaround,
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

#[test]
fn a_single_pre_contact_wrist_alignment_never_becomes_rep_evidence() {
    let subject = subject();
    let mut canonical = unknown_canonical();
    for (index, x) in [(9, 0.40), (10, 0.60)] {
        canonical[index] = CanonicalLandmark {
            x: Some(x),
            y: Some(0.50),
            z: None,
            observation_score: 0.9,
            canonical_confidence: 0.9,
            uncertainty: Some(0.01),
            source: LandmarkSource::Measured,
            renderable: true,
            reason: None,
        };
    }
    let mut shaft = observation(
        900,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.25, 0.495, 0.50, 0.01),
    );
    shaft.axis = Some(maxpower_motion_sdk::EquipmentAxis2d {
        x1: 0.25,
        y1: 0.50,
        x2: 0.75,
        y2: 0.50,
    });
    shaft.source = EquipmentSource::Geometry;

    let output = EquipmentFusionEngine::new().process(EquipmentFrameInput {
        timestamp_ms: 5_400,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[shaft],
    });
    let track = output.tracks.first().expect("raw bar remains observable");
    assert_eq!(
        track.association_stage,
        EquipmentAssociationStage::ContactCandidate
    );
    assert!(!track.judgeable_path);
    assert!(!rigid_bar_track_supports_turnaround(track));
}

#[test]
fn grip_requires_temporal_proximity_and_common_motion() {
    let subject = subject();
    let mut engine = EquipmentFusionEngine::new();
    let mut last = None;
    for (step, y) in [0.50, 0.50, 0.53, 0.56].into_iter().enumerate() {
        let mut canonical = unknown_canonical();
        for (index, x) in [(9, 0.40), (10, 0.60)] {
            canonical[index] = CanonicalLandmark {
                x: Some(x),
                y: Some(y),
                z: None,
                observation_score: 0.9,
                canonical_confidence: 0.9,
                uncertainty: Some(0.01),
                source: LandmarkSource::Measured,
                renderable: true,
                reason: None,
            };
        }
        let mut shaft = observation(
            910 + step as u64,
            EquipmentKind::BarbellShaft,
            NormalizedRect::new(0.25, y - 0.005, 0.50, 0.01),
        );
        shaft.axis = Some(maxpower_motion_sdk::EquipmentAxis2d {
            x1: 0.25,
            y1: y,
            x2: 0.75,
            y2: y,
        });
        shaft.source = EquipmentSource::Geometry;
        last = Some(engine.process(EquipmentFrameInput {
            timestamp_ms: 1_000 + step as u64 * 34,
            selected_subject: Some(&subject),
            canonical: &canonical,
            equipment: &[shaft],
        }));
        if step == 2 {
            assert_eq!(
                last.as_ref().unwrap().tracks[0].association_stage,
                EquipmentAssociationStage::ContactCandidate,
                "one coincident hand/object delta is not enough to establish grip",
            );
        }
    }
    let track = last.unwrap().tracks[0];
    assert_eq!(
        track.association_stage,
        EquipmentAssociationStage::GripEstablished
    );
    assert!(rigid_bar_track_supports_turnaround(&track));
}

#[test]
fn established_grip_becomes_conflict_when_hands_and_bar_move_against_each_other() {
    let subject = subject();
    let mut engine = EquipmentFusionEngine::new();
    for (step, y) in [0.50, 0.50, 0.53, 0.56].into_iter().enumerate() {
        let canonical = bar_contact_pose(y);
        let shaft = bar_axis_observation(920 + step as u64, y);
        let output = engine.process(EquipmentFrameInput {
            timestamp_ms: 2_000 + step as u64 * 34,
            selected_subject: Some(&subject),
            canonical: &canonical,
            equipment: &[shaft],
        });
        if step == 3 {
            assert_eq!(
                output.tracks[0].association_stage,
                EquipmentAssociationStage::GripEstablished
            );
        }
    }

    // The shaft keeps moving down while both hands move back up. Proximity
    // alone still passes, so only causal common-motion validation can refuse it.
    let canonical = bar_contact_pose(0.50);
    let shaft = bar_axis_observation(925, 0.59);
    let output = engine.process(EquipmentFrameInput {
        timestamp_ms: 2_136,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[shaft],
    });
    assert_eq!(
        output.tracks[0].association_stage,
        EquipmentAssociationStage::Conflict
    );
    assert!(!output.tracks[0].judgeable_path);
    assert!(!rigid_bar_track_supports_turnaround(&output.tracks[0]));
}

fn bar_contact_pose(y: f32) -> Vec<CanonicalLandmark> {
    let mut canonical = unknown_canonical();
    for (index, x) in [(9, 0.40), (10, 0.60)] {
        canonical[index] = CanonicalLandmark {
            x: Some(x),
            y: Some(y),
            z: None,
            observation_score: 0.9,
            canonical_confidence: 0.9,
            uncertainty: Some(0.01),
            source: LandmarkSource::Measured,
            renderable: true,
            reason: None,
        };
    }
    canonical
}

fn bar_axis_observation(proposal_id: u64, y: f32) -> EquipmentObservation {
    let mut shaft = observation(
        proposal_id,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.25, y - 0.005, 0.50, 0.01),
    );
    shaft.axis = Some(maxpower_motion_sdk::EquipmentAxis2d {
        x1: 0.25,
        y1: y,
        x2: 0.75,
        y2: y,
    });
    shaft.source = EquipmentSource::Geometry;
    shaft
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
        axis: None,
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
    assert!(!output.tracks[0].judgeable_path);
    assert_eq!(
        output.tracks[0].association_stage,
        EquipmentAssociationStage::Unassociated
    );
    assert_eq!(output.tracks[0].held_by, EquipmentHand::Unknown);
    assert_eq!(canonical, canonical_before);
    assert!(canonical.iter().all(|landmark| landmark.x.is_none()));
}

#[test]
fn rigid_bar_axis_far_from_two_reliable_wrists_remains_raw_but_unassociated() {
    let subject = PoseCandidate {
        id: 41,
        // A wider person box keeps the background line spatially inside, so
        // this test specifically requires hand/shaft geometry rather than a
        // bounding-box rejection.
        bbox: NormalizedRect::new(0.24, 0.06, 0.38, 0.93),
        ..subject()
    };
    let mut canonical = unknown_canonical();
    for (index, x, y) in [(9, 0.4524982, 0.6015692), (10, 0.3246425, 0.6105712)] {
        canonical[index] = CanonicalLandmark {
            x: Some(x),
            y: Some(y),
            z: None,
            observation_score: 0.8,
            canonical_confidence: 0.8,
            uncertainty: Some(0.01),
            source: LandmarkSource::Measured,
            renderable: true,
            reason: None,
        };
    }
    let mut background_line = observation(
        313,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.21665314, 0.42204046, 0.7059613, 0.07359201),
    );
    background_line.axis = Some(maxpower_motion_sdk::EquipmentAxis2d {
        x1: 0.21665314,
        y1: 0.49563247,
        x2: 0.9226144,
        y2: 0.42204046,
    });
    background_line.score = 0.52578264;
    let mut engine = EquipmentFusionEngine::new();

    let output = engine.process(EquipmentFrameInput {
        timestamp_ms: 10_519,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[background_line],
    });

    assert_eq!(output.status, EquipmentFrameStatus::Observed);
    assert_eq!(output.tracks.len(), 1);
    assert_eq!(
        output.tracks[0].association_stage,
        EquipmentAssociationStage::Unassociated
    );
    assert!(!output.tracks[0].judgeable_path);
    assert!(!rigid_bar_track_supports_turnaround(&output.tracks[0]));
}

#[test]
fn rigid_bar_turnaround_requires_established_grip_beyond_provider_acceptance() {
    let subject = subject();
    let mut canonical = unknown_canonical();
    for (index, x) in [(9, 0.40), (10, 0.60)] {
        canonical[index] = CanonicalLandmark {
            x: Some(x),
            y: Some(0.50),
            z: None,
            observation_score: 0.8,
            canonical_confidence: 0.8,
            uncertainty: Some(0.01),
            source: LandmarkSource::Measured,
            renderable: true,
            reason: None,
        };
    }
    let mut shaft = observation(
        314,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.32, 0.495, 0.36, 0.01),
    );
    shaft.axis = Some(maxpower_motion_sdk::EquipmentAxis2d {
        x1: 0.32,
        y1: 0.50,
        x2: 0.68,
        y2: 0.50,
    });
    shaft.score = 0.51;
    let mut engine = EquipmentFusionEngine::new();
    let output = engine.process(EquipmentFrameInput {
        timestamp_ms: 10_520,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[shaft],
    });
    let track = output.tracks.first().expect("accepted rigid-bar track");
    assert!(track.observation_score * track.association_confidence < 0.50);
    assert_eq!(
        track.association_stage,
        EquipmentAssociationStage::ContactCandidate
    );
    assert!(!rigid_bar_track_supports_turnaround(track));
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
fn predicted_shaft_is_excluded_from_canonical_equipment_even_with_a_measured_track() {
    let subject = subject();
    let canonical = unknown_canonical();
    let mut engine = EquipmentFusionEngine::new();
    let mut measured = observation(
        10,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.22, 0.42, 0.56, 0.035),
    );
    measured.axis = Some(maxpower_motion_sdk::EquipmentAxis2d {
        x1: 0.22,
        y1: 0.42,
        x2: 0.78,
        y2: 0.455,
    });
    let first = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_000,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[measured],
    });
    assert_eq!(first.tracks.len(), 1);

    let mut predicted = measured;
    predicted.proposal_id = 11;
    predicted.bbox = NormalizedRect::new(0.23, 0.44, 0.56, 0.035);
    predicted.axis = Some(maxpower_motion_sdk::EquipmentAxis2d {
        x1: 0.23,
        y1: 0.44,
        x2: 0.79,
        y2: 0.475,
    });
    predicted.score = 0.36;
    predicted.uncertainty_px = Some(7.5);
    predicted.source = EquipmentSource::Predicted;

    let continuity = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_100,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[predicted],
    });

    assert_eq!(
        continuity.status,
        EquipmentFrameStatus::CannotJudge(EquipmentCannotJudgeReason::LowConfidenceOrInvalid),
        "prediction belongs to display continuity, never canonical equipment",
    );
    assert!(continuity.tracks.is_empty());
}

#[test]
fn predicted_shaft_cannot_create_an_independent_equipment_track() {
    let subject = subject();
    let canonical = unknown_canonical();
    let mut engine = EquipmentFusionEngine::new();
    let mut predicted = observation(
        12,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.22, 0.42, 0.56, 0.035),
    );
    predicted.source = EquipmentSource::Predicted;
    predicted.score = 0.36;

    let output = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_000,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[predicted],
    });

    assert_eq!(
        output.status,
        EquipmentFrameStatus::CannotJudge(EquipmentCannotJudgeReason::LowConfidenceOrInvalid),
    );
    assert!(output.tracks.is_empty());
}

#[test]
fn predicted_continuity_does_not_extend_the_measured_track_lifetime() {
    let subject = subject();
    let canonical = unknown_canonical();
    let mut engine = EquipmentFusionEngine::new();
    let measured = observation(
        20,
        EquipmentKind::BarbellShaft,
        NormalizedRect::new(0.22, 0.42, 0.56, 0.035),
    );
    engine.process(EquipmentFrameInput {
        timestamp_ms: 1_000,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[measured],
    });

    let mut predicted = measured;
    predicted.source = EquipmentSource::Predicted;
    predicted.score = 0.36;
    let within_measured_gap = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_400,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[predicted],
    });
    assert!(
        within_measured_gap.tracks.is_empty(),
        "display continuity must not enter canonical equipment even inside the private identity gap",
    );

    let after_measured_gap = engine.process(EquipmentFrameInput {
        timestamp_ms: 1_501,
        selected_subject: Some(&subject),
        canonical: &canonical,
        equipment: &[predicted],
    });
    assert!(
        after_measured_gap.tracks.is_empty(),
        "predictions must not keep their own identity alive after measured evidence expires",
    );
    assert_ne!(after_measured_gap.status, EquipmentFrameStatus::Observed);
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

struct MeasuredThenPredictedEquipmentAdapter {
    frame_index: usize,
}

impl InferenceAdapter for MeasuredThenPredictedEquipmentAdapter {
    fn infer(&mut self, _frame: &FrameLease) -> Result<InferenceResult, MotionError> {
        let mut shaft = observation(
            80 + self.frame_index as u64,
            EquipmentKind::BarbellShaft,
            NormalizedRect::new(0.22, 0.42 + self.frame_index as f32 * 0.02, 0.56, 0.035),
        );
        shaft.axis = Some(maxpower_motion_sdk::EquipmentAxis2d {
            x1: 0.22,
            y1: 0.42 + self.frame_index as f32 * 0.02,
            x2: 0.78,
            y2: 0.455 + self.frame_index as f32 * 0.02,
        });
        if self.frame_index > 0 {
            shaft.source = EquipmentSource::Predicted;
            shaft.score = 0.36;
            shaft.uncertainty_px = Some(7.5);
        }
        self.frame_index += 1;
        Ok(FrameObservations {
            pose_candidates: vec![subject()],
            equipment: vec![shaft],
        })
    }
}

#[test]
fn canonical_packet_excludes_predicted_axis_from_raw_equipment() {
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:equipment:predicted-provenance:v1.10".into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        MeasuredThenPredictedEquipmentAdapter { frame_index: 0 },
        output.clone(),
    )
    .unwrap();

    for (frame_id, timestamp_ms) in [(1, 1_000), (2, 1_100)] {
        session
            .offer(FrameLease::fixture(
                frame_id,
                timestamp_ms,
                Arc::new(AtomicUsize::new(0)),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert_eq!(packets[0].equipment.tracks.len(), 1);
    let predicted_packet = &packets[1];
    assert_eq!(
        predicted_packet.equipment.status,
        EquipmentFrameStatus::CannotJudge(EquipmentCannotJudgeReason::LowConfidenceOrInvalid),
    );
    assert!(predicted_packet.equipment.tracks.is_empty());
    let encoded = encode_motion_packet(predicted_packet).unwrap();
    assert!(encoded.windows(4).any(|window| window == b"EQP1"));
    assert!(!encoded.is_empty());
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
