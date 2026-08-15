use maxpower_motion_sdk::{
    ActionMotionCatalog, ActionMotionCompiler, ActionPlanCapability, AssessmentAssetKind,
    ExecutionAssessmentEngine, FeatureJudgeability, MotionEvidenceChannel, MotionRole,
    OperatorRegistry, OperatorSourceRequirement, WorkoutAssessmentContext,
    current_motion_assessment_catalog_v12, reviewed_action_capability_matrix_v1,
    reviewed_action_motion_catalog_v1,
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
    assert_eq!(plan.capability, ActionPlanCapability::FullExecutable);
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
fn current_24_context_catalog_cannot_bypass_leaf_motion_plans() {
    let catalog = current_motion_assessment_catalog_v12();
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
fn reviewed_catalog_materializes_all_248_complete_leaf_definitions() {
    let catalog = reviewed_action_motion_catalog_v1()
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
    let matrix = reviewed_action_capability_matrix_v1()
        .expect("every complete leaf resolves to capability or admissible view refusal");
    assert_eq!(matrix.len(), 248);
    assert!(matrix.iter().all(|record| !record.action_id.is_empty()));
}

#[test]
fn exact_leaf_view_matrix_matches_the_rust_compiler_without_opening_unvalidated_actions() {
    let catalog = reviewed_action_motion_catalog_v1().unwrap();
    let matrix: serde_json::Value = serde_json::from_slice(include_bytes!(
        "../assets/action-motion-capability-matrix-v1.json"
    ))
    .expect("generated exact leaf-view matrix");
    let records = matrix["records"].as_array().expect("matrix records");
    assert_eq!(
        records.len(),
        catalog
            .definitions
            .iter()
            .map(|definition| definition.supported_views.len())
            .sum::<usize>()
    );
    let compiler = ActionMotionCompiler::new(OperatorRegistry::standard());
    for definition in &catalog.definitions {
        for view in &definition.supported_views {
            let record = records
                .iter()
                .find(|record| {
                    record["actionId"] == definition.action_id && record["captureView"] == *view
                })
                .expect("every leaf-view has one matrix record");
            let expected = match compiler.compile(definition, view) {
                Ok(plan) if plan.capability == ActionPlanCapability::FullExecutable => {
                    "full_plan_compiled"
                }
                Ok(plan)
                    if plan.capability == ActionPlanCapability::UnsupportedEquipmentCatalogOnly =>
                {
                    "unsupported_equipment_catalog_only"
                }
                Ok(_) | Err(_) => "admissible_visual_refusal",
            };
            assert_eq!(record["capabilityState"], expected);
            assert_eq!(record["userOpen"], false);
            assert_eq!(
                record["repLifecycle"],
                "not_validated_for_this_exact_leaf_view"
            );
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
fn unsupported_required_equipment_is_catalog_only_not_pose_fallback() {
    let mut catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    catalog.definitions[0].exact_identity.equipment_topology = "cable_handle".into();
    let plan = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(&catalog.definitions[0], "front_right_45")
        .expect("a complete definition resolves to an explicit capability state");
    assert_eq!(
        plan.capability,
        ActionPlanCapability::UnsupportedEquipmentCatalogOnly
    );
    assert!(plan.rep_authority.is_none());
}

#[test]
fn executable_assets_cannot_redefine_plan_phase_semantics_even_with_valid_hashes() {
    let mut catalog = current_motion_assessment_catalog_v12();
    let bundle_index = catalog
        .bundles
        .iter()
        .position(|bundle| {
            bundle.capability == maxpower_motion_sdk::AssessmentBundleCapability::Executable
        })
        .expect("v12 retains at least one executable exact context");
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
