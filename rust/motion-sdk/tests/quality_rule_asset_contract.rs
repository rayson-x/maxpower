use maxpower_motion_sdk::{
    AssessmentAsset, AssessmentAssetKind, AssessmentCaptureView, QUALITY_RULE_ASSET_PACKAGE_SCHEMA,
    QualityRuleAssetPackage, QualityRuleSourceRef, visual_recognition_baseline_registry_v0_1,
};

#[test]
fn offline_quality_assets_install_atomically_without_action_or_review_state() {
    let mut registry =
        visual_recognition_baseline_registry_v0_1().expect("installed action library");
    let bundle = registry
        .runtime_catalog()
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "flat_barbell_bench_press/front/v1")
        .expect("exact action/view Bundle")
        .clone();
    let source_lineage = vec![QualityRuleSourceRef {
        asset_id: "offline:bench-front-quality-calibration-v1".into(),
        version: "v1".into(),
        content_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
    }];
    let package = QualityRuleAssetPackage {
        schema_version: QUALITY_RULE_ASSET_PACKAGE_SCHEMA.into(),
        package_id: "bench-front-quality-rules-v2".into(),
        action_id: bundle.exact_context.action_id.clone(),
        capture_view: AssessmentCaptureView::Front,
        bundle_id: bundle.bundle_id.clone(),
        expected_bundle_hash: bundle.content_hash.clone(),
        feature_program: cloned_quality_asset(
            registry.runtime_catalog(),
            &bundle.lineage.feature_program.id,
            AssessmentAssetKind::FeatureProgram,
            "quality-v2/feature-program",
            &source_lineage,
        ),
        reference_policy: cloned_quality_asset(
            registry.runtime_catalog(),
            &bundle.lineage.reference_policy.id,
            AssessmentAssetKind::ReferencePolicy,
            "quality-v2/reference-policy",
            &source_lineage,
        ),
        rule_pack: cloned_quality_asset(
            registry.runtime_catalog(),
            &bundle.lineage.rule_pack.id,
            AssessmentAssetKind::RulePack,
            "quality-v2/rule-pack",
            &source_lineage,
        ),
        set_aggregation_policy: cloned_quality_asset(
            registry.runtime_catalog(),
            &bundle.lineage.set_aggregation_policy.id,
            AssessmentAssetKind::SetAggregationPolicy,
            "quality-v2/set-aggregation",
            &source_lineage,
        ),
        source_lineage,
        content_hash: String::new(),
    }
    .with_computed_hash();

    let receipt = registry
        .install_quality_rules(package)
        .expect("structurally compatible offline assets install");
    assert_eq!(receipt.bundle_id, bundle.bundle_id);
    assert_eq!(receipt.previous_bundle_hash, bundle.content_hash);
    assert_ne!(receipt.installed_bundle_hash, receipt.previous_bundle_hash);
    assert_eq!(receipt.installed_asset_hashes.len(), 4);
    let installed = registry
        .runtime_catalog()
        .bundles
        .iter()
        .find(|candidate| candidate.bundle_id == bundle.bundle_id)
        .unwrap();
    assert!(installed.lineage.rule_pack.id.contains("quality-v2"));
}

#[test]
fn stale_quality_package_rejects_without_mutating_the_registry() {
    let mut registry =
        visual_recognition_baseline_registry_v0_1().expect("installed action library");
    let before = registry.runtime_catalog().clone();
    let bundle = before.bundles[0].clone();
    let lineage = vec![QualityRuleSourceRef {
        asset_id: "offline:stale-quality".into(),
        version: "v1".into(),
        content_hash: "source-hash".into(),
    }];
    let package = QualityRuleAssetPackage {
        schema_version: QUALITY_RULE_ASSET_PACKAGE_SCHEMA.into(),
        package_id: "stale-quality-rules".into(),
        action_id: bundle.exact_context.action_id.clone(),
        capture_view: bundle.exact_context.capture_view,
        bundle_id: bundle.bundle_id.clone(),
        expected_bundle_hash: "0000000000000000".into(),
        feature_program: cloned_quality_asset(
            &before,
            &bundle.lineage.feature_program.id,
            AssessmentAssetKind::FeatureProgram,
            "stale/feature",
            &lineage,
        ),
        reference_policy: cloned_quality_asset(
            &before,
            &bundle.lineage.reference_policy.id,
            AssessmentAssetKind::ReferencePolicy,
            "stale/reference",
            &lineage,
        ),
        rule_pack: cloned_quality_asset(
            &before,
            &bundle.lineage.rule_pack.id,
            AssessmentAssetKind::RulePack,
            "stale/rules",
            &lineage,
        ),
        set_aggregation_policy: cloned_quality_asset(
            &before,
            &bundle.lineage.set_aggregation_policy.id,
            AssessmentAssetKind::SetAggregationPolicy,
            "stale/set",
            &lineage,
        ),
        source_lineage: lineage,
        content_hash: String::new(),
    }
    .with_computed_hash();
    registry
        .install_quality_rules(package)
        .expect_err("stale Bundle hash must fail before mutation");
    assert_eq!(registry.runtime_catalog(), &before);
}

fn cloned_quality_asset(
    catalog: &maxpower_motion_sdk::ExecutionAssessmentBundleCatalog,
    source_id: &str,
    kind: AssessmentAssetKind,
    suffix: &str,
    source_lineage: &[QualityRuleSourceRef],
) -> AssessmentAsset {
    let mut asset = catalog
        .installed_assets
        .iter()
        .find(|asset| asset.id == source_id && asset.kind == kind)
        .expect("source quality asset")
        .clone();
    asset.id = format!("{source_id}/{suffix}");
    asset.content["sourceLineage"] =
        serde_json::to_value(source_lineage).expect("source lineage serializes");
    asset.with_computed_hash()
}
