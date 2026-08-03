use form_coach_motion_sdk::{
    CorridorPoint, ObservedReferenceNode, ObservedReferenceRep, ReferenceCorridorNode,
    ReferenceIdentity, ReferenceTrajectoryProfile, TrajectoryComparisonStatus,
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
    assert_eq!(result.features[0].comparable_node_count, 2);
    assert_eq!(result.features[1].comparable_node_count, 1);
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
        nodes: vec![
            ReferenceCorridorNode {
                phase: "effort".into(),
                phase_progress: 0.0,
                features: vec![corridor(0.0, 1.0), corridor(-1.0, 0.0)],
            },
            ReferenceCorridorNode {
                phase: "return".into(),
                phase_progress: 1.0,
                features: vec![corridor(0.0, 1.0), corridor(-1.0, 0.0)],
            },
        ],
    }
}

fn corridor(low: f32, high: f32) -> CorridorPoint {
    CorridorPoint {
        q_low: Some(low),
        q_high: Some(high),
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
            ObservedReferenceNode {
                phase: "effort".into(),
                phase_progress: 0.0,
                values: vec![Some(0.5), Some(-0.5)],
            },
            ObservedReferenceNode {
                phase: "return".into(),
                phase_progress: 1.0,
                values: vec![Some(0.5), Some(-0.5)],
            },
        ],
    }
}
