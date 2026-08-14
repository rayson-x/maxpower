use std::collections::HashSet;

use maxpower_motion_sdk::{
    AssessmentAssetKind, AssessmentBundleCapability, AssessmentCaptureView,
    AssessmentEquipmentSemantics, ExecutionAssessmentEngine, LocalEquipmentMode, LocalPoseAnchor,
    WorkoutAssessmentContext, current_bodyweight_assessment_profiles_v1,
    current_cable_assessment_profiles_v1, current_dual_dumbbell_assessment_profiles_v1,
    current_machine_assessment_profiles_v1, current_motion_assessment_catalog_v4,
    current_motion_assessment_catalog_v5, current_motion_assessment_catalog_v6,
    current_motion_assessment_catalog_v7,
};

fn executable_contexts(version: u8) -> usize {
    let catalog = match version {
        4 => current_motion_assessment_catalog_v4(),
        5 => current_motion_assessment_catalog_v5(),
        6 => current_motion_assessment_catalog_v6(),
        7 => current_motion_assessment_catalog_v7(),
        _ => unreachable!(),
    };
    ExecutionAssessmentEngine::configure(
        catalog.clone(),
        WorkoutAssessmentContext {
            workout_session_id: format!("family-v{version}"),
        },
    )
    .expect("every promoted Bundle must compile atomically");
    catalog
        .bundles
        .iter()
        .filter(|bundle| bundle.capability == AssessmentBundleCapability::Executable)
        .count()
}

#[test]
fn family_catalogs_open_only_after_their_dependency_wave() {
    assert_eq!(executable_contexts(4), 18);
    assert_eq!(executable_contexts(5), 21);
    assert_eq!(executable_contexts(6), 22);
    assert_eq!(executable_contexts(7), 24);
}

#[test]
fn all_current_exact_contexts_have_distinct_executable_lineage() {
    let catalog = current_motion_assessment_catalog_v7();
    assert_eq!(catalog.bundles.len(), 24);
    assert!(
        catalog
            .bundles
            .iter()
            .all(|bundle| bundle.capability == AssessmentBundleCapability::Executable)
    );
    let bundle_hashes = catalog
        .bundles
        .iter()
        .map(|bundle| bundle.content_hash.as_str())
        .collect::<HashSet<_>>();
    assert_eq!(bundle_hashes.len(), catalog.bundles.len());
    for bundle in &catalog.bundles {
        for reference in [
            &bundle.lineage.recognition_profile,
            &bundle.lineage.execution_contract,
            &bundle.lineage.local_coordinate_strategy,
            &bundle.lineage.equipment_adapter,
            &bundle.lineage.feature_program,
            &bundle.lineage.reference_policy,
            &bundle.lineage.rule_pack,
            &bundle.lineage.set_aggregation_policy,
        ] {
            assert!(catalog.installed_assets.iter().any(|asset| {
                asset.id == reference.id && asset.content_hash == reference.content_hash
            }));
        }
    }
}

#[test]
fn action_family_strategies_preserve_their_actual_evidence_semantics() {
    assert!(
        current_cable_assessment_profiles_v1()
            .iter()
            .all(|binding| {
                !binding.profile.identity.is_empty()
                    && binding.local_coordinate_strategy.equipment_mode
                        == LocalEquipmentMode::MovingHandle
            })
    );
    assert!(
        current_machine_assessment_profiles_v1()
            .iter()
            .all(|binding| {
                binding.local_coordinate_strategy.equipment_mode == LocalEquipmentMode::MovingHandle
            })
    );
    let dumbbell = current_dual_dumbbell_assessment_profiles_v1();
    assert_eq!(dumbbell.len(), 1);
    assert_eq!(
        dumbbell[0].local_coordinate_strategy.equipment_mode,
        LocalEquipmentMode::TwoIndependentDumbbells
    );
    let body = current_bodyweight_assessment_profiles_v1();
    assert_eq!(
        body[0].local_coordinate_strategy.equipment_mode,
        LocalEquipmentMode::PoseOnly
    );
    assert_eq!(
        body[0].local_coordinate_strategy.pose_anchor,
        LocalPoseAnchor::ShoulderMidpoint
    );
    assert_eq!(
        body[1].local_coordinate_strategy.equipment_mode,
        LocalEquipmentMode::FixedSupport
    );
    assert_eq!(
        body[1].local_coordinate_strategy.pose_anchor,
        LocalPoseAnchor::ShoulderMidpoint
    );
}

#[test]
fn v7_exact_context_matrix_keeps_equipment_and_view_contracts() {
    let catalog = current_motion_assessment_catalog_v7();
    let expected = [
        (
            "lat_pulldown",
            AssessmentCaptureView::Rear,
            AssessmentEquipmentSemantics::CableOrMovingHandle,
        ),
        (
            "seated_row",
            AssessmentCaptureView::RightSide,
            AssessmentEquipmentSemantics::CableOrMovingHandle,
        ),
        (
            "single_arm_cable_lateral_raise",
            AssessmentCaptureView::RearObliqueRight,
            AssessmentEquipmentSemantics::UnilateralCableHandle,
        ),
        (
            "machine_chest_press",
            AssessmentCaptureView::Front,
            AssessmentEquipmentSemantics::ConstrainedMachineLever,
        ),
        (
            "lateral_raise",
            AssessmentCaptureView::Front,
            AssessmentEquipmentSemantics::TwoIndependentDumbbells,
        ),
        (
            "push_up",
            AssessmentCaptureView::RearObliqueRight,
            AssessmentEquipmentSemantics::BodyOnly,
        ),
        (
            "pull_up",
            AssessmentCaptureView::RearObliqueLeft,
            AssessmentEquipmentSemantics::FixedSupport,
        ),
    ];
    for (action, view, equipment) in expected {
        let bundle = catalog
            .bundles
            .iter()
            .find(|bundle| {
                bundle.exact_context.action_id == action
                    && bundle.exact_context.capture_view == view
            })
            .expect("exact context");
        assert_eq!(bundle.exact_context.equipment_semantics, equipment);
        assert_eq!(bundle.capability, AssessmentBundleCapability::Executable);
    }
}

#[test]
fn machine_chest_press_owns_press_then_return_semantics() {
    let catalog = current_motion_assessment_catalog_v5();
    for bundle in catalog.bundles.iter().filter(|bundle| {
        bundle.exact_context.action_id == "machine_chest_press"
            && bundle.capability == AssessmentBundleCapability::Executable
    }) {
        let contract = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.execution_contract.id)
            .expect("machine execution contract");
        assert_eq!(
            contract.content["phaseOrder"],
            serde_json::json!(["concentric_press", "eccentric_return"])
        );
        assert_eq!(
            contract.content["taskEndpoints"],
            serde_json::json!(["retracted_start", "visible_extension", "returned_retracted"])
        );
    }
}

#[test]
fn dual_load_bundle_fails_closed_without_declared_bilateral_thresholds() {
    let mut catalog = current_motion_assessment_catalog_v6();
    let bundle_index = catalog
        .bundles
        .iter()
        .position(|bundle| bundle.exact_context.action_id == "lateral_raise")
        .expect("lateral raise Bundle");
    let aggregation_id = catalog.bundles[bundle_index]
        .lineage
        .set_aggregation_policy
        .id
        .clone();
    let aggregation = catalog
        .installed_assets
        .iter_mut()
        .find(|asset| {
            asset.id == aggregation_id && asset.kind == AssessmentAssetKind::SetAggregationPolicy
        })
        .expect("dual-load aggregation policy");
    aggregation
        .content
        .as_object_mut()
        .expect("aggregation object")
        .remove("bilateralDifferenceThreshold");
    *aggregation = aggregation.clone().with_computed_hash();
    catalog.bundles[bundle_index].lineage.set_aggregation_policy = aggregation.reference();
    catalog.bundles[bundle_index] = catalog.bundles[bundle_index].clone().with_computed_hash();

    assert!(
        ExecutionAssessmentEngine::configure(
            catalog,
            WorkoutAssessmentContext {
                workout_session_id: "missing-bilateral-threshold".into(),
            },
        )
        .is_err(),
        "an executable dual-load Bundle must not receive implicit thresholds"
    );
}
