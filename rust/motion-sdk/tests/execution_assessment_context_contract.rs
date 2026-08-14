use maxpower_motion_sdk::{
    AssessmentAssetKind, AssessmentBundleCapability, AssessmentCaptureView,
    AssessmentConfigurationError, AssessmentEmission, AssessmentEquipmentRecognitionMode,
    AssessmentEquipmentSemantics, AssessmentEvent, AssessmentLateralityMode,
    AssessmentRefusalReason, DeclaredLoad, ExecutionAssessmentEngine, FrameRotation,
    PoseObservationContract, SetExecutionContext, SetIntent, TimestampUnit, VideoFrameContract,
    VideoRecognitionContext, WorkoutAssessmentContext, current_motion_assessment_catalog_v1,
    current_motion_assessment_catalog_v7,
};
use serde::Deserialize;

#[test]
fn annotated_video_context_derives_equipment_and_freezes_one_bundle_before_frames() {
    let mut engine = ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v1(),
        WorkoutAssessmentContext {
            workout_session_id: "workout-1".into(),
        },
    )
    .expect("the built-in context catalog is valid");

    let emission = engine
        .advance(AssessmentEvent::SetStarted(set_context(
            "capture-1",
            "barbell_bench_press",
            "front",
        )))
        .expect("a supported annotated context starts");

    let AssessmentEmission::LiveMotionFacts(facts) = emission else {
        panic!("expected a prepared live recognition context")
    };
    let resolved = facts
        .resolved_context
        .expect("the public emission exposes the frozen resolved context");
    assert_eq!(resolved.action_id, "barbell_bench_press");
    assert_eq!(resolved.capture_view, AssessmentCaptureView::Front);
    assert_eq!(
        resolved.equipment_semantics,
        AssessmentEquipmentSemantics::RigidBarAxis
    );
    assert_eq!(
        resolved.equipment_recognition_mode,
        AssessmentEquipmentRecognitionMode::RustVisualRigidBarAxis,
        "the frozen ExecutionContract must activate the Rust bar-axis adapter"
    );
    assert!(resolved.equipment_recognition_mode.is_provider_available());
    assert!(resolved.equipment_recognition_mode.requires_visual_frame());
    assert_eq!(resolved.variation_id, "standard_variant");
    assert_eq!(resolved.bundle_id, "barbell_bench_press/front/v1");
    assert_eq!(
        resolved.bundle_capability,
        AssessmentBundleCapability::ContextResolutionOnly
    );
    assert_eq!(
        resolved.bundle_lineage.feature_program.kind,
        AssessmentAssetKind::FeatureProgram
    );
    assert_eq!(
        resolved.bundle_lineage.rule_pack.kind,
        AssessmentAssetKind::RulePack
    );
}

#[test]
fn selected_action_contract_is_the_only_equipment_provider_capability_source() {
    for (action_id, capture_position, expected_mode, provider_available) in [
        (
            "barbell_bench_press",
            "front",
            AssessmentEquipmentRecognitionMode::RustVisualRigidBarAxis,
            true,
        ),
        (
            "lateral_raise",
            "front",
            AssessmentEquipmentRecognitionMode::ProviderUnavailableTwoIndependentDumbbells,
            false,
        ),
        (
            "push_up",
            "rearRight45",
            AssessmentEquipmentRecognitionMode::DisabledBodyOnly,
            false,
        ),
    ] {
        let mut engine = ExecutionAssessmentEngine::configure(
            current_motion_assessment_catalog_v7(),
            WorkoutAssessmentContext {
                workout_session_id: format!("equipment-plan-{action_id}"),
            },
        )
        .expect("v7 catalog configures");
        let AssessmentEmission::LiveMotionFacts(facts) = engine
            .advance(AssessmentEvent::SetStarted(set_context(
                "equipment-plan-source",
                action_id,
                capture_position,
            )))
            .expect("selected action resolves")
        else {
            panic!("selected action must resolve a live context")
        };
        let resolved = facts.resolved_context.expect("resolved equipment plan");
        assert_eq!(resolved.equipment_recognition_mode, expected_mode);
        assert_eq!(
            resolved.equipment_recognition_mode.is_provider_available(),
            provider_available
        );
        assert_eq!(
            resolved.equipment_recognition_mode.requires_visual_frame(),
            provider_available
        );
    }
}

#[test]
fn bundle_installation_fails_before_frames_when_atomic_lineage_is_incomplete_or_mistyped() {
    let mut orphaned = current_motion_assessment_catalog_v1();
    let mut orphan = orphaned.bundles[0].clone();
    orphan.bundle_id = "unknown_action/front/v1".into();
    orphan.exact_context.action_id = "unknown_action".into();
    orphan = orphan.with_computed_hash();
    orphaned.bundles.push(orphan);
    assert!(matches!(
        ExecutionAssessmentEngine::configure(
            orphaned,
            WorkoutAssessmentContext {
                workout_session_id: "workout-orphan".into(),
            },
        ),
        Err(AssessmentConfigurationError::OrphanBundle { .. })
    ));

    let mut premature = current_motion_assessment_catalog_v1();
    premature.bundles[0].capability = AssessmentBundleCapability::Executable;
    premature.bundles[0] = premature.bundles[0].clone().with_computed_hash();
    assert!(matches!(
        ExecutionAssessmentEngine::configure(
            premature,
            WorkoutAssessmentContext {
                workout_session_id: "workout-premature-execution".into(),
            },
        ),
        Err(AssessmentConfigurationError::InvalidExecutableBundleProgram { .. })
    ));

    let mut missing = current_motion_assessment_catalog_v1();
    missing.bundles[0]
        .lineage
        .local_coordinate_strategy
        .id
        .clear();
    missing.bundles[0] = missing.bundles[0].clone().with_computed_hash();
    assert!(matches!(
        ExecutionAssessmentEngine::configure(
            missing,
            WorkoutAssessmentContext {
                workout_session_id: "workout-missing".into(),
            },
        ),
        Err(AssessmentConfigurationError::IncompleteBundleLineage { .. })
    ));

    let mut mistyped = current_motion_assessment_catalog_v1();
    mistyped.bundles[0].lineage.feature_program.kind = AssessmentAssetKind::RulePack;
    mistyped.bundles[0] = mistyped.bundles[0].clone().with_computed_hash();
    assert!(matches!(
        ExecutionAssessmentEngine::configure(
            mistyped,
            WorkoutAssessmentContext {
                workout_session_id: "workout-mistyped".into(),
            },
        ),
        Err(AssessmentConfigurationError::InvalidBundleAssetReference { .. })
    ));

    let mut unknown = current_motion_assessment_catalog_v1();
    unknown.bundles[0].lineage.feature_program.id = "unknown/features/v1".into();
    unknown.bundles[0] = unknown.bundles[0].clone().with_computed_hash();
    assert!(matches!(
        ExecutionAssessmentEngine::configure(
            unknown,
            WorkoutAssessmentContext {
                workout_session_id: "workout-unknown-reference".into(),
            },
        ),
        Err(AssessmentConfigurationError::UnknownBundleAssetReference { .. })
    ));

    let mut tampered_content = current_motion_assessment_catalog_v1();
    tampered_content.installed_assets[0].content = serde_json::json!({"tampered": true});
    assert!(matches!(
        ExecutionAssessmentEngine::configure(
            tampered_content,
            WorkoutAssessmentContext {
                workout_session_id: "workout-tampered-content".into(),
            },
        ),
        Err(AssessmentConfigurationError::InvalidCatalogAsset { .. })
    ));

    let mut incompatible = current_motion_assessment_catalog_v1();
    incompatible.bundles[0].lineage.rule_pack.schema_version = "v999".into();
    incompatible.bundles[0] = incompatible.bundles[0].clone().with_computed_hash();
    assert!(matches!(
        ExecutionAssessmentEngine::configure(
            incompatible,
            WorkoutAssessmentContext {
                workout_session_id: "workout-incompatible".into(),
            },
        ),
        Err(AssessmentConfigurationError::InvalidBundleAssetReference { .. })
    ));
}

#[test]
fn unsupported_action_and_view_are_typed_refusals_without_starting_a_set() {
    for (action, view, expected_reason) in [
        (
            "unknown_action",
            "front",
            AssessmentRefusalReason::UnknownAction,
        ),
        (
            "barbell_bench_press",
            "rear",
            AssessmentRefusalReason::UnsupportedCaptureView,
        ),
        (
            "barbell_bench_press",
            "camera_37_degrees",
            AssessmentRefusalReason::UnsupportedCaptureView,
        ),
    ] {
        let mut engine = ExecutionAssessmentEngine::configure(
            current_motion_assessment_catalog_v1(),
            WorkoutAssessmentContext {
                workout_session_id: format!("workout-{action}-{view}"),
            },
        )
        .expect("catalog configures");
        let emission = engine
            .advance(AssessmentEvent::SetStarted(set_context(
                "capture-refused",
                action,
                view,
            )))
            .expect("unsupported context is a product refusal");
        let AssessmentEmission::TypedRefusal(refusal) = emission else {
            panic!("expected typed refusal for {action}/{view}")
        };
        assert_eq!(refusal.reason, expected_reason);
    }

    let mut engine = ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v1(),
        WorkoutAssessmentContext {
            workout_session_id: "workout-pose-contract".into(),
        },
    )
    .expect("catalog configures");
    let mut unsupported_pose = set_context("capture-pose", "barbell_bench_press", "front");
    unsupported_pose.video_context.pose_contract.schema_version = "v999".into();
    let emission = engine
        .advance(AssessmentEvent::SetStarted(unsupported_pose))
        .expect("pose mismatch is a product refusal");
    let AssessmentEmission::TypedRefusal(refusal) = emission else {
        panic!("expected a typed pose-contract refusal")
    };
    assert_eq!(
        refusal.reason,
        AssessmentRefusalReason::UnsupportedPoseContract
    );
}

#[test]
fn active_set_refuses_context_mutation_and_keeps_the_frozen_bundle() {
    let mut engine = ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v1(),
        WorkoutAssessmentContext {
            workout_session_id: "workout-frozen".into(),
        },
    )
    .expect("catalog configures");
    let original = set_context("capture-frozen", "barbell_bench_press", "front");
    engine
        .advance(AssessmentEvent::SetStarted(original.clone()))
        .expect("set starts");

    let restarted = engine
        .advance(AssessmentEvent::SetStarted(set_context(
            "capture-frozen",
            "barbell_row",
            "front",
        )))
        .expect("changed SetStarted is also a typed refusal");
    let AssessmentEmission::TypedRefusal(restarted) = restarted else {
        panic!("expected changed SetStarted to be refused")
    };
    assert_eq!(
        restarted.reason,
        AssessmentRefusalReason::ContextChangedDuringSet
    );

    let emission = engine
        .advance(AssessmentEvent::BundleChangeRequested {
            bundle_id: "barbell_bench_press/front/v2".into(),
            bundle_hash: "0000000000000000".into(),
        })
        .expect("bundle changes are typed refusals");
    let AssessmentEmission::TypedRefusal(refusal) = emission else {
        panic!("expected bundle-change refusal")
    };
    assert_eq!(
        refusal.reason,
        AssessmentRefusalReason::ContextChangedDuringSet
    );

    let mut changes = Vec::new();
    let mut action_changed = original.video_context.clone();
    action_changed.exercise_id = "barbell_row".into();
    changes.push(action_changed);
    let mut view_changed = original.video_context.clone();
    view_changed.capture_position = "frontLeft45".into();
    changes.push(view_changed);
    let mut schema_changed = original.video_context.clone();
    schema_changed.pose_contract.schema_version = "v2".into();
    changes.push(schema_changed);

    for changed in changes {
        let emission = engine
            .advance(AssessmentEvent::VideoContextChanged(changed))
            .expect("context mutation is a typed product refusal");
        let AssessmentEmission::TypedRefusal(refusal) = emission else {
            panic!("expected a typed refusal")
        };
        assert_eq!(
            refusal.reason,
            AssessmentRefusalReason::ContextChangedDuringSet
        );
    }

    let emission = engine
        .advance(AssessmentEvent::VideoContextChanged(
            original.video_context.clone(),
        ))
        .expect("the original set remains active");
    let AssessmentEmission::LiveMotionFacts(facts) = emission else {
        panic!("expected live facts")
    };
    assert_eq!(
        facts.resolved_context.expect("frozen context").bundle_id,
        "barbell_bench_press/front/v1"
    );
}

#[test]
fn context_resolution_only_bundles_cannot_claim_frame_or_report_execution() {
    let mut engine = ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v1(),
        WorkoutAssessmentContext {
            workout_session_id: "workout-resolution-only".into(),
        },
    )
    .expect("catalog configures");
    engine
        .advance(AssessmentEvent::SetStarted(set_context(
            "capture-resolution-only",
            "barbell_bench_press",
            "front",
        )))
        .expect("context resolves");

    for event in [
        AssessmentEvent::CanonicalFrameObserved {
            frame_id: 1,
            timestamp_ms: 10,
        },
        AssessmentEvent::SetFinished,
    ] {
        let emission = engine
            .advance(event)
            .expect("unimplemented execution is a typed product refusal");
        let AssessmentEmission::TypedRefusal(refusal) = emission else {
            panic!("expected a typed capability refusal")
        };
        assert_eq!(refusal.reason, AssessmentRefusalReason::BundleNotExecutable);
    }
}

/// Local-private governed input:
/// `personal-human-rep-ranges-v2` (`label_allowed`), immutable SHA-256
/// `63c33e44365d8359df32793e16f3a3c8dd4c53d32a970933ed57441d4c150727`.
/// Only its allowed source identity, exercise and capture-position fields are consumed.
#[test]
#[ignore = "requires the governed local-private personal annotation asset"]
fn all_54_governed_records_resolve_through_the_public_engine_seam() {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Dataset {
        records: Vec<Record>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Record {
        source_capture_id: String,
        exercise_id: String,
        capture_position: String,
    }

    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let governance_catalog_path =
        manifest_dir.join("../../../maxpower-training-data-governance/catalog/assets.json");
    let governance_catalog: serde_json::Value = serde_json::from_slice(
        &std::fs::read(governance_catalog_path).expect("governance catalog is present"),
    )
    .expect("governance catalog is readable");
    let asset = governance_catalog["assets"]
        .as_array()
        .expect("governance assets")
        .iter()
        .find(|asset| asset["id"] == "personal-human-rep-ranges-v2")
        .expect("the governed annotation asset resolves by asset ID");
    assert_eq!(asset["admission"], "label_allowed");
    assert_eq!(asset["authority"], "user_reviewed");
    assert_eq!(asset["groupKey"], "sourceCaptureId");
    let allowed = asset["allowedSupervision"]
        .as_array()
        .expect("allowed supervision fields");
    for field in ["exerciseId", "capturePosition"] {
        assert!(allowed.iter().any(|candidate| candidate == field));
    }

    let path = manifest_dir.join("../..").join(
        asset["location"]["path"]
            .as_str()
            .expect("governed asset location"),
    );
    let output = std::process::Command::new("shasum")
        .args(["-a", "256"])
        .arg(&path)
        .output()
        .expect("SHA-256 verifier is available");
    assert!(output.status.success());
    let actual_hash = String::from_utf8(output.stdout)
        .expect("hash output is UTF-8")
        .split_whitespace()
        .next()
        .expect("hash output contains a digest")
        .to_owned();
    assert_eq!(
        actual_hash,
        asset["location"]["sha256"]
            .as_str()
            .expect("governed immutable source hash")
    );

    let dataset: Dataset = serde_json::from_slice(
        &std::fs::read(&path).expect("governed local-private annotation asset is present"),
    )
    .expect("governed annotation schema is readable");
    assert_eq!(dataset.records.len(), 54);

    for (index, record) in dataset.records.iter().enumerate() {
        let mut engine = ExecutionAssessmentEngine::configure(
            current_motion_assessment_catalog_v1(),
            WorkoutAssessmentContext {
                workout_session_id: format!("governed-record-{index}"),
            },
        )
        .expect("catalog configures");
        let emission = engine
            .advance(AssessmentEvent::SetStarted(set_context(
                &record.source_capture_id,
                &record.exercise_id,
                &record.capture_position,
            )))
            .expect("record resolves through the public engine");
        assert!(
            matches!(emission, AssessmentEmission::LiveMotionFacts(_)),
            "record {index} did not resolve: {}/{}",
            record.exercise_id,
            record.capture_position
        );
    }
}

#[test]
fn current_action_library_resolves_every_governed_action_view_to_equipment_semantics() {
    use AssessmentCaptureView as View;
    use AssessmentEquipmentSemantics as Equipment;

    let cases = [
        (
            "barbell_bench_press",
            "front",
            View::Front,
            Equipment::RigidBarAxis,
        ),
        (
            "barbell_bench_press",
            "frontLeft45",
            View::FrontObliqueLeft,
            Equipment::RigidBarAxis,
        ),
        (
            "barbell_bench_press",
            "frontRight45",
            View::FrontObliqueRight,
            Equipment::RigidBarAxis,
        ),
        ("barbell_row", "front", View::Front, Equipment::RigidBarAxis),
        (
            "barbell_row",
            "frontLeft45",
            View::FrontObliqueLeft,
            Equipment::RigidBarAxis,
        ),
        (
            "barbell_row",
            "frontRight45",
            View::FrontObliqueRight,
            Equipment::RigidBarAxis,
        ),
        (
            "barbell_row",
            "rearLeft45",
            View::RearObliqueLeft,
            Equipment::RigidBarAxis,
        ),
        (
            "barbell_row",
            "rearRight45",
            View::RearObliqueRight,
            Equipment::RigidBarAxis,
        ),
        (
            "machine_chest_press",
            "front",
            View::Front,
            Equipment::ConstrainedMachineLever,
        ),
        (
            "machine_chest_press",
            "frontRight45",
            View::FrontObliqueRight,
            Equipment::ConstrainedMachineLever,
        ),
        (
            "seated_shoulder_press",
            "front",
            View::Front,
            Equipment::RigidBarAxis,
        ),
        (
            "push_up",
            "rearRight45",
            View::RearObliqueRight,
            Equipment::BodyOnly,
        ),
        (
            "lat_pulldown",
            "rear",
            View::Rear,
            Equipment::CableOrMovingHandle,
        ),
        (
            "lat_pulldown",
            "rearLeft45",
            View::RearObliqueLeft,
            Equipment::CableOrMovingHandle,
        ),
        (
            "pull_up",
            "rearLeft45",
            View::RearObliqueLeft,
            Equipment::FixedSupport,
        ),
        (
            "seated_row",
            "frontLeft45",
            View::FrontObliqueLeft,
            Equipment::CableOrMovingHandle,
        ),
        (
            "seated_row",
            "rearLeft45",
            View::RearObliqueLeft,
            Equipment::CableOrMovingHandle,
        ),
        (
            "seated_row",
            "right",
            View::RightSide,
            Equipment::CableOrMovingHandle,
        ),
        (
            "straight_arm_pulldown",
            "frontLeft45",
            View::FrontObliqueLeft,
            Equipment::CableOrMovingHandle,
        ),
        (
            "straight_arm_pulldown",
            "frontRight45",
            View::FrontObliqueRight,
            Equipment::CableOrMovingHandle,
        ),
        (
            "lateral_raise",
            "front",
            View::Front,
            Equipment::TwoIndependentDumbbells,
        ),
        (
            "rear_delt_fly",
            "front",
            View::Front,
            Equipment::ConstrainedMachineLever,
        ),
        (
            "single_arm_cable_lateral_raise",
            "frontLeft45",
            View::FrontObliqueLeft,
            Equipment::UnilateralCableHandle,
        ),
        (
            "single_arm_cable_lateral_raise",
            "rearRight45",
            View::RearObliqueRight,
            Equipment::UnilateralCableHandle,
        ),
    ];

    for (index, (action, alias, expected_view, expected_equipment)) in cases.iter().enumerate() {
        let mut engine = ExecutionAssessmentEngine::configure(
            current_motion_assessment_catalog_v1(),
            WorkoutAssessmentContext {
                workout_session_id: format!("workout-{index}"),
            },
        )
        .expect("the built-in context catalog is valid");
        let emission = engine
            .advance(AssessmentEvent::SetStarted(set_context(
                &format!("capture-{index}"),
                action,
                alias,
            )))
            .expect("governed context starts");
        let AssessmentEmission::LiveMotionFacts(facts) = emission else {
            panic!("{action}/{alias} did not resolve")
        };
        let resolved = facts.resolved_context.expect("resolved context");
        assert_eq!(resolved.capture_view, *expected_view, "{action}/{alias}");
        assert_eq!(
            resolved.equipment_semantics, *expected_equipment,
            "{action}/{alias}"
        );
        if *action == "single_arm_cable_lateral_raise" {
            assert_eq!(
                resolved.laterality_mode,
                AssessmentLateralityMode::ObservedActiveSide
            );
            assert_eq!(resolved.observed_active_side, None);
        }
    }
}

fn set_context(
    source_capture_id: &str,
    exercise_id: &str,
    capture_position: &str,
) -> SetExecutionContext {
    SetExecutionContext {
        set_id: "set-1".into(),
        set_ordinal: 1,
        video_context: VideoRecognitionContext {
            source_capture_id: source_capture_id.into(),
            exercise_id: exercise_id.into(),
            variation_id: None,
            capture_position: capture_position.into(),
            frame_contract: VideoFrameContract {
                width: 1080,
                height: 1920,
                rotation: FrameRotation::Degrees0,
                mirrored: false,
                timestamp_unit: TimestampUnit::Milliseconds,
            },
            pose_contract: PoseObservationContract {
                runtime_id: "rtmpose-m".into(),
                landmark_schema: "halpe26".into(),
                schema_version: "v1".into(),
            },
        },
        intent: SetIntent::Working,
        planned_load: None::<DeclaredLoad>,
        performed_load: None::<DeclaredLoad>,
    }
}
