use maxpower_motion_sdk::{ActionCapabilityState, reviewed_action_capability_matrix_v1};
use maxpower_motion_sdk::{AssessmentBundleCapability, current_motion_assessment_catalog_v12};
use std::collections::BTreeMap;

fn main() {
    let matrix = reviewed_action_capability_matrix_v1().expect("embedded catalog");
    let mut counts = BTreeMap::<String, usize>::new();
    for record in &matrix {
        let key = match record.state {
            ActionCapabilityState::FullPlanCompiled => "full_plan_compiled",
            ActionCapabilityState::PoseSupportedLimitedSuccess => "pose_supported_limited_success",
            ActionCapabilityState::UnsupportedEquipmentCatalogOnly => {
                "unsupported_equipment_catalog_only"
            }
            ActionCapabilityState::AdmissibleVisualRefusal => "admissible_visual_refusal",
        };
        *counts.entry(key.into()).or_default() += 1;
    }
    let current = current_motion_assessment_catalog_v12();
    let current_executable = current
        .bundles
        .iter()
        .filter(|bundle| bundle.capability == AssessmentBundleCapability::Executable)
        .count();
    let current_contexts = current
        .bundles
        .iter()
        .map(|bundle| {
            serde_json::json!({
                "bundleId": bundle.bundle_id,
                "actionId": bundle.exact_context.action_id,
                "variationId": bundle.exact_context.variation_id,
                "captureView": bundle.exact_context.capture_view,
                "capability": bundle.capability,
            })
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "leafCount": matrix.len(),
            "planResolutionCounts": counts,
            "currentContextCount": current.bundles.len(),
            "currentExecutableContextCount": current_executable,
            "currentContexts": current_contexts,
        }))
        .unwrap()
    );
}
