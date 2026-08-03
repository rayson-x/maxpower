use std::hint::black_box;
use std::time::Instant;

use form_coach_motion_sdk::{
    CorridorPoint, ObservedReferenceNode, ObservedReferenceRep, ReferenceCorridorNode,
    ReferenceIdentity, ReferenceTrajectoryProfile, benchmark_canonical_core,
    match_reference_trajectory,
};

const ITERATIONS: usize = 50_000;

fn main() {
    let core_elapsed = benchmark_canonical_core(ITERATIONS);

    let (profile, observed) = reference_fixture();
    let matcher_started = Instant::now();
    for _ in 0..ITERATIONS {
        black_box(match_reference_trajectory(&profile, &observed));
    }
    let matcher_elapsed = matcher_started.elapsed();

    println!(
        "{{\n  \"iterations\": {ITERATIONS},\n  \"canonicalCore\": {{ \"totalMs\": {:.3}, \"meanUs\": {:.3}, \"opsPerSecond\": {:.1} }},\n  \"sealedRepMatcher\": {{ \"totalMs\": {:.3}, \"meanUs\": {:.3}, \"opsPerSecond\": {:.1} }}\n}}",
        core_elapsed.as_secs_f64() * 1_000.0,
        core_elapsed.as_secs_f64() * 1_000_000.0 / ITERATIONS as f64,
        ITERATIONS as f64 / core_elapsed.as_secs_f64(),
        matcher_elapsed.as_secs_f64() * 1_000.0,
        matcher_elapsed.as_secs_f64() * 1_000_000.0 / ITERATIONS as f64,
        ITERATIONS as f64 / matcher_elapsed.as_secs_f64(),
    );
}

fn reference_fixture() -> (ReferenceTrajectoryProfile, ObservedReferenceRep) {
    let identity = ReferenceIdentity {
        exercise_id: "lat_pulldown".into(),
        capture_position: "rear".into(),
        variation: "front_bar_pronated".into(),
        training_side: "bilateral".into(),
        equipment: "cable_lat_pulldown/straight_bar".into(),
        coordinate_system: "source-image/v1".into(),
        feature_schema_id: "lat_pulldown/source-image-piecewise-32/v2".into(),
        pose_model_version: "mediapipe-pose-heavy".into(),
    };
    let feature_names = [
        "leftWristHeight",
        "rightWristHeight",
        "leftElbowAngleDeg",
        "rightElbowAngleDeg",
        "leftUpperArmToTorsoDeg",
        "rightUpperArmToTorsoDeg",
        "leftWristLateral",
        "rightWristLateral",
        "bilateralWristHeightDelta",
        "torsoLateralShift",
        "torsoLateralTiltDeg",
    ]
    .map(str::to_string)
    .to_vec();
    let mut reference_nodes = Vec::with_capacity(32);
    let mut observed_nodes = Vec::with_capacity(32);
    for phase in ["pull", "return"] {
        for index in 0..16 {
            let progress = index as f32 / 15.0;
            reference_nodes.push(ReferenceCorridorNode {
                phase: phase.into(),
                phase_progress: progress,
                features: feature_names
                    .iter()
                    .map(|_| CorridorPoint {
                        q_low: Some(-1.0),
                        q_high: Some(1.0),
                        median_absolute_deviation: Some(0.2),
                        n_observed: 8,
                    })
                    .collect(),
            });
            observed_nodes.push(ObservedReferenceNode {
                phase: phase.into(),
                phase_progress: progress,
                values: vec![Some(0.25); feature_names.len()],
                confidence: vec![0.99; feature_names.len()],
            });
        }
    }
    (
        ReferenceTrajectoryProfile {
            identity: identity.clone(),
            profile_hash: 99,
            profile_status: "personal_provisional_expert_reviewed".into(),
            feature_names,
            nodes: reference_nodes,
            minimum_observation_confidence: 0.5,
        },
        ObservedReferenceRep {
            identity,
            rep_id: 1,
            rep_revision: 0,
            canonical_slice_hash: 123,
            nodes: observed_nodes,
        },
    )
}
