//! Shared execution-assessment output types.
//!
//! Quality decisions are owned exclusively by `ExecutionAssessmentEngine` and
//! its installed FeatureProgram/ReferencePolicy/RulePack assets. The previous
//! action-name keyed proposal engine was removed. `MotionPacket` retains an
//! empty legacy proposal array for wire compatibility; clients must consume
//! sealed engine assessments instead.

use serde::{Deserialize, Serialize};

use crate::SealedRep;

pub const QUALITY_SCHEMA_VERSION: &str = "maxpower.motion-quality-proposal/v1";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized_features: Option<crate::LocalMotionCoordinateEvidence>,
}

/// Deprecated wire-compatible shape. New runtime code never creates these
/// proposals; quality is emitted by `ExecutionAssessmentEngine`.
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
    pub rule_bundle_version: String,
    pub profile_identity: String,
    pub profile_hash: String,
    pub canonical_slice_hash: String,
    pub endpoints: Vec<RepEndpointSnapshot>,
    pub conclusions: Vec<QualityConclusion>,
    pub content_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualityExtension {
    pub schema_version: String,
    pub proposals: Vec<RustQualityProposal>,
}

/// Kept only so older packet encoders retain an empty extension field.
pub fn build_quality_proposals(_reps: &[SealedRep]) -> Vec<RustQualityProposal> {
    Vec::new()
}
