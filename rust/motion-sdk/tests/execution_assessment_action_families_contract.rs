use std::collections::HashSet;

use maxpower_motion_sdk::{
    AssessmentAssetKind, AssessmentCaptureView, AssessmentEquipmentSemantics,
    ExecutionAssessmentEngine, LocalEquipmentMode, LocalPoseAnchor, WorkoutAssessmentContext,
    current_bodyweight_assessment_profiles_v1, current_cable_assessment_profiles_v1,
    current_dual_dumbbell_assessment_profiles_v1, current_machine_assessment_profiles_v1,
    visual_recognition_baseline_catalog_v0_1,
};

#[test]
fn all_current_exact_contexts_have_distinct_executable_lineage() {
    let catalog = visual_recognition_baseline_catalog_v0_1();
    assert_eq!(catalog.bundles.len(), 24);
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
    let catalog = visual_recognition_baseline_catalog_v0_1();
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
    }
}

#[test]
fn machine_chest_press_uses_its_installed_motion_plan_semantics() {
    let catalog = visual_recognition_baseline_catalog_v0_1();
    for bundle in catalog
        .bundles
        .iter()
        .filter(|bundle| bundle.exact_context.action_id == "machine_chest_press")
    {
        let contract = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.execution_contract.id)
            .expect("machine execution contract");
        assert_eq!(
            contract.content["phaseOrder"],
            serde_json::json!(["outbound", "return"])
        );
        assert_eq!(
            contract.content["taskEndpoints"],
            serde_json::json!([
                "declared_start_endpoint_departure",
                "手柄靠近身体端 → 推出端 → 返回靠近身体端。",
                "declared_start_endpoint_return"
            ])
        );
    }
}

#[test]
fn dual_load_bundle_fails_closed_without_declared_bilateral_thresholds() {
    let mut catalog = visual_recognition_baseline_catalog_v0_1();
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
