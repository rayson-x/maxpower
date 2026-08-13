//! Canonical, review-first execution assessment emitted by the Rust SDK.
//!
//! The module deliberately turns only already-sealed recognition evidence into
//! proposals.  It does not own a second counter and it never upgrades missing
//! visual evidence into measured pose, force, strength, muscle activation or a
//! medical conclusion.

use serde::{Deserialize, Serialize};

use crate::{RepDisposition, RepObservationFinding, SealedRep};

pub const QUALITY_SCHEMA_VERSION: &str = "maxpower.motion-quality-proposal/v1";
pub const QUALITY_RULE_BUNDLE_VERSION: &str = "personal-motion-quality-rules/v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentCapability {
    QualitySupported,
    PhaseSupported,
    ObservationOnly,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndpointKind {
    StartAnchor,
    PrimaryTurnaround,
    EndReturn,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceChannel {
    PoseMeasured,
    EquipmentMeasured,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepEndpointSnapshot {
    pub kind: EndpointKind,
    pub occurred_frame_id: u64,
    pub occurred_timestamp_ms: u64,
    pub causal_confirmed_timestamp_ms: u64,
    pub phase_before: String,
    pub phase_after: String,
    pub confidence: f32,
    pub evidence_channels: Vec<EvidenceChannel>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentDimension {
    TaskCompletion,
    RangeOfMotion,
    PhaseControl,
    SupportStability,
    BilateralCoordination,
    TrajectoryControl,
    StandardVariantCompatibility,
    ObservationConfidence,
}

impl AssessmentDimension {
    pub const ALL: [Self; 8] = [
        Self::TaskCompletion,
        Self::RangeOfMotion,
        Self::PhaseControl,
        Self::SupportStability,
        Self::BilateralCoordination,
        Self::TrajectoryControl,
        Self::StandardVariantCompatibility,
        Self::ObservationConfidence,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TaskCompletion => "task_completion",
            Self::RangeOfMotion => "range_of_motion",
            Self::PhaseControl => "phase_control",
            Self::SupportStability => "support_stability",
            Self::BilateralCoordination => "bilateral_coordination",
            Self::TrajectoryControl => "trajectory_control",
            Self::StandardVariantCompatibility => "standard_variant_compatibility",
            Self::ObservationConfidence => "observation_confidence",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentConclusionState {
    ObservedAcceptable,
    ObservedDeviation,
    CannotJudge,
    NotApplicable,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualityConclusion {
    pub conclusion_id: String,
    pub dimension: AssessmentDimension,
    pub state: AssessmentConclusionState,
    pub summary: String,
    pub evidence: Vec<String>,
    pub reason: Option<String>,
    pub confidence: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RustQualityProposal {
    pub schema_version: String,
    pub proposal_id: String,
    pub rep_id: u64,
    pub action_id: String,
    pub capture_position: String,
    pub anatomical_side: Option<String>,
    pub equipment_role: String,
    pub capability: AssessmentCapability,
    pub rule_bundle_version: String,
    pub profile_identity: String,
    pub profile_hash: String,
    pub canonical_slice_hash: String,
    pub endpoints: Vec<RepEndpointSnapshot>,
    pub conclusions: Vec<QualityConclusion>,
    /// Lower-case fixed-width FNV-1a hex over the proposal with this field
    /// empty.  A string avoids losing u64 precision in JavaScript clients.
    pub content_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualityExtension {
    pub schema_version: String,
    pub proposals: Vec<RustQualityProposal>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionAssessmentContract {
    pub action_id: &'static str,
    pub first_phase: &'static str,
    pub second_phase: &'static str,
    pub equipment_role: &'static str,
    /// Exact equipment tokens accepted in the five-part recognition profile
    /// identity (`action/view/laterality/equipment/version`).
    pub accepted_equipment: &'static [&'static str],
    pub default_capability: AssessmentCapability,
    pub capture_positions: &'static [&'static str],
    pub requires_anatomical_side: bool,
}

const ACTION_CONTRACTS: [ActionAssessmentContract; 12] = [
    ActionAssessmentContract {
        action_id: "barbell_bench_press",
        first_phase: "eccentric",
        second_phase: "concentric",
        equipment_role: "barbell_axis_phase_and_path",
        accepted_equipment: &["barbell"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["front", "frontLeft45", "frontRight45"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "barbell_row",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "barbell_axis_phase_and_path",
        accepted_equipment: &["barbell"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &[
            "front",
            "frontLeft45",
            "frontRight45",
            "rearLeft45",
            "rearRight45",
        ],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "machine_chest_press",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "machine_handle_not_observed",
        accepted_equipment: &["chest_press_machine", "machine"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["front", "frontRight45"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "seated_shoulder_press",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "external_load_not_observed",
        accepted_equipment: &["barbell", "dumbbell"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["front"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "push_up",
        first_phase: "eccentric",
        second_phase: "concentric",
        equipment_role: "not_applicable",
        accepted_equipment: &["bodyweight"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["rearRight45"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "lat_pulldown",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "cable_handle_not_observed",
        accepted_equipment: &["cable_bar", "cable"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["rear", "rearLeft45"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "pull_up",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "fixed_structure_not_tracked",
        accepted_equipment: &["fixed_pull_up_bar", "bodyweight", "pull_up_bar"],
        default_capability: AssessmentCapability::ObservationOnly,
        capture_positions: &["rearLeft45"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "seated_row",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "cable_handle_not_observed",
        accepted_equipment: &["cable_handle", "cable"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["frontLeft45", "rearLeft45", "right"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "straight_arm_pulldown",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "cable_handle_not_observed",
        accepted_equipment: &["cable_bar", "cable"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["frontLeft45", "frontRight45"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "lateral_raise",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "dumbbells_not_observed",
        accepted_equipment: &["dumbbell"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["front"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "rear_delt_fly",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "external_load_not_observed",
        accepted_equipment: &["dumbbell"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["front"],
        requires_anatomical_side: false,
    },
    ActionAssessmentContract {
        action_id: "single_arm_cable_lateral_raise",
        first_phase: "concentric",
        second_phase: "eccentric",
        equipment_role: "cable_handle_not_observed",
        accepted_equipment: &["cable_handle", "cable"],
        default_capability: AssessmentCapability::PhaseSupported,
        capture_positions: &["frontLeft45", "rearRight45"],
        requires_anatomical_side: true,
    },
];

pub fn action_assessment_contract(action_id: &str) -> Option<&'static ActionAssessmentContract> {
    let normalized = normalize_action_id(action_id);
    ACTION_CONTRACTS
        .iter()
        .find(|contract| contract.action_id == normalized)
}

pub fn resolve_action_capability(
    action_id: &str,
    capture_position: &str,
    anatomical_side: Option<&str>,
) -> AssessmentCapability {
    let Some(contract) = action_assessment_contract(action_id) else {
        return AssessmentCapability::Unsupported;
    };
    let capture_position = normalize_capture_position(capture_position);
    if !contract
        .capture_positions
        .contains(&capture_position.as_str())
    {
        return AssessmentCapability::Unsupported;
    }
    if contract.requires_anatomical_side
        && !anatomical_side.is_some_and(|side| matches!(side, "left" | "right"))
    {
        return AssessmentCapability::ObservationOnly;
    }
    contract.default_capability
}

pub fn build_quality_proposals(reps: &[SealedRep]) -> Vec<RustQualityProposal> {
    reps.iter().map(build_quality_proposal).collect()
}

fn build_quality_proposal(rep: &SealedRep) -> RustQualityProposal {
    let profile = profile_context(&rep.profile_identity);
    let action_id = normalize_action_id(profile.action);
    let capture_position = normalize_capture_position(profile.capture_position);
    let contract = action_assessment_contract(&action_id);
    let anatomical_side =
        matches!(profile.laterality, "left" | "right").then_some(profile.laterality);
    let profile_equipment = normalize_equipment(profile.equipment);
    let equipment_matches = contract.is_some_and(|value| {
        profile.complete
            && !profile.version.trim().is_empty()
            && value
                .accepted_equipment
                .contains(&profile_equipment.as_str())
            && ((!value.requires_anatomical_side && profile.laterality == "bilateral")
                || (value.requires_anatomical_side && anatomical_side.is_some()))
    });
    let capability = if equipment_matches {
        resolve_action_capability(&action_id, &capture_position, anatomical_side)
    } else {
        AssessmentCapability::Unsupported
    };
    let first_phase = contract.map_or("unknown_first_phase", |value| value.first_phase);
    let second_phase = contract.map_or("unknown_second_phase", |value| value.second_phase);
    let equipment_primary = rep
        .observation_findings
        .contains(&RepObservationFinding::EquipmentPrimaryBoundary);
    let pose_aligned = rep
        .observation_findings
        .contains(&RepObservationFinding::PoseEquipmentTurnaroundAligned);
    let endpoint_channels = if equipment_primary {
        let mut channels = vec![EvidenceChannel::EquipmentMeasured];
        if pose_aligned {
            channels.push(EvidenceChannel::PoseMeasured);
        }
        channels
    } else {
        vec![EvidenceChannel::PoseMeasured]
    };
    let confidence = proposal_confidence(rep);
    let confirmed_at = rep.end_timestamp_ms;
    let endpoints = vec![
        RepEndpointSnapshot {
            kind: EndpointKind::StartAnchor,
            occurred_frame_id: rep.start_frame_id,
            occurred_timestamp_ms: rep.start_timestamp_ms,
            causal_confirmed_timestamp_ms: confirmed_at.max(rep.start_timestamp_ms),
            phase_before: "ready".into(),
            phase_after: first_phase.into(),
            confidence,
            evidence_channels: endpoint_channels.clone(),
        },
        RepEndpointSnapshot {
            kind: EndpointKind::PrimaryTurnaround,
            occurred_frame_id: rep.peak_frame_id,
            occurred_timestamp_ms: rep.peak_timestamp_ms,
            causal_confirmed_timestamp_ms: rep
                .turnaround_confirmed_timestamp_ms
                .max(rep.peak_timestamp_ms),
            phase_before: first_phase.into(),
            phase_after: second_phase.into(),
            confidence,
            evidence_channels: endpoint_channels.clone(),
        },
        RepEndpointSnapshot {
            kind: EndpointKind::EndReturn,
            occurred_frame_id: rep.end_frame_id,
            occurred_timestamp_ms: rep.end_timestamp_ms,
            causal_confirmed_timestamp_ms: confirmed_at,
            phase_before: second_phase.into(),
            phase_after: "ready".into(),
            confidence,
            evidence_channels: endpoint_channels,
        },
    ];
    let conclusions = AssessmentDimension::ALL
        .into_iter()
        .map(|dimension| conclusion_for(rep, contract, capability, dimension, confidence))
        .collect();
    let mut proposal = RustQualityProposal {
        schema_version: QUALITY_SCHEMA_VERSION.into(),
        proposal_id: format!(
            "{}:rep:{}:revision:{}",
            rep.profile_identity, rep.rep_id, rep.revision
        ),
        rep_id: rep.rep_id,
        action_id,
        capture_position,
        anatomical_side: anatomical_side.map(str::to_owned),
        equipment_role: contract
            .filter(|_| equipment_matches)
            .map_or("unsupported", |value| value.equipment_role)
            .into(),
        capability,
        rule_bundle_version: QUALITY_RULE_BUNDLE_VERSION.into(),
        profile_identity: rep.profile_identity.clone(),
        profile_hash: format!("{:016x}", rep.profile_hash),
        canonical_slice_hash: format!("{:016x}", rep.canonical_slice_hash),
        endpoints,
        conclusions,
        content_hash: String::new(),
    };
    proposal.content_hash = proposal_hash(&proposal);
    proposal
}

fn conclusion_for(
    rep: &SealedRep,
    contract: Option<&ActionAssessmentContract>,
    capability: AssessmentCapability,
    dimension: AssessmentDimension,
    confidence: f32,
) -> QualityConclusion {
    let id = format!("rep:{}:{}", rep.rep_id, dimension.as_str());
    let has_ordered_cycle = rep.start_timestamp_ms < rep.peak_timestamp_ms
        && rep.peak_timestamp_ms < rep.end_timestamp_ms;
    if capability == AssessmentCapability::Unsupported {
        return cannot_judge(
            id,
            dimension,
            "No executable action assessment contract matches this profile.",
            0.0,
        );
    }
    if capability == AssessmentCapability::ObservationOnly
        && matches!(
            dimension,
            AssessmentDimension::TaskCompletion
                | AssessmentDimension::RangeOfMotion
                | AssessmentDimension::PhaseControl
        )
    {
        return cannot_judge(
            id,
            dimension,
            "This exact action/view/side context is observation-only; Rust will not claim Rep or phase semantics.",
            confidence,
        );
    }
    if !has_ordered_cycle
        && matches!(
            dimension,
            AssessmentDimension::TaskCompletion
                | AssessmentDimension::RangeOfMotion
                | AssessmentDimension::PhaseControl
                | AssessmentDimension::TrajectoryControl
        )
    {
        return cannot_judge(
            id,
            dimension,
            "The sealed candidate does not contain three strictly ordered start, turnaround and return timestamps.",
            confidence.min(0.25),
        );
    }
    match dimension {
        AssessmentDimension::TaskCompletion => {
            let (state, summary, reason) = match rep.disposition {
                RepDisposition::Confirmed => (
                    AssessmentConclusionState::ObservedAcceptable,
                    "A complete start–turnaround–return cycle was confirmed.",
                    None,
                ),
                RepDisposition::NeedsReview => (
                    AssessmentConclusionState::ObservedDeviation,
                    "A complete cycle candidate was preserved for review.",
                    Some("Recognition evidence did not satisfy the confirmed-volume gate."),
                ),
                RepDisposition::Rejected => (
                    AssessmentConclusionState::CannotJudge,
                    "The candidate did not establish a reviewable completed task.",
                    Some("The Rust rep disposition rejected this candidate."),
                ),
            };
            QualityConclusion {
                conclusion_id: id,
                dimension,
                state,
                summary: summary.into(),
                evidence: vec![format!(
                    "start={}ms turnaround={}ms end={}ms",
                    rep.start_timestamp_ms, rep.peak_timestamp_ms, rep.end_timestamp_ms
                )],
                reason: reason.map(str::to_owned),
                confidence: if state == AssessmentConclusionState::CannotJudge {
                    0.0
                } else {
                    confidence
                },
            }
        }
        AssessmentDimension::RangeOfMotion => {
            let below = rep.observation_findings.iter().any(|finding| {
                matches!(
                    finding,
                    RepObservationFinding::PrimaryRangeBelowExpectation
                        | RepObservationFinding::SecondaryRangeBelowExpectation
                )
            });
            QualityConclusion {
                conclusion_id: id,
                dimension,
                state: if below {
                    AssessmentConclusionState::ObservedDeviation
                } else {
                    AssessmentConclusionState::ObservedAcceptable
                },
                summary: if below {
                    "The visible excursion was below the active recognition profile expectation."
                } else {
                    "The visible excursion reached the recognizer's cycle gate."
                }
                .into(),
                evidence: rep_finding_evidence(rep),
                reason: Some(
                    "This is profile-relative visible motion, not a universal standard-ROM verdict."
                        .into(),
                ),
                confidence,
            }
        }
        AssessmentDimension::PhaseControl => {
            let contract = contract.expect("supported capability lost its action contract");
            let faster_than_expected = rep
                .observation_findings
                .contains(&RepObservationFinding::CycleFasterThanExpected);
            QualityConclusion {
                conclusion_id: id,
                dimension,
                state: if faster_than_expected {
                    AssessmentConclusionState::ObservedDeviation
                } else {
                    AssessmentConclusionState::ObservedAcceptable
                },
                summary: format!(
                    "Observed {} for {}ms, then {} for {}ms.",
                    contract.first_phase,
                    rep.peak_timestamp_ms.saturating_sub(rep.start_timestamp_ms),
                    contract.second_phase,
                    rep.end_timestamp_ms.saturating_sub(rep.peak_timestamp_ms)
                ),
                evidence: vec![format!(
                    "turnaround_causally_confirmed_at={}ms",
                    rep.turnaround_confirmed_timestamp_ms
                )],
                reason: faster_than_expected.then(|| {
                    "The complete cycle was faster than the active recognition profile expectation; this is not a force or effort claim."
                        .into()
                }),
                confidence,
            }
        }
        AssessmentDimension::TrajectoryControl => {
            let contract = contract.expect("supported capability lost its action contract");
            let equipment_primary = rep
                .observation_findings
                .contains(&RepObservationFinding::EquipmentPrimaryBoundary);
            let equipment_coverage_low = rep
                .observation_findings
                .contains(&RepObservationFinding::EquipmentPathCoverageLow);
            QualityConclusion {
                conclusion_id: id,
                dimension,
                state: if equipment_coverage_low {
                    AssessmentConclusionState::ObservedDeviation
                } else {
                    AssessmentConclusionState::ObservedAcceptable
                },
                summary: if equipment_coverage_low {
                    "The subject-associated equipment path coverage was below the active evidence gate."
                } else if equipment_primary {
                    "The phase boundary and path came from the subject-associated equipment track."
                } else {
                    "A continuous canonical pose trajectory produced the sealed cycle."
                }
                .into(),
                evidence: vec![
                    format!("equipment_role={}", contract.equipment_role),
                    format!("canonical_slice_hash={:016x}", rep.canonical_slice_hash),
                ],
                reason: equipment_coverage_low.then(|| {
                    "This reports visible equipment-path coverage only; it does not infer force, strength or compensation."
                        .into()
                }),
                confidence,
            }
        }
        AssessmentDimension::ObservationConfidence => {
            let channel_conflict = rep
                .observation_findings
                .contains(&RepObservationFinding::PoseEquipmentTurnaroundConflict);
            let equipment_coverage_low = rep
                .observation_findings
                .contains(&RepObservationFinding::EquipmentPathCoverageLow);
            let observed_deviation = rep.disposition == RepDisposition::NeedsReview
                || channel_conflict
                || equipment_coverage_low;
            QualityConclusion {
                conclusion_id: id,
                dimension,
                state: match rep.disposition {
                    RepDisposition::Rejected => AssessmentConclusionState::CannotJudge,
                    _ if observed_deviation => AssessmentConclusionState::ObservedDeviation,
                    _ => AssessmentConclusionState::ObservedAcceptable,
                },
                summary: match rep.disposition {
                    RepDisposition::Confirmed if channel_conflict => {
                        "Pose and equipment disagreed on the observed turnaround."
                    }
                    RepDisposition::Confirmed if equipment_coverage_low => {
                        "The equipment path had insufficient measured coverage."
                    }
                    RepDisposition::Confirmed => "The cycle satisfied the current evidence gate.",
                    RepDisposition::NeedsReview => "The cycle is usable but requires human review.",
                    RepDisposition::Rejected => {
                        "The observation was insufficient for a Rep claim."
                    }
                }
                .into(),
                evidence: rep_finding_evidence(rep),
                reason: match rep.disposition {
                    RepDisposition::Rejected => Some(
                        "The Rust rep disposition rejected this candidate, so no positive observation-confidence claim is available."
                            .into(),
                    ),
                    _ => rep.evidence_reason.map(|reason| format!("{reason:?}")),
                },
                confidence: if rep.disposition == RepDisposition::Rejected {
                    0.0
                } else {
                    confidence
                },
            }
        }
        AssessmentDimension::SupportStability => cannot_judge(
            id,
            dimension,
            "The sealed Rep does not yet carry the required trunk/support trajectory features.",
            confidence,
        ),
        AssessmentDimension::BilateralCoordination => cannot_judge(
            id,
            dimension,
            "This view/Rep lacks validated side-specific persistent evidence; screen-space slope is not physical imbalance.",
            confidence,
        ),
        AssessmentDimension::StandardVariantCompatibility => cannot_judge(
            id,
            dimension,
            "No exact reviewed standard-variant corridor is attached to this proposal.",
            confidence,
        ),
    }
}

fn cannot_judge(
    conclusion_id: String,
    dimension: AssessmentDimension,
    reason: &str,
    _confidence: f32,
) -> QualityConclusion {
    QualityConclusion {
        conclusion_id,
        dimension,
        state: AssessmentConclusionState::CannotJudge,
        summary: "Cannot judge from the available visual evidence.".into(),
        evidence: Vec::new(),
        reason: Some(reason.into()),
        // `confidence` is the confidence of a positive visual claim.  A
        // refusal has no positive claim to calibrate; publishing the parent
        // Rep confidence here made review UIs look overconfident about a
        // dimension for which Rust explicitly has no evidence.
        confidence: 0.0,
    }
}

fn proposal_confidence(rep: &SealedRep) -> f32 {
    let mut confidence: f32 = match rep.disposition {
        RepDisposition::Confirmed => 0.90,
        RepDisposition::NeedsReview => 0.60,
        RepDisposition::Rejected => 0.25,
    };
    if rep
        .observation_findings
        .contains(&RepObservationFinding::EquipmentPathCoverageLow)
    {
        confidence -= 0.15;
    }
    if rep
        .observation_findings
        .contains(&RepObservationFinding::PoseEquipmentTurnaroundConflict)
    {
        confidence -= 0.20;
    }
    if !(rep.start_timestamp_ms < rep.peak_timestamp_ms
        && rep.peak_timestamp_ms < rep.end_timestamp_ms)
    {
        confidence = confidence.min(0.25);
    }
    confidence.clamp(0.0, 1.0)
}

struct ProfileContext<'a> {
    action: &'a str,
    capture_position: &'a str,
    laterality: &'a str,
    equipment: &'a str,
    version: &'a str,
    complete: bool,
}

fn profile_context(identity: &str) -> ProfileContext<'_> {
    let mut parts = identity.split('/');
    let action = parts.next().unwrap_or("unknown");
    let capture_position = parts.next().unwrap_or("unknown");
    let laterality = parts.next().unwrap_or("unknown");
    let equipment = parts.next().unwrap_or("unknown");
    let version = parts.next().unwrap_or("");
    let complete = !action.is_empty()
        && !capture_position.is_empty()
        && !laterality.is_empty()
        && !equipment.is_empty()
        && !version.is_empty()
        && parts.next().is_none();
    ProfileContext {
        action,
        capture_position,
        laterality,
        equipment,
        version,
        complete,
    }
}

fn normalize_action_id(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase().replace('-', "_");
    match normalized.as_str() {
        "barbell_bench" | "bench_press" => "barbell_bench_press".into(),
        "cable_lateral_raise" | "unilateral_cable_lateral_raise" => {
            "single_arm_cable_lateral_raise".into()
        }
        _ => normalized,
    }
}

fn normalize_capture_position(value: &str) -> String {
    match value
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_'], "")
        .as_str()
    {
        "frontleft45" => "frontLeft45".into(),
        "frontright45" => "frontRight45".into(),
        "rearleft45" => "rearLeft45".into(),
        "rearright45" => "rearRight45".into(),
        "front" => "front".into(),
        "rear" => "rear".into(),
        "left" => "left".into(),
        "right" => "right".into(),
        _ => value.trim().into(),
    }
}

fn normalize_equipment(value: &str) -> String {
    match value.trim().to_ascii_lowercase().replace('-', "_").as_str() {
        "dumbbells" => "dumbbell".into(),
        "pullup_bar" => "pull_up_bar".into(),
        normalized => normalized.into(),
    }
}

fn rep_finding_evidence(rep: &SealedRep) -> Vec<String> {
    let mut evidence = rep
        .observation_findings
        .iter()
        .map(|finding| format!("{finding:?}"))
        .collect::<Vec<_>>();
    if evidence.is_empty() {
        evidence.push("canonical_cycle_continuity".into());
    }
    evidence
}

fn proposal_hash(proposal: &RustQualityProposal) -> String {
    let bytes = serde_json::to_vec(proposal).expect("quality proposal is JSON serializable");
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sealed_rep_with_timestamps(start: u64, turnaround: u64, end: u64) -> SealedRep {
        SealedRep {
            rep_id: 1,
            start_frame_id: 10,
            start_timestamp_ms: start,
            peak_frame_id: 20,
            peak_timestamp_ms: turnaround,
            turnaround_confirmed_timestamp_ms: turnaround,
            end_frame_id: 30,
            end_timestamp_ms: end,
            revision: 0,
            canonical_slice_hash: 1,
            profile_identity: "barbell_bench_press/front/v1".into(),
            profile_hash: 2,
            profile_maturity: "observed",
            quality_verdict: None,
            recovered_across_gap: false,
            disposition: RepDisposition::Confirmed,
            evidence_reason: None,
            observation_findings: Vec::new(),
        }
    }

    #[test]
    fn all_supported_action_contracts_keep_one_shared_endpoint_shape() {
        assert_eq!(ACTION_CONTRACTS.len(), 12);
        assert!(ACTION_CONTRACTS.iter().all(|contract| {
            !contract.first_phase.is_empty()
                && !contract.second_phase.is_empty()
                && contract.first_phase != contract.second_phase
        }));
        assert_eq!(
            action_assessment_contract("barbell-bench-press")
                .unwrap()
                .first_phase,
            "eccentric"
        );
        assert_eq!(
            action_assessment_contract("lateral_raise")
                .unwrap()
                .first_phase,
            "concentric"
        );
        assert_eq!(
            resolve_action_capability("pull_up", "rearLeft45", None),
            AssessmentCapability::ObservationOnly
        );
        assert_eq!(
            resolve_action_capability("single_arm_cable_lateral_raise", "frontLeft45", None,),
            AssessmentCapability::ObservationOnly,
            "the engine must not invent an anatomical side"
        );
        assert_eq!(
            resolve_action_capability(
                "single_arm_cable_lateral_raise",
                "rearRight45",
                Some("left"),
            ),
            AssessmentCapability::PhaseSupported
        );
        assert_eq!(
            resolve_action_capability("seated_row", "right", None),
            AssessmentCapability::PhaseSupported
        );
        assert_eq!(
            resolve_action_capability("seated_row", "front", None),
            AssessmentCapability::Unsupported,
            "an unvalidated view is not inherited from another projection"
        );
    }

    #[test]
    fn zero_duration_return_is_reviewable_but_never_claimed_as_a_complete_cycle() {
        let proposal = build_quality_proposal(&sealed_rep_with_timestamps(7_400, 8_100, 8_100));
        assert_eq!(proposal.endpoints.len(), 3);
        assert!(
            proposal
                .conclusions
                .iter()
                .filter(|conclusion| matches!(
                    conclusion.dimension,
                    AssessmentDimension::TaskCompletion
                        | AssessmentDimension::RangeOfMotion
                        | AssessmentDimension::PhaseControl
                        | AssessmentDimension::TrajectoryControl
                ))
                .all(|conclusion| conclusion.state == AssessmentConclusionState::CannotJudge)
        );
        assert!(proposal.conclusions.iter().all(|conclusion| {
            conclusion.state != AssessmentConclusionState::CannotJudge
                || conclusion.confidence == 0.0
        }));
    }
}
