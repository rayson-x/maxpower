use maxpower_motion_sdk::{
    AssessmentCapability, AssessmentConclusionState, AssessmentDimension, EvidenceChannel,
    RepDisposition, RepObservationFinding, RustQualityProposal, SealedRep,
    action_assessment_contract, build_quality_proposals,
};

#[derive(Clone, Copy)]
struct ExpectedActionContract {
    action_id: &'static str,
    first_phase: &'static str,
    second_phase: &'static str,
    equipment_role: &'static str,
    capability: AssessmentCapability,
}

#[derive(Clone, Copy)]
struct ExpectedContext {
    action_id: &'static str,
    view: &'static str,
    anatomical_side: &'static str,
    capability: AssessmentCapability,
}

const ACTION_CONTRACTS: [ExpectedActionContract; 12] = [
    ExpectedActionContract {
        action_id: "barbell_bench_press",
        first_phase: "eccentric",
        second_phase: "concentric",
        equipment_role: "barbell_axis_phase_and_path",
        capability: AssessmentCapability::QualitySupported,
    },
    ExpectedActionContract {
        action_id: "barbell_row",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "barbell_axis_phase_and_path",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "machine_chest_press",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "machine_handle_not_observed",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "seated_shoulder_press",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "external_load_not_observed",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "push_up",
        first_phase: "eccentric",
        second_phase: "concentric",
        equipment_role: "not_applicable",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "lat_pulldown",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "cable_handle_not_observed",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "pull_up",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "fixed_structure_not_tracked",
        capability: AssessmentCapability::ObservationOnly,
    },
    ExpectedActionContract {
        action_id: "seated_row",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "cable_handle_not_observed",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "straight_arm_pulldown",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "cable_handle_not_observed",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "lateral_raise",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "dumbbells_not_observed",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "rear_delt_fly",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "external_load_not_observed",
        capability: AssessmentCapability::PhaseSupported,
    },
    ExpectedActionContract {
        action_id: "single_arm_cable_lateral_raise",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "cable_handle_not_observed",
        capability: AssessmentCapability::PhaseSupported,
    },
];

const PERSONAL_EXACT_CONTEXTS: [ExpectedContext; 26] = [
    context(
        "barbell_bench_press",
        "front",
        "bilateral",
        AssessmentCapability::QualitySupported,
    ),
    context(
        "barbell_bench_press",
        "frontLeft45",
        "bilateral",
        AssessmentCapability::QualitySupported,
    ),
    context(
        "barbell_bench_press",
        "frontRight45",
        "bilateral",
        AssessmentCapability::QualitySupported,
    ),
    context(
        "barbell_row",
        "front",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "barbell_row",
        "frontLeft45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "barbell_row",
        "frontRight45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "barbell_row",
        "rearLeft45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "barbell_row",
        "rearRight45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "machine_chest_press",
        "front",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "machine_chest_press",
        "frontRight45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "seated_shoulder_press",
        "front",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "push_up",
        "rearRight45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "lat_pulldown",
        "rear",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "lat_pulldown",
        "rearLeft45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "pull_up",
        "rearLeft45",
        "bilateral",
        AssessmentCapability::ObservationOnly,
    ),
    context(
        "seated_row",
        "frontLeft45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "seated_row",
        "rearLeft45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "seated_row",
        "right",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "straight_arm_pulldown",
        "frontLeft45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "straight_arm_pulldown",
        "frontRight45",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "lateral_raise",
        "front",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "rear_delt_fly",
        "front",
        "bilateral",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "single_arm_cable_lateral_raise",
        "frontLeft45",
        "left",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "single_arm_cable_lateral_raise",
        "frontLeft45",
        "right",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "single_arm_cable_lateral_raise",
        "rearRight45",
        "left",
        AssessmentCapability::PhaseSupported,
    ),
    context(
        "single_arm_cable_lateral_raise",
        "rearRight45",
        "right",
        AssessmentCapability::PhaseSupported,
    ),
];

const fn context(
    action_id: &'static str,
    view: &'static str,
    anatomical_side: &'static str,
    capability: AssessmentCapability,
) -> ExpectedContext {
    ExpectedContext {
        action_id,
        view,
        anatomical_side,
        capability,
    }
}

#[test]
fn all_twelve_personal_actions_publish_phase_and_equipment_contracts() {
    for expected in ACTION_CONTRACTS {
        let actual = action_assessment_contract(expected.action_id).unwrap_or_else(|| {
            panic!(
                "missing public action assessment contract for {}",
                expected.action_id
            )
        });
        assert_eq!(
            actual.action_id, expected.action_id,
            "action id must remain canonical"
        );
        assert_eq!(
            actual.first_phase, expected.first_phase,
            "wrong first phase for {}",
            expected.action_id
        );
        assert_eq!(
            actual.second_phase, expected.second_phase,
            "wrong second phase for {}",
            expected.action_id
        );
        assert_eq!(
            actual.equipment_role, expected.equipment_role,
            "wrong equipment role for {}",
            expected.action_id
        );
        assert!(
            !actual.accepted_equipment.is_empty(),
            "{} must declare at least one accepted profile equipment token",
            expected.action_id
        );
        assert_eq!(
            actual.default_capability, expected.capability,
            "wrong capability for {}",
            expected.action_id
        );
    }
}

#[test]
fn every_personal_exact_view_resolves_without_guessing_a_different_context() {
    for expected in PERSONAL_EXACT_CONTEXTS {
        let proposal = proposal_for(
            expected.action_id,
            expected.view,
            expected.anatomical_side,
            Vec::new(),
        );
        assert_eq!(
            proposal.action_id, expected.action_id,
            "wrong action for {} / {}",
            expected.action_id, expected.view
        );
        assert_eq!(
            proposal.capture_position, expected.view,
            "wrong view for {} / {}",
            expected.action_id, expected.view
        );
        let expected_side = matches!(expected.anatomical_side, "left" | "right")
            .then_some(expected.anatomical_side);
        assert_eq!(proposal.anatomical_side.as_deref(), expected_side);
        assert_eq!(
            proposal.equipment_role,
            action_assessment_contract(expected.action_id)
                .expect("catalogued action")
                .equipment_role,
        );
        assert_eq!(
            proposal.capability, expected.capability,
            "wrong exact-context capability for {} / {} / {}",
            expected.action_id, expected.view, expected.anatomical_side
        );

        let phase = conclusion(&proposal, AssessmentDimension::PhaseControl);
        if matches!(
            expected.capability,
            AssessmentCapability::ObservationOnly | AssessmentCapability::Unsupported
        ) {
            assert_eq!(
                phase.state,
                AssessmentConclusionState::CannotJudge,
                "non-phase context must not publish phase for {} / {}",
                expected.action_id,
                expected.view
            );
            assert!(
                phase.reason.is_some(),
                "non-phase context refusal needs a reason for {} / {}",
                expected.action_id,
                expected.view
            );
        } else {
            assert_eq!(
                phase.state,
                AssessmentConclusionState::ObservedFact,
                "supported context must expose its phase fact for {} / {}",
                expected.action_id,
                expected.view
            );
        }
    }
}

#[test]
fn unlisted_views_do_not_inherit_an_action_wide_phase_capability() {
    let unlisted = [
        ("barbell_bench_press", "rear"),
        ("barbell_row", "left"),
        ("machine_chest_press", "rear"),
        ("seated_shoulder_press", "rear"),
        ("push_up", "front"),
        ("lat_pulldown", "front"),
        ("seated_row", "front"),
        ("straight_arm_pulldown", "rear"),
        ("lateral_raise", "right"),
        ("rear_delt_fly", "rear"),
        ("single_arm_cable_lateral_raise", "front"),
    ];

    for (action_id, view) in unlisted {
        let proposal = proposal_for(action_id, view, "bilateral", Vec::new());
        assert!(
            matches!(
                proposal.capability,
                AssessmentCapability::ObservationOnly | AssessmentCapability::Unsupported
            ),
            "unlisted exact context must not inherit phase support: {action_id} / {view}"
        );
        let phase = conclusion(&proposal, AssessmentDimension::PhaseControl);
        assert_eq!(
            phase.state,
            AssessmentConclusionState::CannotJudge,
            "unlisted view must abstain from phase: {action_id} / {view}"
        );
        assert!(
            phase.reason.is_some(),
            "unlisted view refusal needs a reason: {action_id} / {view}"
        );
    }
}

#[test]
fn pull_up_is_observation_only_for_the_annotated_rear_left_view() {
    let proposal = proposal_for("pull_up", "rearLeft45", "bilateral", Vec::new());
    assert_eq!(proposal.capability, AssessmentCapability::ObservationOnly);
    assert_eq!(
        conclusion(&proposal, AssessmentDimension::PhaseControl).state,
        AssessmentConclusionState::CannotJudge,
    );
}

#[test]
fn built_in_lat_pulldown_identity_normalizes_kebab_case_view() {
    let proposal =
        proposal_for_identity("lat-pulldown/rear-left-45/bilateral/cable/v1", Vec::new());

    assert_eq!(proposal.action_id, "lat_pulldown");
    assert_eq!(proposal.capture_position, "rearLeft45");
    assert_eq!(proposal.anatomical_side, None);
    assert_eq!(proposal.equipment_role, "cable_handle_not_observed");
    assert_eq!(proposal.capability, AssessmentCapability::PhaseSupported);
}

#[test]
fn exact_action_catalog_equipment_tokens_are_accepted_by_rust() {
    for (identity, expected) in [
        (
            "machine_chest_press/front/bilateral/chest_press_machine/v1",
            AssessmentCapability::PhaseSupported,
        ),
        (
            "seated_shoulder_press/front/bilateral/barbell/v1",
            AssessmentCapability::PhaseSupported,
        ),
        (
            "lat_pulldown/rear/bilateral/cable_bar/v1",
            AssessmentCapability::PhaseSupported,
        ),
        (
            "pull_up/rearLeft45/bilateral/fixed_pull_up_bar/v1",
            AssessmentCapability::ObservationOnly,
        ),
        (
            "seated_row/right/bilateral/cable_handle/v1",
            AssessmentCapability::PhaseSupported,
        ),
        (
            "straight_arm_pulldown/frontLeft45/bilateral/cable_bar/v1",
            AssessmentCapability::PhaseSupported,
        ),
        (
            "single_arm_cable_lateral_raise/frontLeft45/left/cable_handle/v1",
            AssessmentCapability::PhaseSupported,
        ),
    ] {
        assert_eq!(
            proposal_for_identity(identity, Vec::new()).capability,
            expected,
            "Rust must accept the exact equipment token frozen by the action contract: {identity}",
        );
    }
}

#[test]
fn built_in_profile_with_mismatched_equipment_is_unsupported() {
    let proposal = proposal_for_identity(
        "barbell-bench-press/front/bilateral/dumbbell/v1",
        Vec::new(),
    );

    assert_eq!(proposal.capability, AssessmentCapability::Unsupported);
    assert_eq!(proposal.equipment_role, "unsupported");
    assert_eq!(
        conclusion(&proposal, AssessmentDimension::PhaseControl).state,
        AssessmentConclusionState::CannotJudge,
    );
}

#[test]
fn source_independent_bench_profiles_accept_the_declared_barbell_equipment() {
    for view in ["front", "frontLeft45", "frontRight45"] {
        let proposal = proposal_for_identity(
            &format!(
                "barbell_bench_press/{view}/bilateral/barbell/builtin-source-independent-provisional-v1"
            ),
            Vec::new(),
        );

        assert_eq!(proposal.action_id, "barbell_bench_press");
        assert_eq!(proposal.capture_position, view);
        assert_eq!(proposal.equipment_role, "barbell_axis_phase_and_path");
        assert_eq!(proposal.capability, AssessmentCapability::QualitySupported);
    }
}

#[test]
fn observed_profile_without_equipment_token_never_invents_equipment_semantics() {
    let proposal = proposal_for_identity_with_maturity(
        "barbell-bench-press/front/bilateral/v1",
        "observed",
        Vec::new(),
    );

    assert_eq!(proposal.capability, AssessmentCapability::Unsupported);
    assert_eq!(proposal.equipment_role, "unsupported");
}

#[test]
fn unilateral_cable_lateral_raise_requires_anatomical_side_before_phase() {
    for side in ["left", "right"] {
        let proposal = proposal_for(
            "single_arm_cable_lateral_raise",
            "frontLeft45",
            side,
            Vec::new(),
        );
        assert_eq!(
            proposal.capability,
            AssessmentCapability::PhaseSupported,
            "known anatomical side should enable phase: {side}"
        );
        assert_eq!(
            conclusion(&proposal, AssessmentDimension::PhaseControl).state,
            AssessmentConclusionState::ObservedFact,
            "known anatomical side should expose phase: {side}",
        );
    }

    let side_unknown = proposal_for(
        "single_arm_cable_lateral_raise",
        "frontLeft45",
        "unknown",
        Vec::new(),
    );
    assert!(
        matches!(
            side_unknown.capability,
            AssessmentCapability::ObservationOnly | AssessmentCapability::Unsupported
        ),
        "missing anatomical side must not claim phase support"
    );
    let phase = conclusion(&side_unknown, AssessmentDimension::PhaseControl);
    assert_eq!(phase.state, AssessmentConclusionState::CannotJudge);
    assert!(
        phase.reason.is_some(),
        "missing anatomical side needs a refusal reason"
    );
}

#[test]
fn bench_equipment_path_and_pose_are_distinct_evidence_channels() {
    let equipment_only = proposal_for(
        "barbell_bench_press",
        "front",
        "bilateral",
        vec![
            RepObservationFinding::EquipmentPrimaryBoundary,
            RepObservationFinding::PoseUnavailableAtTurnaround,
        ],
    );
    let equipment_only_channels = turnaround_channels(&equipment_only);
    assert_eq!(
        equipment_only_channels,
        &[EvidenceChannel::EquipmentMeasured]
    );

    let corroborated = proposal_for(
        "barbell_bench_press",
        "front",
        "bilateral",
        vec![
            RepObservationFinding::EquipmentPrimaryBoundary,
            RepObservationFinding::PoseEquipmentTurnaroundAligned,
        ],
    );
    let corroborated_channels = turnaround_channels(&corroborated);
    assert_eq!(
        corroborated_channels
            .iter()
            .filter(|channel| **channel == EvidenceChannel::EquipmentMeasured)
            .count(),
        1,
        "equipment path must be counted once",
    );
    assert_eq!(
        corroborated_channels
            .iter()
            .filter(|channel| **channel == EvidenceChannel::PoseMeasured)
            .count(),
        1,
        "independent measured pose corroboration must remain a separate channel",
    );

    let pose_only = proposal_for("barbell_bench_press", "front", "bilateral", Vec::new());
    assert_eq!(
        turnaround_channels(&pose_only),
        &[EvidenceChannel::PoseMeasured]
    );
}

fn proposal_for(
    action_id: &str,
    view: &str,
    anatomical_side: &str,
    findings: Vec<RepObservationFinding>,
) -> RustQualityProposal {
    let equipment = action_assessment_contract(action_id)
        .and_then(|contract| contract.accepted_equipment.first())
        .copied()
        .unwrap_or("unknown");
    proposal_for_identity(
        &format!("{action_id}/{view}/{anatomical_side}/{equipment}/action-assessment-contract-v1"),
        findings,
    )
}

fn proposal_for_identity(
    profile_identity: &str,
    findings: Vec<RepObservationFinding>,
) -> RustQualityProposal {
    proposal_for_identity_with_maturity(profile_identity, "provisional", findings)
}

fn proposal_for_identity_with_maturity(
    profile_identity: &str,
    profile_maturity: &'static str,
    findings: Vec<RepObservationFinding>,
) -> RustQualityProposal {
    let rep = SealedRep {
        rep_id: 1,
        start_frame_id: 10,
        start_timestamp_ms: 1_000,
        peak_frame_id: 20,
        peak_timestamp_ms: 2_000,
        turnaround_confirmed_timestamp_ms: 2_100,
        end_frame_id: 30,
        end_timestamp_ms: 3_000,
        revision: 0,
        canonical_slice_hash: 0x0123_4567_89ab_cdef,
        profile_identity: profile_identity.into(),
        profile_hash: 0xfedc_ba98_7654_3210,
        profile_maturity,
        quality_verdict: None,
        recovered_across_gap: false,
        disposition: RepDisposition::Confirmed,
        evidence_reason: None,
        observation_findings: findings,
    };
    build_quality_proposals(&[rep])
        .into_iter()
        .next()
        .expect("one sealed rep must produce one public quality proposal")
}

fn conclusion(
    proposal: &RustQualityProposal,
    dimension: AssessmentDimension,
) -> &maxpower_motion_sdk::QualityConclusion {
    proposal
        .conclusions
        .iter()
        .find(|conclusion| conclusion.dimension == dimension)
        .unwrap_or_else(|| panic!("missing conclusion for {dimension:?}"))
}

fn turnaround_channels(proposal: &RustQualityProposal) -> &[EvidenceChannel] {
    &proposal
        .endpoints
        .iter()
        .find(|endpoint| endpoint.kind == maxpower_motion_sdk::EndpointKind::PrimaryTurnaround)
        .expect("proposal must contain a primary turnaround")
        .evidence_channels
}
