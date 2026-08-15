use maxpower_motion_sdk::{
    installed_action_motion_catalog_v1, visual_recognition_baseline_registry_v0_1,
};

fn main() {
    let definitions = installed_action_motion_catalog_v1().expect("embedded action library");
    let registry = visual_recognition_baseline_registry_v0_1().expect("installed action runtime");
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "catalogId": definitions.catalog_id,
            "leafActionCount": definitions.definitions.len(),
            "actionViewPlanCount": definitions
                .definitions
                .iter()
                .map(|definition| definition.supported_views.len())
                .sum::<usize>(),
            "installedActionCount": registry.runtime_catalog().action_definitions.len(),
            "installedBundleCount": registry.runtime_catalog().bundles.len(),
        }))
        .unwrap()
    );
}
