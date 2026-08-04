use form_coach_motion_sdk::{
    BodyNormalizationConfig, CanonicalFrameSample, CanonicalLandmark, ExerciseProfile,
    LandmarkSource, PhaseName, ReferenceIdentity, RepDisposition, SealedRep,
    constrained_phase_dtw, extract_profile_signal_reference_rep, normalize_rep_trajectory,
};

#[test]
fn body_relative_phase_registration_removes_translation_and_scale() {
    let rep = sealed(0, 2, 4);
    let base = frames(0.0, 1.0, &[0, 100, 200, 300, 400]);
    let shifted_scaled = frames(4.0, 2.0, &[0, 100, 200, 300, 400]);
    let config = BodyNormalizationConfig::rear_bilateral(false);
    let a = normalize_rep_trajectory(&rep, &base, &config, 5).unwrap();
    let b = normalize_rep_trajectory(&rep, &shifted_scaled, &config, 5).unwrap();

    assert_eq!(a.nodes.len(), 9);
    assert_eq!(a.nodes[0].phase, PhaseName::Effort);
    assert_eq!(a.nodes[4].phase, PhaseName::Effort);
    assert_eq!(a.nodes[5].phase, PhaseName::Return);
    for (left, right) in a.nodes.iter().zip(&b.nodes) {
        for (lv, rv) in left.values.iter().zip(&right.values) {
            assert!((lv.unwrap() - rv.unwrap()).abs() < 1e-5);
        }
    }
    assert_eq!(a.effort_duration_ms, 200);
    assert_eq!(b.effort_duration_ms, 200);
    assert_eq!(a.total_duration_ms, 400);
}

#[test]
fn dtw_is_bounded_shadow_diagnostic_and_cannot_accept_unrestricted_warp() {
    let left = vec![vec![0.0], vec![0.4], vec![0.8], vec![1.0]];
    let right = vec![vec![0.0], vec![0.2], vec![0.6], vec![1.0]];
    let diagnostic = constrained_phase_dtw(&left, &right, 1).unwrap();
    assert!(diagnostic.normalized_cost.is_finite());
    assert!(diagnostic.warp_ratio >= 1.0);
    assert!(constrained_phase_dtw(&left, &right, 4).is_none());
}

#[test]
fn explicit_mirror_metadata_controls_orientation_and_values_are_not_clipped() {
    let rep = sealed(0, 2, 4);
    let source = frames(0.0, 1.0, &[0, 100, 200, 300, 400]);
    let normal = normalize_rep_trajectory(
        &rep,
        &source,
        &BodyNormalizationConfig::rear_bilateral(false),
        3,
    )
    .unwrap();
    let mirrored = normalize_rep_trajectory(
        &rep,
        &source,
        &BodyNormalizationConfig::rear_bilateral(true),
        3,
    )
    .unwrap();
    assert_eq!(
        normal.nodes[0].values[0],
        mirrored.nodes[0].values[0].map(|value| -value)
    );
    assert!(
        normal
            .nodes
            .iter()
            .flat_map(|node| &node.values)
            .any(|value| value.is_some_and(|value| value.abs() > 1.0))
    );
}

#[test]
fn missing_feature_stays_local_instead_of_rejecting_the_rep() {
    let rep = sealed(0, 2, 4);
    let mut source = frames(0.0, 1.0, &[0, 100, 200, 300, 400]);
    source[2].canonical[14] = CanonicalLandmark::unknown(0.0, None);
    let normalized = normalize_rep_trajectory(
        &rep,
        &source,
        &BodyNormalizationConfig::rear_bilateral(false),
        5,
    )
    .unwrap();
    assert!(normalized.nodes[4].values[2].is_none());
    assert_eq!(normalized.nodes[4].confidence[2], 0.0);
    assert!(normalized.nodes[4].values[0].is_some());
}

#[test]
fn missing_origin_or_ambiguous_orientation_refuses_instead_of_guessing() {
    let rep = sealed(0, 2, 4);
    let mut source = frames(0.0, 1.0, &[0, 100, 200, 300, 400]);
    source[2].canonical[23] = CanonicalLandmark::unknown(0.0, None);
    assert!(
        normalize_rep_trajectory(
            &rep,
            &source,
            &BodyNormalizationConfig::rear_bilateral(false),
            3,
        )
        .is_err()
    );
}

#[test]
fn generic_profile_signal_extractor_uses_the_sealed_slice_and_normalizes_each_rep() {
    let rep = sealed(0, 2, 4);
    let identity = ReferenceIdentity {
        exercise_id: "lat_pulldown".into(),
        capture_position: "rear".into(),
        variation: "straight_bar".into(),
        training_side: "bilateral".into(),
        equipment: "cable".into(),
        coordinate_system: "source-image/v1".into(),
        feature_schema_id: "simulated-kinematic-features/v1".into(),
        pose_model_version: "mediapipe-pose@0.10.14".into(),
    };
    let profile = ExerciseProfile::lat_pulldown_provisional();
    let a = extract_profile_signal_reference_rep(identity.clone(), &rep, &profile, &frames(0.0, 1.0, &[0, 100, 200, 300, 400])).unwrap();
    let b = extract_profile_signal_reference_rep(identity, &rep, &profile, &frames(3.0, 2.0, &[0, 100, 200, 300, 400])).unwrap();

    assert_eq!(a.nodes.len(), 32);
    assert_eq!(a.nodes[0].phase, "to_extreme");
    assert_eq!(a.nodes[16].phase, "from_extreme");
    assert_eq!(a.nodes[0].values[0], Some(0.0));
    assert_eq!(a.nodes[15].values[0], Some(1.0));
    assert_eq!(a.nodes[31].values[0], Some(0.0));
    for (left, right) in a.nodes.iter().zip(&b.nodes) {
        for (left_value, right_value) in left.values.iter().zip(&right.values) {
            assert_eq!(left_value, right_value);
        }
    }
}

fn sealed(start: u64, peak: u64, end: u64) -> SealedRep {
    SealedRep {
        rep_id: 1,
        start_frame_id: start,
        start_timestamp_ms: start * 100,
        peak_frame_id: peak,
        peak_timestamp_ms: peak * 100,
        end_frame_id: end,
        end_timestamp_ms: end * 100,
        revision: 0,
        canonical_slice_hash: 1,
        profile_identity: ExerciseProfile::lat_pulldown_provisional().identity,
        profile_hash: ExerciseProfile::lat_pulldown_provisional().content_hash,
        profile_maturity: "provisional",
        quality_verdict: None,
        recovered_across_gap: false,
        disposition: RepDisposition::Confirmed,
        evidence_reason: None,
        observation_findings: vec![],
    }
}

fn frames(translation: f32, scale: f32, times: &[u64]) -> Vec<CanonicalFrameSample> {
    let wrist_y = [0.2, 0.4, 0.8, 0.5, 0.2];
    times
        .iter()
        .enumerate()
        .map(|(index, &timestamp_ms)| {
            let mut canonical = vec![measured(translation + 0.5 * scale, 0.5 * scale); 33];
            canonical[11] = measured(translation + 0.2 * scale, 0.2 * scale);
            canonical[12] = measured(translation + 0.8 * scale, 0.2 * scale);
            canonical[23] = measured(translation + 0.35 * scale, 0.8 * scale);
            canonical[24] = measured(translation + 0.65 * scale, 0.8 * scale);
            canonical[13] = measured(translation - 0.1 * scale, (wrist_y[index] + 0.1) * scale);
            canonical[14] = measured(translation + 1.1 * scale, (wrist_y[index] + 0.1) * scale);
            canonical[15] = measured(translation - 0.4 * scale, wrist_y[index] * scale);
            canonical[16] = measured(translation + 1.4 * scale, wrist_y[index] * scale);
            CanonicalFrameSample {
                frame_id: index as u64,
                timestamp_ms,
                canonical,
            }
        })
        .collect()
}

fn measured(x: f32, y: f32) -> CanonicalLandmark {
    CanonicalLandmark {
        x: Some(x),
        y: Some(y),
        z: Some(0.0),
        observation_score: 0.95,
        canonical_confidence: 0.95,
        uncertainty: None,
        source: LandmarkSource::Measured,
        renderable: true,
        reason: None,
    }
}
