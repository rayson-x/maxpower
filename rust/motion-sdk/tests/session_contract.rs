use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use maxpower_motion_sdk::{
    AdapterCapabilities, CURRENT_MOTION_PACKET_CONTRACT, CanonicalLandmark, ContractVersion,
    DiagnosticLevel, FixtureInferenceAdapter, FrameLease, InferenceAdapter, InferenceResult,
    MotionError, MotionSession, OpenError, RecordingOutputAdapter, SessionConfig, TargetState,
    encode_motion_packet, visual_recognition_baseline_profiles_v0_1,
};

#[test]
fn replay_session_emits_one_versioned_packet_and_releases_the_frame_once() {
    let releases = Arc::new(AtomicUsize::new(0));
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:ticket-1".into(),
            contract: ContractVersion { major: 1, minor: 0 },
            diagnostics: DiagnosticLevel::Summary,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: maxpower_motion_sdk::SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::single_pose(vec![CanonicalLandmark::measured(
            0.25, 0.5, 0.0, 0.9,
        )]),
        output.clone(),
    )
    .expect("compatible fixture session opens");

    let lease = FrameLease::fixture(7, 1_950, Arc::clone(&releases));
    session.offer(lease).expect("fixture frame is accepted");

    let packets = output.packets();
    assert_eq!(packets.len(), 1);
    let packet = &packets[0];
    assert_eq!(packet.lineage.sequence_id, "fixture:ticket-1");
    assert_eq!(
        packet.lineage.contract,
        ContractVersion { major: 1, minor: 0 }
    );
    assert_eq!(packet.frame_id, 7);
    assert_eq!(packet.source_timestamp_ms, 1_950);
    assert_eq!(packet.subject_epoch, 0);
    assert_eq!(packet.target.state, TargetState::Locked);
    assert_eq!(packet.canonical.len(), 1);
    assert_eq!(releases.load(Ordering::SeqCst), 1);

    let summary = session.close().expect("session closes cleanly");
    assert_eq!(summary.accepted_frames, 1);
    assert_eq!(summary.published_packets, 1);
    assert_eq!(summary.released_frames, 1);
}

#[test]
fn motion_packet_binary_has_a_stable_header_and_declared_length() {
    let releases = Arc::new(AtomicUsize::new(0));
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:binary".into(),
            contract: ContractVersion { major: 1, minor: 0 },
            diagnostics: DiagnosticLevel::Off,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: maxpower_motion_sdk::SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::single_pose(vec![CanonicalLandmark::measured(
            0.25, 0.5, 0.0, 0.9,
        )]),
        output.clone(),
    )
    .unwrap();
    session
        .offer(FrameLease::fixture(9, 2_000, releases))
        .unwrap();

    let encoded = encode_motion_packet(&output.packets()[0]).unwrap();
    assert_eq!(&encoded[0..4], b"MOTN");
    assert_eq!(u16::from_le_bytes([encoded[4], encoded[5]]), 1);
    assert_eq!(u16::from_le_bytes([encoded[6], encoded[7]]), 0);
    assert_eq!(
        u32::from_le_bytes([encoded[8], encoded[9], encoded[10], encoded[11]]) as usize,
        encoded.len(),
    );
    assert_eq!(u64::from_le_bytes(encoded[12..20].try_into().unwrap()), 9,);
}

#[test]
fn incompatible_contract_major_is_refused_at_open() {
    let result = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:bad-version".into(),
            contract: ContractVersion { major: 2, minor: 0 },
            diagnostics: DiagnosticLevel::Off,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: maxpower_motion_sdk::SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::single_pose(Vec::new()),
        RecordingOutputAdapter::default(),
    );

    assert!(result.is_err());
}

#[test]
fn future_contract_minor_is_refused_at_open() {
    let result = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:future-minor".into(),
            contract: ContractVersion {
                major: CURRENT_MOTION_PACKET_CONTRACT.major,
                minor: CURRENT_MOTION_PACKET_CONTRACT.minor + 1,
            },
            diagnostics: DiagnosticLevel::Off,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: maxpower_motion_sdk::SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::single_pose(Vec::new()),
        RecordingOutputAdapter::default(),
    );

    assert!(matches!(
        result,
        Err(OpenError::UnsupportedContractMinor {
            requested: 12,
            supported: 11,
        })
    ));
}

#[test]
fn action_plan_requires_the_minor_that_defines_its_typed_reasons() {
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:old-action-plan-minor".into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Off,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: maxpower_motion_sdk::SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::single_pose(Vec::new()),
        RecordingOutputAdapter::default(),
    )
    .expect("a legacy session without an action plan remains supported");
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| binding.motion_plan.is_some())
        .expect("installed action binding");

    assert_eq!(
        session.install_exercise_profile_with_action_plan(
            binding.profile,
            binding.local_coordinate_strategy,
            binding.motion_plan.expect("action plan"),
        ),
        Err(MotionError::InvalidActionPlan(
            "action plans require packet contract 1.11 or newer",
        )),
    );
}

#[test]
fn explicit_set_lifecycle_cannot_reset_or_reinterpret_an_active_session() {
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:set-freeze".into(),
            contract: ContractVersion { major: 1, minor: 0 },
            diagnostics: DiagnosticLevel::Off,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: maxpower_motion_sdk::SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::single_pose(vec![CanonicalLandmark::measured(
            0.25, 0.5, 0.0, 0.9,
        )]),
        RecordingOutputAdapter::default(),
    )
    .expect("fixture session");

    session.begin_set().expect("start explicit set");
    assert_eq!(
        session.begin_set(),
        Err(MotionError::SetLifecycleFrozen),
        "a second begin must not clear the active Rep/trace history"
    );
    assert_eq!(
        session.set_canonical_feed_mirroring(Some(true)),
        Err(MotionError::SetLifecycleFrozen),
        "mirroring changes coordinate/laterality meaning and is frozen with the set"
    );
}

#[test]
fn dominant_subject_policy_refuses_an_adapter_without_multi_pose_capability() {
    let mut capabilities = AdapterCapabilities::fixture();
    capabilities.multi_pose = false;
    capabilities.max_candidates = 1;
    let result = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:no-multi".into(),
            contract: ContractVersion { major: 1, minor: 0 },
            diagnostics: DiagnosticLevel::Off,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: maxpower_motion_sdk::SubjectPolicy::DominantVisible,
        },
        capabilities,
        FixtureInferenceAdapter::single_pose(Vec::new()),
        RecordingOutputAdapter::default(),
    );

    assert!(result.is_err());
}

struct PanickingInference;

impl InferenceAdapter for PanickingInference {
    fn infer(&mut self, _frame: &FrameLease) -> Result<InferenceResult, MotionError> {
        panic!("fixture adapter panic");
    }
}

#[test]
fn adapter_panic_is_isolated_and_the_frame_is_still_released() {
    let releases = Arc::new(AtomicUsize::new(0));
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:panic".into(),
            contract: ContractVersion { major: 1, minor: 0 },
            diagnostics: DiagnosticLevel::Summary,
            image_width_px: 1_000,
            image_height_px: 1_000,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: maxpower_motion_sdk::SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        PanickingInference,
        RecordingOutputAdapter::default(),
    )
    .unwrap();

    let error = session
        .offer(FrameLease::fixture(1, 1_000, Arc::clone(&releases)))
        .unwrap_err();

    assert_eq!(error, MotionError::PanicIsolated("inference_adapter"));
    assert_eq!(releases.load(Ordering::SeqCst), 1);
}
