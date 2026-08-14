use std::{
    collections::{HashSet, VecDeque},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, atomic::AtomicUsize},
};

use maxpower_motion_sdk::{
    AdapterCapabilities, AssessmentBundleCapability, AssessmentCaptureView,
    AssessmentConclusionState, AssessmentDimension, AssessmentEmission, AssessmentEvent,
    AssessmentRuntimeError, ContractVersion, DeclaredLoad, DeclaredLoadProvenance, DiagnosticLevel,
    EquipmentAttributes, EquipmentAxis2d, EquipmentKind, EquipmentObservation, EquipmentSource,
    FrameLease, FrameObservations, FrameRotation, InferenceAdapter, LocalCoarseView, MotionError,
    MotionSession, NormalizedRect, PoseCandidate, PoseObservation, PoseObservationContract,
    RecordingOutputAdapter, ReferenceComparisonKind, SessionConfig, SetExecutionContext, SetIntent,
    SubjectPolicy, TimestampUnit, TraceNodeKind, VideoFrameContract, VideoRecognitionContext,
    WorkoutAssessmentContext, current_motion_assessment_catalog_v3,
    current_rigid_bar_assessment_profiles_v1,
};

const RIGID_BAR_CONTEXTS: &[(&str, &str, AssessmentCaptureView)] = &[
    ("barbell_bench_press", "front", AssessmentCaptureView::Front),
    (
        "barbell_bench_press",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "barbell_bench_press",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    ("barbell_row", "front", AssessmentCaptureView::Front),
    (
        "barbell_row",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "barbell_row",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    (
        "barbell_row",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
    ),
    (
        "barbell_row",
        "rearRight45",
        AssessmentCaptureView::RearObliqueRight,
    ),
    (
        "seated_shoulder_press",
        "front",
        AssessmentCaptureView::Front,
    ),
];

fn video_context(action_id: &str, capture_position: &str) -> VideoRecognitionContext {
    VideoRecognitionContext {
        source_capture_id: format!("fixture:{action_id}:{capture_position}"),
        exercise_id: action_id.into(),
        variation_id: None,
        capture_position: capture_position.into(),
        frame_contract: VideoFrameContract {
            width: 720,
            height: 1_280,
            rotation: FrameRotation::Degrees0,
            mirrored: false,
            timestamp_unit: TimestampUnit::Milliseconds,
        },
        pose_contract: PoseObservationContract {
            runtime_id: "rtmpose-m".into(),
            landmark_schema: "halpe26".into(),
            schema_version: "v1".into(),
        },
    }
}

#[test]
fn same_workout_reference_accepts_progressive_load_but_never_crosses_load_units() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure_for_subject(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "load-compatible-reference".into(),
        },
        "athlete:test-owner",
    )
    .expect("v3 catalog");
    let mut kinds = Vec::new();
    for (ordinal, value_milli, unit) in [(1, 20_000, "kg"), (2, 45_000, "lb"), (3, 60_000, "kg")] {
        let source_capture_id = format!("fixture:load-reference:{ordinal}");
        let (packets, closure) =
            canonical_packets_for_channels(&binding, &source_capture_id, false);
        let mut context = video_context("barbell_bench_press", "front");
        context.source_capture_id = source_capture_id;
        engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("load-set-{ordinal}"),
                set_ordinal: ordinal,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: Some(DeclaredLoad {
                    value_milli,
                    unit: unit.into(),
                    provenance: DeclaredLoadProvenance::UserModified,
                }),
            }))
            .expect("start set");
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect("closure");
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("report")
        else {
            panic!("sealed report")
        };
        kinds.push(
            report.rep_assessments[0]
                .comparisons
                .iter()
                .find(|comparison| comparison.feature_id == "local_primary_excursion")
                .expect("range comparison")
                .kind,
        );
    }
    assert_eq!(
        kinds,
        [
            ReferenceComparisonKind::NoReference,
            ReferenceComparisonKind::NoReference,
            ReferenceComparisonKind::SameWorkoutPriorSet,
        ],
        "load value may progress within one unit, but a different unit is not a compatible reference"
    );
}

#[test]
fn same_workout_reference_requires_an_explicit_stable_subject_identity() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "reference-without-stable-subject".into(),
        },
    )
    .expect("v3 catalog");

    for ordinal in 1..=2 {
        let source_capture_id = format!("fixture:no-subject-reference:{ordinal}");
        let (packets, closure) =
            canonical_packets_for_channels(&binding, &source_capture_id, false);
        let mut context = video_context("barbell_bench_press", "front");
        context.source_capture_id = source_capture_id;
        engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("no-subject-set-{ordinal}"),
                set_ordinal: ordinal,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: Some(DeclaredLoad {
                    value_milli: ordinal as u64 * 20_000,
                    unit: "kg".into(),
                    provenance: DeclaredLoadProvenance::UserModified,
                }),
            }))
            .expect("start set");
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect("closure");
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("report")
        else {
            panic!("sealed report")
        };
        let comparison = report.rep_assessments[0]
            .comparisons
            .iter()
            .find(|comparison| comparison.feature_id == "local_primary_excursion")
            .expect("range comparison");
        assert_eq!(comparison.kind, ReferenceComparisonKind::NoReference);
    }
}

#[test]
fn packet_local_coordinate_strategy_must_match_the_frozen_exact_context() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut wrong_binding = binding.clone();
    wrong_binding.local_coordinate_strategy.capture_view = LocalCoarseView::FrontObliqueRight;
    let (packets, _) = canonical_packets_for(&wrong_binding, "fixture:wrong-local-strategy");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "wrong-local-strategy".into(),
        },
    )
    .expect("v3 catalog");
    let mut context = video_context("barbell_bench_press", "front");
    context.source_capture_id = "fixture:wrong-local-strategy".into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "wrong-local-strategy-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start exact context");

    let error = engine
        .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(
            packets.into_iter().next().expect("canonical packet"),
        )))
        .expect_err("a packet normalized with another view must be refused");
    assert_eq!(
        error,
        AssessmentRuntimeError::PacketLocalCoordinateStrategyMismatch
    );
}

#[test]
fn visible_return_deviation_does_not_require_a_prior_range_reference() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_row"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("row front profile");
    let source_capture_id = "fixture:visible-return-without-reference";
    let (packets, closure) =
        canonical_packets_with_visible_return_error(&binding, source_capture_id);

    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "visible-return-without-reference".into(),
        },
    )
    .expect("v3 catalog");
    let mut context = video_context("barbell_row", "front");
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "visible-return-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("report")
    else {
        panic!("sealed report")
    };
    let rep = report.rep_assessments.first().expect("assessed Rep");
    let range_comparison = rep
        .comparisons
        .iter()
        .find(|comparison| comparison.feature_id == "local_primary_excursion")
        .expect("range comparison");
    assert_eq!(range_comparison.kind, ReferenceComparisonKind::NoReference);
    let range_finding = rep
        .dimension_findings
        .iter()
        .find(|finding| finding.dimension == AssessmentDimension::RangeOfMotion)
        .expect("range and return finding");
    assert_eq!(
        range_finding.state,
        AssessmentConclusionState::ObservedDeviation,
        "{}; features={:?}",
        range_finding.summary,
        rep.features
    );
    assert!(range_finding.summary.contains("Visible return error"));
}

#[derive(Clone)]
struct RigidBarFixture {
    frames: VecDeque<FrameObservations>,
}

impl InferenceAdapter for RigidBarFixture {
    fn infer(&mut self, _frame: &FrameLease) -> Result<FrameObservations, MotionError> {
        Ok(self.frames.pop_front().expect("fixture frame"))
    }
}

fn rigid_bar_frame(
    angle_degrees: f32,
    progress: f32,
    include_equipment: bool,
) -> FrameObservations {
    let mut observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.99); 26];
    for (shoulder, elbow, wrist, x) in [(5, 7, 9, 0.35), (6, 8, 10, 0.65)] {
        let elbow_point = [x, 0.42 + progress * 0.30];
        observations[shoulder] =
            PoseObservation::new(elbow_point[0], elbow_point[1] - 0.12, 0.0, 0.99);
        observations[elbow] = PoseObservation::new(elbow_point[0], elbow_point[1], 0.0, 0.99);
        let theta = (-90.0 + angle_degrees).to_radians();
        observations[wrist] = PoseObservation::new(
            elbow_point[0] + theta.cos() * 0.12,
            elbow_point[1] + theta.sin() * 0.12,
            0.0,
            0.99,
        );
    }
    observations[11] = PoseObservation::new(0.42, 0.62, 0.0, 0.99);
    observations[12] = PoseObservation::new(0.58, 0.62, 0.0, 0.99);
    observations[13] = PoseObservation::new(0.43, 0.78, 0.0, 0.99);
    observations[14] = PoseObservation::new(0.57, 0.78, 0.0, 0.99);
    observations[15] = PoseObservation::new(0.43, 0.94, 0.0, 0.99);
    observations[16] = PoseObservation::new(0.57, 0.94, 0.0, 0.99);

    let bar_center_y = 0.34 + progress * 0.30;
    let axis = EquipmentAxis2d {
        x1: 0.20,
        y1: bar_center_y,
        x2: 0.80,
        y2: bar_center_y,
    };
    FrameObservations {
        pose_candidates: vec![PoseCandidate {
            id: 7,
            bbox: NormalizedRect::new(0.05, 0.02, 0.90, 0.96),
            observations,
            torso_color: [0.2, 0.3, 0.4],
        }],
        equipment: include_equipment
            .then(|| EquipmentObservation {
                proposal_id: 11,
                kind: EquipmentKind::BarbellShaft,
                bbox: NormalizedRect::new(0.20, bar_center_y - 0.005, 0.60, 0.01),
                axis: Some(axis),
                score: 0.98,
                uncertainty_px: Some(1.0),
                source: EquipmentSource::Geometry,
                attributes: EquipmentAttributes::default(),
            })
            .into_iter()
            .collect(),
    }
}

fn aligned_rigid_bar_frame(angle_degrees: f32, progress: f32) -> FrameObservations {
    let mut frame = rigid_bar_frame(angle_degrees, progress, true);
    let bar_center_y = 0.34 + progress * 0.30;
    let observations = &mut frame.pose_candidates[0].observations;
    for (shoulder, elbow, wrist, x) in [(5, 7, 9, 0.35), (6, 8, 10, 0.65)] {
        let theta = (-90.0 + angle_degrees).to_radians();
        let elbow_y = bar_center_y - theta.sin() * 0.12;
        observations[shoulder] = PoseObservation::new(x, elbow_y - 0.12, 0.0, 0.99);
        observations[elbow] = PoseObservation::new(x, elbow_y, 0.0, 0.99);
        observations[wrist] = PoseObservation::new(x + theta.cos() * 0.12, bar_center_y, 0.0, 0.99);
    }
    frame
}

fn canonical_packets_for(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    canonical_packets_for_channels(binding, sequence_id, true)
}

fn canonical_packets_for_channels(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
    include_equipment: bool,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    let decreasing_angles = [160.0; 10]
        .into_iter()
        .chain([150.0, 135.0, 115.0, 95.0, 80.0, 82.0])
        .chain([95.0, 115.0, 135.0, 150.0, 160.0])
        .chain([160.0; 8])
        .collect::<Vec<_>>();
    let angles = if binding.action_id == "seated_shoulder_press" {
        decreasing_angles
            .iter()
            .map(|angle| 240.0 - angle)
            .collect::<Vec<_>>()
    } else {
        decreasing_angles
    };
    let progress = angles
        .iter()
        .map(|angle| {
            if binding.action_id == "seated_shoulder_press" {
                (angle - 80.0) / 80.0
            } else {
                (160.0 - angle) / 80.0
            }
        })
        .collect::<Vec<_>>();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: sequence_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture {
            frames: angles
                .iter()
                .zip(&progress)
                .enumerate()
                .map(|(index, (angle, progress))| {
                    rigid_bar_frame(*angle, *progress, include_equipment || index < 12)
                })
                .collect(),
        },
        output.clone(),
    )
    .expect("motion session");
    session
        .install_exercise_profile_with_local_strategy(
            binding.profile.clone(),
            binding.local_coordinate_strategy,
        )
        .expect("exact-context profile");
    session.begin_set();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..angles.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .expect("canonical frame");
    }
    let packets = output.packets();
    let closure = session.finish_set_for_assessment();
    (packets, closure)
}

fn canonical_packets_with_visible_return_error(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    let angles = [160.0; 10]
        .into_iter()
        .chain([150.0, 135.0, 115.0, 95.0, 80.0, 82.0])
        .chain([95.0, 115.0, 135.0, 150.0, 160.0])
        .chain([160.0; 8])
        .collect::<Vec<_>>();
    let frames = angles
        .iter()
        .enumerate()
        .map(|(index, angle)| {
            let complete_progress: f32 = (160.0_f32 - angle) / 80.0_f32;
            let progress = if index >= 16 {
                complete_progress.max(0.40)
            } else {
                complete_progress
            };
            aligned_rigid_bar_frame(*angle, progress)
        })
        .collect();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: sequence_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture { frames },
        output.clone(),
    )
    .expect("motion session");
    session
        .install_exercise_profile_with_local_strategy(
            binding.profile.clone(),
            binding.local_coordinate_strategy,
        )
        .expect("exact-context profile");
    session.begin_set();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..angles.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .expect("canonical frame");
    }
    let packets = output.packets();
    let closure = session.finish_set_for_assessment();
    (packets, closure)
}

fn read_governed_gzip_json(path: &Path) -> serde_json::Value {
    let output = Command::new("gzip")
        .args(["-dc", path.to_str().expect("UTF-8 fixture path")])
        .output()
        .expect("gzip is available for governed replay");
    assert!(output.status.success(), "failed to read {}", path.display());
    serde_json::from_slice(&output.stdout).expect("governed JSON sidecar")
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut child = Command::new("shasum")
        .args(["-a", "256"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("SHA-256 verifier is available");
    child
        .stdin
        .take()
        .expect("hash stdin")
        .write_all(bytes)
        .expect("hash input");
    let output = child.wait_with_output().expect("hash output");
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .expect("UTF-8 hash")
        .split_whitespace()
        .next()
        .expect("hash digest")
        .to_owned()
}

#[test]
#[ignore = "requires governed local-private Halpe26 observation assets"]
fn governed_real_replays_cover_every_current_rigid_bar_action_view() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let governance_root = root
        .parent()
        .expect("power workspace")
        .join("maxpower-training-data-governance");
    let governance: serde_json::Value = serde_json::from_slice(
        &std::fs::read(governance_root.join("catalog/assets.json")).expect("governance catalog"),
    )
    .expect("governance JSON");
    let replay_manifest: serde_json::Value = serde_json::from_slice(include_bytes!(
        "fixtures/rigid_bar_governed_replay_manifest_v1.json"
    ))
    .expect("versioned governed replay manifest");
    assert_eq!(
        replay_manifest["schemaVersion"],
        "maxpower-governed-replay-manifest/v1"
    );
    let assembled_input = &replay_manifest["assembledInput"];
    assert_eq!(
        sha256_bytes(&serde_json::to_vec(assembled_input).expect("stable replay input")),
        replay_manifest["assembledInputSha256"]
            .as_str()
            .expect("assembled input hash")
    );
    assert_eq!(
        assembled_input["modelConfiguration"]["assessmentCatalogId"],
        current_motion_assessment_catalog_v3().catalog_id
    );
    let assets = governance["assets"].as_array().expect("assets");
    let governed_asset = |asset_id: &str| {
        assets
            .iter()
            .find(|asset| asset["id"] == asset_id)
            .expect("governed asset resolves by ID")
    };
    let label_asset = governed_asset("personal-human-rep-ranges-v2");
    let manifest_label_asset = assembled_input["sourceAssets"]
        .as_array()
        .expect("manifest assets")
        .iter()
        .find(|asset| asset["assetId"] == "personal-human-rep-ranges-v2")
        .expect("manifest label asset");
    assert_eq!(label_asset["admission"], "label_allowed");
    assert_eq!(label_asset["authority"], "user_reviewed");
    assert_eq!(label_asset["groupKey"], "sourceCaptureId");
    let allowed_label_tasks = label_asset["allowedTasks"]
        .as_array()
        .expect("allowed label tasks");
    assert!(
        manifest_label_asset["consumedForTasks"]
            .as_array()
            .expect("consumed label tasks")
            .iter()
            .all(|task| allowed_label_tasks.contains(task))
    );
    for field in manifest_label_asset["selectedFields"]
        .as_array()
        .expect("selected label fields")
    {
        let field = field.as_str().expect("field name");
        assert!(
            field == "sourceCaptureId"
                || label_asset["allowedSupervision"]
                    .as_array()
                    .is_some_and(|fields| fields.iter().any(|value| value == field)),
            "manifest selected an unauthorized label field: {field}"
        );
    }
    assert!(
        label_asset["allowedTasks"]
            .as_array()
            .is_some_and(|tasks| tasks.iter().any(|value| value == "rep_counting"))
    );
    for field in ["exerciseId", "capturePosition"] {
        assert!(
            label_asset["allowedSupervision"]
                .as_array()
                .is_some_and(|fields| fields.iter().any(|value| value == field))
        );
    }
    let pose_asset = governed_asset("personal-native-rtmpose-halpe26-observations");
    let manifest_pose_asset = assembled_input["sourceAssets"]
        .as_array()
        .expect("manifest assets")
        .iter()
        .find(|asset| asset["assetId"] == "personal-native-rtmpose-halpe26-observations")
        .expect("manifest pose asset");
    assert_eq!(pose_asset["admission"], "feature_only");
    assert_eq!(pose_asset["authority"], "model_generated");
    assert_eq!(pose_asset["groupKey"], "sourceCaptureId");
    let allowed_pose_tasks = pose_asset["allowedTasks"]
        .as_array()
        .expect("allowed pose tasks");
    assert!(
        manifest_pose_asset["consumedForTasks"]
            .as_array()
            .expect("consumed pose tasks")
            .iter()
            .all(|task| allowed_pose_tasks.contains(task))
    );
    assert!(
        pose_asset["allowedTasks"]
            .as_array()
            .is_some_and(|tasks| tasks.iter().any(|value| value == "runtime_parity"))
    );

    let label_path = root.join(
        label_asset["location"]["path"]
            .as_str()
            .expect("label asset location"),
    );
    let hash_output = Command::new("shasum")
        .args(["-a", "256"])
        .arg(&label_path)
        .output()
        .expect("SHA-256 verifier is available");
    assert!(hash_output.status.success());
    let actual_label_hash = String::from_utf8(hash_output.stdout)
        .expect("hash output")
        .split_whitespace()
        .next()
        .expect("hash digest")
        .to_owned();
    assert_eq!(
        actual_label_hash,
        label_asset["location"]["sha256"]
            .as_str()
            .expect("immutable label hash")
    );
    let labels: serde_json::Value =
        serde_json::from_slice(&std::fs::read(label_path).expect("admitted label asset"))
            .expect("label JSON");
    let pose_root = root.join(
        pose_asset["location"]["path"]
            .as_str()
            .expect("pose asset location"),
    );
    assert_eq!(pose_asset["location"]["selector"], "*.halpe26.json.gz");
    assert_eq!(
        manifest_pose_asset["selector"],
        pose_asset["location"]["selector"]
    );

    let exclusions_path = governance_root.join(
        assembled_input["exclusions"]["path"]
            .as_str()
            .expect("exclusions path"),
    );
    let exclusion_bytes = std::fs::read(&exclusions_path).expect("governance exclusions");
    assert_eq!(
        sha256_bytes(&exclusion_bytes),
        assembled_input["exclusions"]["sha256"]
            .as_str()
            .expect("exclusions hash")
    );
    let exclusions: serde_json::Value =
        serde_json::from_slice(&exclusion_bytes).expect("exclusions JSON");
    let applied_tasks = assembled_input["exclusions"]["appliedTasks"]
        .as_array()
        .expect("applied exclusion tasks");
    let declared_excluded_groups = assembled_input["exclusions"]["excludedSourceGroups"]
        .as_array()
        .expect("declared excluded groups");
    let replays = assembled_input["sourceGroups"]
        .as_array()
        .expect("frozen source groups");
    assert_eq!(replays.len(), RIGID_BAR_CONTEXTS.len());
    for source_group in replays {
        assert_eq!(
            source_group["splitId"],
            "known-participant-known-video-regression"
        );
        let source_capture_id = source_group["sourceCaptureId"]
            .as_str()
            .expect("source group identity");
        let excluded_by_policy = exclusions["recordExclusions"]
            .as_array()
            .expect("record exclusions")
            .iter()
            .any(|exclusion| {
                exclusion["sourceCaptureId"] == source_capture_id
                    && exclusion["tasks"]
                        .as_array()
                        .is_some_and(|tasks| tasks.iter().any(|task| applied_tasks.contains(task)))
            });
        let declared_excluded = declared_excluded_groups
            .iter()
            .any(|value| value == source_capture_id);
        assert_eq!(excluded_by_policy, declared_excluded);
        assert!(!declared_excluded, "excluded source must not enter replay");
    }

    for (ordinal, source_group) in replays.iter().enumerate() {
        let action_id = source_group["exerciseId"].as_str().expect("exercise ID");
        let capture_position = source_group["capturePosition"]
            .as_str()
            .expect("capture position");
        let capture_id = source_group["sourceCaptureId"]
            .as_str()
            .expect("source capture ID");
        let capture_view = RIGID_BAR_CONTEXTS
            .iter()
            .find(|(expected_action, expected_position, _)| {
                *expected_action == action_id && *expected_position == capture_position
            })
            .map(|(_, _, view)| *view)
            .expect("manifest source group belongs to the supported matrix");
        let label_record = labels["records"]
            .as_array()
            .expect("records")
            .iter()
            .find(|record| {
                record["sourceCaptureId"] == capture_id
                    && record["exerciseId"] == action_id
                    && record["capturePosition"] == capture_position
            })
            .expect("governed exact-context label");
        let raw = read_governed_gzip_json(&pose_root.join(format!("{capture_id}.halpe26.json.gz")));
        let mut frame_ids = Vec::new();
        let mut timestamps = Vec::new();
        let frames = raw["frames"]
            .as_array()
            .expect("pose frames")
            .iter()
            .map(|frame| {
                frame_ids.push(frame["frameNumber"].as_u64().expect("frame number"));
                timestamps.push(frame["timestampMs"].as_f64().expect("timestamp").round() as u64);
                let landmarks = frame["landmarks"].as_array().expect("landmarks");
                let pose_candidates = if landmarks.len() == 26 {
                    let bbox = &frame["selectedBbox"];
                    vec![PoseCandidate {
                        id: 7,
                        bbox: NormalizedRect::new(
                            bbox["x"].as_f64().expect("bbox x") as f32,
                            bbox["y"].as_f64().expect("bbox y") as f32,
                            bbox["width"].as_f64().expect("bbox width") as f32,
                            bbox["height"].as_f64().expect("bbox height") as f32,
                        ),
                        observations: landmarks
                            .iter()
                            .map(|landmark| {
                                PoseObservation::new(
                                    landmark["x"].as_f64().expect("x") as f32,
                                    landmark["y"].as_f64().expect("y") as f32,
                                    landmark["z"].as_f64().unwrap_or(0.0) as f32,
                                    landmark["visibility"].as_f64().expect("visibility") as f32,
                                )
                            })
                            .collect(),
                        torso_color: [0.2, 0.3, 0.4],
                    }]
                } else {
                    Vec::new()
                };
                FrameObservations {
                    pose_candidates,
                    equipment: Vec::new(),
                }
            })
            .collect::<VecDeque<_>>();
        let binding = current_rigid_bar_assessment_profiles_v1()
            .into_iter()
            .find(|binding| binding.action_id == action_id && binding.capture_view == capture_view)
            .expect("exact profile");
        let output = RecordingOutputAdapter::default();
        let mut session = MotionSession::open(
            SessionConfig {
                sequence_id: capture_id.into(),
                contract: ContractVersion {
                    major: 1,
                    minor: 10,
                },
                diagnostics: DiagnosticLevel::Full,
                image_width_px: raw["source"]["widthPx"].as_u64().expect("width") as u32,
                image_height_px: raw["source"]["heightPx"].as_u64().expect("height") as u32,
                continuity: maxpower_motion_sdk::ContinuityMode::Fusion,
                subject_policy: SubjectPolicy::AssumeSingle,
            },
            AdapterCapabilities::fixture(),
            RigidBarFixture { frames },
            output.clone(),
        )
        .expect("real replay session");
        session
            .install_exercise_profile_with_local_strategy(
                binding.profile,
                binding.local_coordinate_strategy,
            )
            .expect("profile");
        session.begin_set();
        let releases = Arc::new(AtomicUsize::new(0));
        for (frame_id, timestamp_ms) in frame_ids.into_iter().zip(timestamps) {
            session
                .offer(FrameLease::fixture(
                    frame_id,
                    timestamp_ms,
                    Arc::clone(&releases),
                ))
                .expect("real frame");
        }
        let closure = session.finish_set_for_assessment();
        let packets = output.packets();
        assert!(
            packets
                .iter()
                .map(|packet| packet.completed_reps.len())
                .sum::<usize>()
                + closure.completed_rep_count()
                > 0,
            "governed {action_id}/{capture_position} replay must preserve at least one Rep"
        );
        let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            current_motion_assessment_catalog_v3(),
            WorkoutAssessmentContext {
                workout_session_id: format!("governed-rigid-bar-{ordinal}"),
            },
        )
        .expect("v3 catalog");
        let mut context = video_context(action_id, capture_position);
        context.source_capture_id = capture_id.into();
        engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("governed-set-{ordinal}"),
                set_ordinal: 1,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: None,
            }))
            .expect("start replay");
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect("closure");
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("report")
        else {
            panic!("sealed report")
        };
        assert!(!report.reps.is_empty());
        let expected_count = label_record["expectedCount"]
            .as_u64()
            .expect("expected count") as usize;
        let recognized = report
            .reps
            .iter()
            .filter(|rep| rep.disposition != "rejected")
            .collect::<Vec<_>>();
        assert!(
            recognized.len().abs_diff(expected_count) <= (expected_count / 2).max(3),
            "governed {action_id}/{capture_position} count regression: expected {expected_count}, recognized {}",
            recognized.len()
        );
        let mut used_predictions = HashSet::new();
        let boundary_aligned = label_record["segments"]
            .as_array()
            .expect("human Rep ranges")
            .iter()
            .filter(|segment| {
                let truth_start = segment["startMs"].as_u64().expect("truth start");
                let truth_end = segment["endMs"].as_u64().expect("truth end");
                recognized.iter().enumerate().any(|(index, predicted)| {
                    if used_predictions.contains(&index) {
                        return false;
                    }
                    let aligned = truth_start.abs_diff(predicted.start_timestamp_ms) <= 3_000
                        && truth_end.abs_diff(predicted.end_timestamp_ms) <= 1_500;
                    if aligned {
                        used_predictions.insert(index);
                    }
                    aligned
                })
            })
            .count();
        assert!(
            boundary_aligned * 2 >= expected_count,
            "governed {action_id}/{capture_position} boundary regression: only {boundary_aligned}/{expected_count} human ranges aligned"
        );
        assert_eq!(
            report.dimension_findings.len(),
            AssessmentDimension::ALL.len()
        );
        assert!(!report.trace.conclusion_root_ids.is_empty());
    }
}

#[test]
fn every_current_rigid_bar_context_resolves_an_executable_action_specific_bundle() {
    let catalog = current_motion_assessment_catalog_v3();
    let profiles = current_rigid_bar_assessment_profiles_v1();
    assert_eq!(profiles.len(), RIGID_BAR_CONTEXTS.len());
    let mut bundle_ids = HashSet::new();
    let mut profile_ids = HashSet::new();

    for (ordinal, (action_id, capture_position, capture_view)) in
        RIGID_BAR_CONTEXTS.iter().enumerate()
    {
        let binding = profiles
            .iter()
            .find(|binding| {
                binding.action_id == *action_id && binding.capture_view == *capture_view
            })
            .expect("exact rigid-bar RecognitionProfile binding");
        assert!(profile_ids.insert(binding.profile.identity.clone()));

        let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            catalog.clone(),
            WorkoutAssessmentContext {
                workout_session_id: format!("rigid-bar-{ordinal}"),
            },
        )
        .expect("v3 catalog");
        let AssessmentEmission::LiveMotionFacts(facts) = engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("set-{ordinal}"),
                set_ordinal: 1,
                video_context: video_context(action_id, capture_position),
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: None,
            }))
            .expect("exact context starts")
        else {
            panic!("rigid-bar exact context must be executable");
        };
        let resolved = facts.resolved_context.expect("resolved context");
        assert_eq!(
            resolved.bundle_capability,
            AssessmentBundleCapability::Executable
        );
        assert!(bundle_ids.insert(resolved.bundle_id.clone()));

        let bundle = catalog
            .bundles
            .iter()
            .find(|bundle| bundle.bundle_id == resolved.bundle_id)
            .expect("resolved bundle");
        let recognition = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.recognition_profile.id)
            .expect("RecognitionProfile asset");
        assert_eq!(
            recognition.content["runtimeProfileIdentity"],
            binding.profile.identity
        );
        assert_eq!(
            recognition.content["runtimeProfileHash"],
            format!("{:016x}", binding.profile.content_hash)
        );

        let execution = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.execution_contract.id)
            .expect("ExecutionContract asset");
        let phase_order = execution.content["phaseOrder"]
            .as_array()
            .expect("phase order");
        let task_endpoints = execution.content["taskEndpoints"]
            .as_array()
            .expect("task endpoints");
        let (expected_phases, expected_endpoints) = match *action_id {
            "barbell_bench_press" => (
                ["lowering", "pressing"],
                [
                    "locked_out_start",
                    "visible_bottom_turnaround",
                    "returned_lockout",
                ],
            ),
            "barbell_row" => (
                ["pulling", "return_to_reach"],
                [
                    "arms_extended_start",
                    "bar_to_torso_turnaround",
                    "returned_reach",
                ],
            ),
            "seated_shoulder_press" => (
                ["lowering", "pressing"],
                [
                    "overhead_start",
                    "visible_bottom_turnaround",
                    "returned_overhead",
                ],
            ),
            _ => unreachable!("rigid-bar matrix is closed"),
        };
        assert_eq!(
            phase_order
                .iter()
                .map(|phase| phase.as_str().expect("phase name"))
                .collect::<Vec<_>>(),
            expected_phases
        );
        assert_eq!(
            task_endpoints
                .iter()
                .map(|endpoint| endpoint.as_str().expect("endpoint name"))
                .collect::<Vec<_>>(),
            expected_endpoints
        );
    }
}

#[test]
fn every_current_rigid_bar_context_produces_rep_quality_and_a_causal_trace() {
    for (ordinal, (action_id, capture_position, capture_view)) in
        RIGID_BAR_CONTEXTS.iter().enumerate()
    {
        let binding = current_rigid_bar_assessment_profiles_v1()
            .into_iter()
            .find(|binding| {
                binding.action_id == *action_id && binding.capture_view == *capture_view
            })
            .expect("profile binding");
        let source_capture_id = format!("fixture:rigid-bar:{ordinal}");
        let (packets, closure) = canonical_packets_for(&binding, &source_capture_id);
        assert!(
            packets
                .iter()
                .map(|packet| packet.completed_reps.len())
                .sum::<usize>()
                + closure.completed_rep_count()
                > 0,
            "{action_id}/{capture_position} must seal a Rep"
        );

        let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            current_motion_assessment_catalog_v3(),
            WorkoutAssessmentContext {
                workout_session_id: format!("rigid-bar-report-{ordinal}"),
            },
        )
        .expect("v3 catalog");
        let mut context = video_context(action_id, capture_position);
        context.source_capture_id = source_capture_id;
        engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("set-{ordinal}"),
                set_ordinal: 1,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: None,
            }))
            .expect("start exact context");
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("canonical packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect("canonical closure");
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("sealed report")
        else {
            panic!("expected sealed report")
        };
        assert!(!report.reps.is_empty());
        assert_eq!(report.rep_assessments.len(), report.reps.len());
        let first_features = &report.rep_assessments[0].features;
        for independent_channel in ["equipment_primary_excursion", "pose_primary_excursion"] {
            assert!(
                first_features.iter().any(|feature| {
                    feature.feature_id == independent_channel && feature.value.is_some()
                }),
                "{action_id}/{capture_position} must retain measured {independent_channel} evidence independently"
            );
        }
        assert_eq!(
            report.dimension_findings.len(),
            AssessmentDimension::ALL.len()
        );
        assert!(
            AssessmentDimension::ALL.iter().all(|dimension| report
                .dimension_findings
                .iter()
                .any(|finding| finding.dimension == *dimension)),
            "{action_id}/{capture_position} must classify or abstain every dimension"
        );
        let kinds = report
            .trace
            .nodes
            .iter()
            .map(|node| node.kind)
            .collect::<Vec<_>>();
        assert!(
            [
                TraceNodeKind::SourceObservation,
                TraceNodeKind::LocalCoordinate,
                TraceNodeKind::PoseEquipmentFusion,
                TraceNodeKind::RepBoundary,
                TraceNodeKind::FeatureFact,
                TraceNodeKind::ReferenceComparison,
                TraceNodeKind::RuleConclusion,
                TraceNodeKind::SetPattern,
                TraceNodeKind::SetConclusion,
            ]
            .into_iter()
            .all(|required| kinds.contains(&required)),
            "{action_id}/{capture_position} must preserve the complete causal route"
        );
    }
}
