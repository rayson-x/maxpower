use maxpower_motion_sdk::{
    ACTION_ASSET_PACKAGE_SCHEMA, ActionAssetContextPackage, ActionAssetPackage,
    ActionMotionCatalog, ActionMotionCompiler, AlgorithmModuleRegistry, AssessmentAssetKind,
    AssessmentCaptureView, ExecutionAssessmentEngine, FeatureJudgeability, MotionEvidenceChannel,
    MotionRole, OperatorRegistry, OperatorSourceRequirement, WorkoutAssessmentContext,
    installed_action_asset_inventory_v1, installed_action_motion_catalog_v1,
    visual_recognition_baseline_catalog_v0_1, visual_recognition_baseline_registry_v0_1,
};

const ASSET_ONLY_ACTION: &str = include_str!("fixtures/asset_only_action_motion_catalog_v1.json");

#[test]
fn an_unknown_action_asset_compiles_without_an_action_name_branch() {
    let catalog =
        ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).expect("valid external catalog");
    let definition = catalog.definition("asset_only_floor_press").unwrap();
    assert!(
        definition
            .relations
            .iter()
            .any(|relation| relation.role == MotionRole::TaskPrimary)
    );

    let plan = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(definition, "front_right_45")
        .expect("generic operators can compile the external action");
    assert!(
        plan.channels
            .iter()
            .any(|channel| channel.channel == MotionEvidenceChannel::VideoEquipment)
    );
    assert!(
        plan.channels
            .iter()
            .any(|channel| channel.channel == MotionEvidenceChannel::Pose)
    );
    let primary = plan
        .relations
        .iter()
        .find(|relation| relation.role == MotionRole::TaskPrimary)
        .unwrap();
    assert_eq!(
        primary.source_requirement,
        OperatorSourceRequirement::CurrentMeasuredEquipment
    );
    assert_eq!(primary.judgeability, FeatureJudgeability::RequiredForRep);
    assert_eq!(plan.projection.exact_view, "front_right_45");
    assert_eq!(
        plan.projection.relations[0].semantic_role,
        MotionRole::TaskPrimary
    );
    assert!(!plan.plan_hash.is_empty());
}

#[test]
fn action_package_registration_is_atomic_when_a_runtime_preset_is_invalid() {
    let external = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    let mut registry = visual_recognition_baseline_registry_v0_1().unwrap();
    let package = ActionAssetPackage {
        schema_version: ACTION_ASSET_PACKAGE_SCHEMA.into(),
        package_id: "invalid-atomic-package".into(),
        definition: external.definitions[0].clone(),
        contexts: vec![ActionAssetContextPackage {
            capture_view: AssessmentCaptureView::FrontObliqueRight,
            runtime_preset_bundle_id: "missing/runtime/preset".into(),
            runtime_preset_bundle_hash: "0000000000000000".into(),
        }],
        content_hash: String::new(),
    }
    .with_computed_hash();
    let before = registry.runtime_catalog().clone();
    let error = registry
        .register(package)
        .expect_err("an unknown preset must reject the complete package");
    assert!(format!("{error:?}").contains("UnknownRuntimePreset"));
    assert_eq!(registry.runtime_catalog(), &before);
}

#[test]
fn current_24_context_catalog_cannot_bypass_leaf_motion_plans() {
    let catalog = visual_recognition_baseline_catalog_v0_1();
    assert_eq!(catalog.bundles.len(), 24);
    assert_eq!(catalog.action_motion_bindings.len(), 24);
    ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "unified-motion-contract".into(),
        },
    )
    .expect("all current contexts pass leaf and exact-view plan admission");
}

#[test]
fn an_untrained_range_rule_is_materialized_as_cannot_judge_not_quality() {
    let catalog = visual_recognition_baseline_catalog_v0_1();
    let bundle = catalog
        .bundles
        .first()
        .expect("the baseline owns exact action/view bundles");
    let rule_pack = catalog
        .installed_assets
        .iter()
        .find(|asset| asset.id == bundle.lineage.rule_pack.id)
        .expect("bundle rule pack");
    let rule = rule_pack
        .content
        .get("repRules")
        .and_then(serde_json::Value::as_array)
        .unwrap()
        .iter()
        .find(|rule| {
            rule.get("dimension").and_then(serde_json::Value::as_str) == Some("range_of_motion")
        })
        .unwrap();
    assert_eq!(
        rule.get("operator").and_then(serde_json::Value::as_str),
        Some("abstain")
    );
    assert_eq!(
        rule.get("reason").and_then(serde_json::Value::as_str),
        Some("no_governed_action_view_range_quality_rule")
    );
    let feature_program_ids = catalog
        .bundles
        .iter()
        .map(|bundle| bundle.lineage.feature_program.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let rule_pack_ids = catalog
        .bundles
        .iter()
        .map(|bundle| bundle.lineage.rule_pack.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(feature_program_ids.len(), catalog.bundles.len());
    assert_eq!(rule_pack_ids.len(), catalog.bundles.len());
}

#[test]
fn reviewed_catalog_materializes_all_248_complete_leaf_definitions() {
    let catalog = installed_action_motion_catalog_v1()
        .expect("reviewed asset must pass completeness and hash admission");
    assert_eq!(catalog.definitions.len(), 248);
    assert!(
        catalog
            .definitions
            .iter()
            .all(|definition| definition.executable_leaf)
    );
    assert!(catalog.definitions.iter().all(|definition| {
        [
            definition.exact_identity.posture.as_str(),
            definition.exact_identity.support.as_str(),
            definition.exact_identity.laterality.as_str(),
        ]
        .into_iter()
        .all(|value| !value.is_empty() && value != "context_declared")
    }));
    for (action_id, topology) in [
        ("trap_bar_deadlift", "trap_bar"),
        ("goblet_kettlebell_squat", "kettlebell"),
        ("plate_front_raise", "weight_plate"),
        ("band_assisted_pull_up", "resistance_band"),
    ] {
        assert_eq!(
            catalog
                .definition(action_id)
                .unwrap()
                .exact_identity
                .equipment_topology,
            topology,
            "unsupported equipment must retain its exact topology instead of borrowing a supported adapter",
        );
    }
    let row = catalog.definition("pronated_barbell_row").unwrap();
    let deadlift = catalog.definition("conventional_barbell_deadlift").unwrap();
    assert!(row.relations.iter().any(|relation| {
        relation.relation_id == "hip_drive_substitution"
            && relation.role == MotionRole::SubstitutionGuard
    }));
    assert!(deadlift.relations.iter().any(|relation| {
        relation.relation_id == "hip_extension_coordination"
            && relation.role == MotionRole::CoordinatedMotion
    }));
    assert!(deadlift.relations.iter().any(|relation| {
        relation.relation_id == "knee_extension_coordination"
            && relation.role == MotionRole::CoordinatedMotion
    }));
    assert_ne!(
        row.relations
            .iter()
            .map(|relation| (&relation.relation_id, relation.role))
            .collect::<Vec<_>>(),
        deadlift
            .relations
            .iter()
            .map(|relation| (&relation.relation_id, relation.role))
            .collect::<Vec<_>>(),
        "row hip motion is substitution evidence while deadlift hip extension is task coordination",
    );
}

#[test]
fn row_and_deadlift_encode_different_joint_and_substitution_causality() {
    let catalog = installed_action_motion_catalog_v1().expect("installed catalog");
    let row = catalog
        .definition("pronated_barbell_row")
        .expect("row leaf");
    let deadlift = catalog
        .definition("conventional_barbell_deadlift")
        .expect("deadlift leaf");
    assert!(row.relations.iter().any(|relation| {
        relation.relation_id == "hip_drive_substitution"
            && relation.role == MotionRole::SubstitutionGuard
    }));
    assert!(
        !row.relations
            .iter()
            .any(|relation| relation.relation_id == "hip_extension_coordination")
    );
    assert!(deadlift.relations.iter().any(|relation| {
        relation.relation_id == "hip_extension_coordination"
            && relation.role == MotionRole::CoordinatedMotion
    }));
    assert!(deadlift.relations.iter().any(|relation| {
        relation.relation_id == "knee_extension_coordination"
            && relation.role == MotionRole::CoordinatedMotion
    }));
    assert!(
        !deadlift
            .relations
            .iter()
            .any(|relation| relation.relation_id == "hip_drive_substitution")
    );
}

#[test]
fn installed_leafs_keep_all_assets_but_refuse_geometrically_invalid_exact_views() {
    let inventory = installed_action_asset_inventory_v1()
        .expect("the complete action library must compile through one runtime path");
    assert_eq!(inventory.leaf_action_count, 248);
    assert_eq!(inventory.exact_view_count, 1_984);
    assert!(inventory.identity_unobservable_view_count > 0);
    let registry = visual_recognition_baseline_registry_v0_1()
        .expect("the runtime registry must accept the structurally complete library");
    assert_eq!(registry.inventory(), &inventory);

    let catalog = installed_action_motion_catalog_v1().unwrap();
    let runtime = registry.runtime_catalog();
    assert_eq!(runtime.action_definitions.len(), 248);
    assert!(runtime.bundles.len() < 1_984);
    assert_eq!(runtime.bundles.len(), runtime.action_motion_bindings.len());
    ExecutionAssessmentEngine::configure(
        runtime.clone(),
        WorkoutAssessmentContext {
            workout_session_id: "complete-action-library-runtime".into(),
        },
    )
    .expect("every installed action/view Bundle must compile into the assessment runtime");
    let compiler = ActionMotionCompiler::new(OperatorRegistry::standard());
    for definition in &catalog.definitions {
        assert_eq!(definition.supported_views.len(), 8);
        let installed = runtime
            .action_definitions
            .iter()
            .find(|candidate| candidate.action_id == definition.action_id)
            .unwrap_or_else(|| panic!("{} is absent from the runtime", definition.action_id));
        assert!(installed.supported_views.len() <= 8);
        for view_binding in &installed.supported_views {
            assert!(runtime.bundles.iter().any(|bundle| {
                bundle.bundle_id == view_binding.bundle_id
                    && bundle.exact_context.action_id == definition.action_id
                    && bundle.exact_context.capture_view == view_binding.capture_view
            }));
            assert!(runtime.action_motion_bindings.iter().any(|binding| {
                binding.bundle_id == view_binding.bundle_id
                    && binding.leaf_action_id == definition.action_id
            }));
        }
        for view in &definition.supported_views {
            match compiler.compile(definition, view) {
                Ok(_) => {}
                Err(maxpower_motion_sdk::ActionMotionError::IdentityRelationNotObservable {
                    ..
                }) => {}
                Err(error) => panic!("{} / {view}: {error:?}", definition.action_id),
            }
        }
    }
}

#[test]
fn a_view_cannot_replace_an_identity_defining_equipment_motion_with_wrists() {
    let mut catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    catalog.definitions[0].relations[0].operator_id = "point_displacement".into();
    catalog.definitions[0].relations[0].inputs[0].source = "left_wrist".into();
    let error = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(&catalog.definitions[0], "front_right_45")
        .expect_err("a proxy signal cannot replace the declared equipment primary");
    assert!(format!("{error:?}").contains("IdentitySourceConflict"));
}

#[test]
fn an_exact_view_refuses_when_its_primary_relation_is_not_declared_visible() {
    let mut catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    let view = catalog.definitions[0]
        .view_observation_plans
        .iter_mut()
        .find(|plan| plan.view_id == "front_right_45")
        .unwrap();
    view.visible_relation_ids
        .retain(|relation| relation != "load_press");

    let error = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(&catalog.definitions[0], "front_right_45")
        .expect_err("an identity relation cannot be implied by an installed operator");
    assert!(format!("{error:?}").contains("IdentityRelationNotObservable"));
}

#[test]
fn changing_the_view_topology_changes_the_preseal_runtime_plan() {
    let catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    let definition = &catalog.definitions[0];
    let initial = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(definition, "front_right_45")
        .unwrap();
    assert_eq!(initial.rep_topology.primary_relation_id, "load_press");
    assert_eq!(initial.rep_topology.minimum_excursion_milli, 140);
    assert_eq!(
        initial.view_observation.rep_topology, initial.rep_topology,
        "the exact-view topology is part of the frozen executable plan"
    );

    let runtime_binding = maxpower_motion_sdk::visual_recognition_baseline_profiles_v0_1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("installed exact context");
    let runtime_plan = runtime_binding.motion_plan.as_ref().unwrap();
    assert_eq!(
        runtime_binding.profile.start_amplitude,
        runtime_plan.rep_topology.start_threshold(),
        "the candidate engine must consume the topology asset, not a global fallback"
    );
    assert_eq!(
        runtime_binding.profile.min_primary_amplitude,
        runtime_plan.rep_topology.minimum_excursion(),
    );
    assert_eq!(
        runtime_binding.profile.max_gap_ms,
        runtime_plan.rep_topology.maximum_gap_ms,
    );
    assert_eq!(
        runtime_binding.profile.state_machine_id,
        format!(
            "action-plan-topology/{}/dwell-{}ms/v1",
            runtime_plan.rep_topology.topology_id, runtime_plan.rep_topology.minimum_phase_dwell_ms
        ),
        "the exact topology and its phase dwell must select the pre-seal state graph"
    );
}

#[test]
fn an_equipment_primary_plan_selects_a_closed_module_graph_with_independent_fusion() {
    let catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    let definition = &catalog.definitions[0];
    let plan = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(definition, "front_right_45")
        .expect("the exact plan selects the registered module graph");
    let ids = plan
        .algorithm_modules
        .iter()
        .map(|module| module.module_id.as_str())
        .collect::<Vec<_>>();
    assert!(ids.contains(&"equipment_observation"));
    assert!(ids.contains(&"equipment_fusion"));
    assert_eq!(
        plan.equipment_provider
            .as_ref()
            .map(|provider| provider.provider_id.as_str()),
        Some("visual_rigid_bar_axis_v1"),
        "the compiler, not a host mode flag, chooses the equipment provider"
    );
    let topology = plan
        .algorithm_modules
        .iter()
        .find(|module| module.module_id == "rep_topology")
        .unwrap();
    assert!(topology.required_inputs.iter().any(|fact| {
        fact.fact_id == "subject_equipment_association"
            && fact.evidence.source_lineage
            && fact.evidence.event_clock
            && fact.evidence.causal_age
            && fact.evidence.coverage
            && fact.evidence.confidence
            && fact.evidence.uncertainty
    }));

    let mut missing_fusion = definition.clone();
    missing_fusion.view_observation_plans[0]
        .rep_topology
        .algorithm_module_ids
        .retain(|id| id != "equipment_fusion");
    let error = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(&missing_fusion, "front_right_45")
        .expect_err("an equipment primary cannot omit independent fusion");
    assert!(format!("{error:?}").contains("RequiredAlgorithmModuleNotSelected"));
}

#[test]
fn module_registry_rejects_unregistered_or_duplicate_module_contracts() {
    let catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    let definition = &catalog.definitions[0];
    let error = ActionMotionCompiler::with_modules(
        OperatorRegistry::standard(),
        AlgorithmModuleRegistry::empty(),
    )
    .compile(definition, "front_right_45")
    .expect_err("a selected module must be registered");
    assert!(format!("{error:?}").contains("MissingAlgorithmModule"));

    let standard = AlgorithmModuleRegistry::standard();
    let duplicate = standard.descriptor("pose_relation").unwrap().clone();
    let error = AlgorithmModuleRegistry::from_descriptors(vec![duplicate.clone(), duplicate])
        .expect_err("a module identity cannot declare a second semantic contract");
    assert!(format!("{error:?}").contains("DuplicateAlgorithmModule"));
}

#[test]
fn equipment_topology_never_changes_or_downgrades_the_declared_primary_relation() {
    let mut catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    catalog.definitions[0].exact_identity.equipment_topology = "cable_handle".into();
    let error = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(&catalog.definitions[0], "front_right_45")
        .expect_err("an equipment-primary relation requires a matching Rust provider");
    assert!(format!("{error:?}").contains("MissingEquipmentProvider"));
}

#[test]
fn executable_assets_cannot_redefine_plan_phase_semantics_even_with_valid_hashes() {
    let mut catalog = visual_recognition_baseline_catalog_v0_1();
    let bundle_index = catalog
        .bundles
        .iter()
        .position(|_| true)
        .expect("v0_1 retains at least one executable exact context");
    let asset_id = catalog.bundles[bundle_index]
        .lineage
        .execution_contract
        .id
        .clone();
    let asset = catalog
        .installed_assets
        .iter_mut()
        .find(|asset| asset.id == asset_id && asset.kind == AssessmentAssetKind::ExecutionContract)
        .expect("execution contract asset");
    asset.content["phaseOrder"] = serde_json::json!(["invented_effort", "invented_return"]);
    *asset = asset.clone().with_computed_hash();
    catalog.bundles[bundle_index].lineage.execution_contract = asset.reference();
    catalog.bundles[bundle_index] = catalog.bundles[bundle_index].clone().with_computed_hash();

    let error = match ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "semantic-conflict".into(),
        },
    ) {
        Ok(_) => panic!("a rehashed legacy asset cannot override the motion plan"),
        Err(error) => error,
    };
    assert!(format!("{error:?}").contains("ActionMotionDefinition semantic authority"));
}
