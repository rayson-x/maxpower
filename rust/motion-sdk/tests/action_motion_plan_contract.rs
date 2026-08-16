use maxpower_motion_sdk::{
    ACTION_ASSET_PACKAGE_SCHEMA, ActionAssetContextPackage, ActionAssetPackage,
    ActionMotionCatalog, ActionMotionCompiler, AlgorithmFactObservation, AlgorithmFactState,
    AlgorithmInvocationDisposition, AlgorithmModuleRegistry, AssessmentAssetKind,
    AssessmentCaptureView, EvidenceMissingConsequence, ExecutionAssessmentEngine,
    ExerciseSignalKind, FeatureJudgeability, LocalActionAxisDirection, LocalPoseAnchor,
    MotionEvidenceChannel, MotionRole, MotionValueType, OperatorRegistry,
    OperatorSourceRequirement, RelationTemporalPattern, WorkoutAssessmentContext,
    compile_action_plan_runtime_binding, compile_action_recognition_binding,
    installed_action_asset_inventory_v1, installed_action_motion_catalog_v1,
    visual_recognition_baseline_catalog_v0_1, visual_recognition_baseline_registry_v0_1,
};

const ASSET_ONLY_ACTION: &str = include_str!("fixtures/asset_only_action_motion_catalog_v1.json");

#[test]
fn action_card_entry_exposes_a_recommended_and_only_executable_view_set() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    let entry = catalog
        .entry_options("flat_barbell_bench_press")
        .expect("an installed action has entry options");
    assert_eq!(entry.action_id, "flat_barbell_bench_press");
    assert!(entry.available_views.contains(&entry.recommended_view));
    assert!(entry.available_views.contains(&"front".to_owned()));
    assert!(
        !entry.available_views.contains(&"left_side".to_owned()),
        "a caller must not be offered an exact view whose identity relation cannot compile",
    );
    let compiler = ActionMotionCompiler::new(OperatorRegistry::standard());
    let definition = catalog.definition(&entry.action_id).unwrap();
    for view in &entry.available_views {
        compiler
            .compile(definition, view)
            .unwrap_or_else(|error| panic!("offered view {view} must compile: {error:?}"));
    }

    let seated_row = catalog
        .entry_options("seated_bilateral_cable_row")
        .expect("bilateral row entry options");
    assert!(
        seated_row.available_views.contains(&"right_side".into()),
        "the token `bilateral` must never be misclassified as a lateral-plane action"
    );
    let seated_row_binding =
        compile_action_recognition_binding(&catalog, "seated_bilateral_cable_row", "right_side")
            .expect("side-view seated row binding");
    assert_eq!(
        seated_row_binding
            .local_coordinate_strategy
            .preparation_to_effort,
        LocalActionAxisDirection::PreparationToEffortRight
    );
}

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
fn registered_action_data_needs_only_action_and_view_to_build_the_runtime() {
    let catalog =
        ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).expect("valid external catalog");
    let binding =
        compile_action_recognition_binding(&catalog, "asset_only_floor_press", "front_right_45")
            .expect("registered data selects its complete Rust runtime");
    let plan = binding.motion_plan.as_ref().expect("compiled plan");
    assert_eq!(plan.action_id, "asset_only_floor_press");
    assert_eq!(plan.capture_view, "front_right_45");
    assert!(plan.equipment_provider.is_some());
    assert!(binding.profile.identity.contains(&plan.plan_hash));
}

#[test]
fn every_compiled_installed_action_view_materializes_the_same_plan_owned_runtime() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    let compiler = ActionMotionCompiler::new(OperatorRegistry::standard());
    let mut executable_contexts = 0_usize;
    for definition in &catalog.definitions {
        for view in &definition.supported_views {
            let plan = match compiler.compile(definition, view) {
                Ok(plan) => plan,
                Err(maxpower_motion_sdk::ActionMotionError::IdentityRelationNotObservable {
                    ..
                }) => continue,
                Err(error) => panic!(
                    "installed action {} / {} must compile or typed-refuse: {error:?}",
                    definition.action_id, view
                ),
            };
            let plan_hash = plan.plan_hash.clone();
            let topology = plan.rep_topology.topology_id.clone();
            let binding = compile_action_plan_runtime_binding(plan)
                .expect("every compiled action plan has a Rust-owned runtime binding");
            assert!(
                binding
                    .profile
                    .identity
                    .ends_with(&format!("action-plan-{plan_hash}"))
            );
            assert!(binding.profile.state_machine_id.contains(&topology));
            executable_contexts += 1;
        }
    }
    assert!(
        executable_contexts > 0,
        "the installed catalog must contain executable exact contexts"
    );
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
fn current_exact_context_catalog_cannot_bypass_leaf_motion_plans() {
    let catalog = visual_recognition_baseline_catalog_v0_1();
    assert_eq!(catalog.bundles.len(), 24);
    assert_eq!(catalog.action_motion_bindings.len(), catalog.bundles.len());
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
fn every_leaf_explains_why_each_relation_and_track_is_needed() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    for definition in &catalog.definitions {
        assert!(
            definition.relations.iter().all(|relation| {
                !relation.semantic_statement.trim().is_empty()
                    && !relation.evidence_rationale.trim().is_empty()
                    && !relation.expected_pattern.trim().is_empty()
            }),
            "{} has an unexplained relation",
            definition.action_id,
        );
        assert!(
            !definition.variant_statement.trim().is_empty(),
            "{} must preserve its leaf-specific distinction",
            definition.action_id,
        );
        assert!(
            definition.tracks.iter().all(|track| {
                !track.evidence_rationale.trim().is_empty()
                    && !track.supports_relation_ids.is_empty()
                    && track.supports_relation_ids.iter().all(|relation_id| {
                        definition
                            .relations
                            .iter()
                            .any(|relation| &relation.relation_id == relation_id)
                    })
            }),
            "{} has an unexplained or dangling motion track",
            definition.action_id,
        );

        let explanation = catalog
            .explain_action(&definition.action_id)
            .expect("every registered action must explain its own definition");
        assert_eq!(explanation.action_id, definition.action_id);
        assert_eq!(explanation.variant_statement, definition.variant_statement);
        assert!(!explanation.primary_relation.evidence_rationale.is_empty());
        assert!(!explanation.skeleton_trajectories.is_empty());
        assert!(!explanation.rep_boundary.turnaround.is_empty());
    }
}

#[test]
fn action_explanation_separates_equipment_skeleton_and_joint_evidence() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    let bench = catalog
        .explain_action("flat_barbell_bench_press")
        .expect("bench definition");
    assert_eq!(
        bench.primary_relation.input_sources,
        vec!["equipment_axis_center"]
    );
    assert!(bench.primary_relation.required_for_rep);
    assert!(
        bench
            .equipment_trajectories
            .iter()
            .any(|item| item.input_sources == ["equipment_axis_center"])
    );
    assert!(
        bench
            .joint_angles
            .iter()
            .any(|item| { item.input_sources == ["left_shoulder", "left_elbow", "left_wrist"] })
    );
    assert!(
        bench
            .skeleton_trajectories
            .iter()
            .any(|item| item.input_sources.contains(&"hip_midpoint".to_owned()))
    );
}

#[test]
fn unsupported_equipment_is_declared_but_skeleton_primary_is_explicit() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    for (action_id, equipment_source) in [
        ("seated_bilateral_cable_row", "cable_handle_center"),
        ("narrow_landmine_row", "landmine_load_point"),
        ("trap_bar_deadlift", "trap_bar_center"),
        ("goblet_kettlebell_squat", "kettlebell_center"),
        ("plate_front_raise", "weight_plate_center"),
    ] {
        let definition = catalog.definition(action_id).expect("registered action");
        let primary = definition
            .relations
            .iter()
            .find(|relation| relation.role == MotionRole::TaskPrimary)
            .expect("task primary");
        assert!(
            primary
                .inputs
                .iter()
                .all(|input| !input.source.contains("equipment")
                    && !input.source.contains("handle_center")
                    && !input.source.contains("load_point")
                    && !input.source.contains("bar_center")),
            "{action_id} must explicitly stay skeleton-primary until its provider exists",
        );
        let explanation = catalog
            .explain_action(action_id)
            .expect("action explanation");
        let equipment = explanation
            .equipment_trajectories
            .iter()
            .find(|item| item.input_sources.contains(&equipment_source.to_owned()))
            .unwrap_or_else(|| panic!("{action_id} must retain its exact equipment trajectory"));
        assert!(!equipment.required_for_rep);
        assert_eq!(
            equipment.missing_consequence,
            EvidenceMissingConsequence::DimensionCannotJudge
        );
        assert!(
            equipment
                .evidence_rationale
                .contains("不得由手腕或骨架伪装")
        );
    }
}

#[test]
fn all_declared_equipment_topologies_have_an_equipment_or_support_explanation() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    for definition in &catalog.definitions {
        if definition.exact_identity.equipment_topology == "none" {
            continue;
        }
        let explanation = catalog
            .explain_action(&definition.action_id)
            .expect("action explanation");
        assert!(
            !explanation.equipment_trajectories.is_empty(),
            "{} declares {} but does not explain its equipment/support evidence",
            definition.action_id,
            definition.exact_identity.equipment_topology,
        );
    }
}

#[test]
fn composite_families_keep_leaf_specific_identity_motion_and_rep_boundaries() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    for (left, right) in [
        ("bent_over_dumbbell_rear_delt_fly", "barbell_upright_row"),
        (
            "bilateral_seated_leg_extension",
            "bilateral_seated_leg_curl",
        ),
        ("floor_sit_up", "floor_crunch"),
        ("march_in_place", "side_step_touch"),
        ("side_step_touch", "jumping_jack"),
    ] {
        let left = catalog.explain_action(left).expect("left leaf explanation");
        let right = catalog
            .explain_action(right)
            .expect("right leaf explanation");
        assert_ne!(
            left.primary_relation.semantic_statement, right.primary_relation.semantic_statement,
            "sibling leaves must not share a broad family identity statement",
        );
        assert_ne!(
            left.rep_boundary.turnaround, right.rep_boundary.turnaround,
            "sibling leaves must retain their own Rep endpoint semantics",
        );
    }
}

#[test]
fn a_definition_with_two_identity_primaries_is_rejected() {
    let mut catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    let mut duplicate = catalog.definitions[0].relations[0].clone();
    duplicate.relation_id = "second_identity_primary".into();
    catalog.definitions[0].relations.push(duplicate);
    catalog.definitions[0].tracks[0]
        .supports_relation_ids
        .push("second_identity_primary".into());
    catalog.definitions[0].content_hash.clear();
    let serialized = serde_json::to_string(&catalog).unwrap();
    let error = ActionMotionCatalog::from_json(&serialized)
        .expect_err("one action cannot own two identity-defining primaries");
    assert!(format!("{error:?}").contains("DefinitionBuildFailure"));
}

#[test]
fn representative_leafs_expose_their_exact_body_load_and_joint_strategy() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");

    let bodyweight_squat = catalog
        .explain_action("bodyweight_air_squat")
        .expect("bodyweight squat");
    assert_eq!(
        bodyweight_squat.primary_relation.input_sources,
        ["hip_midpoint"]
    );
    assert!(
        bodyweight_squat
            .joint_angles
            .iter()
            .any(|item| { item.input_sources == ["left_hip", "left_knee", "left_ankle"] })
    );

    let barbell_squat = catalog
        .explain_action("high_bar_back_squat")
        .expect("barbell squat");
    assert_eq!(
        barbell_squat.primary_relation.input_sources,
        ["equipment_axis_center"]
    );
    assert!(
        barbell_squat
            .skeleton_trajectories
            .iter()
            .any(|item| { item.input_sources.contains(&"shoulder_hip_axis".to_owned()) })
    );

    let lateral_raise = catalog
        .explain_action("standing_bilateral_dumbbell_lateral_raise")
        .expect("dumbbell lateral raise");
    assert_eq!(
        lateral_raise.primary_relation.input_sources,
        ["dumbbell_center"]
    );
    assert!(
        lateral_raise
            .joint_angles
            .iter()
            .any(|item| { item.input_sources == ["left_hip", "left_shoulder", "left_wrist"] })
    );

    let unilateral_cable = catalog
        .explain_action("seated_single_arm_cable_row")
        .expect("unilateral cable row");
    assert_eq!(unilateral_cable.exact_identity.laterality, "unilateral");
    assert_eq!(
        unilateral_cable.primary_relation.input_sources,
        ["left_wrist"]
    );
    assert!(unilateral_cable.equipment_trajectories.iter().any(|item| {
        item.input_sources == ["cable_handle_center"]
            && item.missing_consequence == EvidenceMissingConsequence::DimensionCannotJudge
    }));

    let encoded = serde_json::to_value(unilateral_cable).expect("serializable explanation");
    assert_eq!(
        encoded
            .get("primaryRelation")
            .and_then(|value| value.get("missingConsequence"))
            .and_then(serde_json::Value::as_str),
        Some("rep_refusal")
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
    assert_eq!(
        inventory.catalog_id,
        "maxpower/installed-action-motion-leaves/v1"
    );
    assert_eq!(inventory.leaf_action_count, 248);
    assert_eq!(inventory.exact_view_count, 1_984);
    assert_eq!(inventory.identity_unobservable_view_count, 304);
    assert_eq!(
        inventory.exact_view_count - inventory.identity_unobservable_view_count,
        1_680
    );
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
        runtime_binding.profile.return_tolerance,
        runtime_plan.rep_topology.return_tolerance(),
        "the endpoint-return contract must execute before candidate sealing",
    );
    assert_eq!(
        runtime_binding.profile.state_machine_id,
        format!(
            "action-plan-topology/{}/phases-{}/dwell-{}ms/v1",
            runtime_plan.rep_topology.topology_id,
            runtime_plan.phases.len(),
            runtime_plan.rep_topology.minimum_phase_dwell_ms
        ),
        "the exact topology and its phase dwell must select the pre-seal state graph"
    );
}

#[test]
fn equipment_primary_runtime_never_uses_a_pose_fallback_signal() {
    let catalog = ActionMotionCatalog::from_json(ASSET_ONLY_ACTION).unwrap();
    let plan = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(&catalog.definitions[0], "front_right_45")
        .unwrap();
    let binding = compile_action_plan_runtime_binding(plan).unwrap();
    assert_eq!(
        binding.profile.primary_signal.kind,
        ExerciseSignalKind::LocalAlongAxisProgress,
        "an equipment-primary action must stop candidate segmentation when measured equipment is absent",
    );
}

#[test]
fn axial_rotation_actions_use_a_projected_joint_relation_without_endpoint_substitution() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    for action_id in [
        "seated_arnold_press",
        "standing_arnold_press",
        "standing_elbow_tucked_cable_external_rotation",
        "standing_abducted_cable_external_rotation",
        "side_lying_dumbbell_external_rotation",
        "seated_supported_dumbbell_external_rotation",
        "linked_machine_external_rotation",
    ] {
        let definition = catalog.definition(action_id).expect("reviewed leaf");
        assert!(
            definition
                .limited_claims
                .iter()
                .any(|claim| claim.contains("三维") || claim.contains("3D")),
            "{action_id} must bound the projected operator's claim",
        );
        assert_eq!(
            definition.relations[0].operator_id,
            "projected_shoulder_rotation"
        );
        let entry = catalog
            .entry_options(action_id)
            .expect("every installed axial-rotation action has executable projected views");
        assert!(entry.available_views.contains(&"front".into()));
        assert!(!entry.available_views.contains(&"left_side".into()));
        assert!(!entry.available_views.contains(&"right_side".into()));
        let binding = compile_action_recognition_binding(&catalog, action_id, "front")
            .expect("front projected rotation context");
        assert_eq!(
            binding.local_coordinate_strategy.pose_anchor,
            LocalPoseAnchor::LeftWrist
        );
        assert_eq!(
            binding.local_coordinate_strategy.preparation_to_effort,
            if action_id.contains("arnold") {
                LocalActionAxisDirection::PreparationToEffortUp
            } else {
                LocalActionAxisDirection::PreparationToEffortRight
            }
        );
        if matches!(
            action_id,
            "seated_arnold_press" | "standing_arnold_press" | "linked_machine_external_rotation"
        ) {
            let provider = binding
                .motion_plan
                .as_ref()
                .and_then(|plan| plan.equipment_provider.as_ref())
                .expect("an available equipment Provider remains selected as corroboration");
            assert!(!provider.required_for_rep);
            assert_eq!(
                binding.profile.primary_signal.kind,
                ExerciseSignalKind::ActionPrimaryRelationScalar,
                "the projected joint relation must drive segmentation while optional equipment remains corroboration",
            );
        }
    }
}

#[test]
fn pose_primary_runtime_uses_the_task_primary_anchor_from_the_action_asset() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    let squat = compile_action_recognition_binding(&catalog, "bodyweight_air_squat", "front")
        .expect("bodyweight squat binding");
    assert_eq!(
        squat.local_coordinate_strategy.pose_anchor,
        LocalPoseAnchor::HipMidpoint
    );
    let calf = compile_action_recognition_binding(&catalog, "single_leg_calf_raise", "front")
        .expect("calf raise binding");
    assert_eq!(
        calf.local_coordinate_strategy.pose_anchor,
        LocalPoseAnchor::LeftAnkle
    );
}

#[test]
fn leaf_claims_and_phases_are_asset_specific_not_catalog_wide_defaults() {
    let catalog = installed_action_motion_catalog_v1().expect("installed action catalog");
    let distinct_claim_sets = catalog
        .definitions
        .iter()
        .map(|definition| definition.allowed_claims.clone())
        .collect::<std::collections::HashSet<_>>();
    assert!(
        distinct_claim_sets.len() > 1,
        "reviewed limited claims must constrain the claims each leaf can publish",
    );
    assert!(catalog.definitions.iter().all(|definition| {
        !definition.limited_claims.is_empty()
            && definition
                .limited_claims
                .iter()
                .all(|claim| !claim.trim().is_empty())
    }));

    let box_squat = catalog.definition("box_squat").unwrap();
    assert_eq!(
        box_squat.view_observation_plans[0].rep_topology.topology_id,
        "multi_stage_cycle/v1"
    );
    assert!(
        box_squat
            .phases
            .iter()
            .any(|phase| phase.phase_id == "visible_bottom_pause")
    );

    for action_id in [
        "walking_lunge",
        "side_step_touch",
        "resistance_band_lateral_walk",
        "crossover_side_step",
    ] {
        let definition = catalog.definition(action_id).unwrap();
        assert_eq!(
            definition.view_observation_plans[0]
                .rep_topology
                .topology_id,
            "locomotion_step_cycle/v1",
            "{action_id} must count the asset-defined step, not a generic pose round trip",
        );
        assert!(definition.phases.len() >= 3);
    }

    let crossover = catalog.definition("crossover_side_step").unwrap();
    let crossover_primary = crossover
        .relations
        .iter()
        .find(|relation| relation.role == MotionRole::TaskPrimary)
        .unwrap();
    assert_eq!(crossover_primary.operator_id, "relative_horizontal_offset");
    assert_eq!(
        crossover_primary.temporal_pattern,
        RelationTemporalPattern::CrossZeroRoundTrip
    );
    assert_eq!(
        crossover.tracks[0].source, "pose_ankle_crossing",
        "the explanation track must describe the same signed relation the runtime executes",
    );

    let step_jack = catalog.definition("step_jack").unwrap();
    let jumping_jack = catalog.definition("jumping_jack").unwrap();
    assert_eq!(step_jack.tracks[0].source, "pose_active_ankle_offset");
    assert_eq!(step_jack.exact_identity.laterality, "alternating");
    assert_eq!(jumping_jack.tracks[0].source, "pose_ankle_separation");
    assert_eq!(
        jumping_jack.exact_identity.laterality,
        "bilateral_synchronous"
    );

    let march = catalog.definition("march_in_place").unwrap();
    let high_knees = catalog.definition("high_knees").unwrap();
    assert_eq!(march.tracks[0].source, "pose_active_hip_flexion");
    assert_eq!(high_knees.tracks[0].source, "pose_active_hip_flexion");
    assert!(
        high_knees.view_observation_plans[0]
            .rep_topology
            .maximum_rep_duration_ms
            < march.view_observation_plans[0]
                .rep_topology
                .maximum_rep_duration_ms,
        "high knees must select its declared fast cadence profile instead of the march profile",
    );

    let weighted_march = catalog
        .definition("double_dumbbell_weighted_march_in_place")
        .unwrap();
    assert_eq!(weighted_march.tracks[0].source, "pose_active_hip_flexion");
    assert_eq!(weighted_march.rep_boundary.activation, "pose_ready");
    assert_eq!(weighted_march.rep_boundary.release, "set_closure");
    assert!(weighted_march.tracks.iter().any(|track| {
        track.source == "dumbbell"
            && !track.required
            && track.evidence_rationale.contains("独立观测")
    }));
}

#[test]
fn algorithm_module_runtime_applies_age_missing_and_conflict_policies() {
    let registry = AlgorithmModuleRegistry::standard();
    let topology = registry.descriptor("rep_topology").unwrap();
    let present = AlgorithmFactObservation {
        fact_id: "local_coordinate".into(),
        value_type: MotionValueType::Scalar,
        state: AlgorithmFactState::Observed,
        age_ms: 0,
    };
    assert_eq!(
        topology.evaluate_invocation(&[present.clone()]),
        AlgorithmInvocationDisposition::Execute,
    );
    assert_eq!(
        topology.evaluate_invocation(&[]),
        AlgorithmInvocationDisposition::NeedsReview,
        "the declared missing policy must govern the invocation",
    );
    assert_eq!(
        topology.evaluate_invocation(&[AlgorithmFactObservation {
            state: AlgorithmFactState::Conflict,
            ..present.clone()
        }]),
        AlgorithmInvocationDisposition::RejectCandidate,
        "the declared conflict policy must govern the invocation",
    );
    assert_eq!(
        topology.evaluate_invocation(&[AlgorithmFactObservation {
            age_ms: topology.maximum_causal_age_ms + 1,
            ..present
        }]),
        AlgorithmInvocationDisposition::NeedsReview,
        "stale facts are missing evidence, not executable inputs",
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
