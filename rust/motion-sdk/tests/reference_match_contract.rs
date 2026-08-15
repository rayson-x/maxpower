use maxpower_motion_sdk::{
    CanonicalFrameSample, CanonicalLandmark, CorridorPoint, LandmarkSource, ObservedReferenceNode,
    ObservedReferenceRep, ReferenceCorridorNode, ReferenceIdentity, ReferenceTrajectoryProfile,
    RepDisposition, SealedRep, TrajectoryComparisonStatus, extract_lat_pulldown_reference_rep,
    match_reference_trajectory,
};

#[test]
fn strict_identity_gate_refuses_cross_view_profile() {
    let mut observed = observation();
    observed.identity.capture_position = "rearLeft45".into();
    let result = match_reference_trajectory(&profile(), &observed);
    assert_eq!(result.status, TrajectoryComparisonStatus::ProfileMismatch);
    assert!(result.mismatch_reason.unwrap().contains("capture_position"));
    assert!(result.quality_verdict.is_none());
}

#[test]
fn provisional_corridor_reports_descriptive_excess_and_keeps_unknown_local() {
    let mut observed = observation();
    observed.nodes[0].values[0] = Some(1.4);
    observed.nodes[1].values[1] = None;
    let result = match_reference_trajectory(&profile(), &observed);
    assert_eq!(
        result.status,
        TrajectoryComparisonStatus::ComparisonAvailable
    );
    assert_eq!(result.features[0].outside_node_count, 1);
    assert_eq!(result.features[0].comparable_node_count, 4);
    assert_eq!(result.features[1].comparable_node_count, 3);
    assert_eq!(result.features[1].unknown_node_count, 1);
    assert!(result.quality_verdict.is_none());
    assert_eq!(result.rep_id, observed.rep_id);
    assert_eq!(result.canonical_slice_hash, observed.canonical_slice_hash);
}

fn identity() -> ReferenceIdentity {
    ReferenceIdentity {
        exercise_id: "lat_pulldown".into(),
        capture_position: "rear".into(),
        variation: "front_bar_pronated".into(),
        training_side: "bilateral".into(),
        equipment: "cable_lat_pulldown/straight_bar".into(),
        coordinate_system: "hip-center/shoulder-width/image-xy/v1".into(),
        feature_schema_id: "arms-xy/piecewise-2x2/v1".into(),
        pose_model_version: "mediapipe-pose-heavy".into(),
    }
}

fn profile() -> ReferenceTrajectoryProfile {
    ReferenceTrajectoryProfile {
        identity: identity(),
        profile_hash: 99,
        profile_status: "personal_provisional_unreviewed".into(),
        feature_names: vec!["left_wrist_x".into(), "left_wrist_y".into()],
        minimum_observation_confidence: 0.5,
        nodes: vec![
            reference_node("pull", 0.0),
            reference_node("pull", 1.0),
            reference_node("return", 0.0),
            reference_node("return", 1.0),
        ],
    }
}

fn reference_node(phase: &str, progress: f32) -> ReferenceCorridorNode {
    ReferenceCorridorNode {
        phase: phase.into(),
        phase_progress: progress,
        features: vec![corridor(0.0, 1.0), corridor(-1.0, 0.0)],
    }
}

fn corridor(low: f32, high: f32) -> CorridorPoint {
    CorridorPoint {
        q_low: Some(low),
        q_high: Some(high),
        median_absolute_deviation: Some(0.1),
        n_observed: 8,
    }
}

fn observation() -> ObservedReferenceRep {
    ObservedReferenceRep {
        identity: identity(),
        rep_id: 7,
        rep_revision: 0,
        canonical_slice_hash: 1234,
        nodes: vec![
            observed_node("pull", 0.0),
            observed_node("pull", 1.0),
            observed_node("return", 0.0),
            observed_node("return", 1.0),
        ],
    }
}

fn observed_node(phase: &str, progress: f32) -> ObservedReferenceNode {
    ObservedReferenceNode {
        phase: phase.into(),
        phase_progress: progress,
        values: vec![Some(0.5), Some(-0.5)],
        confidence: vec![1.0, 1.0],
    }
}

#[test]
fn confidence_and_phase_boundaries_match_the_frozen_typescript_policy() {
    let mut observed = observation();
    observed.nodes[0].values[0] = Some(2.0);
    observed.nodes[2].values[0] = Some(2.0);
    observed.nodes[1].confidence[1] = 0.49;

    let result = match_reference_trajectory(&profile(), &observed);
    assert_eq!(result.features[0].outside_node_count, 2);
    assert_eq!(result.features[0].maximum_consecutive_outside_nodes, 1);
    assert_eq!(result.features[1].unknown_node_count, 1);
    assert_eq!(result.features[1].comparable_node_count, 3);
    assert!(result.quality_verdict.is_none());
}

#[test]
fn corrupt_reference_phase_metadata_is_rejected() {
    let mut profile = profile();
    profile.nodes[0].phase = "return".into();
    profile.nodes[0].phase_progress = 0.73;
    let result = match_reference_trajectory(&profile, &observation());
    assert_eq!(result.status, TrajectoryComparisonStatus::InvalidProfile);
}

#[test]
fn corrupt_reference_corridor_is_rejected() {
    let mut profile = profile();
    profile.nodes[0].features[0].q_high = None;
    let result = match_reference_trajectory(&profile, &observation());
    assert_eq!(result.status, TrajectoryComparisonStatus::InvalidProfile);
}

#[test]
fn non_finite_observations_remain_local_unknowns() {
    let mut observed = observation();
    observed.nodes[0].values[0] = Some(f32::NAN);
    observed.nodes[1].confidence[0] = f32::INFINITY;
    let result = match_reference_trajectory(&profile(), &observed);
    assert_eq!(
        result.status,
        TrajectoryComparisonStatus::ComparisonAvailable
    );
    assert_eq!(result.features[0].unknown_node_count, 2);
    assert_eq!(result.features[0].comparable_node_count, 2);

    let mut invalid_profile = profile();
    invalid_profile.nodes[0].features[0].q_low = Some(f32::NAN);
    let refusal = match_reference_trajectory(&invalid_profile, &observation());
    assert_eq!(refusal.status, TrajectoryComparisonStatus::InvalidProfile);
}

#[test]
fn observed_phase_metadata_must_match_the_profile() {
    let mut observed = observation();
    observed.nodes.swap(1, 2);
    let result = match_reference_trajectory(&profile(), &observed);
    assert_eq!(result.status, TrajectoryComparisonStatus::ProfileMismatch);
}

#[test]
fn piecewise_extraction_has_32_nodes_and_keeps_far_elbow_unknown_local() {
    let frames = [
        canonical_frame(0, 0.2, false, 0.7),
        canonical_frame(100, 0.4, false, 0.7),
        canonical_frame(200, 0.6, false, 0.7),
        canonical_frame(300, 0.4, false, 0.7),
        canonical_frame(400, 0.2, false, 0.7),
    ];
    let observed = extract_lat_pulldown_reference_rep(exact_identity(), &sealed_rep(), &frames)
        .expect("reference extraction");
    assert_eq!(observed.nodes.len(), 32);
    assert_eq!(observed.nodes[15].phase, "pull");
    assert_eq!(observed.nodes[16].phase, "return");
    assert!(observed.nodes.iter().all(|node| node.values[0].is_some()));
    assert!(observed.nodes.iter().all(|node| node.values[1].is_some()));
    assert!(observed.nodes.iter().all(|node| node.values[3].is_none()));
    assert!(observed.nodes.iter().all(|node| node.values[5].is_none()));
    assert!(observed.nodes.iter().all(|node| node.values[10].is_some()));
}

#[test]
fn torso_shift_is_not_created_by_scale_change() {
    let frames = [
        canonical_frame(0, 0.2, true, 0.70),
        canonical_frame(100, 0.4, true, 0.73),
        canonical_frame(200, 0.6, true, 0.76),
        canonical_frame(300, 0.4, true, 0.79),
        canonical_frame(400, 0.2, true, 0.82),
    ];
    let observed = extract_lat_pulldown_reference_rep(exact_identity(), &sealed_rep(), &frames)
        .expect("reference extraction");
    assert!(
        observed
            .nodes
            .iter()
            .all(|node| node.values[9] == Some(0.0))
    );
}

fn exact_identity() -> ReferenceIdentity {
    ReferenceIdentity {
        exercise_id: "lat_pulldown".into(),
        capture_position: "rear".into(),
        variation: "front_bar_pronated".into(),
        training_side: "bilateral".into(),
        equipment: "cable_lat_pulldown/straight_bar".into(),
        coordinate_system: "source-image/v1".into(),
        feature_schema_id: "lat_pulldown/source-image-piecewise-32/v2".into(),
        pose_model_version: "mediapipe-pose-heavy".into(),
    }
}

fn sealed_rep() -> SealedRep {
    SealedRep {
        rep_id: 1,
        start_frame_id: 0,
        start_timestamp_ms: 0,
        peak_frame_id: 2,
        peak_timestamp_ms: 200,
        turnaround_confirmed_timestamp_ms: 300,
        end_frame_id: 4,
        end_timestamp_ms: 400,
        revision: 0,
        canonical_slice_hash: 123,
        profile_identity: "lat_pulldown".into(),
        profile_hash: 456,
        quality_verdict: None,
        recovered_across_gap: false,
        disposition: RepDisposition::Confirmed,
        evidence_reason: None,
        observation_findings: vec![],
        normalized_endpoints: None,
    }
}

fn canonical_frame(
    timestamp_ms: u64,
    wrist_y: f32,
    right_elbow_visible: bool,
    hip_y: f32,
) -> CanonicalFrameSample {
    let mut canonical = vec![canonical_landmark(0.5, 0.5, 1.0); 33];
    canonical[11] = canonical_landmark(0.4, 0.4, 1.0);
    canonical[12] = canonical_landmark(0.6, 0.4, 1.0);
    canonical[13] = canonical_landmark(0.34, (0.4 + wrist_y) / 2.0 + 0.03, 1.0);
    canonical[14] = canonical_landmark(
        0.66,
        (0.4 + wrist_y) / 2.0 + 0.03,
        if right_elbow_visible { 1.0 } else { 0.0 },
    );
    canonical[15] = canonical_landmark(0.3, wrist_y, 1.0);
    canonical[16] = canonical_landmark(0.7, wrist_y, 1.0);
    canonical[23] = canonical_landmark(0.43, hip_y, 1.0);
    canonical[24] = canonical_landmark(0.57, hip_y, 1.0);
    CanonicalFrameSample {
        frame_id: timestamp_ms / 100,
        timestamp_ms,
        canonical,
    }
}

fn canonical_landmark(x: f32, y: f32, confidence: f32) -> CanonicalLandmark {
    CanonicalLandmark {
        x: Some(x),
        y: Some(y),
        z: Some(0.0),
        observation_score: confidence,
        canonical_confidence: confidence,
        uncertainty: None,
        source: LandmarkSource::Measured,
        renderable: confidence >= 0.5,
        reason: None,
    }
}
