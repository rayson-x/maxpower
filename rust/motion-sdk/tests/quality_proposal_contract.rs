use std::sync::{Arc, atomic::AtomicUsize};

use maxpower_motion_sdk::{
    AdapterCapabilities, AssessmentDimension, ContinuityMode, ContractVersion, DiagnosticLevel,
    EndpointKind, ExerciseProfile, FixtureInferenceAdapter, FrameLease, MotionSession,
    PoseObservation, RecordingOutputAdapter, SessionConfig, SubjectPolicy, encode_motion_packet,
};

fn rep_frames(wrist_y: &[f32], elbow_y: &[f32]) -> Vec<Vec<PoseObservation>> {
    wrist_y
        .iter()
        .zip(elbow_y)
        .map(|(&wrist_y, &elbow_y)| {
            let mut frame = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.95); 33];
            frame[15] = PoseObservation::new(0.42, wrist_y, 0.0, 0.95);
            frame[16] = PoseObservation::new(0.58, wrist_y, 0.0, 0.95);
            frame[13] = PoseObservation::new(0.43, elbow_y, 0.0, 0.95);
            frame[14] = PoseObservation::new(0.57, elbow_y, 0.0, 0.95);
            frame
        })
        .collect()
}

#[test]
fn one_causal_set_publishes_reviewable_three_endpoint_quality_proposals() {
    let wrist_y = [
        0.20, 0.22, 0.30, 0.45, 0.65, 0.78, 0.75, 0.60, 0.40, 0.25, 0.21,
    ];
    let elbow_y = [
        0.30, 0.31, 0.36, 0.43, 0.53, 0.60, 0.59, 0.51, 0.41, 0.33, 0.30,
    ];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "quality:lat-pulldown".into(),
            contract: ContractVersion { major: 1, minor: 8 },
            diagnostics: DiagnosticLevel::Summary,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: ContinuityMode::Fusion,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(rep_frames(&wrist_y, &elbow_y)),
        output.clone(),
    )
    .unwrap();
    session
        .install_exercise_profile(ExerciseProfile::lat_pulldown_provisional())
        .unwrap();

    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..wrist_y.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 100,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packet = output
        .packets()
        .into_iter()
        .find(|packet| !packet.quality_proposals.is_empty())
        .expect("the sealed rep must carry its Rust quality proposal");
    let proposal = &packet.quality_proposals[0];
    assert_eq!(proposal.endpoints.len(), 3);
    assert_eq!(proposal.endpoints[0].kind, EndpointKind::StartAnchor);
    assert_eq!(proposal.endpoints[1].kind, EndpointKind::PrimaryTurnaround);
    assert_eq!(proposal.endpoints[2].kind, EndpointKind::EndReturn);
    assert!(proposal.endpoints.iter().all(|endpoint| {
        endpoint.causal_confirmed_timestamp_ms >= endpoint.occurred_timestamp_ms
    }));
    assert_eq!(proposal.conclusions.len(), AssessmentDimension::ALL.len());
    assert_eq!(proposal.content_hash.len(), 16);

    let encoded = encode_motion_packet(&packet).unwrap();
    assert!(encoded.windows(4).any(|window| window == b"QLT1"));
    assert_eq!(
        u32::from_le_bytes(encoded[8..12].try_into().unwrap()) as usize,
        encoded.len()
    );
}
