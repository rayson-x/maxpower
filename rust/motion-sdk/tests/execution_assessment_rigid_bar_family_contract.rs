use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, atomic::AtomicUsize},
};

use maxpower_motion_sdk::{
    ACTION_ASSET_PACKAGE_SCHEMA, ActionAssetContextPackage, ActionAssetPackage,
    ActionMotionBundleBinding, ActionMotionCatalog, ActionMotionCompiler, ActionViewBinding,
    AdapterCapabilities, AssessmentAssetKind, AssessmentCaptureView, AssessmentConclusionState,
    AssessmentDimension, AssessmentEmission, AssessmentEvent, AssessmentRuntimeError,
    BarbellAxisSource, BarbellAxisVisualTracker, ContractVersion, DeclaredLoad,
    DeclaredLoadProvenance, DiagnosticLevel, EquipmentAttributes, EquipmentAxis2d, EquipmentKind,
    EquipmentObservation, EquipmentProviderId, EquipmentSource, ExecutionAssessmentBundleCatalog,
    ExecutionAssessmentEngine, ExerciseSignalKind, FrameLease, FrameObservations, FrameRotation,
    InferenceAdapter, LocalEquipmentMode, MotionError, MotionSession, MovementDirection,
    NormalizedRect, OperatorRegistry, PointEquipmentMode, PointEquipmentVisualTracker,
    PoseCandidate, PoseObservation, PoseObservationContract, PoseSchemaId, RecordingOutputAdapter,
    ReferenceComparisonKind, RigidBarAssessmentProfileBinding, SealedSetAssessment, SessionConfig,
    SetExecutionContext, SetIntent, SubjectPolicy, TimestampUnit, TraceNodeKind,
    VideoFrameContract, VideoRecognitionContext, WorkoutAssessmentContext,
    compile_plan_driven_runtime_binding, install_action_motion_local_strategy,
    install_action_motion_runtime_profile, install_compiled_action_motion_semantics,
    rigid_bar_track_supports_turnaround, visual_recognition_baseline_catalog_v0_1,
    visual_recognition_baseline_profiles_v0_1, visual_recognition_baseline_registry_v0_1,
};
use serde::Serialize;

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

fn admitted_external_rigid_bar_bundle(
    leaf_action_id: &str,
    runtime_action_id: &str,
    view: AssessmentCaptureView,
    template_action_id: &str,
) -> (
    ExecutionAssessmentBundleCatalog,
    RigidBarAssessmentProfileBinding,
) {
    let mut catalog = visual_recognition_baseline_catalog_v0_1();
    let (view_id, catalog_view_id) = match view {
        AssessmentCaptureView::Front => ("front", "front"),
        AssessmentCaptureView::FrontObliqueLeft => ("front_left_45", "front-oblique-left"),
        AssessmentCaptureView::FrontObliqueRight => ("front_right_45", "front-oblique-right"),
        _ => panic!("fixture helper supports current rigid-bar front views"),
    };
    let definition = catalog
        .action_motion_catalog
        .as_mut()
        .expect("v0_1 motion catalog")
        .definitions
        .iter_mut()
        .find(|definition| definition.action_id == leaf_action_id)
        .expect("reviewed external leaf");
    *definition = definition.clone().with_computed_hash();
    let plan = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(definition, view_id)
        .expect("externally admitted exact-view plan");

    let template_bundle_id = format!("{template_action_id}/{catalog_view_id}/v1");
    let template_bundle = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == template_bundle_id)
        .expect("front rigid-bar template")
        .clone();
    let target_bundle_id = format!("{runtime_action_id}/{catalog_view_id}/v1");
    let mut bundle = template_bundle.clone();
    bundle.bundle_id = target_bundle_id.clone();
    bundle.exact_context.action_id = runtime_action_id.into();
    let assets = [
        (
            AssessmentAssetKind::RecognitionProfile,
            template_bundle.lineage.recognition_profile,
        ),
        (
            AssessmentAssetKind::ExecutionContract,
            template_bundle.lineage.execution_contract,
        ),
        (
            AssessmentAssetKind::LocalCoordinateStrategy,
            template_bundle.lineage.local_coordinate_strategy,
        ),
        (
            AssessmentAssetKind::EquipmentAdapter,
            template_bundle.lineage.equipment_adapter,
        ),
        (
            AssessmentAssetKind::FeatureProgram,
            template_bundle.lineage.feature_program,
        ),
        (
            AssessmentAssetKind::ReferencePolicy,
            template_bundle.lineage.reference_policy,
        ),
        (
            AssessmentAssetKind::RulePack,
            template_bundle.lineage.rule_pack,
        ),
        (
            AssessmentAssetKind::SetAggregationPolicy,
            template_bundle.lineage.set_aggregation_policy,
        ),
    ];
    for (kind, old_reference) in assets {
        let mut asset = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == old_reference.id && asset.kind == kind)
            .expect("template exact-context asset")
            .clone();
        asset.id = format!("{}/{runtime_action_id}", asset.id);
        asset = asset.with_computed_hash();
        let reference = asset.reference();
        match kind {
            AssessmentAssetKind::RecognitionProfile => {
                bundle.lineage.recognition_profile = reference
            }
            AssessmentAssetKind::ExecutionContract => bundle.lineage.execution_contract = reference,
            AssessmentAssetKind::LocalCoordinateStrategy => {
                bundle.lineage.local_coordinate_strategy = reference
            }
            AssessmentAssetKind::EquipmentAdapter => bundle.lineage.equipment_adapter = reference,
            AssessmentAssetKind::FeatureProgram => bundle.lineage.feature_program = reference,
            AssessmentAssetKind::ReferencePolicy => bundle.lineage.reference_policy = reference,
            AssessmentAssetKind::RulePack => bundle.lineage.rule_pack = reference,
            AssessmentAssetKind::SetAggregationPolicy => {
                bundle.lineage.set_aggregation_policy = reference
            }
        }
        catalog.installed_assets.push(asset);
    }
    bundle = bundle.with_computed_hash();
    catalog.bundles.push(bundle);

    let mut runtime_definition = catalog
        .action_definitions
        .iter()
        .find(|definition| definition.action_id == template_action_id)
        .expect("rigid-bar action definition template")
        .clone();
    runtime_definition.action_definition_id = format!("{runtime_action_id}/action-definition/v1");
    runtime_definition.action_id = runtime_action_id.into();
    runtime_definition.supported_views = vec![ActionViewBinding {
        capture_view: view,
        bundle_id: target_bundle_id.clone(),
    }];
    runtime_definition = runtime_definition.with_computed_hash();
    catalog.action_definitions.push(runtime_definition);
    catalog
        .action_motion_bindings
        .push(ActionMotionBundleBinding {
            bundle_id: target_bundle_id.clone(),
            leaf_action_id: leaf_action_id.into(),
        });

    let runtime_bundle = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == target_bundle_id)
        .expect("external runtime bundle");
    let profile = compile_plan_driven_runtime_binding(runtime_bundle, plan.clone());
    install_action_motion_runtime_profile(&mut catalog, &target_bundle_id, &profile.profile, &plan);
    install_compiled_action_motion_semantics(&mut catalog, &target_bundle_id, &plan);
    install_action_motion_local_strategy(
        &mut catalog,
        &target_bundle_id,
        profile.local_coordinate_strategy,
    );
    (catalog, profile)
}

fn admitted_external_independent_machine_bundle() -> (
    ExecutionAssessmentBundleCatalog,
    RigidBarAssessmentProfileBinding,
) {
    let leaf_action_id = "seated_independent_machine_chest_press";
    let runtime_action_id = leaf_action_id;
    let view = AssessmentCaptureView::Front;
    let mut catalog = visual_recognition_baseline_catalog_v0_1();
    let definition = catalog
        .action_motion_catalog
        .as_mut()
        .expect("v0_1 motion catalog")
        .definitions
        .iter_mut()
        .find(|definition| definition.action_id == leaf_action_id)
        .expect("reviewed independent-machine leaf");
    *definition = definition.clone().with_computed_hash();
    let plan = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(definition, "front")
        .expect("independent-machine plan");
    assert_eq!(
        plan.rep_consensus.mode,
        maxpower_motion_sdk::RepConsensusMode::IndependentBilateral
    );

    let template_bundle = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "machine_chest_press/front/v1")
        .expect("linked machine template")
        .clone();
    let target_bundle_id = format!("{runtime_action_id}/front/v1");
    let mut bundle = template_bundle.clone();
    bundle.bundle_id = target_bundle_id.clone();
    bundle.exact_context.action_id = runtime_action_id.into();
    let assets = [
        (
            AssessmentAssetKind::RecognitionProfile,
            template_bundle.lineage.recognition_profile,
        ),
        (
            AssessmentAssetKind::ExecutionContract,
            template_bundle.lineage.execution_contract,
        ),
        (
            AssessmentAssetKind::LocalCoordinateStrategy,
            template_bundle.lineage.local_coordinate_strategy,
        ),
        (
            AssessmentAssetKind::EquipmentAdapter,
            template_bundle.lineage.equipment_adapter,
        ),
        (
            AssessmentAssetKind::FeatureProgram,
            template_bundle.lineage.feature_program,
        ),
        (
            AssessmentAssetKind::ReferencePolicy,
            template_bundle.lineage.reference_policy,
        ),
        (
            AssessmentAssetKind::RulePack,
            template_bundle.lineage.rule_pack,
        ),
        (
            AssessmentAssetKind::SetAggregationPolicy,
            template_bundle.lineage.set_aggregation_policy,
        ),
    ];
    for (kind, old_reference) in assets {
        let mut asset = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == old_reference.id && asset.kind == kind)
            .expect("machine template asset")
            .clone();
        asset.id = format!("{}/{runtime_action_id}", asset.id);
        asset = asset.with_computed_hash();
        let reference = asset.reference();
        match kind {
            AssessmentAssetKind::RecognitionProfile => {
                bundle.lineage.recognition_profile = reference
            }
            AssessmentAssetKind::ExecutionContract => bundle.lineage.execution_contract = reference,
            AssessmentAssetKind::LocalCoordinateStrategy => {
                bundle.lineage.local_coordinate_strategy = reference
            }
            AssessmentAssetKind::EquipmentAdapter => bundle.lineage.equipment_adapter = reference,
            AssessmentAssetKind::FeatureProgram => bundle.lineage.feature_program = reference,
            AssessmentAssetKind::ReferencePolicy => bundle.lineage.reference_policy = reference,
            AssessmentAssetKind::RulePack => bundle.lineage.rule_pack = reference,
            AssessmentAssetKind::SetAggregationPolicy => {
                bundle.lineage.set_aggregation_policy = reference
            }
        }
        catalog.installed_assets.push(asset);
    }
    catalog.bundles.push(bundle.with_computed_hash());
    let mut runtime_definition = catalog
        .action_definitions
        .iter()
        .find(|definition| definition.action_id == "machine_chest_press")
        .expect("machine action definition template")
        .clone();
    runtime_definition.action_definition_id = format!("{runtime_action_id}/action-definition/v1");
    runtime_definition.action_id = runtime_action_id.into();
    runtime_definition.supported_views = vec![ActionViewBinding {
        capture_view: view,
        bundle_id: target_bundle_id.clone(),
    }];
    runtime_definition = runtime_definition.with_computed_hash();
    catalog.action_definitions.push(runtime_definition);
    catalog
        .action_motion_bindings
        .push(ActionMotionBundleBinding {
            bundle_id: target_bundle_id.clone(),
            leaf_action_id: leaf_action_id.into(),
        });

    let runtime_bundle = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == target_bundle_id)
        .expect("independent-machine runtime bundle");
    let profile = compile_plan_driven_runtime_binding(runtime_bundle, plan.clone());
    install_action_motion_runtime_profile(&mut catalog, &target_bundle_id, &profile.profile, &plan);
    install_compiled_action_motion_semantics(&mut catalog, &target_bundle_id, &plan);
    install_action_motion_local_strategy(
        &mut catalog,
        &target_bundle_id,
        profile.local_coordinate_strategy,
    );
    (catalog, profile)
}

fn run_plan_bound_fixture_report(
    catalog: ExecutionAssessmentBundleCatalog,
    binding: &RigidBarAssessmentProfileBinding,
    action_id: &str,
    capture_position: &str,
    source_capture_id: &str,
) -> SealedSetAssessment {
    let (packets, closure) = canonical_packets_for(binding, source_capture_id);
    let mut engine = ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: format!("fixture-report:{action_id}"),
        },
    )
    .expect("fixture catalog");
    let mut context = video_context(action_id, capture_position);
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: format!("fixture-set:{action_id}"),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start fixture set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("fixture packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("fixture closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("fixture report")
    else {
        panic!("sealed fixture report")
    };
    *report
}

const ALL_ACTION_CONTEXTS: &[(&str, &str, AssessmentCaptureView)] = &[
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
    ("lat_pulldown", "rear", AssessmentCaptureView::Rear),
    (
        "lat_pulldown",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
    ),
    (
        "seated_row",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "seated_row",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
    ),
    ("seated_row", "right", AssessmentCaptureView::RightSide),
    (
        "straight_arm_pulldown",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "straight_arm_pulldown",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    (
        "single_arm_cable_lateral_raise",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "single_arm_cable_lateral_raise",
        "rearRight45",
        AssessmentCaptureView::RearObliqueRight,
    ),
    ("machine_chest_press", "front", AssessmentCaptureView::Front),
    (
        "machine_chest_press",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    ("rear_delt_fly", "front", AssessmentCaptureView::Front),
    ("lateral_raise", "front", AssessmentCaptureView::Front),
    (
        "push_up",
        "rearRight45",
        AssessmentCaptureView::RearObliqueRight,
    ),
    (
        "pull_up",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
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
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure_for_subject(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "load-compatible-reference".into(),
        },
        "athlete:test-owner",
    )
    .expect("v3 catalog");
    let mut kinds = Vec::new();
    for (ordinal, value_milli, unit) in [(1, 20_000, "kg"), (2, 45_000, "lb"), (3, 60_000, "kg")] {
        let source_capture_id = format!("fixture:load-reference:{ordinal}");
        let (packets, closure) = canonical_packets_for_channels(&binding, &source_capture_id, true);
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
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
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
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut wrong_binding = binding.clone();
    wrong_binding.local_coordinate_strategy.equipment_mode = LocalEquipmentMode::PoseOnly;
    let (packets, _) = canonical_packets_for(&wrong_binding, "fixture:wrong-local-strategy");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
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
        .expect_err("a packet normalized with another equipment primitive must be refused");
    assert_eq!(
        error,
        AssessmentRuntimeError::PacketLocalCoordinateStrategyMismatch
    );
}

#[test]
fn canonical_set_closure_without_any_packet_is_refused() {
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let (_, closure) = canonical_packets_for(&binding, "fixture:empty-assessment-stream");
    let mut engine = ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "empty-assessment-stream".into(),
        },
    )
    .expect("v3 catalog");
    let mut context = video_context("barbell_bench_press", "front");
    context.source_capture_id = "fixture:empty-assessment-stream".into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "empty-assessment-stream-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start exact context");

    assert_eq!(
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect_err("an empty canonical stream cannot produce user conclusions"),
        AssessmentRuntimeError::CanonicalPacketRequired
    );
}

#[test]
fn visible_return_error_without_a_governed_rule_remains_cannot_judge() {
    let binding = visual_recognition_baseline_profiles_v0_1()
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
        visual_recognition_baseline_catalog_v0_1(),
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
        AssessmentConclusionState::CannotJudge,
        "{}; features={:?}",
        range_finding.summary,
        rep.features
    );
    assert!(
        range_finding
            .summary
            .contains("does not authorize a conclusion")
    );
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

fn rigid_bar_pixels(
    tracker: &mut BarbellAxisVisualTracker,
    timestamp_ms: u64,
    mut frame: FrameObservations,
) -> FrameObservations {
    const WIDTH: usize = 320;
    const HEIGHT: usize = 240;
    let bar_y = frame
        .equipment
        .first()
        .and_then(|observation| observation.axis)
        .map(|axis| (axis.y1 + axis.y2) * 0.5)
        .expect("fixture bar axis");
    let mut luma = vec![28; WIDTH * HEIGHT];
    let center_y = (bar_y * HEIGHT as f32).round() as usize;
    for y in center_y.saturating_sub(3)..=(center_y + 3).min(HEIGHT - 1) {
        for x in 44..=276 {
            luma[y * WIDTH + x] = 224;
        }
    }
    let raw = tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &luma,
            WIDTH,
            HEIGHT,
            timestamp_ms,
            &frame.pose_candidates,
        )
        .expect("Rust rigid-bar pixel provider");
    frame.equipment = raw.raw_observations;
    frame
}

fn point_equipment_frame(
    tracker: &mut PointEquipmentVisualTracker,
    timestamp_ms: u64,
    shoulder_angle_degrees: f32,
    setup_offset_y: f32,
    kind: EquipmentKind,
) -> FrameObservations {
    const WIDTH: usize = 320;
    const HEIGHT: usize = 240;
    let radians = shoulder_angle_degrees.to_radians();
    let mut observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.99); 26];
    let mut centers = Vec::new();
    for (shoulder, elbow, wrist, hip, shoulder_x, direction) in
        [(5, 7, 9, 11, 0.40, -1.0), (6, 8, 10, 12, 0.60, 1.0)]
    {
        let shoulder_point = [shoulder_x, 0.36 + setup_offset_y];
        let wrist_point = [
            shoulder_x + direction * radians.sin() * 0.20,
            shoulder_point[1] + radians.cos() * 0.20,
        ];
        observations[shoulder] =
            PoseObservation::new(shoulder_point[0], shoulder_point[1], 0.0, 0.99);
        observations[elbow] = PoseObservation::new(
            (shoulder_point[0] + wrist_point[0]) * 0.5,
            (shoulder_point[1] + wrist_point[1]) * 0.5,
            0.0,
            0.99,
        );
        observations[wrist] = PoseObservation::new(wrist_point[0], wrist_point[1], 0.0, 0.99);
        observations[hip] = PoseObservation::new(shoulder_x, 0.68 + setup_offset_y, 0.0, 0.99);
        centers.push(wrist_point);
    }
    observations[13] = PoseObservation::new(0.42, 0.80 + setup_offset_y, 0.0, 0.99);
    observations[14] = PoseObservation::new(0.58, 0.80 + setup_offset_y, 0.0, 0.99);
    observations[15] = PoseObservation::new(0.42, 0.94 + setup_offset_y, 0.0, 0.99);
    observations[16] = PoseObservation::new(0.58, 0.94 + setup_offset_y, 0.0, 0.99);
    let subject = PoseCandidate {
        id: 7,
        bbox: NormalizedRect::new(0.08, 0.04, 0.84, 0.94),
        observations,
        torso_color: [0.2, 0.3, 0.4],
    };
    let mut image = vec![28; WIDTH * HEIGHT];
    for center in centers {
        let center_x = (center[0] * WIDTH as f32).round() as isize;
        let center_y = (center[1] * HEIGHT as f32).round() as isize;
        for y in center_y - 8..center_y + 8 {
            for x in center_x - 9..center_x + 9 {
                if x >= 0 && y >= 0 && x < WIDTH as isize && y < HEIGHT as isize {
                    image[y as usize * WIDTH + x as usize] = 224;
                }
            }
        }
    }
    let raw = tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &image,
            WIDTH,
            HEIGHT,
            timestamp_ms,
            std::slice::from_ref(&subject),
        )
        .expect("point equipment frame");
    assert!(raw.raw_observations.iter().all(|value| value.kind == kind));
    FrameObservations {
        pose_candidates: vec![subject],
        equipment: raw.raw_observations,
    }
}

fn machine_handle_frame(
    tracker: &mut PointEquipmentVisualTracker,
    timestamp_ms: u64,
    elbow_angle_degrees: f32,
    setup_offset_x: f32,
    independent_handles: bool,
) -> FrameObservations {
    const WIDTH: usize = 320;
    const HEIGHT: usize = 240;
    let radians = (180.0 - elbow_angle_degrees).to_radians();
    let mut observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.99); 26];
    let mut centers = Vec::new();
    for (shoulder, elbow, wrist, hip, shoulder_x) in [(5, 7, 9, 11, 0.30), (6, 8, 10, 12, 0.52)] {
        let shoulder_point = [shoulder_x + setup_offset_x, 0.42];
        let elbow_point = [shoulder_point[0] + 0.10, 0.42];
        let wrist_point = [
            elbow_point[0] + radians.cos() * 0.16,
            elbow_point[1] + radians.sin() * 0.16,
        ];
        observations[shoulder] =
            PoseObservation::new(shoulder_point[0], shoulder_point[1], 0.0, 0.99);
        observations[elbow] = PoseObservation::new(elbow_point[0], elbow_point[1], 0.0, 0.99);
        observations[wrist] = PoseObservation::new(wrist_point[0], wrist_point[1], 0.0, 0.99);
        observations[hip] = PoseObservation::new(shoulder_point[0], 0.70, 0.0, 0.99);
        centers.push(wrist_point);
    }
    observations[13] = PoseObservation::new(0.38, 0.82, 0.0, 0.99);
    observations[14] = PoseObservation::new(0.60, 0.82, 0.0, 0.99);
    observations[15] = PoseObservation::new(0.38, 0.95, 0.0, 0.99);
    observations[16] = PoseObservation::new(0.60, 0.95, 0.0, 0.99);
    let subject = PoseCandidate {
        id: 7,
        bbox: NormalizedRect::new(0.08, 0.04, 0.84, 0.94),
        observations,
        torso_color: [0.2, 0.3, 0.4],
    };
    let mut image = vec![28; WIDTH * HEIGHT];
    let draw_centers = if independent_handles {
        centers
    } else {
        vec![[
            centers.iter().map(|point| point[0]).sum::<f32>() / centers.len() as f32,
            centers.iter().map(|point| point[1]).sum::<f32>() / centers.len() as f32,
        ]]
    };
    for center in draw_centers {
        let center_x = (center[0] * WIDTH as f32).round() as isize;
        let center_y = (center[1] * HEIGHT as f32).round() as isize;
        for y in center_y - 7..center_y + 7 {
            for x in center_x - 8..center_x + 8 {
                if x >= 0 && y >= 0 && x < WIDTH as isize && y < HEIGHT as isize {
                    image[y as usize * WIDTH + x as usize] = 224;
                }
            }
        }
    }
    let raw = tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &image,
            WIDTH,
            HEIGHT,
            timestamp_ms,
            std::slice::from_ref(&subject),
        )
        .expect("machine handle frame");
    FrameObservations {
        pose_candidates: vec![subject],
        equipment: raw.raw_observations,
    }
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

fn canonical_packets_from_frames(
    binding: &RigidBarAssessmentProfileBinding,
    sequence_id: &str,
    frames: Vec<FrameObservations>,
    width: u32,
    height: u32,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    let frame_count = frames.len() as u64;
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: sequence_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 11,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: width,
            image_height_px: height,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture {
            frames: frames.into(),
        },
        output.clone(),
    )
    .expect("fixture session");
    session
        .install_exercise_profile_with_action_plan(
            binding.profile.clone(),
            binding.local_coordinate_strategy,
            binding.motion_plan.clone().expect("plan-bound binding"),
        )
        .expect("plan-driven profile");
    session.begin_set().expect("begin set");
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..frame_count {
        session
            .offer(FrameLease::fixture(
                frame_id,
                100 + frame_id * 100,
                Arc::clone(&releases),
            ))
            .expect("fixture frame");
    }
    let packets = output.packets();
    let closure = session.finish_set_for_assessment();
    (packets, closure)
}

fn canonical_packets_for_supported_binding(
    binding: &RigidBarAssessmentProfileBinding,
    sequence_id: &str,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    match binding.local_coordinate_strategy.equipment_mode {
        LocalEquipmentMode::RigidBarAxis => canonical_packets_for_visual_bar(binding, sequence_id),
        LocalEquipmentMode::MovingHandle => {
            let mut tracker = PointEquipmentVisualTracker::new(PointEquipmentMode::MachineHandle);
            tracker
                .process_frame(
                    PoseSchemaId::Halpe26,
                    &vec![28; 320 * 240],
                    320,
                    240,
                    1,
                    &[],
                )
                .expect("machine background");
            let angles = [80.0; 10]
                .into_iter()
                .chain([85.0, 100.0, 120.0, 140.0, 160.0])
                .chain([140.0, 120.0, 100.0, 85.0, 80.0])
                .chain([80.0; 8])
                .collect::<Vec<_>>();
            let frames = angles
                .iter()
                .enumerate()
                .map(|(index, angle)| {
                    machine_handle_frame(
                        &mut tracker,
                        100 + index as u64 * 100,
                        *angle,
                        if index < 3 {
                            index as f32 * 0.008
                        } else {
                            0.024
                        },
                        false,
                    )
                })
                .collect();
            canonical_packets_from_frames(binding, sequence_id, frames, 320, 240)
        }
        LocalEquipmentMode::TwoIndependentDumbbells => {
            let mut tracker = PointEquipmentVisualTracker::new(PointEquipmentMode::Dumbbell);
            tracker
                .process_frame(
                    PoseSchemaId::Halpe26,
                    &vec![28; 320 * 240],
                    320,
                    240,
                    1,
                    &[],
                )
                .expect("dumbbell background");
            let angles = [10.0; 10]
                .into_iter()
                .chain([12.0, 20.0, 35.0, 55.0, 75.0, 95.0])
                .chain([75.0, 55.0, 35.0, 20.0, 12.0, 10.0])
                .chain([10.0; 8])
                .collect::<Vec<_>>();
            let frames = angles
                .iter()
                .enumerate()
                .map(|(index, angle)| {
                    point_equipment_frame(
                        &mut tracker,
                        100 + index as u64 * 100,
                        *angle,
                        if index < 3 {
                            index as f32 * 0.008
                        } else {
                            0.024
                        },
                        EquipmentKind::Dumbbell,
                    )
                })
                .collect();
            canonical_packets_from_frames(binding, sequence_id, frames, 320, 240)
        }
        LocalEquipmentMode::PosePrimaryWithMovingHandle
        | LocalEquipmentMode::PosePrimaryWithIndependentDumbbells
        | LocalEquipmentMode::PoseOnly
        | LocalEquipmentMode::FixedSupport => {
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
                    let progress = if index == 1 {
                        0.04
                    } else {
                        (160.0 - angle) / 80.0
                    };
                    let mut frame = aligned_rigid_bar_frame(*angle, progress);
                    frame.equipment.clear();
                    frame
                })
                .collect();
            canonical_packets_from_frames(binding, sequence_id, frames, 720, 1_280)
        }
    }
}

fn canonical_packets_for_channels(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
    include_equipment: bool,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    canonical_packets_for_source(binding, sequence_id, include_equipment, false)
}

fn canonical_packets_for_visual_bar(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    canonical_packets_for_source(binding, sequence_id, true, true)
}

fn canonical_packets_for_source(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
    include_equipment: bool,
    visual_provider: bool,
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
    let mut visual_tracker = visual_provider.then(BarbellAxisVisualTracker::default);
    if let Some(tracker) = visual_tracker.as_mut() {
        tracker
            .process_frame(
                PoseSchemaId::Halpe26,
                &vec![28; 320 * 240],
                320,
                240,
                1,
                &[],
            )
            .expect("rigid-bar background frame");
    }
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: sequence_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 11,
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
                    // A sub-threshold setup dither proves common hand/bar
                    // motion before the working cycle without becoming a Rep.
                    let setup_progress = if index == 1 { 0.04 } else { *progress };
                    let mut frame = aligned_rigid_bar_frame(*angle, setup_progress);
                    if let Some(tracker) = visual_tracker.as_mut() {
                        frame = rigid_bar_pixels(tracker, 100 + index as u64 * 100, frame);
                    }
                    if !include_equipment && index >= 12 {
                        frame.equipment.clear();
                    }
                    frame
                })
                .collect(),
        },
        output.clone(),
    )
    .expect("motion session");
    if let Some(plan) = binding.motion_plan.clone() {
        session
            .install_exercise_profile_with_action_plan(
                binding.profile.clone(),
                binding.local_coordinate_strategy,
                plan,
            )
            .expect("plan-authorized exact-context profile");
    } else {
        session
            .install_exercise_profile_with_local_strategy(
                binding.profile.clone(),
                binding.local_coordinate_strategy,
            )
            .expect("legacy exact-context profile");
    }
    session.begin_set().expect("begin set");
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
            aligned_rigid_bar_frame(*angle, if index == 1 { 0.04 } else { progress })
        })
        .collect();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: sequence_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 11,
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
        .install_exercise_profile_with_action_plan(
            binding.profile.clone(),
            binding.local_coordinate_strategy,
            binding.motion_plan.clone().expect("plan-bound binding"),
        )
        .expect("plan-bound exact-context profile");
    session.begin_set().expect("begin set");
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

fn governed_evaluation_output_path(
    governance_root: &Path,
    requested_output: &str,
) -> Result<PathBuf, String> {
    let workspace_root = governance_root.join("workspace/visual-recognition-v0.1");
    let canonical_workspace = workspace_root.canonicalize().map_err(|error| {
        format!(
            "governed evaluation workspace {} is unavailable: {error}",
            workspace_root.display()
        )
    })?;
    let requested_path = PathBuf::from(requested_output);
    let requested_path = if requested_path.is_absolute() {
        requested_path
    } else {
        canonical_workspace.join(requested_path)
    };
    if requested_path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err("governed evaluation output must be a JSON file".into());
    }
    if requested_path
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err("governed evaluation output cannot replace a symbolic link".into());
    }
    let file_name = requested_path
        .file_name()
        .ok_or_else(|| "governed evaluation output is missing a file name".to_owned())?;
    let parent = requested_path
        .parent()
        .ok_or_else(|| "governed evaluation output is missing a parent directory".to_owned())?;
    let canonical_parent = parent.canonicalize().map_err(|error| {
        format!(
            "governed evaluation output parent {} must already exist: {error}",
            parent.display()
        )
    })?;
    if !canonical_parent.starts_with(&canonical_workspace) {
        return Err(format!(
            "governed evaluation output must stay under {}",
            canonical_workspace.display()
        ));
    }
    Ok(canonical_parent.join(file_name))
}

#[test]
#[cfg(unix)]
fn governed_evaluation_output_is_confined_and_rejects_symlink_escape() {
    use std::os::unix::fs::symlink;
    use std::time::{SystemTime, UNIX_EPOCH};

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    let fixture_root = std::env::temp_dir().join(format!(
        "maxpower-governed-output-boundary-{}-{nonce}",
        std::process::id()
    ));
    let governance_root = fixture_root.join("governance");
    let workspace_root = governance_root.join("workspace/visual-recognition-v0.1");
    let outside_root = fixture_root.join("outside");
    std::fs::create_dir_all(&workspace_root).expect("fixture governed workspace");
    std::fs::create_dir_all(&outside_root).expect("fixture outside directory");

    let valid = governed_evaluation_output_path(&governance_root, "accepted.json")
        .expect("workspace-relative output");
    assert!(valid.starts_with(workspace_root.canonicalize().expect("workspace")));
    assert!(
        governed_evaluation_output_path(
            &governance_root,
            outside_root
                .join("escaped.json")
                .to_str()
                .expect("UTF-8 path")
        )
        .is_err()
    );

    symlink(&outside_root, workspace_root.join("escape")).expect("directory symlink fixture");
    assert!(governed_evaluation_output_path(&governance_root, "escape/escaped.json").is_err());
    let outside_file = outside_root.join("outside.json");
    std::fs::write(&outside_file, b"{}").expect("outside fixture file");
    symlink(&outside_file, workspace_root.join("linked.json")).expect("file symlink fixture");
    assert!(governed_evaluation_output_path(&governance_root, "linked.json").is_err());

    std::fs::remove_dir_all(&fixture_root).expect("remove isolated output-boundary fixture");
}

fn governed_replay_source_bundle_sha256(root: &Path) -> String {
    fn collect_rust_sources(directory: &Path, files: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(directory).expect("read Rust source directory") {
            let path = entry.expect("Rust source entry").path();
            if path.is_dir() {
                collect_rust_sources(&path, files);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                files.push(path);
            }
        }
    }

    let mut files = vec![
        root.join("Cargo.lock"),
        root.join("rust/motion-sdk/Cargo.toml"),
        root.join("rust/motion-sdk/assets/action-motion-catalog-v1.json"),
        root.join("rust/motion-sdk/tests/execution_assessment_rigid_bar_family_contract.rs"),
    ];
    collect_rust_sources(&root.join("rust/motion-sdk/src"), &mut files);
    files.sort();
    files.dedup();
    let mut bytes = Vec::new();
    for path in files {
        let relative = path
            .strip_prefix(root)
            .expect("source belongs to MaxPower root");
        bytes.extend_from_slice(relative.to_string_lossy().as_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&std::fs::read(&path).expect("governed replay source bytes"));
        bytes.push(0xff);
    }
    sha256_bytes(&bytes)
}

fn stable_fnv_hash<T: serde::Serialize>(value: &T) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in serde_json::to_vec(value).expect("trace is JSON serializable") {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[test]
fn frozen_rust_evaluation_metrics_resolve_to_governed_immutable_evidence() {
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
    let manifest: serde_json::Value = serde_json::from_slice(include_bytes!(
        "fixtures/current_rust_evaluation_evidence_manifest_v1.json"
    ))
    .expect("evaluation evidence manifest");
    let assembled = &manifest["assembledInput"];
    assert_eq!(
        sha256_bytes(&serde_json::to_vec(assembled).expect("stable manifest input")),
        manifest["assembledInputSha256"]
    );
    let catalog_assets = governance["assets"].as_array().expect("assets");
    for expected in assembled["sourceAssets"].as_array().expect("source assets") {
        let governed = catalog_assets
            .iter()
            .find(|asset| asset["id"] == expected["assetId"])
            .expect("manifest asset resolves in governance catalog");
        assert_eq!(governed["admission"], expected["admission"]);
        assert_eq!(governed["authority"], expected["authority"]);
        assert_eq!(governed["groupKey"], expected["groupKey"]);
        let allowed_tasks = governed["allowedTasks"].as_array().expect("allowed tasks");
        let target_tasks = assembled["targetTasks"].as_array().expect("target tasks");
        assert!(
            expected["consumedForTasks"]
                .as_array()
                .expect("consumed tasks")
                .iter()
                .all(|task| allowed_tasks.contains(task) && target_tasks.contains(task)),
            "every consumed task must be admitted by governance"
        );
        assert!(
            !expected["selectedFields"]
                .as_array()
                .expect("selected fields")
                .is_empty(),
            "every source must declare the exact consumed fields"
        );
        if expected["assetId"] == "personal-human-rep-ranges-v2" {
            let allowed_fields = governed["allowedSupervision"]
                .as_array()
                .expect("allowed label fields");
            assert!(
                expected["selectedFields"]
                    .as_array()
                    .expect("selected label fields")
                    .iter()
                    .all(|field| field == "sourceCaptureId" || allowed_fields.contains(field)),
                "evaluation must not consume undeclared label supervision"
            );
        }
    }
    let evaluation_asset = catalog_assets
        .iter()
        .find(|asset| asset["id"] == "client-single-pass-predictions-and-agent-output")
        .expect("evaluation asset");
    assert!(
        evaluation_asset["allowedTasks"]
            .as_array()
            .is_some_and(|tasks| tasks.iter().any(|task| task == "model_evaluation"))
    );
    let label_asset = catalog_assets
        .iter()
        .find(|asset| asset["id"] == "personal-human-rep-ranges-v2")
        .expect("label asset");
    let manifest_label = assembled["sourceAssets"]
        .as_array()
        .expect("source assets")
        .iter()
        .find(|asset| asset["assetId"] == "personal-human-rep-ranges-v2")
        .expect("manifest label asset");
    assert_eq!(
        label_asset["location"]["sha256"],
        manifest_label["immutableSha256"]
    );
    let label_bytes = std::fs::read(
        root.join(
            label_asset["location"]["path"]
                .as_str()
                .expect("label asset path"),
        ),
    )
    .expect("immutable label file");
    assert_eq!(
        sha256_bytes(&label_bytes),
        manifest_label["immutableSha256"]
    );
    let output_path = assembled["evaluationOutput"]["path"]
        .as_str()
        .expect("evaluation output path");
    assert!(
        output_path.starts_with(
            evaluation_asset["location"]["path"]
                .as_str()
                .expect("evaluation asset directory")
        )
    );
    let output_bytes = std::fs::read(root.join(output_path)).expect("frozen evaluation output");
    assert_eq!(
        sha256_bytes(&output_bytes),
        assembled["evaluationOutput"]["sha256"]
    );
    let output: serde_json::Value =
        serde_json::from_slice(&output_bytes).expect("frozen evaluation JSON");
    assert_eq!(
        output["schemaVersion"],
        assembled["evaluationOutput"]["schemaVersion"]
    );
    assert_eq!(
        output["generatedAt"],
        assembled["evaluationOutput"]["generatedAt"]
    );
    for key in [
        "visualRuntime",
        "motionRuntime",
        "pass",
        "truthReveal",
        "predictionSha256",
        "datasetSha256",
    ] {
        assert_eq!(output["protocol"][key], assembled["protocol"][key]);
    }
    for key in [
        "visualRuntime",
        "motionRuntime",
        "pass",
        "truthReveal",
        "predictionSha256",
    ] {
        assert_eq!(
            assembled["modelConfiguration"][key],
            assembled["protocol"][key]
        );
    }
    let exclusion_bytes = std::fs::read(
        governance_root.join(
            assembled["exclusions"]["path"]
                .as_str()
                .expect("exclusions path"),
        ),
    )
    .expect("governance exclusions");
    assert_eq!(
        sha256_bytes(&exclusion_bytes),
        assembled["exclusions"]["sha256"]
    );
    let exclusions: serde_json::Value =
        serde_json::from_slice(&exclusion_bytes).expect("exclusions JSON");
    let source_groups = assembled["sourceGroups"].as_array().expect("source groups");
    assert_eq!(
        source_groups.len(),
        output["rows"].as_array().expect("rows").len()
    );
    for row in output["rows"].as_array().expect("rows") {
        let capture_id = &row["captureId"];
        assert!(source_groups.iter().any(|group| {
            group["sourceCaptureId"] == *capture_id
                && group["splitId"] == "frozen-client-observation-debug-evaluation"
        }));
        assert!(
            !exclusions["recordExclusions"]
                .as_array()
                .expect("record exclusions")
                .iter()
                .any(|excluded| {
                    excluded["sourceCaptureId"] == *capture_id && excluded["repIndex"].is_null()
                })
        );
    }
    for key in [
        "sourceCount",
        "truthRepCount",
        "confirmedPredictedRepCount",
        "matchedRepCount",
        "candidatePrecision",
        "candidateRecall",
        "exactSetSourceRate",
    ] {
        assert_eq!(
            output["aggregate"][key].as_f64(),
            assembled["frozenResult"][key].as_f64()
        );
    }
    let matches = output["rows"]
        .as_array()
        .expect("evaluation rows")
        .iter()
        .flat_map(|row| {
            row["confirmedEvaluation"]["matches"]
                .as_array()
                .expect("confirmed matches")
        })
        .collect::<Vec<_>>();
    let mean_absolute = |field: &str| {
        matches
            .iter()
            .map(|entry| entry[field].as_f64().expect("boundary offset").abs())
            .sum::<f64>()
            / matches.len() as f64
    };
    assert!(
        (mean_absolute("startOffsetMs")
            - assembled["frozenResult"]["startBoundaryMaeMs"]
                .as_f64()
                .expect("start MAE"))
        .abs()
            < 1e-9
    );
    assert!(
        (mean_absolute("endOffsetMs")
            - assembled["frozenResult"]["endBoundaryMaeMs"]
                .as_f64()
                .expect("end MAE"))
        .abs()
            < 1e-9
    );
    assert!(assembled["frozenResult"]["reviewedNegativeWindowFalseTriggerRate"].is_null());
}

const EVALUATION_CANDIDATE_MINIMUM_INTERVAL_IOU: f64 = 0.10;
const EVALUATION_CANDIDATE_BOUNDARY_TOLERANCE_MS: i64 = 1_500;
const EVALUATION_STRICT_MINIMUM_INTERVAL_IOU: f64 = 0.60;
const EVALUATION_STRICT_BOUNDARY_TOLERANCE_MS: i64 = 500;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationRange {
    start_ms: u64,
    end_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationPredictionRep {
    rep_id: u64,
    disposition: String,
    evidence_reason: Option<String>,
    start_ms: u64,
    turnaround_ms: u64,
    turnaround_source: String,
    end_ms: u64,
    canonical_slice_hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GovernedPredictionRow {
    source_capture_id: String,
    context_id: String,
    exercise_id: String,
    capture_position: String,
    bundle_id: String,
    bundle_hash: String,
    trace_content_hash: String,
    trace_root_count: usize,
    equipment_provider: EquipmentProviderEvaluation,
    reps: Vec<EvaluationPredictionRep>,
    quality_finding_states: Vec<String>,
    typed_refusal_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationMatch {
    truth_index: usize,
    predicted_index: usize,
    start_error_ms: i64,
    end_error_ms: i64,
    interval_iou: f64,
    strict_boundary_aligned: bool,
}

#[derive(Clone, Debug)]
struct AlignmentSolution {
    matches: Vec<EvaluationMatch>,
    total_iou: f64,
    total_boundary_error_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluatedReplayRow {
    source_capture_id: String,
    context_id: String,
    exercise_id: String,
    capture_position: String,
    bundle_id: String,
    bundle_hash: String,
    trace_content_hash: String,
    trace_root_count: usize,
    equipment_provider: EquipmentProviderEvaluation,
    truth_ranges: Vec<EvaluationRange>,
    raw_proposals: Vec<EvaluationPredictionRep>,
    raw_proposal_matches: Vec<EvaluationMatch>,
    raw_proposal_negative_window_false_trigger_count: usize,
    confirmed_only_reps: Vec<EvaluationPredictionRep>,
    confirmed_only_matches: Vec<EvaluationMatch>,
    confirmed_only_negative_window_false_trigger_count: usize,
    predicted_reps: Vec<EvaluationPredictionRep>,
    rejected_proposals: Vec<EvaluationPredictionRep>,
    rejected_truth_overlaps: Vec<EvaluationMatch>,
    rejected_negative_window_false_trigger_count: usize,
    truth_count: usize,
    predicted_count: usize,
    matched_count: usize,
    false_positive_count: usize,
    missed_count: usize,
    exact_set: bool,
    strict_boundary_aligned_count: usize,
    exact_set_and_all_boundaries_aligned: bool,
    reviewed_negative_window_false_trigger_count: usize,
    matches: Vec<EvaluationMatch>,
    quality_finding_states: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct EquipmentProviderEvaluation {
    recognition_mode: String,
    source_asset_id: Option<String>,
    pose_input_frame_count: usize,
    pose_input_rate_hz: f64,
    decoded_frame_count: usize,
    visual_processed_frame_count: usize,
    visual_processing_rate_hz: f64,
    tracker_output_frame_count: usize,
    tracker_output_rate_hz: f64,
    canonical_observation_frame_count: usize,
    measured_frame_count: usize,
    predicted_frame_count: usize,
    pose_fused_frame_count: usize,
    frames: Vec<EquipmentFramePrediction>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EquipmentFramePrediction {
    frame_number: u64,
    timestamp_ms: u64,
    source: String,
    confidence: f32,
    uncertainty_px: f32,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    center_y: f32,
    provider_accepted: bool,
    canonical_accepted: bool,
    fusion_eligible: bool,
}

fn governed_pose_candidates(frame: &serde_json::Value) -> Vec<PoseCandidate> {
    let Some(landmarks) = frame["landmarks"]
        .as_array()
        .filter(|landmarks| landmarks.len() == 26)
    else {
        return Vec::new();
    };
    let bbox = &frame["selectedBbox"];
    let Some((((x, y), width), height)) = bbox["x"]
        .as_f64()
        .zip(bbox["y"].as_f64())
        .zip(bbox["width"].as_f64())
        .zip(bbox["height"].as_f64())
    else {
        return Vec::new();
    };
    let observations = landmarks
        .iter()
        .map(|landmark| {
            Some(PoseObservation::new(
                landmark["x"].as_f64()? as f32,
                landmark["y"].as_f64()? as f32,
                landmark["z"].as_f64().unwrap_or(0.0) as f32,
                landmark["visibility"].as_f64()? as f32,
            ))
        })
        .collect::<Option<Vec<_>>>();
    observations.map_or_else(Vec::new, |observations| {
        vec![PoseCandidate {
            id: 7,
            bbox: NormalizedRect::new(x as f32, y as f32, width as f32, height as f32),
            observations,
            torso_color: [0.2, 0.3, 0.4],
        }]
    })
}

fn governed_frames_with_equipment_provider(
    raw: &serde_json::Value,
    provider_id: Option<EquipmentProviderId>,
    video_path: Option<&Path>,
) -> (
    VecDeque<FrameObservations>,
    Vec<u64>,
    Vec<u64>,
    EquipmentProviderEvaluation,
) {
    let raw_frames = raw["frames"].as_array().expect("pose frames");
    let duration_seconds = raw["source"]["durationMs"]
        .as_f64()
        .expect("source duration")
        / 1_000.0;
    let mut evaluation = EquipmentProviderEvaluation {
        recognition_mode: format!("{provider_id:?}"),
        source_asset_id: video_path.map(|_| "personal-raw-capture-archive".into()),
        pose_input_frame_count: raw_frames.len(),
        pose_input_rate_hz: raw_frames.len() as f64 / duration_seconds,
        ..EquipmentProviderEvaluation::default()
    };
    if provider_id.is_none() {
        let mut frame_ids = Vec::with_capacity(raw_frames.len());
        let mut timestamps = Vec::with_capacity(raw_frames.len());
        let mut frames = VecDeque::with_capacity(raw_frames.len());
        for frame in raw_frames {
            frame_ids.push(frame["frameNumber"].as_u64().expect("frame number"));
            timestamps.push(frame["timestampMs"].as_f64().expect("timestamp").round() as u64);
            frames.push_back(FrameObservations {
                pose_candidates: governed_pose_candidates(frame),
                equipment: Vec::new(),
            });
        }
        return (frames, frame_ids, timestamps, evaluation);
    }

    let video_path = video_path.expect("the frozen rigid-bar source video");
    let source_width = raw["source"]["widthPx"].as_u64().expect("pose width") as usize;
    let source_height = raw["source"]["heightPx"].as_u64().expect("pose height") as usize;
    let width = 360_usize.min(source_width);
    let height = ((source_height * width / source_width + 1) / 2) * 2;
    let last_frame_id = raw_frames
        .last()
        .and_then(|frame| frame["frameNumber"].as_u64())
        .expect("last governed frame");
    let video_timestamps = governed_video_frame_timestamps_ms(video_path);
    assert!(
        video_timestamps.len() > last_frame_id as usize,
        "video timestamps end before governed pose frames"
    );
    let frame_limit = last_frame_id.saturating_add(1).to_string();
    let mut child = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(video_path)
        .args([
            "-an",
            "-vf",
            &format!("scale={width}:{height}"),
            "-pix_fmt",
            "gray",
            "-frames:v",
            &frame_limit,
            "-f",
            "rawvideo",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("decode {}: {error}", video_path.display()));
    let mut stdout = child.stdout.take().expect("ffmpeg stdout");
    let mut pixels = vec![0_u8; width * height];
    let mut tracker = BarbellAxisVisualTracker::default();
    let mut pose_index = 0_usize;
    let mut latest_pose = Vec::<PoseCandidate>::new();
    let mut latest_pose_timestamp_ms = 0_u64;
    let mut previous_published_timestamp_ms = None::<u64>;
    let mut latest_axis = None;
    let mut latest_axis_timestamp_ms = 0_u64;
    let mut frame_ids = Vec::with_capacity(raw_frames.len());
    let mut timestamps = Vec::with_capacity(raw_frames.len());
    let mut frames = VecDeque::with_capacity(raw_frames.len());
    for frame_id in 0..=last_frame_id {
        stdout
            .read_exact(&mut pixels)
            .unwrap_or_else(|error| panic!("video ended before frame {frame_id}: {error}"));
        evaluation.decoded_frame_count += 1;
        let video_timestamp_ms = video_timestamps[frame_id as usize];
        let pose_frame = raw_frames
            .get(pose_index)
            .filter(|frame| frame["frameNumber"].as_u64().expect("pose frame number") == frame_id);
        let pose_candidates = pose_frame.map_or_else(Vec::new, governed_pose_candidates);
        if pose_frame.is_some() {
            latest_pose.clone_from(&pose_candidates);
            latest_pose_timestamp_ms = pose_frame
                .and_then(|frame| frame["timestampMs"].as_f64())
                .expect("pose timestamp")
                .round() as u64;
            pose_index += 1;
        }
        let axis = if previous_published_timestamp_ms
            .is_some_and(|previous| video_timestamp_ms <= previous)
        {
            None
        } else {
            previous_published_timestamp_ms = Some(video_timestamp_ms);
            evaluation.visual_processed_frame_count += 1;
            let tracker_pose = if video_timestamp_ms.saturating_sub(latest_pose_timestamp_ms) <= 180
            {
                latest_pose.as_slice()
            } else {
                &[]
            };
            tracker
                .process(
                    PoseSchemaId::Halpe26,
                    &pixels,
                    width,
                    height,
                    video_timestamp_ms,
                    tracker_pose,
                )
                .expect("Halpe26 multi-rate visual equipment provider")
        };
        if let Some(axis) = axis {
            latest_axis = Some(axis);
            latest_axis_timestamp_ms = video_timestamp_ms;
            evaluation.tracker_output_frame_count += 1;
            match axis.source {
                BarbellAxisSource::Measured => {
                    evaluation.measured_frame_count += 1;
                    evaluation.canonical_observation_frame_count += 1;
                }
                BarbellAxisSource::Predicted => {
                    evaluation.predicted_frame_count += 1;
                    evaluation.canonical_observation_frame_count += 1;
                }
                BarbellAxisSource::Fused => evaluation.pose_fused_frame_count += 1,
            }
            evaluation.frames.push(EquipmentFramePrediction {
                frame_number: frame_id,
                timestamp_ms: video_timestamp_ms,
                source: format!("{:?}", axis.source),
                confidence: axis.confidence,
                uncertainty_px: axis.uncertainty_px,
                x1: axis.x1,
                y1: axis.y1,
                x2: axis.x2,
                y2: axis.y2,
                center_y: axis.center_y,
                provider_accepted: true,
                canonical_accepted: false,
                fusion_eligible: false,
            });
        }
        if let Some(pose_frame) = pose_frame {
            let pose_timestamp_ms = pose_frame["timestampMs"]
                .as_f64()
                .expect("pose timestamp")
                .round() as u64;
            let equipment = axis
                .or_else(|| {
                    (pose_timestamp_ms.saturating_sub(latest_axis_timestamp_ms) <= 180)
                        .then_some(latest_axis)
                        .flatten()
                })
                .and_then(|axis| axis.equipment_observation())
                .into_iter()
                .collect();
            frame_ids.push(frame_id);
            timestamps.push(pose_timestamp_ms);
            frames.push_back(FrameObservations {
                pose_candidates,
                equipment,
            });
        }
    }
    drop(stdout);
    let status = child.wait().expect("wait for video decoder");
    assert!(status.success(), "video decoder failed: {status}");
    assert_eq!(
        pose_index,
        raw_frames.len(),
        "every pose frame must be consumed"
    );
    evaluation.visual_processing_rate_hz =
        evaluation.visual_processed_frame_count as f64 / duration_seconds;
    evaluation.tracker_output_rate_hz =
        evaluation.tracker_output_frame_count as f64 / duration_seconds;
    (frames, frame_ids, timestamps, evaluation)
}

fn governed_video_frame_timestamps_ms(video_path: &Path) -> Vec<u64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "frame=best_effort_timestamp_time",
            "-of",
            "csv=p=0",
        ])
        .arg(video_path)
        .output()
        .unwrap_or_else(|error| panic!("inspect {} timestamps: {error}", video_path.display()));
    assert!(output.status.success(), "video timestamp inspection failed");
    let timestamps = String::from_utf8(output.stdout)
        .expect("UTF-8 video timestamps")
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            (line.trim().parse::<f64>().expect("finite video timestamp") * 1_000.0).round() as u64
        })
        .collect::<Vec<_>>();
    timestamps
}

#[test]
#[ignore = "requires governed local-private Halpe26 observation and raw video assets"]
fn governed_barbell_row_multirate_provider_processes_video_cadence_without_pose_duplication() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let capture_id = "field-capture-2026-08-02T18-26-54-722Z";
    let raw = read_governed_gzip_json(&root.join(format!(
        "data/workflows/action-trajectory-database/halpe26-v1/personal-observations/{capture_id}.halpe26.json.gz"
    )));
    let video = root.join(format!(
        "public/archives/confirmed-captures/{capture_id}.webm"
    ));
    let (frames, frame_ids, timestamps, evaluation) = governed_frames_with_equipment_provider(
        &raw,
        Some(EquipmentProviderId::VisualRigidBarAxisV1),
        Some(&video),
    );
    assert!(timestamps.windows(2).all(|pair| pair[1] > pair[0]));
    assert!(frame_ids.windows(2).all(|pair| pair[1] > pair[0]));
    let published_pose_frames = frames
        .iter()
        .filter(|frame| !frame.pose_candidates.is_empty())
        .count();
    assert!(
        published_pose_frames <= evaluation.pose_input_frame_count,
        "intermediate equipment frames must not duplicate pose observations"
    );
    assert!(evaluation.visual_processing_rate_hz >= 20.0);
    assert!(evaluation.tracker_output_rate_hz >= 15.0);
    eprintln!(
        "target multi-rate provider: pose={:.1}Hz visual={:.1}Hz tracker={:.1}Hz decoded={} processed={} outputs={}",
        evaluation.pose_input_rate_hz,
        evaluation.visual_processing_rate_hz,
        evaluation.tracker_output_rate_hz,
        evaluation.decoded_frame_count,
        evaluation.visual_processed_frame_count,
        evaluation.tracker_output_frame_count,
    );
}

fn evaluation_interval_iou(left: &EvaluationRange, right: &EvaluationRange) -> f64 {
    let intersection = left
        .end_ms
        .min(right.end_ms)
        .saturating_sub(left.start_ms.max(right.start_ms));
    let union = left.end_ms.max(right.end_ms) - left.start_ms.min(right.start_ms);
    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

fn better_alignment(left: AlignmentSolution, right: AlignmentSolution) -> AlignmentSolution {
    if left.matches.len() != right.matches.len() {
        return if left.matches.len() > right.matches.len() {
            left
        } else {
            right
        };
    }
    if (left.total_iou - right.total_iou).abs() > 1e-12 {
        return if left.total_iou > right.total_iou {
            left
        } else {
            right
        };
    }
    if left.total_boundary_error_ms <= right.total_boundary_error_ms {
        left
    } else {
        right
    }
}

fn monotonic_evaluation_matches(
    truth: &[EvaluationRange],
    predicted: &[EvaluationRange],
) -> Vec<EvaluationMatch> {
    fn solve(
        truth: &[EvaluationRange],
        predicted: &[EvaluationRange],
        truth_index: usize,
        predicted_index: usize,
        memo: &mut BTreeMap<(usize, usize), AlignmentSolution>,
    ) -> AlignmentSolution {
        if let Some(cached) = memo.get(&(truth_index, predicted_index)) {
            return cached.clone();
        }
        if truth_index >= truth.len() || predicted_index >= predicted.len() {
            return AlignmentSolution {
                matches: Vec::new(),
                total_iou: 0.0,
                total_boundary_error_ms: 0,
            };
        }
        let mut best = better_alignment(
            solve(truth, predicted, truth_index + 1, predicted_index, memo),
            solve(truth, predicted, truth_index, predicted_index + 1, memo),
        );
        let expected = &truth[truth_index];
        let actual = &predicted[predicted_index];
        let interval_iou = evaluation_interval_iou(expected, actual);
        let start_error_ms = actual.start_ms as i64 - expected.start_ms as i64;
        let end_error_ms = actual.end_ms as i64 - expected.end_ms as i64;
        let within_candidate_boundary_tolerance = start_error_ms.abs()
            <= EVALUATION_CANDIDATE_BOUNDARY_TOLERANCE_MS
            && end_error_ms.abs() <= EVALUATION_CANDIDATE_BOUNDARY_TOLERANCE_MS;
        if interval_iou >= EVALUATION_CANDIDATE_MINIMUM_INTERVAL_IOU
            || within_candidate_boundary_tolerance
        {
            let remainder = solve(truth, predicted, truth_index + 1, predicted_index + 1, memo);
            let strict_boundary_aligned = interval_iou >= EVALUATION_STRICT_MINIMUM_INTERVAL_IOU
                && start_error_ms.abs() <= EVALUATION_STRICT_BOUNDARY_TOLERANCE_MS
                && end_error_ms.abs() <= EVALUATION_STRICT_BOUNDARY_TOLERANCE_MS;
            let boundary_error = start_error_ms.unsigned_abs() + end_error_ms.unsigned_abs();
            let mut matches = Vec::with_capacity(remainder.matches.len() + 1);
            matches.push(EvaluationMatch {
                truth_index,
                predicted_index,
                start_error_ms,
                end_error_ms,
                interval_iou,
                strict_boundary_aligned,
            });
            matches.extend(remainder.matches);
            best = better_alignment(
                best,
                AlignmentSolution {
                    matches,
                    total_iou: interval_iou + remainder.total_iou,
                    total_boundary_error_ms: boundary_error + remainder.total_boundary_error_ms,
                },
            );
        }
        memo.insert((truth_index, predicted_index), best.clone());
        best
    }

    solve(truth, predicted, 0, 0, &mut BTreeMap::new()).matches
}

#[derive(Clone, Copy)]
enum EvaluationStreamKind {
    RawProposal,
    ConfirmedOnly,
    ConfirmedPlusNeedsReview,
    RejectedDiagnostic,
}

fn evaluation_stream_summary(
    rows: &[EvaluatedReplayRow],
    kind: EvaluationStreamKind,
) -> serde_json::Value {
    let truth_count = rows.iter().map(|row| row.truth_count).sum::<usize>();
    let predicted_count = rows
        .iter()
        .map(|row| match kind {
            EvaluationStreamKind::RawProposal => row.raw_proposals.len(),
            EvaluationStreamKind::ConfirmedOnly => row.confirmed_only_reps.len(),
            EvaluationStreamKind::ConfirmedPlusNeedsReview => row.predicted_reps.len(),
            EvaluationStreamKind::RejectedDiagnostic => row.rejected_proposals.len(),
        })
        .sum::<usize>();
    let matches = rows
        .iter()
        .flat_map(|row| match kind {
            EvaluationStreamKind::RawProposal => row.raw_proposal_matches.iter(),
            EvaluationStreamKind::ConfirmedOnly => row.confirmed_only_matches.iter(),
            EvaluationStreamKind::ConfirmedPlusNeedsReview => row.matches.iter(),
            EvaluationStreamKind::RejectedDiagnostic => row.rejected_truth_overlaps.iter(),
        })
        .collect::<Vec<_>>();
    let negative_false_triggers = rows
        .iter()
        .map(|row| match kind {
            EvaluationStreamKind::RawProposal => {
                row.raw_proposal_negative_window_false_trigger_count
            }
            EvaluationStreamKind::ConfirmedOnly => {
                row.confirmed_only_negative_window_false_trigger_count
            }
            EvaluationStreamKind::ConfirmedPlusNeedsReview => {
                row.reviewed_negative_window_false_trigger_count
            }
            EvaluationStreamKind::RejectedDiagnostic => {
                row.rejected_negative_window_false_trigger_count
            }
        })
        .sum::<usize>();
    let mean = |values: Vec<f64>| {
        if values.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::json!(values.iter().sum::<f64>() / values.len() as f64)
        }
    };
    let percentile_95 = |mut values: Vec<f64>| {
        if values.is_empty() {
            serde_json::Value::Null
        } else {
            values.sort_by(f64::total_cmp);
            let index = ((values.len() as f64 * 0.95).ceil() as usize)
                .saturating_sub(1)
                .min(values.len() - 1);
            serde_json::json!(values[index])
        }
    };
    let ratio = |numerator: usize, denominator: usize| {
        if denominator == 0 {
            serde_json::Value::Null
        } else {
            serde_json::json!(numerator as f64 / denominator as f64)
        }
    };
    let candidate_truth_matches = rows
        .iter()
        .flat_map(|row| {
            let matches = match kind {
                EvaluationStreamKind::RawProposal => &row.raw_proposal_matches,
                EvaluationStreamKind::ConfirmedOnly => &row.confirmed_only_matches,
                EvaluationStreamKind::ConfirmedPlusNeedsReview => &row.matches,
                EvaluationStreamKind::RejectedDiagnostic => &row.rejected_truth_overlaps,
            };
            matches.iter().map(|matched| {
                serde_json::json!({
                    "contextId": row.context_id,
                    "truthIndex": matched.truth_index,
                    "predictedIndex": matched.predicted_index,
                    "startErrorMs": matched.start_error_ms,
                    "endErrorMs": matched.end_error_ms,
                    "intervalIoU": matched.interval_iou,
                    "strictBoundaryAligned": matched.strict_boundary_aligned,
                })
            })
        })
        .collect::<Vec<_>>();
    let start_errors = matches
        .iter()
        .map(|entry| entry.start_error_ms.unsigned_abs() as f64)
        .collect::<Vec<_>>();
    let end_errors = matches
        .iter()
        .map(|entry| entry.end_error_ms.unsigned_abs() as f64)
        .collect::<Vec<_>>();
    let interval_ious = matches
        .iter()
        .map(|entry| entry.interval_iou)
        .collect::<Vec<_>>();
    serde_json::json!({
        "predicted": predicted_count,
        "matched": matches.len(),
        "falsePositive": predicted_count.saturating_sub(matches.len()),
        "falseNegative": truth_count.saturating_sub(matches.len()),
        "precision": ratio(matches.len(), predicted_count),
        "recall": ratio(matches.len(), truth_count),
        "candidateTruthMatches": candidate_truth_matches,
        "boundaryMetrics": {
            "startMaeMs": mean(start_errors.clone()),
            "startP95Ms": percentile_95(start_errors),
            "turnaroundMaeMs": serde_json::Value::Null,
            "turnaroundP95Ms": serde_json::Value::Null,
            "turnaroundStatus": "not_evaluable_no_human_turnaround_truth",
            "endMaeMs": mean(end_errors.clone()),
            "endP95Ms": percentile_95(end_errors),
            "meanIntervalIoU": mean(interval_ious.clone()),
            "intervalIoUP95": percentile_95(interval_ious),
        },
        "negativeWindowFalseTriggers": negative_false_triggers,
        "diagnosticOnly": matches!(kind, EvaluationStreamKind::RejectedDiagnostic),
    })
}

fn evaluation_summary(rows: &[EvaluatedReplayRow]) -> serde_json::Value {
    let truth_count = rows.iter().map(|row| row.truth_count).sum::<usize>();
    let predicted_count = rows.iter().map(|row| row.predicted_count).sum::<usize>();
    let matched_count = rows.iter().map(|row| row.matched_count).sum::<usize>();
    let strict_boundary_aligned_count = rows
        .iter()
        .map(|row| row.strict_boundary_aligned_count)
        .sum::<usize>();
    let negative_false_triggers = rows
        .iter()
        .map(|row| row.reviewed_negative_window_false_trigger_count)
        .sum::<usize>();
    let matches = rows
        .iter()
        .flat_map(|row| row.matches.iter())
        .collect::<Vec<_>>();
    let mean = |values: Vec<f64>| {
        if values.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::json!(values.iter().sum::<f64>() / values.len() as f64)
        }
    };
    let ratio = |numerator: usize, denominator: usize| {
        if denominator == 0 {
            serde_json::Value::Null
        } else {
            serde_json::json!(numerator as f64 / denominator as f64)
        }
    };
    let percentile_95 = |mut values: Vec<f64>| {
        if values.is_empty() {
            serde_json::Value::Null
        } else {
            values.sort_by(f64::total_cmp);
            let index = ((values.len() as f64 * 0.95).ceil() as usize)
                .saturating_sub(1)
                .min(values.len() - 1);
            serde_json::json!(values[index])
        }
    };
    let raw_proposal_count = rows
        .iter()
        .map(|row| row.raw_proposals.len())
        .sum::<usize>();
    let confirmed_count = rows
        .iter()
        .flat_map(|row| &row.raw_proposals)
        .filter(|rep| rep.disposition == "confirmed")
        .count();
    let needs_review_count = rows
        .iter()
        .flat_map(|row| &row.raw_proposals)
        .filter(|rep| rep.disposition == "needs_review")
        .count();
    let rejected_count = rows
        .iter()
        .flat_map(|row| &row.raw_proposals)
        .filter(|rep| rep.disposition == "rejected")
        .count();
    let mut rejection_reasons = BTreeMap::<String, usize>::new();
    for reason in rows
        .iter()
        .flat_map(|row| &row.raw_proposals)
        .filter(|rep| rep.disposition == "rejected")
        .map(|rep| {
            rep.evidence_reason
                .clone()
                .unwrap_or_else(|| "unclassified_rejection".into())
        })
    {
        *rejection_reasons.entry(reason).or_default() += 1;
    }
    let candidate_truth_matches = rows
        .iter()
        .flat_map(|row| {
            row.matches.iter().map(|matched| {
                serde_json::json!({
                    "contextId": row.context_id,
                    "truthIndex": matched.truth_index,
                    "predictedIndex": matched.predicted_index,
                    "startErrorMs": matched.start_error_ms,
                    "endErrorMs": matched.end_error_ms,
                    "intervalIoU": matched.interval_iou,
                    "strictBoundaryAligned": matched.strict_boundary_aligned,
                })
            })
        })
        .collect::<Vec<_>>();
    let start_errors = matches
        .iter()
        .map(|entry| entry.start_error_ms.unsigned_abs() as f64)
        .collect::<Vec<_>>();
    let end_errors = matches
        .iter()
        .map(|entry| entry.end_error_ms.unsigned_abs() as f64)
        .collect::<Vec<_>>();
    let interval_ious = matches
        .iter()
        .map(|entry| entry.interval_iou)
        .collect::<Vec<_>>();
    let raw_stream = evaluation_stream_summary(rows, EvaluationStreamKind::RawProposal);
    let confirmed_stream = evaluation_stream_summary(rows, EvaluationStreamKind::ConfirmedOnly);
    let formal_stream =
        evaluation_stream_summary(rows, EvaluationStreamKind::ConfirmedPlusNeedsReview);
    let rejected_stream = evaluation_stream_summary(rows, EvaluationStreamKind::RejectedDiagnostic);
    let recognition_funnel = serde_json::json!({
        "schemaVersion": "maxpower.visual-recognition-funnel/v2",
        "rawProposal": raw_proposal_count,
        "confirmedOnly": confirmed_count,
        "confirmedPlusNeedsReview": confirmed_count + needs_review_count,
        "rejected": rejected_count,
        "rejectionReasons": rejection_reasons,
        "candidateTruthMatches": candidate_truth_matches,
        "falsePositive": predicted_count.saturating_sub(matched_count),
        "falseNegative": truth_count.saturating_sub(matched_count),
        "boundaryMetrics": {
            "startMaeMs": mean(start_errors.clone()),
            "startP95Ms": percentile_95(start_errors),
            "turnaroundMaeMs": serde_json::Value::Null,
            "turnaroundP95Ms": serde_json::Value::Null,
            "turnaroundStatus": "not_evaluable_no_human_turnaround_truth",
            "endMaeMs": mean(end_errors.clone()),
            "endP95Ms": percentile_95(end_errors),
            "meanIntervalIoU": mean(interval_ious.clone()),
            "intervalIoUP95": percentile_95(interval_ious),
        },
        "negativeWindowFalseTriggers": negative_false_triggers,
        "streams": {
            "rawProposal": raw_stream,
            "confirmedOnly": confirmed_stream,
            "confirmedPlusNeedsReview": formal_stream,
            "rejectedDiagnostic": rejected_stream,
        },
    });
    serde_json::json!({
        "recordCount": rows.len(),
        "truthRepCount": truth_count,
        "predictedRepCount": predicted_count,
        "matchedRepCount": matched_count,
        "falsePositiveCount": predicted_count.saturating_sub(matched_count),
        "missedCount": truth_count.saturating_sub(matched_count),
        "candidatePrecision": ratio(matched_count, predicted_count),
        "candidateRecall": ratio(matched_count, truth_count),
        "exactSetRecordCount": rows.iter().filter(|row| row.exact_set).count(),
        "exactSetRate": ratio(rows.iter().filter(|row| row.exact_set).count(), rows.len()),
        "strictBoundaryAlignedRepCount": strict_boundary_aligned_count,
        "strictBoundaryAlignedRate": ratio(strict_boundary_aligned_count, truth_count),
        "exactSetAndAllBoundariesAlignedRecordCount": rows.iter().filter(|row| row.exact_set_and_all_boundaries_aligned).count(),
        "exactSetAndAllBoundariesAlignedRate": ratio(rows.iter().filter(|row| row.exact_set_and_all_boundaries_aligned).count(), rows.len()),
        "matchedStartMaeMs": mean(matches.iter().map(|entry| entry.start_error_ms.unsigned_abs() as f64).collect()),
        "matchedEndMaeMs": mean(matches.iter().map(|entry| entry.end_error_ms.unsigned_abs() as f64).collect()),
        "matchedMeanIntervalIoU": mean(matches.iter().map(|entry| entry.interval_iou).collect()),
        "reviewedNegativeWindowFalseTriggerCount": negative_false_triggers,
        "recognitionFunnel": recognition_funnel,
    })
}

fn evaluation_buckets(
    rows: &[EvaluatedReplayRow],
    key_for: impl Fn(&EvaluatedReplayRow) -> String,
) -> serde_json::Value {
    let mut grouped = BTreeMap::<String, Vec<EvaluatedReplayRow>>::new();
    for row in rows {
        grouped.entry(key_for(row)).or_default().push(row.clone());
    }
    serde_json::Value::Object(
        grouped
            .into_iter()
            .map(|(key, bucket_rows)| (key, evaluation_summary(&bucket_rows)))
            .collect(),
    )
}

#[test]
fn known_video_alignment_keeps_candidate_and_strict_boundary_metrics_distinct() {
    let truth = vec![EvaluationRange {
        start_ms: 1_000,
        end_ms: 3_000,
    }];
    let candidate_only = vec![EvaluationRange {
        start_ms: 1_700,
        end_ms: 3_700,
    }];
    let matches = monotonic_evaluation_matches(&truth, &candidate_only);
    assert_eq!(matches.len(), 1);
    assert!(!matches[0].strict_boundary_aligned);

    let strictly_aligned = vec![EvaluationRange {
        start_ms: 1_200,
        end_ms: 3_200,
    }];
    let matches = monotonic_evaluation_matches(&truth, &strictly_aligned);
    assert_eq!(matches.len(), 1);
    assert!(matches[0].strict_boundary_aligned);
}

#[test]
fn action_view_evaluation_summary_always_exports_the_versioned_recognition_funnel() {
    let summary = evaluation_summary(&[]);
    let funnel = summary
        .get("recognitionFunnel")
        .expect("every action×view bucket needs a recognition funnel");
    assert_eq!(
        funnel["schemaVersion"],
        "maxpower.visual-recognition-funnel/v2"
    );
    for key in [
        "rawProposal",
        "confirmedOnly",
        "confirmedPlusNeedsReview",
        "rejected",
        "rejectionReasons",
        "candidateTruthMatches",
        "falsePositive",
        "falseNegative",
        "boundaryMetrics",
        "negativeWindowFalseTriggers",
        "streams",
    ] {
        assert!(funnel.get(key).is_some(), "missing funnel field {key}");
    }
    for stream in [
        "rawProposal",
        "confirmedOnly",
        "confirmedPlusNeedsReview",
        "rejectedDiagnostic",
    ] {
        for field in [
            "predicted",
            "matched",
            "falsePositive",
            "falseNegative",
            "precision",
            "recall",
            "candidateTruthMatches",
            "boundaryMetrics",
            "negativeWindowFalseTriggers",
        ] {
            assert!(
                funnel["streams"][stream].get(field).is_some(),
                "missing {stream}.{field}"
            );
        }
    }
    assert!(funnel["boundaryMetrics"]["turnaroundMaeMs"].is_null());
    assert_eq!(
        funnel["boundaryMetrics"]["turnaroundStatus"],
        "not_evaluable_no_human_turnaround_truth"
    );
}

#[test]
#[ignore = "requires the governed local-private Halpe26 observation asset"]
fn governed_lat_pulldown_rear_closure_keeps_a_valid_causal_trace() {
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
    let pose_asset = governance["assets"]
        .as_array()
        .expect("assets")
        .iter()
        .find(|asset| asset["id"] == "personal-native-rtmpose-halpe26-observations")
        .expect("governed pose asset");
    assert_eq!(pose_asset["admission"], "feature_only");
    assert!(
        pose_asset["allowedTasks"]
            .as_array()
            .is_some_and(|tasks| tasks.iter().any(|task| task == "runtime_parity"))
    );

    let capture_id = "field-capture-2026-08-02T18-41-05-284Z";
    let raw = read_governed_gzip_json(
        &root
            .join(
                pose_asset["location"]["path"]
                    .as_str()
                    .expect("pose asset location"),
            )
            .join(format!("{capture_id}.halpe26.json.gz")),
    );
    let (frames, frame_ids, timestamps, _) =
        governed_frames_with_equipment_provider(&raw, None, None);
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "lat_pulldown"
                && binding.capture_view == AssessmentCaptureView::Rear
        })
        .expect("lat pulldown rear binding");
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: capture_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 11,
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
        .install_exercise_profile_with_action_plan(
            binding.profile,
            binding.local_coordinate_strategy,
            binding.motion_plan.expect("plan-bound profile"),
        )
        .expect("install exact action plan");
    session.begin_set().expect("begin set");
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
    let mut engine = ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "lat-pulldown-rear-trace-regression".into(),
        },
    )
    .expect("assessment catalog");
    let mut context = video_context("lat_pulldown", "rear");
    context.source_capture_id = capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "lat-pulldown-rear-trace-regression".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start assessment");
    for packet in output.packets() {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure must preserve a valid trace");
}

#[test]
#[ignore = "requires governed local-private Halpe26 observation assets"]
fn governed_v0_1_visual_recognition_baseline_replays_current_action_views() {
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
    let replay_manifest_bytes =
        include_bytes!("fixtures/all_action_governed_replay_manifest_v1.json");
    let replay_manifest: serde_json::Value =
        serde_json::from_slice(replay_manifest_bytes).expect("versioned governed replay manifest");
    let evaluation_protocol: serde_json::Value = serde_json::from_slice(include_bytes!(
        "fixtures/visual_recognition_v0_1_protocol.json"
    ))
    .expect("frozen v0.1 visual-recognition protocol");
    let video_manifest_bytes =
        include_bytes!("fixtures/visual_recognition_v0_1_video_sources.json");
    let video_manifest: serde_json::Value = serde_json::from_slice(video_manifest_bytes)
        .expect("versioned v0.1 visual source manifest");
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
        visual_recognition_baseline_catalog_v0_1().catalog_id
    );
    assert_eq!(
        video_manifest["schemaVersion"],
        "maxpower.visual-recognition-video-source-manifest/v0.1"
    );
    assert_eq!(video_manifest["assetId"], "personal-raw-capture-archive");
    assert_eq!(
        evaluation_protocol["schemaVersion"],
        "maxpower.visual-recognition-evaluation-protocol/v0.1"
    );
    let evaluation_rules = &evaluation_protocol["protocol"];
    assert_eq!(
        sha256_bytes(&serde_json::to_vec(evaluation_rules).expect("stable evaluation protocol")),
        evaluation_protocol["protocolSha256"]
            .as_str()
            .expect("evaluation protocol hash")
    );
    assert_eq!(
        sha256_bytes(replay_manifest_bytes),
        evaluation_rules["replayManifest"]["sha256"]
            .as_str()
            .expect("replay manifest hash")
    );
    assert_eq!(
        evaluation_rules["replayManifest"]["assembledInputSha256"],
        replay_manifest["assembledInputSha256"]
    );
    assert_eq!(
        evaluation_rules["modelConfiguration"]["assessmentCatalogId"],
        visual_recognition_baseline_catalog_v0_1().catalog_id
    );
    assert_eq!(
        evaluation_rules["matchingPolicy"]["minimumIntervalIoU"],
        EVALUATION_CANDIDATE_MINIMUM_INTERVAL_IOU
    );
    assert_eq!(
        evaluation_rules["matchingPolicy"]["candidateBoundaryToleranceMs"],
        EVALUATION_CANDIDATE_BOUNDARY_TOLERANCE_MS
    );
    assert_eq!(
        evaluation_rules["matchingPolicy"]["strictMinimumIntervalIoU"],
        EVALUATION_STRICT_MINIMUM_INTERVAL_IOU
    );
    assert_eq!(
        evaluation_rules["matchingPolicy"]["strictStartEndToleranceMs"],
        EVALUATION_STRICT_BOUNDARY_TOLERANCE_MS
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
    let evaluation_supervision = &evaluation_rules["humanSupervision"];
    assert_eq!(evaluation_supervision["assetId"], label_asset["id"]);
    assert!(
        evaluation_supervision["consumedForTasks"]
            .as_array()
            .expect("evaluation tasks")
            .iter()
            .all(|task| allowed_label_tasks.contains(task))
    );
    for field in evaluation_supervision["selectedFields"]
        .as_array()
        .expect("evaluation selected fields")
    {
        let field = field.as_str().expect("evaluation field name");
        assert!(
            field == "sourceCaptureId"
                || label_asset["allowedSupervision"]
                    .as_array()
                    .is_some_and(|fields| fields.iter().any(|value| value == field)),
            "evaluation selected an unauthorized label field: {field}"
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
    let raw_video_asset = governed_asset("personal-raw-capture-archive");
    let manifest_raw_video_asset = assembled_input["sourceAssets"]
        .as_array()
        .expect("manifest assets")
        .iter()
        .find(|asset| asset["assetId"] == "personal-raw-capture-archive")
        .expect("manifest raw video asset");
    assert_eq!(raw_video_asset["admission"], "immutable_source");
    assert_eq!(raw_video_asset["authority"], "user_source");
    assert_eq!(raw_video_asset["groupKey"], "sourceCaptureId");
    assert_eq!(video_manifest["assetId"], raw_video_asset["id"]);
    assert_eq!(video_manifest["admission"], raw_video_asset["admission"]);
    assert_eq!(video_manifest["authority"], raw_video_asset["authority"]);
    assert_eq!(video_manifest["groupKey"], raw_video_asset["groupKey"]);
    assert!(
        manifest_raw_video_asset["consumedForTasks"]
            .as_array()
            .expect("raw video tasks")
            .iter()
            .all(|task| raw_video_asset["allowedTasks"]
                .as_array()
                .expect("allowed raw video tasks")
                .contains(task))
    );
    assert_eq!(
        manifest_raw_video_asset["consumedForTasks"],
        serde_json::json!([video_manifest["allowedTask"]])
    );
    let client_runtime_asset = governed_asset("maxpower-motion-sdk-wasm");
    let manifest_client_runtime_asset = assembled_input["sourceAssets"]
        .as_array()
        .expect("manifest assets")
        .iter()
        .find(|asset| asset["assetId"] == "maxpower-motion-sdk-wasm")
        .expect("manifest client runtime parity asset");
    assert_eq!(client_runtime_asset["admission"], "protected");
    assert_eq!(client_runtime_asset["authority"], "application_runtime");
    assert_eq!(client_runtime_asset["groupKey"], "not_applicable");
    let allowed_client_runtime_tasks = client_runtime_asset["allowedTasks"]
        .as_array()
        .expect("allowed client runtime tasks");
    assert!(
        manifest_client_runtime_asset["consumedForTasks"]
            .as_array()
            .expect("consumed client runtime tasks")
            .iter()
            .all(|task| allowed_client_runtime_tasks.contains(task)),
        "the client runtime parity purpose must be admitted by the governance catalog"
    );
    assert_eq!(
        manifest_client_runtime_asset["consumedForTasks"],
        serde_json::json!(["client_runtime_parity"])
    );
    assert_eq!(
        manifest_client_runtime_asset["immutableSha256"],
        client_runtime_asset["location"]["sha256"]
    );
    let client_runtime_path = root.join(
        client_runtime_asset["location"]["path"]
            .as_str()
            .expect("client runtime asset path"),
    );
    let client_runtime_bytes =
        std::fs::read(client_runtime_path).expect("protected client runtime bytes");
    assert_eq!(
        sha256_bytes(&client_runtime_bytes),
        client_runtime_asset["location"]["sha256"]
            .as_str()
            .expect("protected client runtime hash")
    );
    assert!(
        !cfg!(debug_assertions),
        "the frozen governed replay must execute the release runner"
    );
    let execution_runner_path = std::env::current_exe().expect("native replay runner path");
    let execution_runner_bytes =
        std::fs::read(&execution_runner_path).expect("native replay runner bytes");
    let execution_runner_sha256 = sha256_bytes(&execution_runner_bytes);
    let execution_runtime = serde_json::json!({
        "runnerId": "maxpower-motion-sdk-native-release-governed-replay/v1",
        "kind": "native_release_test_binary",
        "buildProfile": "release",
        "runnerBinarySha256": &execution_runner_sha256,
        "sourceBundleSha256": governed_replay_source_bundle_sha256(&root),
        "crateName": env!("CARGO_PKG_NAME"),
        "crateVersion": env!("CARGO_PKG_VERSION"),
        "packetContract": assembled_input["modelConfiguration"]["packetContract"],
    });
    let client_runtime_parity_artifact = serde_json::json!({
        "assetId": manifest_client_runtime_asset["assetId"],
        "admission": manifest_client_runtime_asset["admission"],
        "authority": manifest_client_runtime_asset["authority"],
        "sha256": manifest_client_runtime_asset["immutableSha256"],
        "claim": "attested_client_build_from_the_reviewed_source_not_the_governed_replay_executor",
    });

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
    let raw_video_root = root.join(
        raw_video_asset["location"]["path"]
            .as_str()
            .expect("raw video asset location"),
    );
    let visual_video_sources = video_manifest["sources"]
        .as_array()
        .expect("frozen v0.1 visual sources");
    assert_eq!(visual_video_sources.len(), 50);
    for source in visual_video_sources {
        let relative_path = Path::new(source["path"].as_str().expect("source video path"));
        assert!(!relative_path.is_absolute());
        assert!(
            !relative_path
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        );
        let video_path = raw_video_root.join(relative_path);
        let hash_output = Command::new("shasum")
            .args(["-a", "256"])
            .arg(&video_path)
            .output()
            .unwrap_or_else(|error| panic!("hash {}: {error}", video_path.display()));
        assert!(hash_output.status.success());
        let actual_hash = String::from_utf8(hash_output.stdout)
            .expect("video hash output")
            .split_whitespace()
            .next()
            .expect("video digest")
            .to_owned();
        assert_eq!(actual_hash, source["sha256"]);
    }

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
    assert_eq!(replays.len(), 54, "every governed label record is frozen");
    assert_eq!(
        replays
            .iter()
            .map(|source| {
                (
                    source["exerciseId"].as_str().expect("exercise"),
                    source["capturePosition"].as_str().expect("view"),
                )
            })
            .collect::<HashSet<_>>()
            .len(),
        ALL_ACTION_CONTEXTS.len(),
        "54 records must cover the complete 24-context matrix",
    );
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
                    && exclusion["repIndex"].is_null()
                    && exclusion["tasks"]
                        .as_array()
                        .is_some_and(|tasks| tasks.iter().any(|task| applied_tasks.contains(task)))
            });
        let declared_excluded = declared_excluded_groups
            .iter()
            .any(|value| value == source_capture_id);
        assert_eq!(excluded_by_policy, declared_excluded);
    }

    let mut replayed_records = 0_usize;
    let mut records_with_non_rejected_rep = 0_usize;
    let mut records_with_boundary_alignment = 0_usize;
    let mut structural_gaps = Vec::new();
    let mut packet_count = 0_usize;
    let mut local_states = BTreeMap::<String, usize>::new();
    let mut pose_channel_frames = 0_usize;
    let mut equipment_channel_frames = 0_usize;
    let mut fusion_states = BTreeMap::<String, usize>::new();
    let mut rep_disposition_counts = BTreeMap::<String, usize>::new();
    let mut rep_evidence_reason_counts = BTreeMap::<String, usize>::new();
    let mut dimension_states = BTreeMap::<String, usize>::new();
    let mut reference_kinds = BTreeMap::<String, usize>::new();
    let mut trace_complete_reports = 0_usize;
    let mut typed_refusal_count = 0_usize;
    let mut equipment_provider_requested_records = 0_usize;
    let mut equipment_provider_available_records = 0_usize;
    let mut equipment_provider_duration_ms = 0_f64;
    let mut equipment_provider_pose_input_frames = 0_usize;
    let mut equipment_provider_decoded_frames = 0_usize;
    let mut equipment_provider_visual_processed_frames = 0_usize;
    let mut equipment_provider_tracker_output_frames = 0_usize;
    let mut equipment_provider_canonical_observation_frames = 0_usize;
    let mut equipment_provider_measured_frames = 0_usize;
    let mut equipment_provider_predicted_frames = 0_usize;
    let mut equipment_provider_pose_fused_frames = 0_usize;
    let mut frozen_prediction_rows = Vec::<GovernedPredictionRow>::new();
    for (ordinal, source_group) in replays.iter().enumerate() {
        let action_id = source_group["exerciseId"].as_str().expect("exercise ID");
        let capture_position = source_group["capturePosition"]
            .as_str()
            .expect("capture position");
        let capture_id = source_group["sourceCaptureId"]
            .as_str()
            .expect("source capture ID");
        let capture_view = ALL_ACTION_CONTEXTS
            .iter()
            .find(|(expected_action, expected_position, _)| {
                *expected_action == action_id && *expected_position == capture_position
            })
            .map(|(_, _, view)| *view)
            .expect("manifest source group belongs to the supported matrix");
        if declared_excluded_groups
            .iter()
            .any(|value| value == capture_id)
        {
            let mut resolver = ExecutionAssessmentEngine::configure(
                visual_recognition_baseline_catalog_v0_1(),
                WorkoutAssessmentContext {
                    workout_session_id: format!("excluded-context-{ordinal}"),
                },
            )
            .expect("v7 catalog");
            let AssessmentEmission::LiveMotionFacts(facts) = resolver
                .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                    set_id: format!("excluded-set-{ordinal}"),
                    set_ordinal: ordinal as u32 + 1,
                    video_context: video_context(action_id, capture_position),
                    intent: SetIntent::Working,
                    planned_load: None,
                    performed_load: None,
                }))
                .expect("excluded record still resolves its exact context")
            else {
                panic!("context resolution facts")
            };
            assert!(facts.resolved_context.is_some());
            continue;
        }
        replayed_records += 1;
        let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            visual_recognition_baseline_catalog_v0_1(),
            WorkoutAssessmentContext {
                workout_session_id: format!("governed-rigid-bar-{ordinal}"),
            },
        )
        .expect("v7 catalog");
        let mut context = video_context(action_id, capture_position);
        context.source_capture_id = capture_id.into();
        let start_emission = engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("governed-set-{ordinal}"),
                set_ordinal: 1,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: None,
            }))
            .expect("start replay");
        let start_facts = match start_emission {
            AssessmentEmission::LiveMotionFacts(facts) => facts,
            AssessmentEmission::TypedRefusal(refusal) => {
                typed_refusal_count += 1;
                structural_gaps.push(format!(
                    "{capture_id}:{action_id}/{capture_position}: exact-context refusal {:?}",
                    refusal.reason
                ));
                frozen_prediction_rows.push(GovernedPredictionRow {
                    source_capture_id: capture_id.into(),
                    context_id: format!("{capture_id}:{action_id}:{capture_position}"),
                    exercise_id: action_id.into(),
                    capture_position: capture_position.into(),
                    bundle_id: "typed_exact_context_refusal".into(),
                    bundle_hash: String::new(),
                    trace_content_hash: String::new(),
                    trace_root_count: 0,
                    equipment_provider: EquipmentProviderEvaluation {
                        recognition_mode: "not_started_exact_context_refusal".into(),
                        ..EquipmentProviderEvaluation::default()
                    },
                    reps: Vec::new(),
                    quality_finding_states: Vec::new(),
                    typed_refusal_reason: Some(format!("{:?}", refusal.reason)),
                });
                continue;
            }
            AssessmentEmission::SealedSetAssessment(_) => {
                panic!("set start cannot seal an assessment")
            }
        };
        let provider_id = start_facts
            .resolved_context
            .expect("resolved equipment provider context")
            .equipment_provider_id;
        let video_source = if provider_id.is_some() {
            equipment_provider_requested_records += 1;
            let source = visual_video_sources
                .iter()
                .find(|source| source["sourceCaptureId"] == capture_id)
                .unwrap_or_else(|| {
                    panic!("missing frozen rigid-bar video for {capture_id}:{action_id}/{capture_position}")
                });
            equipment_provider_available_records += 1;
            Some(raw_video_root.join(source["path"].as_str().expect("source video path")))
        } else {
            None
        };
        let raw = read_governed_gzip_json(&pose_root.join(format!("{capture_id}.halpe26.json.gz")));
        let (frames, frame_ids, timestamps, mut equipment_provider) =
            governed_frames_with_equipment_provider(&raw, provider_id, video_source.as_deref());
        if provider_id.is_some() {
            equipment_provider_duration_ms += raw["source"]["durationMs"]
                .as_f64()
                .expect("equipment source duration");
            equipment_provider_pose_input_frames += equipment_provider.pose_input_frame_count;
            equipment_provider_visual_processed_frames +=
                equipment_provider.visual_processed_frame_count;
        }
        equipment_provider_decoded_frames += equipment_provider.decoded_frame_count;
        equipment_provider_tracker_output_frames += equipment_provider.tracker_output_frame_count;
        equipment_provider_canonical_observation_frames +=
            equipment_provider.canonical_observation_frame_count;
        equipment_provider_measured_frames += equipment_provider.measured_frame_count;
        equipment_provider_predicted_frames += equipment_provider.predicted_frame_count;
        equipment_provider_pose_fused_frames += equipment_provider.pose_fused_frame_count;
        if provider_id.is_some() {
            assert!(
                equipment_provider.canonical_observation_frame_count > 0,
                "Rust equipment provider emitted no independent observation for {capture_id}"
            );
        }
        let binding = visual_recognition_baseline_profiles_v0_1()
            .into_iter()
            .find(|binding| binding.action_id == action_id && binding.capture_view == capture_view)
            .unwrap_or_else(|| {
                panic!("missing v0.1 profile binding for {action_id}/{capture_position}")
            });
        let profile = binding.profile;
        let local_coordinate_strategy = binding.local_coordinate_strategy;
        let motion_plan = binding.motion_plan.expect("v0.1 plan-bound profile");
        assert!(
            !profile.identity.is_empty(),
            "empty profile binding for {action_id}/{capture_position}"
        );
        let output = RecordingOutputAdapter::default();
        let mut session = MotionSession::open(
            SessionConfig {
                sequence_id: capture_id.into(),
                contract: ContractVersion {
                    major: 1,
                    minor: 11,
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
            .install_exercise_profile_with_action_plan(
                profile,
                local_coordinate_strategy,
                motion_plan,
            )
            .unwrap_or_else(|error| panic!("profile {action_id}/{capture_position}: {error:?}"));
        session.begin_set().expect("begin set");
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
        let mut completed_rep_diagnostics = BTreeMap::<u64, (String, String)>::new();
        for packet in &packets {
            for rep in &packet.completed_reps {
                completed_rep_diagnostics.insert(
                    rep.rep_id,
                    (
                        format!("{:?}", rep.disposition),
                        rep.evidence_reason
                            .as_ref()
                            .map(|reason| format!("{reason:?}"))
                            .unwrap_or_else(|| "None".into()),
                    ),
                );
            }
        }
        for (_, (disposition, reason)) in completed_rep_diagnostics {
            *rep_disposition_counts.entry(disposition).or_default() += 1;
            *rep_evidence_reason_counts.entry(reason).or_default() += 1;
        }
        for packet in &packets {
            let canonical_accepted = packet.equipment.tracks.iter().any(|track| {
                track.kind == EquipmentKind::BarbellShaft
                    && track.judgeable_path
                    && track.source != EquipmentSource::Predicted
            });
            let fusion_eligible = packet
                .equipment
                .tracks
                .iter()
                .any(|track| rigid_bar_track_supports_turnaround(track));
            if let Some(frame) = equipment_provider
                .frames
                .iter_mut()
                .find(|frame| frame.frame_number == packet.frame_id)
            {
                frame.canonical_accepted = canonical_accepted;
                frame.fusion_eligible = fusion_eligible;
            }
        }
        for packet in &packets {
            packet_count += 1;
            *local_states
                .entry(format!("{:?}", packet.local_motion_coordinate.state))
                .or_default() += 1;
            pose_channel_frames += usize::from(packet.local_motion_coordinate.pose.is_some());
            equipment_channel_frames +=
                usize::from(packet.local_motion_coordinate.equipment.is_some());
            *fusion_states
                .entry(format!(
                    "{:?}",
                    packet.local_motion_coordinate.channel_agreement
                ))
                .or_default() += 1;
        }
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .unwrap_or_else(|error| panic!("closure {action_id}/{capture_position}: {error:?}"));
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("report")
        else {
            panic!("sealed report")
        };
        let recognized = report
            .reps
            .iter()
            .filter(|rep| rep.disposition != "rejected")
            .collect::<Vec<_>>();
        if !recognized.is_empty() {
            records_with_non_rejected_rep += 1;
        }
        assert_eq!(
            report.dimension_findings.len(),
            AssessmentDimension::ALL.len()
        );
        assert!(!report.trace.conclusion_root_ids.is_empty());
        for finding in &report.dimension_findings {
            *dimension_states
                .entry(format!("{:?}/{:?}", finding.dimension, finding.state))
                .or_default() += 1;
        }
        for comparison in report
            .rep_assessments
            .iter()
            .flat_map(|assessment| &assessment.comparisons)
        {
            *reference_kinds
                .entry(format!("{:?}", comparison.kind))
                .or_default() += 1;
        }
        let node_ids = report
            .trace
            .nodes
            .iter()
            .map(|node| node.node_id.as_str())
            .collect::<HashSet<_>>();
        let trace_complete = report.trace.conclusion_root_ids.len()
            == AssessmentDimension::ALL.len()
            && report
                .trace
                .conclusion_root_ids
                .iter()
                .all(|root| node_ids.contains(root.as_str()));
        assert!(
            trace_complete,
            "every set dimension needs a resolvable trace root"
        );
        let mut unhashed_trace = report.trace.clone();
        unhashed_trace.content_hash.clear();
        assert_eq!(
            stable_fnv_hash(&unhashed_trace),
            report.trace.content_hash,
            "sealed trace hash must reproduce from its immutable graph"
        );
        for root in &report.trace.conclusion_root_ids {
            let mut pending = vec![root.as_str()];
            let mut visited = HashSet::new();
            let mut kinds = Vec::new();
            while let Some(node_id) = pending.pop() {
                if !visited.insert(node_id) {
                    continue;
                }
                let node = report
                    .trace
                    .nodes
                    .iter()
                    .find(|node| node.node_id == node_id)
                    .expect("every trace input resolves");
                if !kinds.contains(&node.kind) {
                    kinds.push(node.kind);
                }
                pending.extend(node.input_node_ids.iter().map(String::as_str));
            }
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
                    kinds.contains(&required),
                    "root {root} is missing required {required:?} ancestry"
                );
            }
        }
        trace_complete_reports += 1;
        frozen_prediction_rows.push(GovernedPredictionRow {
            source_capture_id: capture_id.into(),
            context_id: format!("{capture_id}:{action_id}:{capture_position}"),
            exercise_id: action_id.into(),
            capture_position: capture_position.into(),
            bundle_id: report.bundle_id.clone(),
            bundle_hash: report.bundle_hash.clone(),
            trace_content_hash: report.trace.content_hash.clone(),
            trace_root_count: report.trace.conclusion_root_ids.len(),
            equipment_provider,
            reps: report
                .reps
                .iter()
                .map(|rep| EvaluationPredictionRep {
                    rep_id: rep.rep_id,
                    disposition: rep.disposition.clone(),
                    evidence_reason: rep.evidence_reason.map(|reason| {
                        serde_json::to_value(reason)
                            .expect("Rep evidence reason serializes")
                            .as_str()
                            .expect("Rep evidence reason is a string")
                            .to_owned()
                    }),
                    start_ms: rep.start_timestamp_ms,
                    turnaround_ms: rep.turnaround_timestamp_ms,
                    turnaround_source: rep.turnaround_source.clone(),
                    end_ms: rep.end_timestamp_ms,
                    canonical_slice_hash: rep.canonical_slice_hash.clone(),
                })
                .collect(),
            quality_finding_states: report
                .dimension_findings
                .iter()
                .map(|finding| format!("{:?}/{:?}", finding.dimension, finding.state))
                .collect(),
            typed_refusal_reason: None,
        });
    }

    // Freeze every runtime prediction before the human Rep ranges are loaded.
    // This prevents expectedCount or boundary truth from influencing inference,
    // while the protocol still classifies this corpus as known-video regression.
    let frozen_prediction_semantic = serde_json::json!({
        "schemaVersion": "maxpower-current-rust-known-video-predictions/v1",
        "state": "frozen_before_truth",
        "evaluationId": evaluation_protocol["evaluationId"],
        "protocolSha256": evaluation_protocol["protocolSha256"],
        "executionRuntime": &execution_runtime,
        "clientRuntimeParityArtifact": &client_runtime_parity_artifact,
        "rows": &frozen_prediction_rows,
    });
    let prediction_sha256 = sha256_bytes(
        &serde_json::to_vec(&frozen_prediction_semantic).expect("frozen prediction bytes"),
    );

    let labels: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&label_path).expect("admitted label asset"))
            .expect("label JSON");
    let label_records = labels["records"].as_array().expect("label records");
    assert_eq!(replays.len(), label_records.len());
    let mut exact_context_keys = HashSet::new();
    for record in label_records {
        assert!(exact_context_keys.insert(format!(
            "{}:{}:{}",
            record["sourceCaptureId"].as_str().expect("label source"),
            record["exerciseId"].as_str().expect("label action"),
            record["capturePosition"].as_str().expect("label view")
        )));
    }

    let mut evaluated_rows = Vec::<EvaluatedReplayRow>::new();
    let mut evaluated_expected_rep_count = 0_usize;
    let mut reviewed_negative_window_count = 0_usize;
    for prediction in &frozen_prediction_rows {
        let label_record = label_records
            .iter()
            .find(|record| {
                record["sourceCaptureId"] == prediction.source_capture_id
                    && record["exerciseId"] == prediction.exercise_id
                    && record["capturePosition"] == prediction.capture_position
            })
            .expect("governed exact-context label");
        let truth_ranges = label_record["segments"]
            .as_array()
            .expect("human Rep ranges")
            .iter()
            .map(|segment| EvaluationRange {
                start_ms: segment["startMs"].as_u64().expect("truth start"),
                end_ms: segment["endMs"].as_u64().expect("truth end"),
            })
            .collect::<Vec<_>>();
        assert!(
            truth_ranges
                .windows(2)
                .all(|pair| pair[0].start_ms < pair[1].start_ms)
                && truth_ranges
                    .iter()
                    .all(|range| range.start_ms < range.end_ms),
            "invalid truth ranges for {}",
            prediction.context_id
        );
        let expected_count = label_record["expectedCount"]
            .as_u64()
            .expect("expected count") as usize;
        assert_eq!(
            expected_count,
            truth_ranges.len(),
            "admitted evaluation records must have complete Rep ranges"
        );
        evaluated_expected_rep_count += expected_count;
        let counted_reps = prediction
            .reps
            .iter()
            .filter(|rep| rep.disposition != "rejected")
            .cloned()
            .collect::<Vec<_>>();
        let confirmed_only_reps = prediction
            .reps
            .iter()
            .filter(|rep| rep.disposition == "confirmed")
            .cloned()
            .collect::<Vec<_>>();
        let rejected_proposals = prediction
            .reps
            .iter()
            .filter(|rep| rep.disposition == "rejected")
            .cloned()
            .collect::<Vec<_>>();
        let ranges_for = |reps: &[EvaluationPredictionRep]| {
            reps.iter()
                .map(|rep| EvaluationRange {
                    start_ms: rep.start_ms,
                    end_ms: rep.end_ms,
                })
                .collect::<Vec<_>>()
        };
        let raw_proposal_ranges = ranges_for(&prediction.reps);
        let confirmed_only_ranges = ranges_for(&confirmed_only_reps);
        let rejected_ranges = ranges_for(&rejected_proposals);
        let predicted_ranges = counted_reps
            .iter()
            .map(|rep| EvaluationRange {
                start_ms: rep.start_ms,
                end_ms: rep.end_ms,
            })
            .collect::<Vec<_>>();
        let raw_proposal_matches =
            monotonic_evaluation_matches(&truth_ranges, &raw_proposal_ranges);
        let confirmed_only_matches =
            monotonic_evaluation_matches(&truth_ranges, &confirmed_only_ranges);
        let matches = monotonic_evaluation_matches(&truth_ranges, &predicted_ranges);
        let rejected_truth_overlaps = monotonic_evaluation_matches(&truth_ranges, &rejected_ranges);
        let strict_boundary_aligned_count = matches
            .iter()
            .filter(|entry| entry.strict_boundary_aligned)
            .count();
        let negative_windows = label_record["reviewedNegativeWindows"]
            .as_array()
            .expect("reviewed negative windows");
        reviewed_negative_window_count += negative_windows.len();
        let negative_false_triggers_for = |ranges: &[EvaluationRange]| {
            ranges
                .iter()
                .filter(|range| {
                    let midpoint = range.start_ms + (range.end_ms - range.start_ms) / 2;
                    negative_windows.iter().any(|window| {
                        let start = window["startMs"].as_u64().expect("negative start");
                        let end = window["endMs"].as_u64().expect("negative end");
                        assert!(start < end, "invalid reviewed negative window");
                        midpoint >= start && midpoint < end
                    })
                })
                .count()
        };
        let raw_proposal_negative_window_false_trigger_count =
            negative_false_triggers_for(&raw_proposal_ranges);
        let confirmed_only_negative_window_false_trigger_count =
            negative_false_triggers_for(&confirmed_only_ranges);
        let negative_false_triggers = negative_false_triggers_for(&predicted_ranges);
        let rejected_negative_window_false_trigger_count =
            negative_false_triggers_for(&rejected_ranges);

        let mut used_predictions = HashSet::new();
        let broad_boundary_aligned = truth_ranges
            .iter()
            .filter(|truth| {
                predicted_ranges
                    .iter()
                    .enumerate()
                    .any(|(index, predicted)| {
                        if used_predictions.contains(&index) {
                            return false;
                        }
                        let aligned = truth.start_ms.abs_diff(predicted.start_ms) <= 3_000
                            && truth.end_ms.abs_diff(predicted.end_ms) <= 1_500;
                        if aligned {
                            used_predictions.insert(index);
                        }
                        aligned
                    })
            })
            .count();
        if broad_boundary_aligned > 0 {
            records_with_boundary_alignment += 1;
        } else {
            structural_gaps.push(format!(
                "{}:{}/{}: non_rejected={}; expected={expected_count}",
                prediction.source_capture_id,
                prediction.exercise_id,
                prediction.capture_position,
                counted_reps.len()
            ));
        }

        let matched_count = matches.len();
        let exact_set = truth_ranges.len() == predicted_ranges.len();
        evaluated_rows.push(EvaluatedReplayRow {
            source_capture_id: prediction.source_capture_id.clone(),
            context_id: prediction.context_id.clone(),
            exercise_id: prediction.exercise_id.clone(),
            capture_position: prediction.capture_position.clone(),
            bundle_id: prediction.bundle_id.clone(),
            bundle_hash: prediction.bundle_hash.clone(),
            trace_content_hash: prediction.trace_content_hash.clone(),
            trace_root_count: prediction.trace_root_count,
            equipment_provider: prediction.equipment_provider.clone(),
            truth_count: truth_ranges.len(),
            predicted_count: predicted_ranges.len(),
            matched_count,
            false_positive_count: predicted_ranges.len().saturating_sub(matched_count),
            missed_count: truth_ranges.len().saturating_sub(matched_count),
            exact_set,
            strict_boundary_aligned_count,
            exact_set_and_all_boundaries_aligned: exact_set
                && strict_boundary_aligned_count == truth_ranges.len(),
            reviewed_negative_window_false_trigger_count: negative_false_triggers,
            truth_ranges,
            raw_proposals: prediction.reps.clone(),
            raw_proposal_matches,
            raw_proposal_negative_window_false_trigger_count,
            confirmed_only_reps,
            confirmed_only_matches,
            confirmed_only_negative_window_false_trigger_count,
            predicted_reps: counted_reps,
            rejected_proposals,
            rejected_truth_overlaps,
            rejected_negative_window_false_trigger_count,
            matches,
            quality_finding_states: prediction.quality_finding_states.clone(),
        });
    }

    let evaluated_unique_source_count = evaluated_rows
        .iter()
        .map(|row| row.source_capture_id.as_str())
        .collect::<HashSet<_>>()
        .len();
    let rigid_bar_actions = [
        "barbell_bench_press",
        "barbell_row",
        "seated_shoulder_press",
    ];
    let predicted_rep_count = evaluated_rows
        .iter()
        .map(|row| row.predicted_reps.len())
        .sum::<usize>();
    let rigid_bar_predicted_rep_count = evaluated_rows
        .iter()
        .filter(|row| rigid_bar_actions.contains(&row.exercise_id.as_str()))
        .map(|row| row.predicted_reps.len())
        .sum::<usize>();
    let equipment_fused_turnaround_count = evaluated_rows
        .iter()
        .flat_map(|row| &row.predicted_reps)
        .filter(|rep| rep.turnaround_source == "equipment_fused")
        .count();
    let pose_primary_turnaround_count = predicted_rep_count - equipment_fused_turnaround_count;
    let turnaround_by_rigid_bar_action = rigid_bar_actions
        .into_iter()
        .map(|action_id| {
            let reps = evaluated_rows
                .iter()
                .filter(|row| row.exercise_id == action_id)
                .flat_map(|row| &row.predicted_reps)
                .collect::<Vec<_>>();
            let fused = reps
                .iter()
                .filter(|rep| rep.turnaround_source == "equipment_fused")
                .count();
            (
                action_id,
                serde_json::json!({
                    "predictedRepCount": reps.len(),
                    "equipmentFusedTurnaroundCount": fused,
                    "posePrimaryTurnaroundCount": reps.len() - fused,
                }),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let report_semantic = serde_json::json!({
        "schemaVersion": evaluation_rules["output"]["schemaVersion"],
        "generatedOn": "2026-08-16",
        "evaluationId": evaluation_protocol["evaluationId"],
        "evaluationStatus": "known_participant_known_video_regression",
        "generalizationClaimAllowed": false,
        "protocolSha256": evaluation_protocol["protocolSha256"],
        "predictionSha256": prediction_sha256,
        "executionRuntime": &execution_runtime,
        "clientRuntimeParityArtifact": &client_runtime_parity_artifact,
        "protocol": evaluation_rules,
        "dataQuality": {
            "assetContractChecks": "passed",
            "labelRecordCount": label_records.len(),
            "resolvedRecordCount": replays.len(),
            "governanceExcludedRecordCount": declared_excluded_groups.len(),
            "evaluatedRecordCount": evaluated_rows.len(),
            "evaluatedUniqueSourceCaptureCount": evaluated_unique_source_count,
            "duplicateExactContextKeyCount": 0,
            "poseSidecarJoinCoverage": 1.0,
            "expectedRepCount": evaluated_expected_rep_count,
            "humanRangeCount": evaluated_rows.iter().map(|row| row.truth_count).sum::<usize>(),
            "reviewedNegativeWindowCount": reviewed_negative_window_count,
        },
        "aggregate": evaluation_summary(&evaluated_rows),
        "buckets": {
            "byAction": evaluation_buckets(&evaluated_rows, |row| row.exercise_id.clone()),
            "byView": evaluation_buckets(&evaluated_rows, |row| row.capture_position.clone()),
            "byActionView": evaluation_buckets(&evaluated_rows, |row| format!("{}|{}", row.exercise_id, row.capture_position)),
        },
        "structuralRuntime": {
            "packetCount": packet_count,
            "localStates": local_states,
            "poseChannelFrames": pose_channel_frames,
            "equipmentChannelFrames": equipment_channel_frames,
            "fusionStates": fusion_states,
            "repDispositionCounts": rep_disposition_counts,
            "repEvidenceReasonCounts": rep_evidence_reason_counts,
            "dimensionStates": dimension_states,
            "referenceKinds": reference_kinds,
            "traceCompleteReportCount": trace_complete_reports,
            "typedRefusalCount": typed_refusal_count,
        },
        "equipmentProvider": {
            "decisionAuthority": "ExecutionContract",
            "runtime": "maxpower_motion_sdk::EquipmentProviderRegistry",
            "requestedRecordCount": equipment_provider_requested_records,
            "availableRecordCount": equipment_provider_available_records,
            "poseInputFrameCount": equipment_provider_pose_input_frames,
            "poseInputRateHz": equipment_provider_pose_input_frames as f64 / (equipment_provider_duration_ms / 1_000.0),
            "decodedFrameCount": equipment_provider_decoded_frames,
            "visualProcessedFrameCount": equipment_provider_visual_processed_frames,
            "visualProcessingRateHz": equipment_provider_visual_processed_frames as f64 / (equipment_provider_duration_ms / 1_000.0),
            "trackerOutputFrameCount": equipment_provider_tracker_output_frames,
            "trackerOutputRateHz": equipment_provider_tracker_output_frames as f64 / (equipment_provider_duration_ms / 1_000.0),
            "canonicalObservationFrameCount": equipment_provider_canonical_observation_frames,
            "measuredFrameCount": equipment_provider_measured_frames,
            "predictedFrameCount": equipment_provider_predicted_frames,
            "poseFusedFrameCount": equipment_provider_pose_fused_frames,
            "accuracyStatus": "not_evaluable_no_human_equipment_track_truth",
        },
        "turnaroundEvaluation": {
            "boundaryAuthority": "action_observation_plan_task_primary_and_required_relations",
            "humanTurnaroundTruthCount": 0,
            "accuracyStatus": "not_evaluable_no_human_turnaround_truth",
            "predictedRepCount": predicted_rep_count,
            "rigidBarPredictedRepCount": rigid_bar_predicted_rep_count,
            "equipmentFusedTurnaroundCount": equipment_fused_turnaround_count,
            "posePrimaryTurnaroundCount": pose_primary_turnaround_count,
            "byRigidBarAction": turnaround_by_rigid_bar_action,
        },
        "unsupportedAccuracyClaims": {
            "equipmentTrackAccuracy": "not_evaluable_no_human_equipment_track_truth",
            "turnaroundAccuracy": "not_evaluable_no_human_turnaround_truth",
            "techniqueQualityAccuracy": "not_evaluable_no_human_quality_truth",
        },
        "rows": evaluated_rows,
    });
    let report_digest = sha256_bytes(
        &serde_json::to_vec(&report_semantic).expect("stable known-video evaluation report"),
    );
    let mut report_output = report_semantic;
    report_output
        .as_object_mut()
        .expect("evaluation report object")
        .insert("reportDigest".into(), serde_json::json!(&report_digest));
    let requested_output = std::env::var("MAXPOWER_GOVERNED_EVALUATION_OUTPUT").ok();
    let run_id = std::env::var("MAXPOWER_GOVERNED_EVALUATION_RUN_ID")
        .unwrap_or_else(|_| "contract-test-unpublished".into());
    if requested_output.is_some() {
        assert!(
            !run_id.trim().is_empty() && run_id != "contract-test-unpublished",
            "a published governed replay requires an explicit immutable run ID"
        );
    }
    report_output
        .as_object_mut()
        .expect("evaluation report object")
        .insert("runId".into(), serde_json::json!(run_id));
    report_output
        .as_object_mut()
        .expect("evaluation report object")
        .insert(
            "executionInvocation".into(),
            serde_json::json!({
                "processId": std::process::id(),
            }),
        );
    eprintln!("governed semantic report digest: {report_digest}");
    eprintln!(
        "known-video alignment: {}",
        serde_json::to_string(&report_output["aggregate"]).expect("aggregate JSON")
    );
    eprintln!(
        "governed replay: resolved=54 replayed={replayed_records} non_rejected={} boundary_aligned={} gaps={:?}",
        records_with_non_rejected_rep, records_with_boundary_alignment, structural_gaps
    );
    eprintln!(
        "structural metrics: packets={packet_count} local_states={local_states:?} pose_channel_frames={pose_channel_frames} equipment_channel_frames={equipment_channel_frames} fusion_states={fusion_states:?} rep_dispositions={rep_disposition_counts:?} rep_evidence_reasons={rep_evidence_reason_counts:?} dimension_states={dimension_states:?} reference_kinds={reference_kinds:?} trace_complete_reports={trace_complete_reports} typed_refusals={typed_refusal_count}"
    );
    let expected: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join(
            "rust/motion-sdk/tests/fixtures/visual_recognition_v0_1_expected_structural_result.json",
        ))
        .expect("frozen v0.1b action-driven regression fixture"),
    )
    .expect("frozen v0.1b action-driven regression result");
    assert_eq!(report_output["reportDigest"], expected["reportDigest"]);
    assert_eq!(
        report_output["aggregate"]["truthRepCount"],
        expected["aggregate"]["truthRepCount"]
    );
    assert_eq!(
        report_output["aggregate"]["recognitionFunnel"]["rawProposal"],
        expected["aggregate"]["rawProposalCount"]
    );
    assert_eq!(
        report_output["aggregate"]["recognitionFunnel"]["confirmedOnly"],
        expected["aggregate"]["confirmedCount"]
    );
    assert_eq!(
        report_output["aggregate"]["recognitionFunnel"]["confirmedPlusNeedsReview"],
        expected["aggregate"]["confirmedPlusNeedsReviewCount"]
    );
    assert_eq!(
        report_output["aggregate"]["matchedRepCount"],
        expected["aggregate"]["matchedRepCount"]
    );
    assert_eq!(
        report_output["aggregate"]["falsePositiveCount"],
        expected["aggregate"]["falsePositiveCount"]
    );
    assert_eq!(
        report_output["aggregate"]["missedCount"],
        expected["aggregate"]["falseNegativeCount"]
    );
    assert_eq!(
        report_output["aggregate"]["candidatePrecision"],
        expected["aggregate"]["candidatePrecision"]
    );
    assert_eq!(
        report_output["aggregate"]["candidateRecall"],
        expected["aggregate"]["candidateRecall"]
    );
    assert_eq!(
        report_output["aggregate"]["exactSetRate"],
        expected["aggregate"]["exactSetRate"]
    );
    assert_eq!(
        report_output["aggregate"]["strictBoundaryAlignedRepCount"],
        expected["aggregate"]["strictBoundaryAlignedRepCount"]
    );
    assert_eq!(
        report_output["aggregate"]["reviewedNegativeWindowFalseTriggerCount"],
        expected["aggregate"]["reviewedNegativeWindowFalseTriggerCount"]
    );
    assert_eq!(replays.len() as u64, expected["resolvedRecordCount"]);
    assert_eq!(
        declared_excluded_groups.len() as u64,
        expected["governanceExcludedRecordCount"]
    );
    assert_eq!(replayed_records as u64, expected["replayedRecordCount"]);
    assert_eq!(
        records_with_non_rejected_rep as u64,
        expected["recordsWithNonRejectedRep"]
    );
    assert_eq!(
        records_with_boundary_alignment as u64,
        expected["recordsWithBoundaryAlignment"]
    );
    assert_eq!(packet_count as u64, expected["packetCount"]);
    assert_eq!(
        serde_json::to_value(&local_states).expect("local state metrics"),
        expected["localStates"]
    );
    assert_eq!(pose_channel_frames as u64, expected["poseChannelFrames"]);
    assert_eq!(
        equipment_channel_frames as u64,
        expected["equipmentChannelFrames"]
    );
    assert_eq!(
        serde_json::to_value(&fusion_states).expect("fusion state metrics"),
        expected["fusionStates"]
    );
    assert_eq!(
        serde_json::to_value(&dimension_states).expect("dimension state metrics"),
        expected["dimensionStates"]
    );
    assert_eq!(
        serde_json::to_value(&reference_kinds).expect("reference metrics"),
        expected["referenceKinds"]
    );
    assert_eq!(
        trace_complete_reports as u64,
        expected["traceCompleteReportCount"]
    );
    let expected_equipment = &expected["equipmentProvider"];
    assert_eq!(
        equipment_provider_requested_records as u64,
        expected_equipment["requestedRecordCount"]
    );
    assert_eq!(
        equipment_provider_available_records as u64,
        expected_equipment["availableRecordCount"]
    );
    assert_eq!(
        equipment_provider_decoded_frames as u64,
        expected_equipment["decodedFrameCount"]
    );
    assert_eq!(
        equipment_provider_tracker_output_frames as u64,
        expected_equipment["trackerOutputFrameCount"]
    );
    assert_eq!(
        equipment_provider_canonical_observation_frames as u64,
        expected_equipment["canonicalObservationFrameCount"]
    );
    assert_eq!(
        equipment_provider_measured_frames as u64,
        expected_equipment["measuredFrameCount"]
    );
    assert_eq!(
        equipment_provider_predicted_frames as u64,
        expected_equipment["predictedFrameCount"]
    );
    assert_eq!(
        equipment_provider_pose_fused_frames as u64,
        expected_equipment["poseFusedFrameCount"]
    );
    assert_eq!(typed_refusal_count as u64, expected["typedRefusalCount"]);

    // Publication happens only after every frozen expectation has passed.
    // The rename is atomic inside one directory, so an interrupted or failed
    // replay cannot replace the last accepted artifact with partial output.
    if let Some(output_path) = requested_output {
        let output_path = governed_evaluation_output_path(&governance_root, &output_path)
            .expect("governed evaluation output boundary");
        let file_name = output_path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("UTF-8 governed evaluation file name");
        let temporary_path =
            output_path.with_file_name(format!(".{file_name}.tmp-{}", std::process::id()));
        let mut temporary_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .expect("create unique governed evaluation temporary output");
        temporary_file
            .write_all(&serde_json::to_vec_pretty(&report_output).expect("pretty evaluation JSON"))
            .expect("write governed evaluation temporary output");
        temporary_file
            .sync_all()
            .expect("durably flush governed evaluation temporary output");
        drop(temporary_file);
        std::fs::rename(&temporary_path, &output_path)
            .expect("atomically publish accepted governed evaluation output");
    }
}

#[test]
fn every_current_rigid_bar_context_resolves_an_executable_action_specific_bundle() {
    let catalog = visual_recognition_baseline_catalog_v0_1();
    let profiles = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .filter(|binding| {
            RIGID_BAR_CONTEXTS.iter().any(|(action, _, view)| {
                binding.action_id == *action && binding.capture_view == *view
            })
        })
        .collect::<Vec<_>>();
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
        let plan = binding.motion_plan.as_ref().expect("compiled motion plan");
        assert_eq!(
            phase_order
                .iter()
                .map(|phase| phase.as_str().expect("phase name"))
                .collect::<Vec<_>>(),
            plan.phases
                .iter()
                .map(|phase| phase.phase_id.as_str())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            task_endpoints
                .iter()
                .map(|endpoint| endpoint.as_str().expect("endpoint name"))
                .collect::<Vec<_>>(),
            vec![
                plan.rep_boundary.start.as_str(),
                plan.rep_boundary.turnaround.as_str(),
                plan.rep_boundary.return_boundary.as_str(),
            ]
        );
    }
}

#[test]
fn every_current_rigid_bar_context_produces_rep_quality_and_a_causal_trace() {
    for (ordinal, (action_id, capture_position, capture_view)) in
        RIGID_BAR_CONTEXTS.iter().enumerate()
    {
        let binding = visual_recognition_baseline_profiles_v0_1()
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
            visual_recognition_baseline_catalog_v0_1(),
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
            .unwrap_or_else(|error| {
                panic!(
                    "{}/{:?} must seal a causal report: {error:?}",
                    binding.action_id, binding.capture_view
                )
            })
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

#[test]
fn v0_1_report_executes_the_bound_motion_plan_instead_of_wrist_proxy_semantics() {
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("v0_1 bench profile");
    let source_capture_id = "fixture:v0_1-motion-plan-runtime";
    let (packets, closure) = canonical_packets_for(&binding, source_capture_id);
    let mut engine = ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "v0_1-plan-runtime".into(),
        },
    )
    .expect("v0_1 catalog");
    let mut context = video_context("barbell_bench_press", "front");
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "v0_1-set".into(),
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
        panic!("sealed report")
    };
    assert!(
        report
            .resolved_context
            .observation_plan_hash
            .as_ref()
            .is_some_and(|hash| !hash.is_empty())
    );
    let assessment = report.rep_assessments.first().expect("sealed Rep");
    let primary = assessment
        .features
        .iter()
        .find(|feature| feature.feature_id == "motion_relation:task_primary")
        .expect("plan-generated TaskPrimary fact");
    assert!(
        primary.value.is_some(),
        "measured equipment drives the primary relation"
    );
    assert!(
        primary
            .provenance
            .iter()
            .any(|entry| entry.starts_with("action_observation_plan:"))
    );
    assert!(
        assessment.features.iter().any(|feature| {
            feature.feature_id == "motion_relation:torso_support_stability"
                && feature.status == maxpower_motion_sdk::MotionFeatureStatus::Observed
                && feature.value.is_some()
        }),
        "the plan-declared segment-angle operator executes on canonical pose evidence"
    );
    let task_rule = report
        .trace
        .nodes
        .iter()
        .find(|node| {
            node.kind == TraceNodeKind::RuleConclusion && node.node_id.contains("task_completion")
        })
        .expect("task completion rule");
    assert!(
        task_rule
            .input_node_ids
            .iter()
            .any(|node| node.contains("comparison:motion_relation:task_primary"))
    );
}

#[test]
fn every_v0_1_executable_profile_uses_the_plan_driven_local_cycle() {
    let bindings = visual_recognition_baseline_profiles_v0_1();
    assert_eq!(bindings.len(), 24, "current executable exact contexts");
    for binding in bindings {
        let plan = binding.motion_plan.as_ref().expect("compiled motion plan");
        let expected_signal = if plan.relations.iter().any(|relation| {
            relation.role == maxpower_motion_sdk::MotionRole::TaskPrimary
                && matches!(
                    relation.operator_id.as_str(),
                    "joint_angle"
                        | "relative_distance"
                        | "segment_angle"
                        | "projected_shoulder_rotation"
                )
        }) {
            ExerciseSignalKind::ActionPrimaryRelationScalar
        } else {
            match binding.local_coordinate_strategy.equipment_mode {
                LocalEquipmentMode::PoseOnly | LocalEquipmentMode::FixedSupport => {
                    ExerciseSignalKind::LocalPoseAlongAxisProgress
                }
                LocalEquipmentMode::MovingHandle | LocalEquipmentMode::TwoIndependentDumbbells
                    if plan.rep_consensus.mode
                        == maxpower_motion_sdk::RepConsensusMode::IndependentBilateral =>
                {
                    ExerciseSignalKind::LocalIndependentBilateralAlongAxisProgress
                }
                _ => ExerciseSignalKind::LocalAlongAxisProgress,
            }
        };
        assert_eq!(binding.profile.primary_signal.kind, expected_signal);
        assert_eq!(binding.profile.secondary_signal.kind, expected_signal);
        assert_eq!(binding.profile.direction, MovementDirection::Auto);
        assert_eq!(
            binding.profile.state_machine_id,
            format!(
                "action-plan-topology/{}/phases-{}/dwell-{}ms/v1",
                plan.rep_topology.topology_id,
                plan.phases.len(),
                plan.rep_topology.minimum_phase_dwell_ms
            )
        );
        assert!(binding.profile.identity.contains(&plan.plan_hash));
        assert!(
            binding
                .profile
                .identity
                .contains("plan-driven-local-cycle/v0.1")
        );
    }

    let source = include_str!("../src/execution_assessment_engine.rs");
    let start = source
        .find("pub fn compile_plan_driven_runtime_binding")
        .expect("plan-driven compiler source");
    let end = source[start..]
        .find("pub fn visual_recognition_baseline_catalog_v0_1")
        .map(|offset| start + offset)
        .expect("v0_1 catalog boundary");
    let current_runtime_path = &source[start..end];
    for forbidden in [
        "barbell_bench_press",
        "barbell_row",
        "seated_shoulder_press",
        "machine_chest_press",
        "lateral_raise",
        "push_up",
        "pull_up",
    ] {
        assert!(
            !current_runtime_path.contains(forbidden),
            "v0_1 executable runtime must not branch on action name: {forbidden}"
        );
    }
}

#[test]
fn every_v0_1_executable_context_runs_rep_quality_set_and_trace_lifecycle() {
    let catalog = visual_recognition_baseline_catalog_v0_1();
    let bindings = visual_recognition_baseline_profiles_v0_1();
    assert_eq!(bindings.len(), 24);
    assert_eq!(bindings.len(), catalog.bundles.len());
    for (ordinal, binding) in bindings.iter().enumerate() {
        let source_capture_id = format!("fixture:v0_1-all-contexts:{ordinal}");
        let (packets, closure) =
            canonical_packets_for_supported_binding(binding, &source_capture_id);
        let confirmed = packets
            .iter()
            .flat_map(|packet| &packet.completed_reps)
            .filter(|rep| rep.disposition == maxpower_motion_sdk::RepDisposition::Confirmed)
            .count();
        assert!(
            confirmed > 0,
            "{}/{:?} must seal a plan-authorized Rep: reps={:#?}, local={:#?}, closure_count={}",
            binding.action_id,
            binding.capture_view,
            packets
                .iter()
                .flat_map(|packet| &packet.completed_reps)
                .collect::<Vec<_>>(),
            packets
                .iter()
                .map(|packet| (
                    packet.frame_id,
                    packet.local_motion_coordinate.state,
                    packet
                        .local_motion_coordinate
                        .pose
                        .map(|channel| channel.along_axis_progress),
                    packet.rep_state.phase,
                    packet.set_state.lifecycle,
                    packet.target.state,
                ))
                .collect::<Vec<_>>(),
            closure.completed_rep_count(),
        );

        let capture_position = match binding.capture_view {
            AssessmentCaptureView::Front => "front",
            AssessmentCaptureView::Rear => "rear",
            AssessmentCaptureView::LeftSide => "left",
            AssessmentCaptureView::RightSide => "right",
            AssessmentCaptureView::FrontObliqueLeft => "frontLeft45",
            AssessmentCaptureView::FrontObliqueRight => "frontRight45",
            AssessmentCaptureView::RearObliqueLeft => "rearLeft45",
            AssessmentCaptureView::RearObliqueRight => "rearRight45",
        };
        let mut engine = ExecutionAssessmentEngine::configure(
            catalog.clone(),
            WorkoutAssessmentContext {
                workout_session_id: format!("v0_1-all-contexts:{ordinal}"),
            },
        )
        .expect("v0_1 catalog");
        let mut context = video_context(&binding.action_id, capture_position);
        context.source_capture_id = source_capture_id;
        let started = engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("v0_1-set:{ordinal}"),
                set_ordinal: 1,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: None,
            }))
            .expect("start exact context");
        assert!(
            matches!(started, AssessmentEmission::LiveMotionFacts(_)),
            "{}/{:?} must start without an action-level capability refusal: {started:#?}",
            binding.action_id,
            binding.capture_view,
        );
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
            .unwrap_or_else(|error| {
                panic!(
                    "{}/{:?} must seal a causal report: {error:?}",
                    binding.action_id, binding.capture_view
                )
            })
        else {
            panic!("sealed report")
        };
        assert!(!report.reps.is_empty());
        assert_eq!(
            report.dimension_findings.len(),
            AssessmentDimension::ALL.len()
        );
        for kind in [
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
                report.trace.nodes.iter().any(|node| node.kind == kind),
                "{}/{} missing trace stage {kind:?}",
                binding.action_id,
                capture_position
            );
        }
    }
}

#[test]
fn a_v0_1_profile_cannot_enter_motion_session_without_its_action_plan() {
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("v0_1 bench profile");
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: "plan-required".into(),
            contract: ContractVersion {
                major: 1,
                minor: 11,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture {
            frames: VecDeque::new(),
        },
        RecordingOutputAdapter::default(),
    )
    .expect("session");
    assert_eq!(
        session.install_exercise_profile_with_local_strategy(
            binding.profile,
            binding.local_coordinate_strategy,
        ),
        Err(MotionError::ActionPlanRequired),
        "a plan-bound profile must not bypass the new action authority",
    );
}

#[test]
fn rust_bar_pixels_run_provider_fusion_rep_assessment_and_trace() {
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("v0_1 bench binding");
    let source_capture_id = "fixture:rust-bar-provider-lifecycle";
    let (packets, closure) = canonical_packets_for_visual_bar(&binding, source_capture_id);
    let observed_reps = packets
        .iter()
        .flat_map(|packet| &packet.completed_reps)
        .collect::<Vec<_>>();
    assert!(
        observed_reps.iter().any(|rep| {
            rep.disposition == maxpower_motion_sdk::RepDisposition::Confirmed
                && rep.observation_findings.contains(
                    &maxpower_motion_sdk::RepObservationFinding::ActionPrimaryRelationSatisfied,
                )
        }),
        "{observed_reps:#?}"
    );
    let mut engine = ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "bar-provider-lifecycle".into(),
        },
    )
    .expect("v0_1 catalog");
    let mut context = video_context("barbell_bench_press", "front");
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "bar-provider-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start bar set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("canonical packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("bar report")
    else {
        panic!("sealed report")
    };
    assert!(!report.rep_assessments.is_empty());
    assert!(report.trace.nodes.iter().any(|node| {
        node.kind == TraceNodeKind::PoseEquipmentFusion
            && node
                .summary
                .contains("independent equipment observed: true")
    }));
}

#[test]
fn smith_bar_reuses_pixel_axis_but_keeps_guide_path_and_exact_lineage() {
    let (catalog, profile) = admitted_external_rigid_bar_bundle(
        "smith_flat_bench_press",
        "smith_flat_bench_press",
        AssessmentCaptureView::Front,
        "barbell_bench_press",
    );
    let plan = profile.motion_plan.as_ref().expect("Smith plan");
    assert!(plan.relations.iter().any(|relation| {
        relation.relation_id == "smith_guide_path"
            && relation.operator_id == "constrained_path_deviation"
            && relation.judgeability == maxpower_motion_sdk::FeatureJudgeability::RequiredForRep
    }));
    let source_capture_id = "fixture:rust-smith-provider-lifecycle";
    let (packets, closure) = canonical_packets_for_visual_bar(&profile, source_capture_id);
    assert!(
        packets
            .iter()
            .flat_map(|packet| &packet.completed_reps)
            .any(|rep| {
                rep.disposition == maxpower_motion_sdk::RepDisposition::Confirmed
                    && rep.observation_findings.contains(
                        &maxpower_motion_sdk::RepObservationFinding::ActionPrimaryRelationSatisfied,
                    )
            })
    );

    let mut engine = ExecutionAssessmentEngine::configure(
        catalog.clone(),
        WorkoutAssessmentContext {
            workout_session_id: "smith-provider-lifecycle".into(),
        },
    )
    .expect("Smith exact-context catalog");
    let mut context = video_context("smith_flat_bench_press", "front");
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "smith-provider-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start Smith set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("Smith canonical packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("Smith closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("Smith report")
    else {
        panic!("sealed Smith report")
    };
    assert!(!report.rep_assessments.is_empty());
    let guide_feature = report.rep_assessments[0]
        .features
        .iter()
        .find(|feature| feature.feature_id == "motion_relation:smith_guide_path")
        .expect("Smith guide-path feature");
    assert_eq!(
        guide_feature.status,
        maxpower_motion_sdk::MotionFeatureStatus::Observed
    );
    assert!(guide_feature.value.is_some());
    assert!(report.trace.nodes.iter().any(|node| {
        node.kind == TraceNodeKind::FeatureFact
            && node.node_id.contains("motion_relation:smith_guide_path")
    }));

    let smith_bundle = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "smith_flat_bench_press/front/v1")
        .expect("Smith bundle");
    let free_bundle = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "barbell_bench_press/front/v1")
        .expect("free-bar bundle");
    assert_ne!(
        smith_bundle.lineage.execution_contract.id,
        free_bundle.lineage.execution_contract.id
    );
    assert_ne!(
        smith_bundle.lineage.rule_pack.id,
        free_bundle.lineage.rule_pack.id
    );
    assert_ne!(
        smith_bundle.lineage.reference_policy.id,
        free_bundle.lineage.reference_policy.id
    );
}

#[test]
fn row_and_deadlift_publish_different_joint_and_substitution_causal_routes() {
    let row_binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_row"
                && binding.capture_view == AssessmentCaptureView::FrontObliqueRight
        })
        .expect("row plan binding");
    let row_report = run_plan_bound_fixture_report(
        visual_recognition_baseline_catalog_v0_1(),
        &row_binding,
        "barbell_row",
        "frontRight45",
        "fixture:row-semantic-route",
    );
    let (deadlift_catalog, deadlift_binding) = admitted_external_rigid_bar_bundle(
        "conventional_barbell_deadlift",
        "conventional_barbell_deadlift",
        AssessmentCaptureView::FrontObliqueRight,
        "barbell_row",
    );
    let deadlift_report = run_plan_bound_fixture_report(
        deadlift_catalog,
        &deadlift_binding,
        "conventional_barbell_deadlift",
        "frontRight45",
        "fixture:deadlift-semantic-route",
    );

    let row_features = &row_report.rep_assessments[0].features;
    let hip_drive = row_features
        .iter()
        .find(|feature| feature.feature_id == "motion_relation:hip_drive_substitution")
        .expect("row hip-drive substitution fact");
    assert!(
        hip_drive
            .provenance
            .iter()
            .any(|value| value == "semantic_role:substitutionguard")
    );
    assert!(
        !row_features
            .iter()
            .any(|feature| feature.feature_id == "motion_relation:hip_extension_coordination")
    );

    let deadlift_features = &deadlift_report.rep_assessments[0].features;
    for relation_id in ["hip_extension_coordination", "knee_extension_coordination"] {
        let feature = deadlift_features
            .iter()
            .find(|feature| feature.feature_id == format!("motion_relation:{relation_id}"))
            .expect("deadlift coordination fact");
        assert!(
            feature
                .provenance
                .iter()
                .any(|value| value == "semantic_role:coordinatedmotion")
        );
    }
    assert!(
        !deadlift_features
            .iter()
            .any(|feature| feature.feature_id == "motion_relation:hip_drive_substitution")
    );

    let row_variant_rule = row_report
        .trace
        .nodes
        .iter()
        .find(|node| {
            node.kind == TraceNodeKind::RuleConclusion
                && node.node_id.contains("standard_variant_compatibility")
        })
        .expect("row variant rule");
    assert!(
        row_variant_rule
            .input_node_ids
            .iter()
            .any(|id| id.contains("comparison:motion_relation:hip_drive_substitution"))
    );
    let deadlift_phase_rule = deadlift_report
        .trace
        .nodes
        .iter()
        .find(|node| {
            node.kind == TraceNodeKind::RuleConclusion && node.node_id.contains("phase_control")
        })
        .expect("deadlift phase rule");
    assert!(
        deadlift_phase_rule
            .input_node_ids
            .iter()
            .any(|id| id.contains("comparison:motion_relation:hip_extension_coordination"))
    );
    assert!(
        deadlift_phase_rule
            .input_node_ids
            .iter()
            .any(|id| id.contains("comparison:motion_relation:knee_extension_coordination"))
    );
}

#[test]
fn rust_dumbbell_pixels_run_provider_fusion_rep_assessment_and_trace() {
    const WIDTH: usize = 320;
    const HEIGHT: usize = 240;
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "lateral_raise"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("v0_1 dumbbell front binding");
    let plan = binding.motion_plan.clone().expect("dumbbell action plan");
    let mut tracker = PointEquipmentVisualTracker::new(PointEquipmentMode::Dumbbell);
    tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &vec![28; WIDTH * HEIGHT],
            WIDTH,
            HEIGHT,
            1,
            &[],
        )
        .expect("background frame");
    let angles = [10.0; 10]
        .into_iter()
        .chain([12.0, 20.0, 35.0, 55.0, 75.0, 95.0])
        .chain([75.0, 55.0, 35.0, 20.0, 12.0, 10.0])
        .chain([10.0; 8])
        .collect::<Vec<_>>();
    let frames = angles
        .iter()
        .enumerate()
        .map(|(index, angle)| {
            let setup_offset_y = match index {
                0 => 0.0,
                1 => 0.008,
                2 => 0.016,
                _ => 0.024,
            };
            point_equipment_frame(
                &mut tracker,
                100 + index as u64 * 100,
                *angle,
                setup_offset_y,
                EquipmentKind::Dumbbell,
            )
        })
        .collect();
    let output = RecordingOutputAdapter::default();
    let source_capture_id = "fixture:rust-dumbbell-provider-lifecycle";
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: source_capture_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 11,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: WIDTH as u32,
            image_height_px: HEIGHT as u32,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture { frames },
        output.clone(),
    )
    .expect("motion session");
    session
        .install_exercise_profile_with_action_plan(
            binding.profile,
            binding.local_coordinate_strategy,
            plan,
        )
        .expect("plan-bound dumbbell profile");
    session.begin_set().expect("begin set");
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..angles.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                100 + frame_id * 100,
                Arc::clone(&releases),
            ))
            .expect("provider frame");
    }
    let packets = output.packets();
    let closure = session.finish_set_for_assessment();
    let observed_reps = packets
        .iter()
        .flat_map(|packet| &packet.completed_reps)
        .collect::<Vec<_>>();
    assert!(
        observed_reps.iter().any(|rep| {
            rep.disposition == maxpower_motion_sdk::RepDisposition::Confirmed
                && rep.observation_findings.contains(
                    &maxpower_motion_sdk::RepObservationFinding::ActionPrimaryRelationSatisfied,
                )
        }),
        "{observed_reps:#?}"
    );

    let mut engine = ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "dumbbell-provider-lifecycle".into(),
        },
    )
    .expect("v0_1 catalog");
    let mut context = video_context("lateral_raise", "front");
    context.source_capture_id = source_capture_id.into();
    context.frame_contract.width = WIDTH as u32;
    context.frame_contract.height = HEIGHT as u32;
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "dumbbell-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start dumbbell set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("canonical packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("dumbbell report")
    else {
        panic!("sealed report")
    };
    assert!(!report.rep_assessments.is_empty());
    assert!(report.trace.nodes.iter().any(|node| {
        node.kind == TraceNodeKind::PoseEquipmentFusion
            && node
                .summary
                .contains("independent equipment observed: true")
    }));
    assert!(report.trace.nodes.iter().any(|node| {
        node.kind == TraceNodeKind::FeatureFact
            && node.node_id.contains("motion_relation:task_primary")
    }));
}

#[test]
fn rust_machine_handle_pixels_run_provider_fusion_rep_assessment_and_trace() {
    const WIDTH: usize = 320;
    const HEIGHT: usize = 240;
    let binding = visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "machine_chest_press"
                && binding.capture_view == AssessmentCaptureView::FrontObliqueRight
        })
        .expect("v0_1 machine press binding");
    assert_eq!(
        binding.local_coordinate_strategy.pose_anchor,
        maxpower_motion_sdk::LocalPoseAnchor::RightWrist
    );
    let plan = binding.motion_plan.clone().expect("machine action plan");
    let mut tracker = PointEquipmentVisualTracker::new(PointEquipmentMode::MachineHandle);
    tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &vec![28; WIDTH * HEIGHT],
            WIDTH,
            HEIGHT,
            1,
            &[],
        )
        .expect("background frame");
    let angles = [80.0; 10]
        .into_iter()
        .chain([85.0, 100.0, 120.0, 140.0, 160.0])
        .chain([140.0, 120.0, 100.0, 85.0, 80.0])
        .chain([80.0; 8])
        .collect::<Vec<_>>();
    let frames = angles
        .iter()
        .enumerate()
        .map(|(index, angle)| {
            let setup_offset_x = match index {
                0 => 0.0,
                1 => 0.008,
                2 => 0.016,
                _ => 0.024,
            };
            machine_handle_frame(
                &mut tracker,
                100 + index as u64 * 100,
                *angle,
                setup_offset_x,
                false,
            )
        })
        .collect();
    let output = RecordingOutputAdapter::default();
    let source_capture_id = "fixture:rust-machine-provider-lifecycle";
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: source_capture_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 11,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: WIDTH as u32,
            image_height_px: HEIGHT as u32,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture { frames },
        output.clone(),
    )
    .expect("motion session");
    session
        .install_exercise_profile_with_action_plan(
            binding.profile,
            binding.local_coordinate_strategy,
            plan,
        )
        .expect("plan-bound machine profile");
    session.begin_set().expect("begin set");
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..angles.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                100 + frame_id * 100,
                Arc::clone(&releases),
            ))
            .expect("provider frame");
    }
    let packets = output.packets();
    let closure = session.finish_set_for_assessment();
    let observed_reps = packets
        .iter()
        .flat_map(|packet| &packet.completed_reps)
        .collect::<Vec<_>>();
    assert!(
        observed_reps.iter().any(|rep| {
            rep.disposition == maxpower_motion_sdk::RepDisposition::Confirmed
                && rep.observation_findings.contains(
                    &maxpower_motion_sdk::RepObservationFinding::ActionPrimaryRelationSatisfied,
                )
        }),
        "{observed_reps:#?}"
    );

    let mut engine = ExecutionAssessmentEngine::configure(
        visual_recognition_baseline_catalog_v0_1(),
        WorkoutAssessmentContext {
            workout_session_id: "machine-provider-lifecycle".into(),
        },
    )
    .expect("v0_1 catalog");
    let mut context = video_context("machine_chest_press", "frontRight45");
    context.source_capture_id = source_capture_id.into();
    context.frame_contract.width = WIDTH as u32;
    context.frame_contract.height = HEIGHT as u32;
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "machine-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start machine set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("canonical packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("machine report")
    else {
        panic!("sealed report")
    };
    assert!(!report.rep_assessments.is_empty());
    assert!(report.trace.nodes.iter().any(|node| {
        node.kind == TraceNodeKind::FeatureFact
            && node.node_id.contains("motion_relation:task_primary")
    }));
}

#[test]
fn independent_machine_handles_keep_two_tracks_through_rep_and_assessment() {
    const WIDTH: usize = 320;
    const HEIGHT: usize = 240;
    let (catalog, binding) = admitted_external_independent_machine_bundle();
    let plan = binding
        .motion_plan
        .clone()
        .expect("independent machine plan");
    let mut tracker = PointEquipmentVisualTracker::new(PointEquipmentMode::MachineHandle);
    tracker
        .process_frame(
            PoseSchemaId::Halpe26,
            &vec![28; WIDTH * HEIGHT],
            WIDTH,
            HEIGHT,
            1,
            &[],
        )
        .expect("background frame");
    let angles = [80.0; 10]
        .into_iter()
        .chain([85.0, 100.0, 120.0, 140.0, 160.0])
        .chain([140.0, 120.0, 100.0, 85.0, 80.0])
        .chain([80.0; 8])
        .collect::<Vec<_>>();
    let frames = angles
        .iter()
        .enumerate()
        .map(|(index, angle)| {
            let setup_offset_x = match index {
                0 => 0.0,
                1 => 0.008,
                2 => 0.016,
                _ => 0.024,
            };
            machine_handle_frame(
                &mut tracker,
                100 + index as u64 * 100,
                *angle,
                setup_offset_x,
                true,
            )
        })
        .collect();
    let output = RecordingOutputAdapter::default();
    let source_capture_id = "fixture:rust-independent-machine-provider-lifecycle";
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: source_capture_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 11,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: WIDTH as u32,
            image_height_px: HEIGHT as u32,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture { frames },
        output.clone(),
    )
    .expect("motion session");
    session
        .install_exercise_profile_with_action_plan(
            binding.profile,
            binding.local_coordinate_strategy,
            plan,
        )
        .expect("independent-machine plan-bound profile");
    session.begin_set().expect("begin set");
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..angles.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                100 + frame_id * 100,
                Arc::clone(&releases),
            ))
            .expect("provider frame");
    }
    let packets = output.packets();
    assert!(
        packets.iter().any(|packet| {
            let left = packet.equipment.tracks.iter().any(|track| {
                track.kind == EquipmentKind::MachineHandle
                    && track.held_by == maxpower_motion_sdk::EquipmentHand::Left
                    && track.association_stage
                        == maxpower_motion_sdk::EquipmentAssociationStage::GripEstablished
            });
            let right = packet.equipment.tracks.iter().any(|track| {
                track.kind == EquipmentKind::MachineHandle
                    && track.held_by == maxpower_motion_sdk::EquipmentHand::Right
                    && track.association_stage
                        == maxpower_motion_sdk::EquipmentAssociationStage::GripEstablished
            });
            left && right
        }),
        "{:#?}",
        packets
            .iter()
            .map(|packet| &packet.equipment.tracks)
            .collect::<Vec<_>>()
    );
    let closure = session.finish_set_for_assessment();
    assert!(
        packets
            .iter()
            .flat_map(|packet| &packet.completed_reps)
            .any(|rep| { rep.disposition == maxpower_motion_sdk::RepDisposition::Confirmed }),
        "reps={:#?}, local={:#?}",
        packets
            .iter()
            .flat_map(|packet| &packet.completed_reps)
            .collect::<Vec<_>>(),
        packets
            .iter()
            .map(|packet| (&packet.local_motion_coordinate, &packet.rep_state))
            .collect::<Vec<_>>()
    );

    let mut engine = ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "independent-machine-provider-lifecycle".into(),
        },
    )
    .expect("independent-machine catalog");
    let mut context = video_context("seated_independent_machine_chest_press", "front");
    context.source_capture_id = source_capture_id.into();
    context.frame_contract.width = WIDTH as u32;
    context.frame_contract.height = HEIGHT as u32;
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "independent-machine-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start independent-machine set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("canonical packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("independent-machine report")
    else {
        panic!("sealed report")
    };
    assert!(!report.rep_assessments.is_empty());
    assert!(report.trace.nodes.iter().any(|node| {
        node.kind == TraceNodeKind::PoseEquipmentFusion
            && node
                .summary
                .contains("independent equipment observed: true")
    }));
}

#[test]
fn an_external_action_asset_runs_the_real_set_lifecycle_without_a_rust_action_branch() {
    let external_catalog = ActionMotionCatalog::from_json(include_str!(
        "fixtures/asset_only_action_motion_catalog_v1.json"
    ))
    .expect("external action asset");
    let mut registry =
        visual_recognition_baseline_registry_v0_1().expect("complete installed registry");
    let preset_hash = registry
        .runtime_catalog()
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "flat_barbell_bench_press/front-oblique-right/v1")
        .expect("explicit runtime preset")
        .content_hash
        .clone();
    let package = ActionAssetPackage {
        schema_version: ACTION_ASSET_PACKAGE_SCHEMA.into(),
        package_id: "asset-only-floor-press-v1".into(),
        definition: external_catalog.definitions[0].clone(),
        contexts: vec![ActionAssetContextPackage {
            capture_view: AssessmentCaptureView::FrontObliqueRight,
            runtime_preset_bundle_id: "flat_barbell_bench_press/front-oblique-right/v1".into(),
            runtime_preset_bundle_hash: preset_hash,
        }],
        content_hash: String::new(),
    }
    .with_computed_hash();
    let package_json = serde_json::to_string(&package).expect("serializable action package");
    let receipt = registry
        .register_json(&package_json)
        .expect("one package atomically registers the external action");
    assert_eq!(receipt.action_id, "asset_only_floor_press");
    assert_eq!(receipt.bundle_ids.len(), 1);
    let catalog = registry.into_runtime_catalog();
    let plan = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(&package.definition, "front_right_45")
        .expect("generic plan");
    let runtime_bundle = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "asset_only_floor_press/front-oblique-right/v1")
        .expect("external runtime bundle");
    let profile = compile_plan_driven_runtime_binding(runtime_bundle, plan.clone());

    let source_capture_id = "fixture:external-asset-lifecycle";
    let (packets, closure) = canonical_packets_for(&profile, source_capture_id);
    let mut engine = ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "external-asset-lifecycle".into(),
        },
    )
    .expect("external asset configures without a Rust action-name branch");
    let mut context = video_context("asset_only_floor_press", "frontRight45");
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "external-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start external set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("canonical packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("sealed external report")
    else {
        panic!("sealed report")
    };
    assert_eq!(report.resolved_context.action_id, "asset_only_floor_press");
    assert!(!report.reps.is_empty());
    assert!(
        report.rep_assessments[0]
            .features
            .iter()
            .any(|feature| feature.feature_id == "motion_relation:load_press")
    );
    assert!(!report.trace.conclusion_root_ids.is_empty());
}
