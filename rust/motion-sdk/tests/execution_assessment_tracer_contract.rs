use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, atomic::AtomicUsize},
};

use maxpower_motion_sdk::{
    AdapterCapabilities, AssessmentEmission, AssessmentEvent, ContractVersion, DiagnosticLevel,
    EquipmentAttributes, EquipmentAxis2d, EquipmentKind, EquipmentObservation, EquipmentSource,
    FrameLease, FrameObservations, FrameRotation, InferenceAdapter, MotionError, MotionSession,
    NormalizedRect, PoseCandidate, PoseObservation, PoseObservationContract,
    RecordingOutputAdapter, SessionConfig, SetExecutionContext, SetIntent, SubjectPolicy,
    TimestampUnit, TraceNodeKind, VideoFrameContract, VideoRecognitionContext,
    WorkoutAssessmentContext, visual_recognition_baseline_catalog_v0_1,
    visual_recognition_baseline_profiles_v0_1,
};

fn replace_feature_program(
    catalog: &mut maxpower_motion_sdk::ExecutionAssessmentBundleCatalog,
    content: serde_json::Value,
) {
    let asset_id = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "barbell_bench_press/front-oblique-left/v1")
        .expect("tracer bundle")
        .lineage
        .feature_program
        .id
        .clone();
    let asset = catalog
        .installed_assets
        .iter_mut()
        .find(|asset| asset.id == asset_id)
        .expect("feature asset");
    asset.content = content;
    *asset = asset.clone().with_computed_hash();
    let reference = asset.reference();
    for bundle in &mut catalog.bundles {
        if bundle.lineage.feature_program.id == asset_id {
            bundle.lineage.feature_program = reference.clone();
            *bundle = bundle.clone().with_computed_hash();
        }
    }
}

fn replace_execution_contract(
    catalog: &mut maxpower_motion_sdk::ExecutionAssessmentBundleCatalog,
    content: serde_json::Value,
) {
    let asset_id = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "barbell_bench_press/front-oblique-left/v1")
        .expect("tracer bundle")
        .lineage
        .execution_contract
        .id
        .clone();
    let asset = catalog
        .installed_assets
        .iter_mut()
        .find(|asset| asset.id == asset_id)
        .expect("execution asset");
    asset.content = content;
    *asset = asset.clone().with_computed_hash();
    let reference = asset.reference();
    for bundle in &mut catalog.bundles {
        if bundle.lineage.execution_contract.id == asset_id {
            bundle.lineage.execution_contract = reference.clone();
            *bundle = bundle.clone().with_computed_hash();
        }
    }
}

fn local_bar_frame(progress: f32) -> FrameObservations {
    let angle = 0.28_f32;
    let cross = [angle.cos(), angle.sin()];
    let primary = [-cross[1], cross[0]];
    let center = [0.5 + primary[0] * progress, 0.35 + primary[1] * progress];
    let half = 0.25;
    let axis = EquipmentAxis2d {
        x1: center[0] - cross[0] * half,
        y1: center[1] - cross[1] * half,
        x2: center[0] + cross[0] * half,
        y2: center[1] + cross[1] * half,
    };
    let mut observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.10); 26];
    observations[5] = PoseObservation::new(0.42, 0.42, 0.0, 0.95);
    observations[6] = PoseObservation::new(0.58, 0.42, 0.0, 0.95);
    observations[9] = PoseObservation::new(
        center[0] - cross[0] * 0.16,
        center[1] - cross[1] * 0.16,
        0.0,
        0.95,
    );
    observations[10] = PoseObservation::new(
        center[0] + cross[0] * 0.16,
        center[1] + cross[1] * 0.16,
        0.0,
        0.95,
    );
    FrameObservations {
        pose_candidates: vec![PoseCandidate {
            id: 7,
            bbox: NormalizedRect::new(0.05, 0.02, 0.90, 0.94),
            observations,
            torso_color: [0.2, 0.3, 0.4],
        }],
        equipment: vec![EquipmentObservation {
            proposal_id: 11,
            kind: EquipmentKind::BarbellShaft,
            bbox: NormalizedRect::new(
                axis.x1.min(axis.x2),
                axis.y1.min(axis.y2),
                (axis.x2 - axis.x1).abs(),
                (axis.y2 - axis.y1).abs().max(0.005),
            ),
            axis: Some(axis),
            score: 0.96,
            uncertainty_px: Some(1.0),
            source: EquipmentSource::Geometry,
            attributes: EquipmentAttributes::default(),
        }],
    }
}

#[derive(Clone)]
struct Fixture {
    frames: VecDeque<FrameObservations>,
}

impl InferenceAdapter for Fixture {
    fn infer(&mut self, _frame: &FrameLease) -> Result<FrameObservations, MotionError> {
        Ok(self.frames.pop_front().expect("fixture frame"))
    }
}

fn canonical_bench_packets() -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    let progress = [0.0, 0.02, 0.0]
        .into_iter()
        .chain([0.0; 9])
        .chain([
            0.02, 0.06, 0.12, 0.20, 0.30, 0.34, 0.33, 0.30, 0.22, 0.12, 0.04, 0.01,
        ])
        .chain([0.0; 8])
        .collect::<Vec<_>>();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "fixture:assessment-tracer".into(),
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
        Fixture {
            frames: progress.iter().copied().map(local_bar_frame).collect(),
        },
        output.clone(),
    )
    .expect("motion session");
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view
                    == maxpower_motion_sdk::AssessmentCaptureView::FrontObliqueLeft
        })
        .expect("v0.1 bench front-left binding");
    session
        .install_exercise_profile_with_action_plan(
            binding.profile,
            binding.local_coordinate_strategy,
            binding.motion_plan.expect("compiled action plan"),
        )
        .expect("plan-bound profile");
    session.begin_set();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..progress.len() as u64 {
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
    assert!(
        packets
            .iter()
            .map(|packet| packet.completed_reps.len())
            .sum::<usize>()
            + closure.completed_rep_count()
            > 0,
        "the assessment engine must consume RepEngine output, not count a second time"
    );
    (packets, closure)
}

fn video_context() -> VideoRecognitionContext {
    VideoRecognitionContext {
        source_capture_id: "fixture:assessment-tracer".into(),
        exercise_id: "barbell_bench_press".into(),
        variation_id: None,
        capture_position: "frontLeft45".into(),
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
fn canonical_packet_produces_rep_set_quality_and_auditable_causal_trace() {
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "workout-tracer".into(),
        },
    )
    .expect("executable assessment catalog");
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "set-1".into(),
            set_ordinal: 1,
            video_context: video_context(),
            intent: SetIntent::Warmup,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start set");
    assert_eq!(
        engine.advance(AssessmentEvent::CanonicalFrameObserved {
            frame_id: 0,
            timestamp_ms: 0,
        }),
        Err(maxpower_motion_sdk::AssessmentRuntimeError::CanonicalPacketRequired),
        "an executable Bundle must not accept frame timing without canonical evidence"
    );

    let (packets, closure) = canonical_bench_packets();
    assert!(
        packets
            .iter()
            .all(|packet| packet.completed_reps.len() == packet.completed_rep_subject_epochs.len()),
        "every delayed Rep outcome must retain its subject epoch"
    );
    let expected_rep_count = closure.completed_rep_count();
    let post_closure_packet = packets.last().expect("packet").clone();
    let duplicate_closure = closure.clone();
    engine
        .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(
            packets[0].clone(),
        )))
        .expect("first canonical packet freezes runtime lineage");
    let mut changed_lineage = packets[1].clone();
    changed_lineage.lineage.config_version = "unexpected-config/v2".into();
    assert_eq!(
        engine.advance(AssessmentEvent::CanonicalPacketObserved(Box::new(
            changed_lineage,
        ))),
        Err(maxpower_motion_sdk::AssessmentRuntimeError::PacketLineageChangedDuringSet)
    );
    for packet in packets.into_iter().skip(1) {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("consume canonical packet");
    }
    assert_eq!(
        engine.advance(AssessmentEvent::SetFinished),
        Err(maxpower_motion_sdk::AssessmentRuntimeError::CanonicalSetClosureRequired),
        "the immutable report cannot omit RepEngine's terminal candidates"
    );
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("consume canonical set closure");
    assert_eq!(
        engine.advance(AssessmentEvent::CanonicalPacketObserved(Box::new(
            post_closure_packet,
        ))),
        Err(maxpower_motion_sdk::AssessmentRuntimeError::CanonicalSetClosureAlreadyObserved)
    );
    assert_eq!(
        engine.advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            duplicate_closure,
        ))),
        Err(maxpower_motion_sdk::AssessmentRuntimeError::CanonicalSetClosureAlreadyObserved)
    );

    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("finish set")
    else {
        panic!("expected a sealed set assessment");
    };
    assert_eq!(report.reps.len(), expected_rep_count);
    assert!(!report.reps.is_empty());
    assert_eq!(report.rep_assessments.len(), report.reps.len());
    assert!(
        report
            .rep_assessments
            .iter()
            .all(|rep| !rep.features.is_empty())
    );
    assert!(!report.dimension_findings.is_empty());
    assert!(!report.set_patterns.is_empty());

    let node_kinds = report
        .trace
        .nodes
        .iter()
        .map(|node| node.kind)
        .collect::<Vec<_>>();
    for required in [
        TraceNodeKind::SourceObservation,
        TraceNodeKind::LocalCoordinate,
        TraceNodeKind::PoseEquipmentFusion,
        TraceNodeKind::RepBoundary,
        TraceNodeKind::FeatureFact,
        TraceNodeKind::ReferenceComparison,
        TraceNodeKind::RuleConclusion,
        TraceNodeKind::SetPattern,
        TraceNodeKind::SetConclusion,
    ] {
        assert!(
            node_kinds.contains(&required),
            "missing trace node {required:?}"
        );
    }
    assert!(
        report
            .trace
            .nodes
            .iter()
            .all(|node| !node.source_ids.is_empty())
    );
    assert!(!report.trace.content_hash.is_empty());
    assert!(report.trace.nodes.iter().any(|node| {
        node.kind == TraceNodeKind::SourceObservation
            && node.summary.contains("motion-session-replay/v1")
            && node.summary.contains("motion-session-config/v1")
            && node.summary.contains("inference-adapter-contract/v1")
    }));
    let kind_for = |node_id: &str| {
        report
            .trace
            .nodes
            .iter()
            .find(|node| node.node_id == node_id)
            .map(|node| node.kind)
            .expect("trace input resolves")
    };
    let mut observed_node_ids = std::collections::HashSet::new();
    for node in &report.trace.nodes {
        assert!(
            !observed_node_ids.contains(&node.node_id),
            "duplicate trace node"
        );
        assert!(
            node.input_node_ids
                .iter()
                .all(|input_id| observed_node_ids.contains(input_id)),
            "trace edges must resolve to an earlier causal node"
        );
        observed_node_ids.insert(&node.node_id);
        match node.kind {
            TraceNodeKind::RepBoundary => assert!(
                node.input_node_ids
                    .iter()
                    .all(|node_id| kind_for(node_id) == TraceNodeKind::PoseEquipmentFusion)
            ),
            TraceNodeKind::RuleConclusion => assert!(
                node.input_node_ids
                    .iter()
                    .all(|node_id| kind_for(node_id) == TraceNodeKind::ReferenceComparison)
            ),
            TraceNodeKind::SetPattern => assert!(
                node.input_node_ids
                    .iter()
                    .all(|node_id| kind_for(node_id) == TraceNodeKind::RuleConclusion)
            ),
            TraceNodeKind::SetConclusion => {
                assert!(node.input_node_ids.iter().all(|node_id| matches!(
                    kind_for(node_id),
                    TraceNodeKind::RuleConclusion | TraceNodeKind::SetPattern
                )));
                assert!(
                    node.input_node_ids
                        .iter()
                        .any(|node_id| kind_for(node_id) == TraceNodeKind::SetPattern)
                )
            }
            _ => {}
        }
    }
    assert!(
        report
            .trace
            .conclusion_root_ids
            .iter()
            .all(|node_id| observed_node_ids.contains(node_id))
    );
    let first_rep_id = report.reps[0].rep_id;
    let range_rule = report
        .trace
        .nodes
        .iter()
        .find(|node| node.node_id == format!("rep:{first_rep_id}:rule:range_of_motion"))
        .expect("range rule node");
    assert_eq!(
        range_rule.input_node_ids,
        [
            format!("rep:{first_rep_id}:comparison:authorization_range_of_motion"),
            format!("rep:{first_rep_id}:comparison:motion_relation:task_primary"),
        ],
        "the abstention depends on its authorization fact and task-primary gate"
    );
    for (dimension, expected_inputs) in [
        (
            "task_completion",
            vec![
                format!("rep:{first_rep_id}:comparison:motion_relation:task_primary"),
                format!("rep:{first_rep_id}:comparison:rep_disposition"),
            ],
        ),
        (
            "phase_control",
            vec![
                format!("rep:{first_rep_id}:comparison:authorization_phase_control"),
                format!("rep:{first_rep_id}:comparison:motion_relation:elbow_press_coordination"),
                format!("rep:{first_rep_id}:comparison:motion_relation:task_primary"),
            ],
        ),
    ] {
        let rule = report
            .trace
            .nodes
            .iter()
            .find(|node| node.node_id == format!("rep:{first_rep_id}:rule:{dimension}"))
            .expect("typed categorical rule node");
        assert_eq!(
            rule.input_node_ids, expected_inputs,
            "TaskPrimary, Rep disposition and Bundle authorization must be evaluated facts, not decorative edges"
        );
    }

    let AssessmentEmission::SealedSetAssessment(repeated) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("idempotent finish")
    else {
        panic!("expected the same sealed report");
    };
    assert_eq!(report, repeated);
}

#[test]
fn same_workout_reference_is_read_before_the_current_set_is_published() {
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure_for_subject(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "workout-reference-order".into(),
        },
        "athlete:tracer-reference",
    )
    .expect("executable assessment catalog");
    let mut reports = Vec::new();
    for (ordinal, set_id) in [(1, "warmup"), (2, "working")] {
        engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: set_id.into(),
                set_ordinal: ordinal,
                video_context: video_context(),
                intent: if ordinal == 1 {
                    SetIntent::Warmup
                } else {
                    SetIntent::Working
                },
                planned_load: None,
                performed_load: None,
            }))
            .expect("start set");
        let (packets, closure) = canonical_bench_packets();
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
            panic!("sealed report");
        };
        reports.push(report);
    }
    let range_comparison = |report: &maxpower_motion_sdk::SealedSetAssessment| {
        report.rep_assessments[0]
            .comparisons
            .iter()
            .find(|comparison| comparison.feature_id == "local_primary_excursion")
            .expect("range comparison")
            .kind
    };
    assert_eq!(
        range_comparison(&reports[0]),
        maxpower_motion_sdk::ReferenceComparisonKind::NoReference
    );
    assert_eq!(
        range_comparison(&reports[1]),
        maxpower_motion_sdk::ReferenceComparisonKind::SameWorkoutPriorSet,
        "the second set reads the already-sealed warmup reference before updating it"
    );
    let second_range = reports[1].rep_assessments[0]
        .comparisons
        .iter()
        .find(|comparison| comparison.feature_id == "local_primary_excursion")
        .expect("second range comparison");
    assert!(
        second_range
            .reference_source_ids
            .iter()
            .any(|source_id| source_id.contains("set:warmup")),
        "same-workout comparison retains the prior set and Rep provenance"
    );
    assert_ne!(reports[0].assessment_id, reports[1].assessment_id);
}

#[test]
fn configured_feature_program_cannot_override_motion_authority_or_use_raw_landmarks() {
    let mut catalog = visual_recognition_baseline_catalog_v0_1();
    replace_feature_program(
        &mut catalog,
        serde_json::json!({
            "features": [
                "cycle_duration",
                "rep_disposition",
                "first_phase_duration",
                "second_phase_duration",
                "phase_duration_ratio",
                "local_primary_excursion",
                "local_return_error",
                "authorization_range_of_motion",
                "authorization_phase_control",
                "authorization_support_stability",
                "authorization_bilateral_coordination",
                "authorization_trajectory_control",
                "authorization_standard_variant_compatibility"
            ],
            "boundedFacts": true,
            "deliveryStage": "test_program",
        }),
    );
    assert!(matches!(
        maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            catalog,
            WorkoutAssessmentContext {
                workout_session_id: "feature-program".into(),
            },
        ),
        Err(maxpower_motion_sdk::AssessmentConfigurationError::InvalidActionMotionPlan { .. })
    ));

    let mut invalid = visual_recognition_baseline_catalog_v0_1();
    replace_feature_program(
        &mut invalid,
        serde_json::json!({
            "features": ["raw_landmark_10_y"],
            "boundedFacts": true,
            "deliveryStage": "invalid_test_program",
        }),
    );
    assert!(matches!(
        maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            invalid,
            WorkoutAssessmentContext {
                workout_session_id: "invalid-feature-program".into(),
            },
        ),
        Err(
            maxpower_motion_sdk::AssessmentConfigurationError::InvalidExecutableBundleProgram { .. }
        )
    ));
}

#[test]
fn executable_bundle_rejects_duplicate_features_and_equipment_semantic_drift() {
    let mut duplicate_features = visual_recognition_baseline_catalog_v0_1();
    let feature_asset_id = duplicate_features
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "barbell_bench_press/front-oblique-left/v1")
        .expect("tracer bundle")
        .lineage
        .feature_program
        .id
        .clone();
    let mut feature_content = duplicate_features
        .installed_assets
        .iter()
        .find(|asset| asset.id == feature_asset_id)
        .expect("feature asset")
        .content
        .clone();
    feature_content["features"]
        .as_array_mut()
        .expect("feature list")
        .push(serde_json::json!("cycle_duration"));
    replace_feature_program(&mut duplicate_features, feature_content);
    assert!(matches!(
        maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            duplicate_features,
            WorkoutAssessmentContext {
                workout_session_id: "duplicate-feature-contract".into(),
            },
        ),
        Err(
            maxpower_motion_sdk::AssessmentConfigurationError::InvalidExecutableBundleProgram { .. }
        )
    ));

    let mut semantic_drift = visual_recognition_baseline_catalog_v0_1();
    let execution_asset_id = semantic_drift
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "barbell_bench_press/front-oblique-left/v1")
        .expect("tracer bundle")
        .lineage
        .execution_contract
        .id
        .clone();
    let mut execution_content = semantic_drift
        .installed_assets
        .iter()
        .find(|asset| asset.id == execution_asset_id)
        .expect("execution asset")
        .content
        .clone();
    execution_content["equipmentSemantics"] = serde_json::json!("body_only");
    replace_execution_contract(&mut semantic_drift, execution_content);
    assert!(matches!(
        maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            semantic_drift,
            WorkoutAssessmentContext {
                workout_session_id: "semantic-drift-contract".into(),
            },
        ),
        Err(
            maxpower_motion_sdk::AssessmentConfigurationError::InvalidExecutableBundleProgram { .. }
        )
    ));
}

fn read_gzip_json(path: &Path) -> serde_json::Value {
    let output = Command::new("gzip")
        .args(["-dc", path.to_str().expect("UTF-8 fixture path")])
        .output()
        .expect("gzip is available for the governed local replay");
    assert!(output.status.success(), "failed to read {}", path.display());
    serde_json::from_slice(&output.stdout).expect("governed JSON sidecar")
}

#[test]
#[ignore = "requires governed local-private Halpe26 and proposal-only bar-axis assets"]
fn governed_real_bench_video_runs_the_same_public_tracer_seam() {
    const CAPTURE_ID: &str = "e963bc2e0819f5ef528561cc1260b7ef";
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
    .expect("governance catalog JSON");
    let assets = governance["assets"].as_array().expect("asset catalog");
    let admitted = |asset_id: &str, admission: &str, task: &str| {
        assets.iter().any(|asset| {
            asset["id"] == asset_id
                && asset["admission"] == admission
                && asset["groupKey"] == "sourceCaptureId"
                && asset["allowedTasks"]
                    .as_array()
                    .is_some_and(|tasks| tasks.iter().any(|value| value == task))
        })
    };
    assert!(admitted(
        "personal-native-rtmpose-halpe26-observations",
        "feature_only",
        "runtime_parity"
    ));
    assert!(admitted(
        "barbell-geometry-alignment-prototype",
        "proposal_only",
        "prototype_replay"
    ));

    let raw = read_gzip_json(&root.join(format!(
        "data/workflows/action-trajectory-database/halpe26-v1/personal-observations/{CAPTURE_ID}.halpe26.json.gz"
    )));
    let equipment = read_gzip_json(&root.join(format!(
        "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations/{CAPTURE_ID}.barbell-pose-alignment.json.gz"
    )));
    let equipment_by_timestamp = equipment["frames"]
        .as_array()
        .expect("equipment frames")
        .iter()
        .map(|frame| {
            (
                frame["timestampMs"].as_f64().expect("timestamp").round() as u64,
                frame,
            )
        })
        .collect::<HashMap<_, _>>();
    let mut frame_ids = Vec::new();
    let mut timestamps = Vec::new();
    let mut long_bar_input_count = 0_usize;
    let frames = raw["frames"]
        .as_array()
        .expect("pose frames")
        .iter()
        .map(|frame| {
            let frame_id = frame["frameNumber"].as_u64().expect("frame number");
            let timestamp = frame["timestampMs"].as_f64().expect("timestamp").round() as u64;
            frame_ids.push(frame_id);
            timestamps.push(timestamp);
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
                                landmark["x"].as_f64().expect("landmark x") as f32,
                                landmark["y"].as_f64().expect("landmark y") as f32,
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
            let equipment = equipment_by_timestamp
                .get(&timestamp)
                .and_then(|frame| frame.get("axis"))
                .filter(|axis| !axis.is_null())
                .and_then(|axis| {
                    let measured = EquipmentAxis2d {
                        x1: axis["x1"].as_f64()? as f32,
                        y1: axis["y1"].as_f64()? as f32,
                        x2: axis["x2"].as_f64()? as f32,
                        y2: axis["y2"].as_f64()? as f32,
                    };
                    let values = [measured.x1, measured.y1, measured.x2, measured.y2];
                    if !values.into_iter().all(|value| (0.0..=1.0).contains(&value)) {
                        return None;
                    }
                    if let Some(candidate) = pose_candidates.first()
                        && (measured.x1 < candidate.bbox.x
                            || measured.x2 > candidate.bbox.x + candidate.bbox.width)
                    {
                        long_bar_input_count += 1;
                    }
                    Some(EquipmentObservation {
                        proposal_id: frame_id + 1,
                        kind: EquipmentKind::BarbellShaft,
                        bbox: NormalizedRect::new(
                            measured.x1.min(measured.x2),
                            measured.y1.min(measured.y2),
                            (measured.x2 - measured.x1).abs(),
                            (measured.y2 - measured.y1).abs().max(0.005),
                        ),
                        axis: Some(measured),
                        score: axis["confidence"].as_f64().unwrap_or(0.0) as f32,
                        uncertainty_px: None,
                        source: EquipmentSource::Geometry,
                        attributes: EquipmentAttributes::default(),
                    })
                })
                .into_iter()
                .collect();
            FrameObservations {
                pose_candidates,
                equipment,
            }
        })
        .collect::<VecDeque<_>>();
    assert!(
        long_bar_input_count > 0,
        "real shaft extends beyond the pose box"
    );

    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: CAPTURE_ID.into(),
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
        Fixture { frames },
        output.clone(),
    )
    .expect("real replay session");
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view
                    == maxpower_motion_sdk::AssessmentCaptureView::FrontObliqueLeft
        })
        .expect("v0.1 bench front-left binding");
    session
        .install_exercise_profile_with_action_plan(
            binding.profile,
            binding.local_coordinate_strategy,
            binding.motion_plan.expect("compiled action plan"),
        )
        .expect("plan-bound profile");
    session.begin_set();
    let releases = Arc::new(AtomicUsize::new(0));
    for (frame_id, timestamp) in frame_ids.into_iter().zip(timestamps) {
        session
            .offer(FrameLease::fixture(
                frame_id,
                timestamp,
                Arc::clone(&releases),
            ))
            .expect("real canonical frame");
    }
    let closure = session.finish_set_for_assessment();
    let packets = output.packets();
    assert!(packets.iter().any(|packet| matches!(
        packet.equipment.status,
        maxpower_motion_sdk::EquipmentFrameStatus::Observed
    )));
    assert!(packets.iter().any(|packet| matches!(
        packet.local_motion_coordinate.state,
        maxpower_motion_sdk::LocalCoordinateState::Frozen
            | maxpower_motion_sdk::LocalCoordinateState::Degraded
    )));

    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "governed-real-tracer".into(),
        },
    )
    .expect("assessment engine");
    let mut context = video_context();
    context.source_capture_id = CAPTURE_ID.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "governed-real-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start real set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("real packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("real closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("real report")
    else {
        panic!("real sealed report");
    };
    assert!(!report.reps.is_empty());
    assert_eq!(report.rep_assessments.len(), report.reps.len());
    assert!(!report.trace.conclusion_root_ids.is_empty());
}
