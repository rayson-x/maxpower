use maxpower_motion_sdk::{
    BodySide, CanonicalLandmark, JointAngleKind, LandmarkSource, TargetState, measure_joint_angles,
};

fn measured_pose() -> Vec<CanonicalLandmark> {
    let mut pose = vec![CanonicalLandmark::unknown(0.0, None); 33];
    for (index, x, y) in [
        (11, 0.25, 0.25),
        (13, 0.25, 0.45),
        (15, 0.45, 0.45),
        (12, 0.75, 0.25),
        (14, 0.75, 0.45),
        (16, 0.55, 0.45),
        (23, 0.35, 0.55),
        (25, 0.35, 0.75),
        (27, 0.35, 0.95),
        (24, 0.65, 0.55),
        (26, 0.65, 0.75),
        (28, 0.65, 0.95),
    ] {
        pose[index] = CanonicalLandmark::measured(x, y, 0.0, 0.95);
    }
    pose
}

#[test]
fn canonical_joint_angles_use_one_stable_triplet_definition() {
    let angles = measure_joint_angles(&measured_pose(), TargetState::Locked);
    assert_eq!(angles.len(), 8);
    let left_elbow = angles
        .iter()
        .find(|angle| angle.kind == JointAngleKind::Elbow && angle.side == BodySide::Left)
        .expect("left elbow snapshot");
    assert!((left_elbow.value_degrees.unwrap() - 90.0).abs() < 0.01);
    assert_eq!(left_elbow.source, LandmarkSource::Measured);
    assert!(left_elbow.judgeable);
    assert!((left_elbow.confidence - 0.95).abs() < 0.001);
}

#[test]
fn predicted_or_unlocked_angles_are_not_presented_as_judgeable() {
    let mut pose = measured_pose();
    pose[15].source = LandmarkSource::Predicted;
    let predicted = measure_joint_angles(&pose, TargetState::Locked);
    assert!(!predicted[0].judgeable);
    assert_eq!(predicted[0].source, LandmarkSource::Predicted);

    let unlocked = measure_joint_angles(&measured_pose(), TargetState::Uncertain);
    assert!(unlocked.iter().all(|angle| !angle.judgeable));
}
