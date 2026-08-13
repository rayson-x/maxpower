use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use maxpower_motion_sdk::{
    AdapterCapabilities, ContinuityMode, ContinuityReason, ContractVersion, DiagnosticLevel,
    FixtureInferenceAdapter, FrameLease, LandmarkSource, MotionError, MotionSession,
    PoseObservation, RecordingOutputAdapter, SessionConfig,
};

fn config(sequence_id: &str) -> SessionConfig {
    SessionConfig {
        sequence_id: sequence_id.into(),
        contract: ContractVersion { major: 1, minor: 0 },
        diagnostics: DiagnosticLevel::Summary,
        image_width_px: 1_000,
        image_height_px: 1_000,
        continuity: ContinuityMode::Fusion,
        subject_policy: maxpower_motion_sdk::SubjectPolicy::AssumeSingle,
    }
}

#[test]
fn raw_mode_keeps_zero_confidence_missing_points_unknown() {
    let output = RecordingOutputAdapter::default();
    let mut raw_config = config("synthetic:raw-missing");
    raw_config.continuity = ContinuityMode::Raw;
    let mut session = MotionSession::open(
        raw_config,
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(vec![vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0)]]),
        output.clone(),
    )
    .unwrap();
    session
        .offer(FrameLease::fixture(0, 100, Arc::new(AtomicUsize::new(0))))
        .unwrap();

    let landmark = &output.packets()[0].canonical[0];
    assert_eq!(landmark.source, LandmarkSource::Unknown);
    assert_eq!(landmark.x, None);
    assert!(!landmark.renderable);
}

#[test]
fn short_gap_is_predicted_but_evidence_older_than_150ms_is_unknown() {
    let output = RecordingOutputAdapter::default();
    let frames = vec![
        vec![PoseObservation::new(0.40, 0.50, 0.0, 0.95)],
        vec![PoseObservation::new(0.45, 0.50, 0.0, 0.95)],
        vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0)],
        vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0)],
    ];
    let mut session = MotionSession::open(
        config("synthetic:gaps"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for (id, timestamp) in [0, 50, 150, 250].into_iter().enumerate() {
        session
            .offer(FrameLease::fixture(
                id as u64,
                timestamp,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert_eq!(packets[2].canonical[0].source, LandmarkSource::Predicted);
    assert!(packets[2].canonical[0].renderable);
    assert_eq!(packets[3].canonical[0].source, LandmarkSource::Unknown);
    assert!(!packets[3].canonical[0].renderable);
    assert_eq!(packets[3].canonical[0].x, None);
}

#[test]
fn prediction_boundary_is_time_based_at_20_30_and_60_fps() {
    for frame_interval_ms in [50_u64, 33, 17] {
        let output = RecordingOutputAdapter::default();
        let frames = vec![
            vec![PoseObservation::new(0.40, 0.50, 0.0, 0.95)],
            vec![PoseObservation::new(0.45, 0.50, 0.0, 0.95)],
            vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0)],
            vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0)],
            vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0)],
        ];
        let mut session = MotionSession::open(
            config("synthetic:fps-matrix"),
            AdapterCapabilities::fixture(),
            FixtureInferenceAdapter::sequence(frames),
            output.clone(),
        )
        .unwrap();
        let releases = Arc::new(AtomicUsize::new(0));
        let timestamps = [
            0,
            frame_interval_ms,
            frame_interval_ms + 50,
            frame_interval_ms + 150,
            frame_interval_ms + 250,
        ];
        for (frame_id, timestamp) in timestamps.into_iter().enumerate() {
            session
                .offer(FrameLease::fixture(
                    frame_id as u64,
                    timestamp,
                    Arc::clone(&releases),
                ))
                .unwrap();
        }
        let packets = output.packets();
        assert_eq!(packets[2].canonical[0].source, LandmarkSource::Predicted);
        assert_eq!(packets[3].canonical[0].source, LandmarkSource::Predicted);
        assert_eq!(packets[4].canonical[0].source, LandmarkSource::Unknown);
    }
}

#[test]
fn large_timestamp_gap_resets_prediction_history() {
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config("synthetic:large-dt"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(vec![
            vec![PoseObservation::new(0.40, 0.50, 0.0, 0.95)],
            vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0)],
        ]),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    session
        .offer(FrameLease::fixture(0, 100, Arc::clone(&releases)))
        .unwrap();
    session
        .offer(FrameLease::fixture(1, 1_500, releases))
        .unwrap();
    assert_eq!(
        output.packets()[1].canonical[0].source,
        LandmarkSource::Unknown
    );
}

#[test]
fn weak_elbow_is_fused_from_stable_arm_bones_without_changing_anchors() {
    let mut frames = Vec::new();
    for _ in 0..5 {
        frames.push(arm_frame(0.55, 0.95));
    }
    frames.push(arm_frame(0.25, 0.35));
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config("synthetic:weak-elbow"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..6 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packet = output.packets().pop().unwrap();
    assert_eq!(packet.canonical[11].source, LandmarkSource::Measured);
    assert_eq!(packet.canonical[15].source, LandmarkSource::Measured);
    assert_eq!(packet.canonical[13].source, LandmarkSource::Fused);
    assert!(packet.canonical[13].renderable);
    assert!(packet.canonical[13].y.unwrap() > 0.4);
    assert!(packet.canonical[13].uncertainty.is_some());
}

#[test]
fn sustained_weak_arm_coordinates_remain_kinematically_tracked() {
    let mut frames = vec![arm_frame_with_scores(0.55, 0.95, 0.95); 5];
    frames.extend((0..8).map(|_| arm_frame_with_scores(0.55, 0.01, 0.01)));
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config("synthetic:sustained-weak-arm"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..13 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packet = output.packets().pop().unwrap();
    assert_eq!(packet.canonical[11].source, LandmarkSource::Measured);
    assert_eq!(packet.canonical[13].source, LandmarkSource::Fused);
    assert_eq!(packet.canonical[15].source, LandmarkSource::Fused);
    assert!(packet.canonical[13].renderable);
    assert!(packet.canonical[15].renderable);
}

#[test]
fn isolated_high_confidence_spike_is_rejected_before_it_can_pollute_continuity() {
    let mut frames = vec![arm_frame(0.55, 0.95); 5];
    frames.push(arm_frame(0.98, 0.95));
    frames.push(arm_frame(0.98, 0.95));
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config("synthetic:isolated-spike"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for (frame_id, timestamp_ms) in [0, 50, 100, 150, 200, 250, 400].into_iter().enumerate() {
        session
            .offer(FrameLease::fixture(
                frame_id as u64,
                timestamp_ms,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert_eq!(packets[5].canonical[13].source, LandmarkSource::Predicted);
    assert_eq!(
        packets[5].canonical[13].reason,
        Some(ContinuityReason::OutlierRejectedPrediction)
    );
    assert_eq!(packets[6].canonical[13].source, LandmarkSource::Unknown);
    assert_eq!(
        packets[6].canonical[13].reason,
        Some(ContinuityReason::OutlierRejectedUnknown)
    );
    assert_eq!(releases.load(Ordering::SeqCst), 7);
}

#[test]
fn coherent_rapid_whole_body_motion_is_not_mistaken_for_an_isolated_spike() {
    let baseline = arm_frame(0.55, 0.95);
    let mut moved = baseline.clone();
    for landmark in &mut moved {
        landmark.x += 0.2;
        landmark.y -= 0.1;
    }
    let frames = vec![
        baseline.clone(),
        baseline.clone(),
        baseline.clone(),
        baseline.clone(),
        baseline,
        moved,
    ];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config("synthetic:coherent-fast-motion"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..6 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    assert!(
        output.packets()[5]
            .canonical
            .iter()
            .all(|landmark| landmark.source == LandmarkSource::Measured)
    );
}

#[test]
fn out_of_order_frame_is_refused_and_its_lease_is_released_once() {
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config("synthetic:out-of-order"),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(vec![arm_frame(0.55, 0.95)]),
        output,
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    session
        .offer(FrameLease::fixture(0, 100, Arc::clone(&releases)))
        .unwrap();
    let error = session
        .offer(FrameLease::fixture(1, 90, Arc::clone(&releases)))
        .unwrap_err();

    assert_eq!(
        error,
        MotionError::TimestampNotMonotonic {
            previous: 100,
            received: 90,
        }
    );
    assert_eq!(releases.load(Ordering::SeqCst), 2);
}

fn arm_frame(elbow_y: f32, elbow_visibility: f32) -> Vec<PoseObservation> {
    arm_frame_with_scores(elbow_y, elbow_visibility, 0.95)
}

fn arm_frame_with_scores(
    elbow_y: f32,
    elbow_visibility: f32,
    wrist_visibility: f32,
) -> Vec<PoseObservation> {
    let mut landmarks = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.95); 17];
    landmarks[11] = PoseObservation::new(0.4, 0.4, 0.0, 0.95);
    landmarks[13] = PoseObservation::new(0.5, elbow_y, 0.0, elbow_visibility);
    landmarks[15] = PoseObservation::new(0.6, 0.4, 0.0, wrist_visibility);
    landmarks
}

#[test]
fn reviewed_lat_pulldown_bottom_frames_keep_both_elbows_connected() {
    let rows: &[(u64, [[f32; 4]; 6])] = &[
        (
            1400,
            [
                [0.46067, 0.45699, -0.11583, 0.9994],
                [0.30324, 0.44027, 0.00712, 0.5461],
                [0.25545, 0.34572, 0.1246, 0.8868],
                [0.70772, 0.45434, -0.12517, 0.9988],
                [0.85806, 0.42002, -0.00473, 0.5544],
                [0.91464, 0.33656, 0.13229, 0.8256],
            ],
        ),
        (
            1450,
            [
                [0.46037, 0.46803, -0.13463, 0.9994],
                [0.29507, 0.46918, 0.02087, 0.5483],
                [0.25541, 0.37366, 0.24122, 0.8765],
                [0.71008, 0.46567, -0.1792, 0.9988],
                [0.86418, 0.44756, -0.01173, 0.537],
                [0.91527, 0.36168, 0.22849, 0.8171],
            ],
        ),
        (
            1500,
            [
                [0.45898, 0.47398, -0.13287, 0.9995],
                [0.29663, 0.48302, 0.03775, 0.5447],
                [0.25791, 0.3919, 0.24295, 0.8647],
                [0.70998, 0.47241, -0.203, 0.9989],
                [0.86402, 0.46222, -0.03756, 0.5271],
                [0.91523, 0.37685, 0.17339, 0.8144],
            ],
        ),
        (
            1550,
            [
                [0.46055, 0.47916, -0.11051, 0.9995],
                [0.29589, 0.5097, 0.07247, 0.5537],
                [0.25828, 0.42244, 0.31344, 0.8588],
                [0.71218, 0.48057, -0.16973, 0.999],
                [0.86548, 0.4881, 0.03592, 0.5426],
                [0.91441, 0.40266, 0.29825, 0.8267],
            ],
        ),
        (
            1600,
            [
                [0.46264, 0.47995, -0.09173, 0.9995],
                [0.29621, 0.5289, 0.06056, 0.5407],
                [0.25861, 0.44161, 0.25896, 0.8321],
                [0.71178, 0.48257, -0.16936, 0.9991],
                [0.86423, 0.5073, 0.01891, 0.5353],
                [0.91273, 0.41935, 0.23882, 0.8259],
            ],
        ),
        (
            1650,
            [
                [0.46297, 0.48615, -0.10189, 0.9996],
                [0.3125, 0.55378, 0.06052, 0.538],
                [0.26087, 0.4681, 0.31102, 0.8142],
                [0.71025, 0.48932, -0.16606, 0.9992],
                [0.85373, 0.53388, 0.01838, 0.5235],
                [0.91194, 0.45234, 0.27803, 0.8248],
            ],
        ),
        (
            1700,
            [
                [0.46616, 0.49143, -0.15035, 0.9996],
                [0.3301, 0.5659, -0.05536, 0.5117],
                [0.26114, 0.48202, 0.12594, 0.7636],
                [0.70834, 0.49251, -0.19515, 0.9992],
                [0.84375, 0.5458, -0.02488, 0.4944],
                [0.90928, 0.46393, 0.25899, 0.7986],
            ],
        ),
        (
            1750,
            [
                [0.46648, 0.5017, -0.17821, 0.9996],
                [0.34607, 0.58536, -0.06241, 0.5226],
                [0.26366, 0.50522, 0.1165, 0.7656],
                [0.7081, 0.49985, -0.25761, 0.9993],
                [0.8249, 0.56442, -0.13528, 0.4861],
                [0.90351, 0.48765, 0.0569, 0.7988],
            ],
        ),
        (
            1800,
            [
                [0.46737, 0.50543, -0.18226, 0.9997],
                [0.36052, 0.59866, -0.13015, 0.5042],
                [0.26802, 0.51683, -0.03614, 0.7419],
                [0.70782, 0.50315, -0.28841, 0.9993],
                [0.81194, 0.57505, -0.30776, 0.4538],
                [0.90261, 0.50076, -0.27515, 0.7728],
            ],
        ),
        (
            1850,
            [
                [0.47019, 0.50731, -0.23143, 0.9997],
                [0.36812, 0.60369, -0.16575, 0.4749],
                [0.27393, 0.53174, -0.06531, 0.6988],
                [0.70734, 0.50588, -0.33853, 0.9994],
                [0.80428, 0.5836, -0.34523, 0.4217],
                [0.90277, 0.51587, -0.31022, 0.7377],
            ],
        ),
        (
            1900,
            [
                [0.47029, 0.51079, -0.22028, 0.9997],
                [0.37061, 0.60876, -0.13974, 0.4814],
                [0.27594, 0.53441, -0.02552, 0.7036],
                [0.70753, 0.5086, -0.33918, 0.9994],
                [0.80469, 0.58803, -0.34665, 0.4339],
                [0.90376, 0.52143, -0.32926, 0.7528],
            ],
        ),
        (
            1950,
            [
                [0.47159, 0.50988, -0.20735, 0.9997],
                [0.37096, 0.60717, -0.12203, 0.4715],
                [0.2769, 0.53621, 0.0122, 0.6859],
                [0.70674, 0.50722, -0.31176, 0.9995],
                [0.79856, 0.59041, -0.30602, 0.4246],
                [0.90291, 0.52578, -0.25411, 0.7498],
            ],
        ),
        (
            2000,
            [
                [0.47166, 0.5108, -0.21732, 0.9998],
                [0.36798, 0.60819, -0.15809, 0.4508],
                [0.27753, 0.53589, -0.04056, 0.6568],
                [0.70652, 0.50688, -0.33934, 0.9995],
                [0.79822, 0.5917, -0.35642, 0.4063],
                [0.90272, 0.52624, -0.31622, 0.7352],
            ],
        ),
    ];
    let frames = rows.iter().map(|(_, row)| real_arm_frame(row)).collect();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            image_width_px: 720,
            image_height_px: 1_280,
            ..config("fixture:lat-pulldown-bottom")
        },
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for (frame_id, (timestamp, _)) in rows.iter().enumerate() {
        session
            .offer(FrameLease::fixture(
                frame_id as u64,
                *timestamp,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let expected = [
        [(0.370833_f32, 0.607813_f32), (0.798611_f32, 0.590625_f32)],
        [(0.368056_f32, 0.608594_f32), (0.798611_f32, 0.592188_f32)],
    ];
    for (packet, expected_frame) in output.packets().iter().rev().take(2).rev().zip(expected) {
        for ((index, actual), expected_point) in [13_usize, 14]
            .into_iter()
            .map(|index| (index, &packet.canonical[index]))
            .zip(expected_frame)
        {
            let error_px = ((actual.x.unwrap() - expected_point.0) * 720.0)
                .hypot((actual.y.unwrap() - expected_point.1) * 1_280.0);
            assert_eq!(actual.source, LandmarkSource::Fused, "landmark {index}");
            assert!(actual.renderable);
            assert!(error_px <= 12.0, "landmark {index} error {error_px}px");
        }
    }
}

fn real_arm_frame(row: &[[f32; 4]; 6]) -> Vec<PoseObservation> {
    let mut landmarks = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.95); 17];
    for (index, values) in [11_usize, 13, 15, 12, 14, 16].into_iter().zip(row) {
        landmarks[index] = PoseObservation::new(values[0], values[1], values[2], values[3]);
    }
    landmarks
}
