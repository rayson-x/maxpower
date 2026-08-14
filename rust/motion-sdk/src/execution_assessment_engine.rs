//! Workout-scoped execution assessment behind one small event interface.
//!
//! Hosts configure a versioned bundle catalog once and then advance canonical
//! lifecycle events. Feature evaluation, comparisons, rules, aggregation and
//! trace construction stay private implementation details as they land.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{
    AssessmentConclusionState, AssessmentDimension, LocalChannelAgreement, MotionPacket,
    QualityConclusion, RepDisposition, SealedRep,
};

pub const EXECUTION_ASSESSMENT_BUNDLE_SCHEMA: &str = "maxpower.execution-assessment-bundle/v1";
pub const EXECUTION_ASSESSMENT_CATALOG_SCHEMA: &str =
    "maxpower.execution-assessment-bundle-catalog/v1";
pub const ACTION_DEFINITION_SCHEMA: &str = "maxpower.action-definition/v1";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentCaptureView {
    Front,
    FrontObliqueLeft,
    FrontObliqueRight,
    Rear,
    RearObliqueLeft,
    RearObliqueRight,
    LeftSide,
    RightSide,
}

impl AssessmentCaptureView {
    fn from_alias(alias: &str) -> Option<Self> {
        match alias.trim() {
            "front" => Some(Self::Front),
            "frontLeft45" | "front_left_45" | "front_oblique_left" => Some(Self::FrontObliqueLeft),
            "frontRight45" | "front_right_45" | "front_oblique_right" => {
                Some(Self::FrontObliqueRight)
            }
            "rear" => Some(Self::Rear),
            "rearLeft45" | "rear_left_45" | "rear_oblique_left" => Some(Self::RearObliqueLeft),
            "rearRight45" | "rear_right_45" | "rear_oblique_right" => Some(Self::RearObliqueRight),
            "left" | "left_side" => Some(Self::LeftSide),
            "right" | "right_side" => Some(Self::RightSide),
            _ => None,
        }
    }

    fn catalog_slug(self) -> &'static str {
        match self {
            Self::Front => "front",
            Self::FrontObliqueLeft => "front-oblique-left",
            Self::FrontObliqueRight => "front-oblique-right",
            Self::Rear => "rear",
            Self::RearObliqueLeft => "rear-oblique-left",
            Self::RearObliqueRight => "rear-oblique-right",
            Self::LeftSide => "left-side",
            Self::RightSide => "right-side",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentEquipmentSemantics {
    RigidBarAxis,
    CableOrMovingHandle,
    UnilateralCableHandle,
    ConstrainedMachineLever,
    TwoIndependentDumbbells,
    BodyOnly,
    FixedSupport,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentLateralityMode {
    Bilateral,
    ObservedActiveSide,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnatomicalSide {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameRotation {
    Degrees0,
    Degrees90,
    Degrees180,
    Degrees270,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimestampUnit {
    Milliseconds,
    Microseconds,
    Nanoseconds,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoFrameContract {
    pub width: u32,
    pub height: u32,
    pub rotation: FrameRotation,
    pub mirrored: bool,
    pub timestamp_unit: TimestampUnit,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PoseObservationContract {
    pub runtime_id: String,
    pub landmark_schema: String,
    pub schema_version: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoRecognitionContext {
    pub source_capture_id: String,
    pub exercise_id: String,
    pub variation_id: Option<String>,
    pub capture_position: String,
    pub frame_contract: VideoFrameContract,
    pub pose_contract: PoseObservationContract,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssessmentExactContext {
    pub action_id: String,
    pub variation_id: String,
    pub equipment_semantics: AssessmentEquipmentSemantics,
    pub laterality_mode: AssessmentLateralityMode,
    pub capture_view: AssessmentCaptureView,
    pub pose_contract: PoseObservationContract,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionViewBinding {
    pub capture_view: AssessmentCaptureView,
    pub bundle_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionDefinition {
    pub schema_version: String,
    pub action_definition_id: String,
    pub action_id: String,
    pub default_variation_id: String,
    pub equipment_semantics: AssessmentEquipmentSemantics,
    pub laterality_mode: AssessmentLateralityMode,
    pub pose_contract: PoseObservationContract,
    pub supported_views: Vec<ActionViewBinding>,
    pub content_hash: String,
}

impl ActionDefinition {
    pub fn with_computed_hash(mut self) -> Self {
        self.content_hash.clear();
        self.content_hash = hash_serialized(&self);
        self
    }

    fn computed_content_hash(&self) -> String {
        let mut semantic = self.clone();
        semantic.content_hash.clear();
        hash_serialized(&semantic)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentAssetKind {
    RecognitionProfile,
    ExecutionContract,
    LocalCoordinateStrategy,
    EquipmentAdapter,
    FeatureProgram,
    ReferencePolicy,
    RulePack,
    SetAggregationPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssessmentAssetRef {
    pub kind: AssessmentAssetKind,
    pub id: String,
    pub schema_version: String,
    pub content_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssessmentAsset {
    pub kind: AssessmentAssetKind,
    pub id: String,
    pub schema_version: String,
    pub content: serde_json::Value,
    pub content_hash: String,
}

impl AssessmentAsset {
    pub fn with_computed_hash(mut self) -> Self {
        self.content_hash.clear();
        self.content_hash = self.computed_content_hash();
        self
    }

    pub fn reference(&self) -> AssessmentAssetRef {
        AssessmentAssetRef {
            kind: self.kind,
            id: self.id.clone(),
            schema_version: self.schema_version.clone(),
            content_hash: self.content_hash.clone(),
        }
    }

    fn computed_content_hash(&self) -> String {
        let mut semantic = self.clone();
        semantic.content_hash.clear();
        hash_serialized(&semantic)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssessmentBundleLineage {
    pub recognition_profile: AssessmentAssetRef,
    pub execution_contract: AssessmentAssetRef,
    pub local_coordinate_strategy: AssessmentAssetRef,
    pub equipment_adapter: AssessmentAssetRef,
    pub feature_program: AssessmentAssetRef,
    pub reference_policy: AssessmentAssetRef,
    pub rule_pack: AssessmentAssetRef,
    pub set_aggregation_policy: AssessmentAssetRef,
}

impl AssessmentBundleLineage {
    fn assets(&self) -> [(&AssessmentAssetRef, AssessmentAssetKind); 8] {
        [
            (
                &self.recognition_profile,
                AssessmentAssetKind::RecognitionProfile,
            ),
            (
                &self.execution_contract,
                AssessmentAssetKind::ExecutionContract,
            ),
            (
                &self.local_coordinate_strategy,
                AssessmentAssetKind::LocalCoordinateStrategy,
            ),
            (
                &self.equipment_adapter,
                AssessmentAssetKind::EquipmentAdapter,
            ),
            (&self.feature_program, AssessmentAssetKind::FeatureProgram),
            (&self.reference_policy, AssessmentAssetKind::ReferencePolicy),
            (&self.rule_pack, AssessmentAssetKind::RulePack),
            (
                &self.set_aggregation_policy,
                AssessmentAssetKind::SetAggregationPolicy,
            ),
        ]
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentBundleCapability {
    ContextResolutionOnly,
    Executable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionAssessmentBundle {
    pub schema_version: String,
    pub bundle_id: String,
    pub capability: AssessmentBundleCapability,
    pub exact_context: AssessmentExactContext,
    pub lineage: AssessmentBundleLineage,
    /// Lower-case fixed-width FNV-1a over this structure with an empty hash.
    pub content_hash: String,
}

impl ExecutionAssessmentBundle {
    pub fn with_computed_hash(mut self) -> Self {
        self.content_hash.clear();
        self.content_hash = self.computed_content_hash();
        self
    }

    pub fn computed_content_hash(&self) -> String {
        let mut semantic = self.clone();
        semantic.content_hash.clear();
        hash_serialized(&semantic)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionAssessmentBundleCatalog {
    pub schema_version: String,
    pub catalog_id: String,
    pub installed_assets: Vec<AssessmentAsset>,
    pub action_definitions: Vec<ActionDefinition>,
    pub bundles: Vec<ExecutionAssessmentBundle>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkoutAssessmentContext {
    pub workout_session_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SetIntent {
    Warmup,
    Working,
    Unspecified,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeclaredLoadProvenance {
    Plan,
    UserModified,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclaredLoad {
    /// Decimal value represented without floating-point ambiguity.
    pub value_milli: u64,
    pub unit: String,
    pub provenance: DeclaredLoadProvenance,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetExecutionContext {
    pub set_id: String,
    pub set_ordinal: u32,
    pub video_context: VideoRecognitionContext,
    pub intent: SetIntent,
    pub planned_load: Option<DeclaredLoad>,
    pub performed_load: Option<DeclaredLoad>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedAssessmentContext {
    pub source_capture_id: String,
    pub action_definition_id: String,
    pub action_definition_hash: String,
    pub action_id: String,
    pub variation_id: String,
    pub equipment_semantics: AssessmentEquipmentSemantics,
    pub laterality_mode: AssessmentLateralityMode,
    pub observed_active_side: Option<AnatomicalSide>,
    pub capture_view: AssessmentCaptureView,
    pub bundle_id: String,
    pub bundle_hash: String,
    pub bundle_capability: AssessmentBundleCapability,
    pub bundle_lineage: AssessmentBundleLineage,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AssessmentEvent {
    SetStarted(SetExecutionContext),
    VideoContextChanged(VideoRecognitionContext),
    BundleChangeRequested {
        bundle_id: String,
        bundle_hash: String,
    },
    CanonicalFrameObserved {
        frame_id: u64,
        timestamp_ms: u64,
    },
    /// The only executable assessment input. It is authored by `MotionSession`
    /// after canonical pose, equipment fusion, local coordinates and RepEngine
    /// have run; this engine never owns a second repetition counter.
    CanonicalPacketObserved(Box<MotionPacket>),
    /// Opaque terminal RepEngine output returned by
    /// `MotionSession::finish_set_for_assessment`.
    CanonicalSetClosureObserved(Box<crate::MotionSetClosure>),
    /// Legacy context-resolution seam. Executable bundles reject this event so
    /// callers cannot inject an arbitrary repetition outside MotionSession.
    RepSealed(Box<SealedRep>),
    SetPaused,
    SetResumed,
    SetFinished,
    WorkoutFinished,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentLifecycle {
    BetweenSets,
    ObservingSet,
    Paused,
    WorkoutFinished,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveMotionFacts {
    pub workout_session_id: String,
    pub set_id: Option<String>,
    pub lifecycle: AssessmentLifecycle,
    pub confirmed_rep_count: u32,
    pub needs_review_rep_count: u32,
    pub rejected_rep_count: u32,
    pub latest_frame_id: Option<u64>,
    pub latest_timestamp_ms: Option<u64>,
    pub resolved_context: Option<ResolvedAssessmentContext>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SealedRepReference {
    pub rep_id: u64,
    pub subject_epoch: u64,
    pub disposition: String,
    pub start_timestamp_ms: u64,
    pub turnaround_timestamp_ms: u64,
    pub end_timestamp_ms: u64,
    pub canonical_slice_hash: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotionFeatureStatus {
    Observed,
    CannotJudge,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotionFeatureUnit {
    Milliseconds,
    NormalizedDisplacement,
    Ratio,
    Confidence,
    Count,
    Categorical,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceSourceRange {
    pub source_capture_id: String,
    pub start_frame_id: u64,
    pub end_frame_id: u64,
    pub start_timestamp_ms: u64,
    pub end_timestamp_ms: u64,
    pub canonical_slice_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionFeatureFact {
    pub feature_id: String,
    pub value: Option<f32>,
    pub categorical_value: Option<String>,
    pub unit: MotionFeatureUnit,
    pub status: MotionFeatureStatus,
    pub coverage: f32,
    pub confidence: f32,
    pub uncertainty: f32,
    pub provenance: Vec<String>,
    pub source_range: EvidenceSourceRange,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceComparisonKind {
    SelfGeometry,
    SetPrefix,
    SameWorkoutPriorSet,
    NoReference,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceComparisonFact {
    pub feature_id: String,
    pub kind: ReferenceComparisonKind,
    pub observed_value: Option<f32>,
    pub observed_category: Option<String>,
    pub reference_value: Option<f32>,
    pub delta_ratio: Option<f32>,
    pub reference_source_ids: Vec<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SealedRepAssessment {
    pub rep: SealedRepReference,
    pub features: Vec<MotionFeatureFact>,
    pub comparisons: Vec<ReferenceComparisonFact>,
    pub dimension_findings: Vec<QualityConclusion>,
    pub trace_root_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetPatternFact {
    pub pattern_id: String,
    pub summary: String,
    pub supporting_rep_ids: Vec<u64>,
    pub evidence_dimensions: Vec<AssessmentDimension>,
    pub confidence: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceNodeKind {
    SourceObservation,
    LocalCoordinate,
    PoseEquipmentFusion,
    RepBoundary,
    FeatureFact,
    ReferenceComparison,
    RuleConclusion,
    SetPattern,
    SetConclusion,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceTraceNode {
    pub node_id: String,
    pub kind: TraceNodeKind,
    pub summary: String,
    pub source_ids: Vec<String>,
    pub input_node_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceDerivationTrace {
    pub schema_version: String,
    pub nodes: Vec<EvidenceTraceNode>,
    pub conclusion_root_ids: Vec<String>,
    pub content_hash: String,
}

impl EvidenceDerivationTrace {
    fn computed_content_hash(&self) -> String {
        let mut semantic = self.clone();
        semantic.content_hash.clear();
        hash_serialized(&semantic)
    }
}

fn validate_trace_graph(
    nodes: &[EvidenceTraceNode],
    conclusion_root_ids: &[String],
) -> Result<(), AssessmentRuntimeError> {
    let mut seen = HashSet::new();
    for node in nodes {
        if node.node_id.trim().is_empty()
            || seen.contains(node.node_id.as_str())
            || node
                .input_node_ids
                .iter()
                .any(|input_id| !seen.contains(input_id.as_str()))
        {
            return Err(AssessmentRuntimeError::InvalidTraceGraph);
        }
        seen.insert(node.node_id.as_str());
    }
    if conclusion_root_ids.is_empty()
        || conclusion_root_ids
            .iter()
            .any(|root_id| !seen.contains(root_id.as_str()))
    {
        return Err(AssessmentRuntimeError::InvalidTraceGraph);
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SealedSetAssessment {
    pub schema_version: String,
    pub assessment_id: String,
    pub workout_session_id: String,
    pub set_context: SetExecutionContext,
    pub resolved_context: ResolvedAssessmentContext,
    pub bundle_id: String,
    pub bundle_hash: String,
    pub reps: Vec<SealedRepReference>,
    pub rep_assessments: Vec<SealedRepAssessment>,
    pub set_patterns: Vec<SetPatternFact>,
    pub dimension_findings: Vec<QualityConclusion>,
    pub trace: EvidenceDerivationTrace,
    pub content_hash: String,
}

impl SealedSetAssessment {
    fn computed_content_hash(&self) -> String {
        let mut semantic = self.clone();
        semantic.content_hash.clear();
        hash_serialized(&semantic)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentRefusalReason {
    UnknownAction,
    UnsupportedCaptureView,
    UnsupportedVariation,
    UnsupportedPoseContract,
    InvalidVideoContext,
    UnsupportedExactContext,
    ContextChangedDuringSet,
    BundleNotExecutable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TypedAssessmentRefusal {
    pub reason: AssessmentRefusalReason,
    pub video_context: VideoRecognitionContext,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AssessmentEmission {
    LiveMotionFacts(LiveMotionFacts),
    SealedSetAssessment(Box<SealedSetAssessment>),
    TypedRefusal(TypedAssessmentRefusal),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AssessmentConfigurationError {
    UnsupportedCatalogSchema,
    EmptyCatalogIdentity,
    EmptyBundleIdentity,
    UnsupportedBundleSchema {
        bundle_id: String,
    },
    InvalidExecutableBundleProgram {
        bundle_id: String,
        detail: String,
    },
    InvalidBundleHash {
        bundle_id: String,
    },
    EmptyActionDefinitionIdentity,
    UnsupportedActionDefinitionSchema {
        action_definition_id: String,
    },
    InvalidActionDefinitionHash {
        action_definition_id: String,
    },
    InvalidCatalogAsset {
        asset_id: String,
    },
    DuplicateAssetIdentity(String),
    DuplicateAction(String),
    DuplicateBundleIdentity(String),
    MissingBundleBinding {
        action_id: String,
        bundle_id: String,
    },
    OrphanBundle {
        bundle_id: String,
    },
    InconsistentBundleBinding {
        action_id: String,
        bundle_id: String,
    },
    InvalidBundleAssetReference {
        bundle_id: String,
        expected_kind: AssessmentAssetKind,
    },
    UnknownBundleAssetReference {
        bundle_id: String,
        asset_id: String,
    },
    DuplicateExactContext(AssessmentExactContext),
    IncompleteBundleLineage {
        bundle_id: String,
    },
    InvalidSubjectReferenceId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AssessmentRuntimeError {
    WorkoutAlreadyFinished,
    SetAlreadyActive,
    NoActiveSet,
    SetPaused,
    SetNotPaused,
    TimestampNotStrictlyIncreasing,
    FrameIdNotStrictlyIncreasing,
    DuplicateRepId(u64),
    RepProfileMismatch,
    PacketProfileMismatch,
    PacketLocalCoordinateStrategyMismatch,
    PacketSourceMismatch,
    RepNotFromCanonicalPacket,
    CanonicalPacketRequired,
    CanonicalSetClosureRequired,
    CanonicalSetClosureAlreadyObserved,
    PacketLineageChangedDuringSet,
    DuplicateSetId,
    InvalidRepProvenance,
    InvalidTraceGraph,
}

#[derive(Clone, Debug)]
struct CompiledAssessmentProgram {
    runtime_profile_identity: String,
    runtime_profile_hash: u64,
    feature_ids: Vec<String>,
    range_feature_id: String,
    phase_names: [String; 2],
    task_endpoints: [String; 3],
    local_coordinate_strategy: crate::LocalMotionCoordinateStrategy,
    reference_order: Vec<ReferenceComparisonKind>,
    range_deviation_ratio: f32,
    minimum_feature_confidence: f32,
    late_set_window: usize,
    minimum_persistent_reps: usize,
    bilateral_difference_threshold: f32,
    bilateral_timing_difference_threshold_ms: f32,
    rep_rules: Vec<CompiledRepRule>,
    set_rules: Vec<CompiledSetRule>,
}

#[derive(Clone, Debug)]
enum CompiledRepRule {
    RepDisposition {
        dimension: AssessmentDimension,
        feature_id: String,
    },
    ReferenceLowerBound {
        dimension: AssessmentDimension,
        feature_id: String,
        return_feature_id: String,
        maximum_return_error: f32,
    },
    FeaturesAvailable {
        dimension: AssessmentDimension,
        feature_ids: Vec<String>,
    },
    Abstain {
        dimension: AssessmentDimension,
        feature_ids: Vec<String>,
        reason: String,
    },
    NotApplicable {
        dimension: AssessmentDimension,
        feature_ids: Vec<String>,
    },
}

#[derive(Clone, Debug)]
enum CompiledSetRule {
    RollupRepDimension { dimension: AssessmentDimension },
    LateSetPersistence { dimension: AssessmentDimension },
}

#[derive(Clone, Debug)]
struct ReferenceSample {
    value: f32,
    set_id: String,
    source_capture_id: String,
    rep_id: u64,
    subject_epoch: u64,
    subject_reference_key: Option<String>,
    load_unit: Option<String>,
}

#[derive(Clone, Copy, Debug)]
struct ActiveSideMotionCandidate {
    side: AnatomicalSide,
    origin: [f32; 2],
    observations: u32,
    maximum_displacement: f32,
}

#[derive(Clone, Debug)]
struct PacketEvidenceSummary {
    frame_id: u64,
    timestamp_ms: u64,
    subject_epoch: u64,
    source_id: String,
    coordinate_frame_id: u64,
    local_state: String,
    channel_agreement: LocalChannelAgreement,
    equipment_observed: bool,
}

struct ActiveSet {
    context: SetExecutionContext,
    resolved_context: ResolvedAssessmentContext,
    bundle: ExecutionAssessmentBundle,
    paused: bool,
    latest_frame_id: Option<u64>,
    latest_timestamp_ms: Option<u64>,
    reps: Vec<SealedRepReference>,
    rep_assessments: Vec<SealedRepAssessment>,
    trace_nodes: Vec<EvidenceTraceNode>,
    packets: Vec<PacketEvidenceSummary>,
    prefix_range_values: Vec<ReferenceSample>,
    prior_workout_range_values: Vec<ReferenceSample>,
    rep_ids: HashSet<u64>,
    program: CompiledAssessmentProgram,
    closure_observed: bool,
    packet_lineage: Option<crate::PacketLineage>,
    subject_reference_key: Option<String>,
    active_side_candidates: HashMap<u64, ActiveSideMotionCandidate>,
    active_side_conflicted: bool,
}

fn update_observed_active_side(
    candidates: &mut HashMap<u64, ActiveSideMotionCandidate>,
    tracks: &[crate::EquipmentTrackEvidence],
    resolved_side: &mut Option<AnatomicalSide>,
    conflicted: &mut bool,
) {
    const ACTIVE_SIDE_MINIMUM_DISPLACEMENT: f32 = 0.015;
    for track in tracks.iter().filter(|track| track.judgeable_path) {
        let side = match track.held_by {
            crate::EquipmentHand::Left => AnatomicalSide::Left,
            crate::EquipmentHand::Right => AnatomicalSide::Right,
            crate::EquipmentHand::Both | crate::EquipmentHand::Unknown => continue,
        };
        let center = [track.center_x, track.center_y];
        match candidates.entry(track.track_id) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(ActiveSideMotionCandidate {
                    side,
                    origin: center,
                    observations: 1,
                    maximum_displacement: 0.0,
                });
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                let candidate = entry.get_mut();
                if candidate.side != side {
                    *conflicted = true;
                    continue;
                }
                candidate.observations = candidate.observations.saturating_add(1);
                candidate.maximum_displacement = candidate.maximum_displacement.max(
                    ((center[0] - candidate.origin[0]).powi(2)
                        + (center[1] - candidate.origin[1]).powi(2))
                    .sqrt(),
                );
            }
        }
    }
    let established_sides = candidates
        .values()
        .filter(|candidate| {
            candidate.observations >= 2
                && candidate.maximum_displacement >= ACTIVE_SIDE_MINIMUM_DISPLACEMENT
        })
        .map(|candidate| candidate.side)
        .collect::<HashSet<_>>();
    if established_sides.len() > 1 {
        *resolved_side = None;
        *conflicted = true;
    } else if let Some(observed) = established_sides.iter().next().copied()
        && !*conflicted
    {
        match *resolved_side {
            None => *resolved_side = Some(observed),
            Some(previous) if previous == observed => {}
            Some(_) => {
                *resolved_side = None;
                *conflicted = true;
            }
        }
    }
    if *conflicted {
        *resolved_side = None;
    }
}

pub struct ExecutionAssessmentEngine {
    workout: WorkoutAssessmentContext,
    action_definitions: HashMap<String, ActionDefinition>,
    bundles: HashMap<String, ExecutionAssessmentBundle>,
    programs: HashMap<String, CompiledAssessmentProgram>,
    workout_range_references: HashMap<String, Vec<ReferenceSample>>,
    completed_set_ids: HashSet<String>,
    active_set: Option<ActiveSet>,
    last_terminal: Option<SealedSetAssessment>,
    workout_finished: bool,
    subject_reference_key: Option<String>,
}

impl ExecutionAssessmentEngine {
    pub fn configure(
        catalog: ExecutionAssessmentBundleCatalog,
        workout: WorkoutAssessmentContext,
    ) -> Result<Self, AssessmentConfigurationError> {
        Self::configure_inner(catalog, workout, None)
    }

    pub fn configure_for_subject(
        catalog: ExecutionAssessmentBundleCatalog,
        workout: WorkoutAssessmentContext,
        subject_reference_id: impl Into<String>,
    ) -> Result<Self, AssessmentConfigurationError> {
        let subject_reference_id = subject_reference_id.into();
        if subject_reference_id.trim().is_empty() {
            return Err(AssessmentConfigurationError::InvalidSubjectReferenceId);
        }
        let subject_reference_key = hash_serialized(&(
            "maxpower.workout-subject-reference/v1",
            subject_reference_id,
        ));
        Self::configure_inner(catalog, workout, Some(subject_reference_key))
    }

    fn configure_inner(
        catalog: ExecutionAssessmentBundleCatalog,
        workout: WorkoutAssessmentContext,
        subject_reference_key: Option<String>,
    ) -> Result<Self, AssessmentConfigurationError> {
        validate_catalog(&catalog)?;
        let programs = compile_catalog_programs(&catalog)?;
        let action_definitions = catalog
            .action_definitions
            .into_iter()
            .map(|definition| (definition.action_id.clone(), definition))
            .collect();
        let bundles = catalog
            .bundles
            .into_iter()
            .map(|bundle| (bundle.bundle_id.clone(), bundle))
            .collect();
        Ok(Self {
            workout,
            action_definitions,
            bundles,
            programs,
            workout_range_references: HashMap::new(),
            completed_set_ids: HashSet::new(),
            active_set: None,
            last_terminal: None,
            workout_finished: false,
            subject_reference_key,
        })
    }

    pub fn advance(
        &mut self,
        event: AssessmentEvent,
    ) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        if self.workout_finished {
            return Err(AssessmentRuntimeError::WorkoutAlreadyFinished);
        }
        match event {
            AssessmentEvent::SetStarted(context) => self.start_set(context),
            AssessmentEvent::VideoContextChanged(context) => self.change_video_context(context),
            AssessmentEvent::BundleChangeRequested {
                bundle_id,
                bundle_hash,
            } => self.request_bundle_change(bundle_id, bundle_hash),
            AssessmentEvent::CanonicalFrameObserved {
                frame_id,
                timestamp_ms,
            } => self.observe_frame(frame_id, timestamp_ms),
            AssessmentEvent::CanonicalPacketObserved(packet) => self.observe_packet(*packet),
            AssessmentEvent::CanonicalSetClosureObserved(closure) => {
                self.observe_set_closure(*closure)
            }
            AssessmentEvent::RepSealed(_) => Err(AssessmentRuntimeError::RepNotFromCanonicalPacket),
            AssessmentEvent::SetPaused => self.pause_set(),
            AssessmentEvent::SetResumed => self.resume_set(),
            AssessmentEvent::SetFinished => self.finish_set(),
            AssessmentEvent::WorkoutFinished => self.finish_workout(),
        }
    }

    fn change_video_context(
        &self,
        context: VideoRecognitionContext,
    ) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        let active = self
            .active_set
            .as_ref()
            .ok_or(AssessmentRuntimeError::NoActiveSet)?;
        if active.context.video_context == context {
            return Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()));
        }
        Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
            reason: AssessmentRefusalReason::ContextChangedDuringSet,
            video_context: context,
            detail: "action, view, pose contract and assessment Bundle are frozen until the set finishes"
                .into(),
        }))
    }

    fn request_bundle_change(
        &self,
        bundle_id: String,
        bundle_hash: String,
    ) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        let active = self
            .active_set
            .as_ref()
            .ok_or(AssessmentRuntimeError::NoActiveSet)?;
        if active.bundle.bundle_id == bundle_id && active.bundle.content_hash == bundle_hash {
            return Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()));
        }
        Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
            reason: AssessmentRefusalReason::ContextChangedDuringSet,
            video_context: active.context.video_context.clone(),
            detail: format!(
                "assessment Bundle is frozen until the set finishes; refused {bundle_id}@{bundle_hash}"
            ),
        }))
    }

    fn start_set(
        &mut self,
        context: SetExecutionContext,
    ) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        if self.completed_set_ids.contains(&context.set_id) {
            return Err(AssessmentRuntimeError::DuplicateSetId);
        }
        if let Some(active) = self.active_set.as_ref() {
            if active.context.video_context != context.video_context {
                return Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
                    reason: AssessmentRefusalReason::ContextChangedDuringSet,
                    video_context: context.video_context,
                    detail: "action, view, pose contract and assessment Bundle are frozen until the set finishes"
                        .into(),
                }));
            }
            return Err(AssessmentRuntimeError::SetAlreadyActive);
        }
        if let Some(detail) = invalid_video_context_detail(&context.video_context) {
            return Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
                reason: AssessmentRefusalReason::InvalidVideoContext,
                video_context: context.video_context,
                detail,
            }));
        }
        let Some(definition) = self
            .action_definitions
            .get(&context.video_context.exercise_id)
            .cloned()
        else {
            return Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
                reason: AssessmentRefusalReason::UnknownAction,
                video_context: context.video_context,
                detail: "no installed ActionDefinition matches the exercise ID".into(),
            }));
        };
        let Some(capture_view) =
            AssessmentCaptureView::from_alias(&context.video_context.capture_position)
        else {
            return Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
                reason: AssessmentRefusalReason::UnsupportedCaptureView,
                video_context: context.video_context,
                detail: "capture position is not a governed coarse-view alias".into(),
            }));
        };
        let variation_id = context
            .video_context
            .variation_id
            .clone()
            .unwrap_or_else(|| definition.default_variation_id.clone());
        if variation_id != definition.default_variation_id {
            return Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
                reason: AssessmentRefusalReason::UnsupportedVariation,
                video_context: context.video_context,
                detail: "the ActionDefinition does not bind the requested variation".into(),
            }));
        }
        let Some(binding) = definition
            .supported_views
            .iter()
            .find(|binding| binding.capture_view == capture_view)
        else {
            return Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
                reason: AssessmentRefusalReason::UnsupportedCaptureView,
                video_context: context.video_context,
                detail: "the ActionDefinition does not support this coarse capture view".into(),
            }));
        };
        if context.video_context.pose_contract != definition.pose_contract {
            return Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
                reason: AssessmentRefusalReason::UnsupportedPoseContract,
                video_context: context.video_context,
                detail: "the ActionDefinition does not support this pose runtime/schema contract"
                    .into(),
            }));
        }
        let bundle = self
            .bundles
            .get(&binding.bundle_id)
            .cloned()
            .expect("validated ActionDefinition bundle binding");
        let resolved_context = ResolvedAssessmentContext {
            source_capture_id: context.video_context.source_capture_id.clone(),
            action_definition_id: definition.action_definition_id,
            action_definition_hash: definition.content_hash,
            action_id: definition.action_id,
            variation_id,
            equipment_semantics: definition.equipment_semantics,
            laterality_mode: definition.laterality_mode,
            observed_active_side: None,
            capture_view,
            bundle_id: bundle.bundle_id.clone(),
            bundle_hash: bundle.content_hash.clone(),
            bundle_capability: bundle.capability,
            bundle_lineage: bundle.lineage.clone(),
        };
        let program = self
            .programs
            .get(&bundle.bundle_id)
            .cloned()
            .unwrap_or_else(|| CompiledAssessmentProgram {
                runtime_profile_identity: String::new(),
                runtime_profile_hash: 0,
                feature_ids: Vec::new(),
                range_feature_id: "local_primary_excursion".into(),
                phase_names: ["first_phase".into(), "second_phase".into()],
                task_endpoints: ["start".into(), "turnaround".into(), "return".into()],
                local_coordinate_strategy: crate::LocalMotionCoordinateStrategy {
                    capture_view: crate::LocalCoarseView::Front,
                    preparation_to_effort: crate::LocalActionAxisDirection::PreparationToEffortDown,
                    equipment_mode: crate::LocalEquipmentMode::RigidBarAxis,
                    pose_anchor: crate::LocalPoseAnchor::WristMidpoint,
                },
                reference_order: vec![
                    ReferenceComparisonKind::SetPrefix,
                    ReferenceComparisonKind::SameWorkoutPriorSet,
                ],
                range_deviation_ratio: 0.20,
                minimum_feature_confidence: 0.50,
                late_set_window: 2,
                minimum_persistent_reps: 2,
                bilateral_difference_threshold: 0.15,
                bilateral_timing_difference_threshold_ms: 150.0,
                rep_rules: Vec::new(),
                set_rules: Vec::new(),
            });
        let prior_workout_range_values = self
            .workout_range_references
            .get(&bundle.bundle_id)
            .cloned()
            .unwrap_or_default();
        self.active_set = Some(ActiveSet {
            context,
            resolved_context,
            bundle,
            paused: false,
            latest_frame_id: None,
            latest_timestamp_ms: None,
            reps: Vec::new(),
            rep_assessments: Vec::new(),
            trace_nodes: Vec::new(),
            packets: Vec::new(),
            prefix_range_values: Vec::new(),
            prior_workout_range_values,
            rep_ids: HashSet::new(),
            program,
            closure_observed: false,
            packet_lineage: None,
            subject_reference_key: self.subject_reference_key.clone(),
            active_side_candidates: HashMap::new(),
            active_side_conflicted: false,
        });
        self.last_terminal = None;
        Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()))
    }

    fn observe_frame(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
    ) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        if self.active_set.as_ref().is_some_and(|active| {
            active.bundle.capability == AssessmentBundleCapability::ContextResolutionOnly
        }) {
            return self.bundle_not_executable_refusal();
        }
        let _ = (frame_id, timestamp_ms);
        Err(AssessmentRuntimeError::CanonicalPacketRequired)
    }

    fn record_packet_position(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
    ) -> Result<(), AssessmentRuntimeError> {
        let active = self
            .active_set
            .as_mut()
            .ok_or(AssessmentRuntimeError::NoActiveSet)?;
        if active.paused {
            return Err(AssessmentRuntimeError::SetPaused);
        }
        if active
            .latest_timestamp_ms
            .is_some_and(|previous| timestamp_ms <= previous)
        {
            return Err(AssessmentRuntimeError::TimestampNotStrictlyIncreasing);
        }
        if active
            .latest_frame_id
            .is_some_and(|previous| frame_id <= previous)
        {
            return Err(AssessmentRuntimeError::FrameIdNotStrictlyIncreasing);
        }
        active.latest_frame_id = Some(frame_id);
        active.latest_timestamp_ms = Some(timestamp_ms);
        Ok(())
    }

    fn observe_packet(
        &mut self,
        packet: MotionPacket,
    ) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        if self.active_set.as_ref().is_some_and(|active| {
            active.bundle.capability == AssessmentBundleCapability::ContextResolutionOnly
        }) {
            return self.bundle_not_executable_refusal();
        }
        if self
            .active_set
            .as_ref()
            .is_some_and(|active| active.closure_observed)
        {
            return Err(AssessmentRuntimeError::CanonicalSetClosureAlreadyObserved);
        }
        {
            let active = self
                .active_set
                .as_ref()
                .ok_or(AssessmentRuntimeError::NoActiveSet)?;
            if packet.lineage.sequence_id != active.context.video_context.source_capture_id {
                return Err(AssessmentRuntimeError::PacketSourceMismatch);
            }
            if packet.lineage.active_profile_identity.as_deref()
                != Some(active.program.runtime_profile_identity.as_str())
                || packet.lineage.active_profile_hash != Some(active.program.runtime_profile_hash)
            {
                return Err(AssessmentRuntimeError::PacketProfileMismatch);
            }
            if packet.local_motion_coordinate.coarse_view
                != Some(active.program.local_coordinate_strategy.capture_view)
                || packet.local_motion_coordinate.preparation_to_effort
                    != Some(
                        active
                            .program
                            .local_coordinate_strategy
                            .preparation_to_effort,
                    )
                || packet.local_motion_coordinate.equipment_mode
                    != active.program.local_coordinate_strategy.equipment_mode
                || packet.local_motion_coordinate.pose_anchor
                    != active.program.local_coordinate_strategy.pose_anchor
            {
                return Err(AssessmentRuntimeError::PacketLocalCoordinateStrategyMismatch);
            }
            if active
                .packet_lineage
                .as_ref()
                .is_some_and(|frozen| frozen != &packet.lineage)
            {
                return Err(AssessmentRuntimeError::PacketLineageChangedDuringSet);
            }
        }
        if packet.completed_reps.len() != packet.completed_rep_subject_epochs.len() {
            return Err(AssessmentRuntimeError::InvalidRepProvenance);
        }
        self.record_packet_position(packet.frame_id, packet.source_timestamp_ms)?;

        let source_id = format!(
            "{}:frame:{}@{}",
            packet.lineage.sequence_id, packet.frame_id, packet.source_timestamp_ms
        );
        let coordinate_id = format!(
            "coordinate:{}:{}",
            packet.local_motion_coordinate.coordinate_frame_id, packet.frame_id
        );
        let fusion_id = format!("fusion:{}", packet.frame_id);
        let local_state =
            format!("{:?}", packet.local_motion_coordinate.state).to_ascii_lowercase();
        let equipment_observed = matches!(
            packet.equipment.status,
            crate::EquipmentFrameStatus::Observed
        );
        let active = self.active_set.as_mut().expect("active set observed above");
        if active.resolved_context.laterality_mode == AssessmentLateralityMode::ObservedActiveSide {
            update_observed_active_side(
                &mut active.active_side_candidates,
                &packet.equipment.tracks,
                &mut active.resolved_context.observed_active_side,
                &mut active.active_side_conflicted,
            );
        }
        let lineage_id = packet_lineage_id(&packet.lineage);
        active.packet_lineage.get_or_insert(packet.lineage.clone());
        active.trace_nodes.push(EvidenceTraceNode {
            node_id: source_id.clone(),
            kind: TraceNodeKind::SourceObservation,
            summary: format!(
                "Canonical frame {} at {} ms from MotionSession lineage {} (contract {}.{}, algorithm {}, config {}, inference {}, diagnostics {}).",
                packet.frame_id,
                packet.source_timestamp_ms,
                lineage_id,
                packet.lineage.contract.major,
                packet.lineage.contract.minor,
                packet.lineage.algorithm_version,
                packet.lineage.config_version,
                packet.lineage.inference_version,
                packet.lineage.diagnostic_version,
            ),
            source_ids: vec![source_id.clone()],
            input_node_ids: Vec::new(),
        });
        active.trace_nodes.push(EvidenceTraceNode {
            node_id: coordinate_id.clone(),
            kind: TraceNodeKind::LocalCoordinate,
            summary: format!(
                "Local coordinate {} is {local_state}.",
                packet.local_motion_coordinate.coordinate_frame_id
            ),
            source_ids: vec![source_id.clone()],
            input_node_ids: vec![source_id.clone()],
        });
        active.trace_nodes.push(EvidenceTraceNode {
            node_id: fusion_id,
            kind: TraceNodeKind::PoseEquipmentFusion,
            summary: format!(
                "Pose/equipment channel state is {:?}; independent equipment observed: {equipment_observed}; observed active side: {}.",
                packet.local_motion_coordinate.channel_agreement,
                if active.active_side_conflicted {
                    "conflict"
                } else {
                    match active.resolved_context.observed_active_side {
                        Some(AnatomicalSide::Left) => "left",
                        Some(AnatomicalSide::Right) => "right",
                        None => "unknown",
                    }
                }
            ),
            source_ids: vec![source_id.clone()],
            input_node_ids: vec![source_id.clone(), coordinate_id],
        });
        active.packets.push(PacketEvidenceSummary {
            frame_id: packet.frame_id,
            timestamp_ms: packet.source_timestamp_ms,
            subject_epoch: packet.subject_epoch,
            source_id,
            coordinate_frame_id: packet.local_motion_coordinate.coordinate_frame_id,
            local_state,
            channel_agreement: packet.local_motion_coordinate.channel_agreement,
            equipment_observed,
        });
        Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()))
    }

    fn assess_rep(&mut self, rep: SealedRep, subject_epoch: u64) {
        let active = self
            .active_set
            .as_mut()
            .expect("Rep provenance validated against an active set");
        debug_assert!(active.rep_ids.insert(rep.rep_id));
        let rep_ref = rep_reference(&rep, subject_epoch);
        let (features, range_value) = feature_facts(active, &rep);
        let load_unit = declared_load_unit(&active.context);
        let comparisons = compare_features(
            &features,
            &active.prefix_range_values,
            &active.prior_workout_range_values,
            &active.program.range_feature_id,
            &active.program.reference_order,
            subject_epoch,
            active.subject_reference_key.as_deref(),
            load_unit.as_deref(),
        );
        let evaluated_rules = evaluate_rep_rules(active, &comparisons);
        let rep_node = format!("rep:{}:boundary", rep.rep_id);
        let source_ids = active
            .packets
            .iter()
            .filter(|packet| {
                packet.frame_id >= rep.start_frame_id
                    && packet.frame_id <= rep.end_frame_id
                    && packet.subject_epoch == subject_epoch
            })
            .map(|packet| packet.source_id.clone())
            .collect::<Vec<_>>();
        active.trace_nodes.push(EvidenceTraceNode {
            node_id: rep_node.clone(),
            kind: TraceNodeKind::RepBoundary,
            summary: format!(
                "RepEngine sealed Rep {} from {} to {} ms with {:?} disposition.",
                rep.rep_id, rep.start_timestamp_ms, rep.end_timestamp_ms, rep.disposition
            ),
            source_ids: source_ids.clone(),
            input_node_ids: active
                .packets
                .iter()
                .filter(|packet| {
                    packet.frame_id >= rep.start_frame_id
                        && packet.frame_id <= rep.end_frame_id
                        && packet.subject_epoch == subject_epoch
                })
                .map(|packet| format!("fusion:{}", packet.frame_id))
                .collect(),
        });
        for feature in &features {
            let feature_node = format!("rep:{}:feature:{}", rep.rep_id, feature.feature_id);
            active.trace_nodes.push(EvidenceTraceNode {
                node_id: feature_node.clone(),
                kind: TraceNodeKind::FeatureFact,
                summary: feature_summary(feature),
                source_ids: source_ids.clone(),
                input_node_ids: vec![rep_node.clone()],
            });
            let comparison = comparisons
                .iter()
                .find(|value| value.feature_id == feature.feature_id)
                .expect("every feature has a comparison fact");
            let comparison_node = format!("rep:{}:comparison:{}", rep.rep_id, feature.feature_id);
            let mut comparison_sources = source_ids.clone();
            comparison_sources.extend(comparison.reference_source_ids.clone());
            comparison_sources.sort();
            comparison_sources.dedup();
            active.trace_nodes.push(EvidenceTraceNode {
                node_id: comparison_node.clone(),
                kind: TraceNodeKind::ReferenceComparison,
                summary: comparison_summary(comparison),
                source_ids: comparison_sources,
                input_node_ids: vec![feature_node],
            });
        }
        let mut rule_node_ids = Vec::new();
        for evaluated in &evaluated_rules {
            let conclusion = &evaluated.conclusion;
            let rule_node = format!("rep:{}:rule:{}", rep.rep_id, conclusion.dimension.as_str());
            let input_node_ids = if evaluated.feature_dependencies.is_empty() {
                vec![rep_node.clone()]
            } else {
                evaluated
                    .feature_dependencies
                    .iter()
                    .map(|feature_id| format!("rep:{}:comparison:{feature_id}", rep.rep_id))
                    .collect()
            };
            active.trace_nodes.push(EvidenceTraceNode {
                node_id: rule_node.clone(),
                kind: TraceNodeKind::RuleConclusion,
                summary: conclusion.summary.clone(),
                source_ids: source_ids.clone(),
                input_node_ids,
            });
            rule_node_ids.push(rule_node);
        }
        active.reps.push(rep_ref.clone());
        active.rep_assessments.push(SealedRepAssessment {
            rep: rep_ref,
            features,
            comparisons,
            dimension_findings: evaluated_rules
                .into_iter()
                .map(|evaluated| evaluated.conclusion)
                .collect(),
            trace_root_ids: rule_node_ids,
        });
        // Reference policy is compare-before-update: this Rep was evaluated
        // against only the prior set prefix and becomes reference afterwards.
        let range_is_observed = active.rep_assessments.last().is_some_and(|assessment| {
            assessment.features.iter().any(|feature| {
                feature.feature_id == active.program.range_feature_id
                    && feature.status == MotionFeatureStatus::Observed
            })
        });
        if let Some(value) = range_value.filter(|_| range_is_observed) {
            active.prefix_range_values.push(ReferenceSample {
                value,
                set_id: active.context.set_id.clone(),
                source_capture_id: active.context.video_context.source_capture_id.clone(),
                rep_id: rep.rep_id,
                subject_epoch,
                subject_reference_key: active.subject_reference_key.clone(),
                load_unit,
            });
        }
    }

    fn observe_set_closure(
        &mut self,
        closure: crate::MotionSetClosure,
    ) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        let active = self
            .active_set
            .as_ref()
            .ok_or(AssessmentRuntimeError::NoActiveSet)?;
        if active.bundle.capability == AssessmentBundleCapability::ContextResolutionOnly {
            return self.bundle_not_executable_refusal();
        }
        if active.closure_observed {
            return Err(AssessmentRuntimeError::CanonicalSetClosureAlreadyObserved);
        }
        if closure.lineage.sequence_id != active.context.video_context.source_capture_id {
            return Err(AssessmentRuntimeError::PacketSourceMismatch);
        }
        if closure.lineage.active_profile_identity.as_deref()
            != Some(active.program.runtime_profile_identity.as_str())
            || closure.lineage.active_profile_hash != Some(active.program.runtime_profile_hash)
        {
            return Err(AssessmentRuntimeError::PacketProfileMismatch);
        }
        if active
            .packet_lineage
            .as_ref()
            .is_some_and(|frozen| frozen != &closure.lineage)
        {
            return Err(AssessmentRuntimeError::PacketLineageChangedDuringSet);
        }
        if closure
            .source_timestamp_ms
            .zip(active.latest_timestamp_ms)
            .is_some_and(|(closure_timestamp, observed_timestamp)| {
                closure_timestamp != observed_timestamp
            })
        {
            return Err(AssessmentRuntimeError::PacketSourceMismatch);
        }
        if closure.completed_reps.len() != closure.completed_rep_subject_epochs.len() {
            return Err(AssessmentRuntimeError::InvalidRepProvenance);
        }
        let completed_reps = closure
            .completed_reps
            .into_iter()
            .zip(closure.completed_rep_subject_epochs)
            .collect::<Vec<_>>();
        {
            let active = self
                .active_set
                .as_ref()
                .expect("active set validated above");
            let mut rep_ids = active.rep_ids.clone();
            for (rep, subject_epoch) in &completed_reps {
                if !rep_ids.insert(rep.rep_id) {
                    return Err(AssessmentRuntimeError::DuplicateRepId(rep.rep_id));
                }
                validate_rep_provenance(
                    active,
                    rep,
                    *subject_epoch,
                    closure.source_timestamp_ms.unwrap_or(0),
                )?;
            }
        }
        for (rep, subject_epoch) in completed_reps {
            self.assess_rep(rep, subject_epoch);
        }
        self.active_set
            .as_mut()
            .expect("active set validated above")
            .closure_observed = true;
        Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()))
    }

    fn pause_set(&mut self) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        let active = self
            .active_set
            .as_mut()
            .ok_or(AssessmentRuntimeError::NoActiveSet)?;
        if active.paused {
            return Err(AssessmentRuntimeError::SetPaused);
        }
        active.paused = true;
        Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()))
    }

    fn resume_set(&mut self) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        let active = self
            .active_set
            .as_mut()
            .ok_or(AssessmentRuntimeError::NoActiveSet)?;
        if !active.paused {
            return Err(AssessmentRuntimeError::SetNotPaused);
        }
        active.paused = false;
        Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()))
    }

    fn finish_set(&mut self) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        if self.active_set.is_none() {
            return self
                .last_terminal
                .clone()
                .map(Box::new)
                .map(AssessmentEmission::SealedSetAssessment)
                .ok_or(AssessmentRuntimeError::NoActiveSet);
        }
        if self.active_set.as_ref().is_some_and(|active| {
            active.bundle.capability == AssessmentBundleCapability::ContextResolutionOnly
        }) {
            let refusal = self.bundle_not_executable_refusal();
            self.active_set = None;
            return refusal;
        }
        if self
            .active_set
            .as_ref()
            .is_some_and(|active| !active.closure_observed)
        {
            return Err(AssessmentRuntimeError::CanonicalSetClosureRequired);
        }
        let mut active = self.active_set.take().expect("active set checked above");
        if active.rep_assessments.is_empty() {
            let source_ids = active
                .packets
                .iter()
                .map(|packet| packet.source_id.clone())
                .collect::<Vec<_>>();
            let no_rep_boundary = "set:rep-boundary:no-sealed-rep".to_owned();
            active.trace_nodes.push(EvidenceTraceNode {
                node_id: no_rep_boundary.clone(),
                kind: TraceNodeKind::RepBoundary,
                summary: "Canonical set closure sealed without a completed Rep candidate.".into(),
                source_ids: source_ids.clone(),
                input_node_ids: active
                    .packets
                    .iter()
                    .map(|packet| format!("fusion:{}", packet.frame_id))
                    .collect(),
            });
            for dimension in AssessmentDimension::ALL {
                let dimension_id = dimension.as_str();
                let feature_node = format!("set:feature:no-sealed-rep:{dimension_id}");
                let comparison_node = format!("set:comparison:no-sealed-rep:{dimension_id}");
                let rule_node = format!("set:rule:no-sealed-rep:{dimension_id}");
                active.trace_nodes.push(EvidenceTraceNode {
                    node_id: feature_node.clone(),
                    kind: TraceNodeKind::FeatureFact,
                    summary: format!(
                        "No sealed Rep exists, so {dimension_id} has no Rep-scoped feature fact."
                    ),
                    source_ids: source_ids.clone(),
                    input_node_ids: vec![no_rep_boundary.clone()],
                });
                active.trace_nodes.push(EvidenceTraceNode {
                    node_id: comparison_node.clone(),
                    kind: TraceNodeKind::ReferenceComparison,
                    summary: format!(
                        "No {dimension_id} comparison is possible without a sealed Rep feature."
                    ),
                    source_ids: source_ids.clone(),
                    input_node_ids: vec![feature_node],
                });
                active.trace_nodes.push(EvidenceTraceNode {
                    node_id: rule_node,
                    kind: TraceNodeKind::RuleConclusion,
                    summary: format!(
                        "The {dimension_id} Rep rule abstains because set closure contained no sealed Rep."
                    ),
                    source_ids: source_ids.clone(),
                    input_node_ids: vec![comparison_node],
                });
            }
        }
        let set_patterns = aggregate_set_patterns(&active);
        for pattern in &set_patterns {
            let source_ids = active
                .packets
                .iter()
                .map(|packet| packet.source_id.clone())
                .collect::<Vec<_>>();
            let mut input_node_ids = pattern
                .supporting_rep_ids
                .iter()
                .flat_map(|rep_id| {
                    pattern
                        .evidence_dimensions
                        .iter()
                        .map(move |dimension| format!("rep:{rep_id}:rule:{}", dimension.as_str()))
                })
                .collect::<Vec<_>>();
            if input_node_ids.is_empty() && active.rep_assessments.is_empty() {
                input_node_ids.extend(
                    pattern
                        .evidence_dimensions
                        .iter()
                        .map(|dimension| format!("set:rule:no-sealed-rep:{}", dimension.as_str())),
                );
            }
            active.trace_nodes.push(EvidenceTraceNode {
                node_id: format!("set-pattern:{}", pattern.pattern_id),
                kind: TraceNodeKind::SetPattern,
                summary: pattern.summary.clone(),
                source_ids,
                input_node_ids,
            });
        }
        let dimension_findings = aggregate_dimension_findings(&active, &set_patterns);
        let all_source_ids = active
            .packets
            .iter()
            .map(|packet| packet.source_id.clone())
            .collect::<Vec<_>>();
        let mut conclusion_root_ids = Vec::new();
        for finding in &dimension_findings {
            let node_id = format!("set-conclusion:{}", finding.dimension.as_str());
            let mut input_node_ids = active
                .rep_assessments
                .iter()
                .map(|rep| format!("rep:{}:rule:{}", rep.rep.rep_id, finding.dimension.as_str()))
                .collect::<Vec<_>>();
            input_node_ids.extend(
                set_patterns
                    .iter()
                    .filter(|pattern| pattern.evidence_dimensions.contains(&finding.dimension))
                    .map(|pattern| format!("set-pattern:{}", pattern.pattern_id)),
            );
            active.trace_nodes.push(EvidenceTraceNode {
                node_id: node_id.clone(),
                kind: TraceNodeKind::SetConclusion,
                summary: finding.summary.clone(),
                source_ids: all_source_ids.clone(),
                input_node_ids,
            });
            conclusion_root_ids.push(node_id);
        }
        let assessment_id = format!(
            "{}:{}:{}",
            self.workout.workout_session_id, active.context.set_id, active.bundle.bundle_id
        );
        let completed_set_id = active.context.set_id.clone();
        let reference_key = active.bundle.bundle_id.clone();
        let sealed_range_values = active.prefix_range_values.clone();
        let mut trace = EvidenceDerivationTrace {
            schema_version: "maxpower.evidence-derivation-trace/v1".into(),
            nodes: active.trace_nodes,
            conclusion_root_ids,
            content_hash: String::new(),
        };
        validate_trace_graph(&trace.nodes, &trace.conclusion_root_ids)?;
        trace.content_hash = trace.computed_content_hash();
        let mut assessment = SealedSetAssessment {
            schema_version: "maxpower.sealed-set-assessment/v1".into(),
            assessment_id,
            workout_session_id: self.workout.workout_session_id.clone(),
            set_context: active.context,
            resolved_context: active.resolved_context,
            bundle_id: active.bundle.bundle_id,
            bundle_hash: active.bundle.content_hash,
            reps: active.reps,
            rep_assessments: active.rep_assessments,
            set_patterns,
            dimension_findings,
            trace,
            content_hash: String::new(),
        };
        assessment.content_hash = assessment.computed_content_hash();
        self.last_terminal = Some(assessment.clone());
        // The report above is immutable before any same-workout reference is
        // updated, so this set can never compare against its own future facts.
        self.completed_set_ids.insert(completed_set_id);
        self.workout_range_references
            .entry(reference_key)
            .or_default()
            .extend(sealed_range_values);
        Ok(AssessmentEmission::SealedSetAssessment(Box::new(
            assessment,
        )))
    }

    fn bundle_not_executable_refusal(&self) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        let active = self
            .active_set
            .as_ref()
            .ok_or(AssessmentRuntimeError::NoActiveSet)?;
        Ok(AssessmentEmission::TypedRefusal(TypedAssessmentRefusal {
            reason: AssessmentRefusalReason::BundleNotExecutable,
            video_context: active.context.video_context.clone(),
            detail: "this exact context currently supports Bundle resolution only; frame execution and quality reporting are not enabled"
                .into(),
        }))
    }

    fn finish_workout(&mut self) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        if self.active_set.is_some() {
            return Err(AssessmentRuntimeError::SetAlreadyActive);
        }
        self.workout_finished = true;
        Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()))
    }

    fn live_facts(&self) -> LiveMotionFacts {
        let (
            confirmed,
            needs_review,
            rejected,
            set_id,
            latest_frame_id,
            latest_timestamp_ms,
            resolved_context,
        ) = self
            .active_set
            .as_ref()
            .map_or((0, 0, 0, None, None, None, None), |active| {
                let confirmed = active
                    .reps
                    .iter()
                    .filter(|rep| rep.disposition == "confirmed")
                    .count() as u32;
                let needs_review = active
                    .reps
                    .iter()
                    .filter(|rep| rep.disposition == "needs_review")
                    .count() as u32;
                let rejected = active
                    .reps
                    .iter()
                    .filter(|rep| rep.disposition == "rejected")
                    .count() as u32;
                (
                    confirmed,
                    needs_review,
                    rejected,
                    Some(active.context.set_id.clone()),
                    active.latest_frame_id,
                    active.latest_timestamp_ms,
                    Some(active.resolved_context.clone()),
                )
            });
        LiveMotionFacts {
            workout_session_id: self.workout.workout_session_id.clone(),
            set_id,
            lifecycle: if self.workout_finished {
                AssessmentLifecycle::WorkoutFinished
            } else if self.active_set.as_ref().is_some_and(|active| active.paused) {
                AssessmentLifecycle::Paused
            } else if self.active_set.is_some() {
                AssessmentLifecycle::ObservingSet
            } else {
                AssessmentLifecycle::BetweenSets
            },
            confirmed_rep_count: confirmed,
            needs_review_rep_count: needs_review,
            rejected_rep_count: rejected,
            latest_frame_id,
            latest_timestamp_ms,
            resolved_context,
        }
    }
}

fn validate_catalog(
    catalog: &ExecutionAssessmentBundleCatalog,
) -> Result<(), AssessmentConfigurationError> {
    if catalog.schema_version != EXECUTION_ASSESSMENT_CATALOG_SCHEMA {
        return Err(AssessmentConfigurationError::UnsupportedCatalogSchema);
    }
    if catalog.catalog_id.trim().is_empty() {
        return Err(AssessmentConfigurationError::EmptyCatalogIdentity);
    }
    let mut installed_assets = HashMap::new();
    for asset in &catalog.installed_assets {
        if asset.id.trim().is_empty()
            || asset.schema_version != "v1"
            || !is_fixed_hash(&asset.content_hash)
            || asset.content_hash != asset.computed_content_hash()
        {
            return Err(AssessmentConfigurationError::InvalidCatalogAsset {
                asset_id: asset.id.clone(),
            });
        }
        if installed_assets.insert(asset.id.as_str(), asset).is_some() {
            return Err(AssessmentConfigurationError::DuplicateAssetIdentity(
                asset.id.clone(),
            ));
        }
    }
    let mut action_ids = HashSet::new();
    let mut bound_bundle_ids = HashSet::new();
    for definition in &catalog.action_definitions {
        if definition.action_definition_id.trim().is_empty()
            || definition.action_id.trim().is_empty()
            || definition.default_variation_id.trim().is_empty()
        {
            return Err(AssessmentConfigurationError::EmptyActionDefinitionIdentity);
        }
        if definition.schema_version != ACTION_DEFINITION_SCHEMA {
            return Err(
                AssessmentConfigurationError::UnsupportedActionDefinitionSchema {
                    action_definition_id: definition.action_definition_id.clone(),
                },
            );
        }
        if definition.content_hash != definition.computed_content_hash() {
            return Err(AssessmentConfigurationError::InvalidActionDefinitionHash {
                action_definition_id: definition.action_definition_id.clone(),
            });
        }
        if !action_ids.insert(definition.action_id.clone()) {
            return Err(AssessmentConfigurationError::DuplicateAction(
                definition.action_id.clone(),
            ));
        }
    }

    let mut contexts = HashSet::new();
    let mut bundle_ids = HashSet::new();
    for bundle in &catalog.bundles {
        if bundle.bundle_id.trim().is_empty() {
            return Err(AssessmentConfigurationError::EmptyBundleIdentity);
        }
        if bundle.schema_version != EXECUTION_ASSESSMENT_BUNDLE_SCHEMA {
            return Err(AssessmentConfigurationError::UnsupportedBundleSchema {
                bundle_id: bundle.bundle_id.clone(),
            });
        }
        if bundle.content_hash != bundle.computed_content_hash() {
            return Err(AssessmentConfigurationError::InvalidBundleHash {
                bundle_id: bundle.bundle_id.clone(),
            });
        }
        if !bundle_ids.insert(bundle.bundle_id.clone()) {
            return Err(AssessmentConfigurationError::DuplicateBundleIdentity(
                bundle.bundle_id.clone(),
            ));
        }
        for (asset, expected_kind) in bundle.lineage.assets() {
            if asset.id.trim().is_empty()
                || asset.schema_version.trim().is_empty()
                || asset.content_hash.trim().is_empty()
            {
                return Err(AssessmentConfigurationError::IncompleteBundleLineage {
                    bundle_id: bundle.bundle_id.clone(),
                });
            }
            if asset.kind != expected_kind
                || asset.schema_version != "v1"
                || !is_fixed_hash(&asset.content_hash)
            {
                return Err(AssessmentConfigurationError::InvalidBundleAssetReference {
                    bundle_id: bundle.bundle_id.clone(),
                    expected_kind,
                });
            }
            let Some(installed) = installed_assets.get(asset.id.as_str()) else {
                return Err(AssessmentConfigurationError::UnknownBundleAssetReference {
                    bundle_id: bundle.bundle_id.clone(),
                    asset_id: asset.id.clone(),
                });
            };
            if installed.reference() != *asset {
                return Err(AssessmentConfigurationError::InvalidBundleAssetReference {
                    bundle_id: bundle.bundle_id.clone(),
                    expected_kind,
                });
            }
        }
        if !contexts.insert(bundle.exact_context.clone()) {
            return Err(AssessmentConfigurationError::DuplicateExactContext(
                bundle.exact_context.clone(),
            ));
        }
    }
    let bundles_by_id: HashMap<_, _> = catalog
        .bundles
        .iter()
        .map(|bundle| (bundle.bundle_id.as_str(), bundle))
        .collect();
    for definition in &catalog.action_definitions {
        let mut views = HashSet::new();
        for binding in &definition.supported_views {
            bound_bundle_ids.insert(binding.bundle_id.as_str());
            if !views.insert(binding.capture_view) {
                return Err(AssessmentConfigurationError::DuplicateExactContext(
                    AssessmentExactContext {
                        action_id: definition.action_id.clone(),
                        variation_id: definition.default_variation_id.clone(),
                        equipment_semantics: definition.equipment_semantics,
                        laterality_mode: definition.laterality_mode,
                        capture_view: binding.capture_view,
                        pose_contract: definition.pose_contract.clone(),
                    },
                ));
            }
            let Some(bundle) = bundles_by_id.get(binding.bundle_id.as_str()) else {
                return Err(AssessmentConfigurationError::MissingBundleBinding {
                    action_id: definition.action_id.clone(),
                    bundle_id: binding.bundle_id.clone(),
                });
            };
            let expected = AssessmentExactContext {
                action_id: definition.action_id.clone(),
                variation_id: definition.default_variation_id.clone(),
                equipment_semantics: definition.equipment_semantics,
                laterality_mode: definition.laterality_mode,
                capture_view: binding.capture_view,
                pose_contract: definition.pose_contract.clone(),
            };
            if bundle.exact_context != expected {
                return Err(AssessmentConfigurationError::InconsistentBundleBinding {
                    action_id: definition.action_id.clone(),
                    bundle_id: binding.bundle_id.clone(),
                });
            }
        }
    }
    for bundle in &catalog.bundles {
        if !bound_bundle_ids.contains(bundle.bundle_id.as_str()) {
            return Err(AssessmentConfigurationError::OrphanBundle {
                bundle_id: bundle.bundle_id.clone(),
            });
        }
    }
    Ok(())
}

fn compile_catalog_programs(
    catalog: &ExecutionAssessmentBundleCatalog,
) -> Result<HashMap<String, CompiledAssessmentProgram>, AssessmentConfigurationError> {
    let assets = catalog
        .installed_assets
        .iter()
        .map(|asset| (asset.id.as_str(), asset))
        .collect::<HashMap<_, _>>();
    let mut programs = HashMap::new();
    for bundle in &catalog.bundles {
        if bundle.capability != AssessmentBundleCapability::Executable {
            continue;
        }
        let read_asset = |reference: &AssessmentAssetRef| {
            assets.get(reference.id.as_str()).copied().ok_or_else(|| {
                AssessmentConfigurationError::UnknownBundleAssetReference {
                    bundle_id: bundle.bundle_id.clone(),
                    asset_id: reference.id.clone(),
                }
            })
        };
        let recognition = read_asset(&bundle.lineage.recognition_profile)?;
        let execution = read_asset(&bundle.lineage.execution_contract)?;
        let local = read_asset(&bundle.lineage.local_coordinate_strategy)?;
        let equipment = read_asset(&bundle.lineage.equipment_adapter)?;
        let feature = read_asset(&bundle.lineage.feature_program)?;
        let reference = read_asset(&bundle.lineage.reference_policy)?;
        let rules = read_asset(&bundle.lineage.rule_pack)?;
        let aggregation = read_asset(&bundle.lineage.set_aggregation_policy)?;
        let invalid = |detail: &str| AssessmentConfigurationError::InvalidExecutableBundleProgram {
            bundle_id: bundle.bundle_id.clone(),
            detail: detail.into(),
        };
        let runtime_profile_identity = recognition
            .content
            .get("runtimeProfileIdentity")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| invalid("recognition profile runtime identity is missing"))?
            .to_owned();
        let runtime_profile_hash = recognition
            .content
            .get("runtimeProfileHash")
            .and_then(serde_json::Value::as_str)
            .filter(|value| is_fixed_hash(value))
            .and_then(|value| u64::from_str_radix(value, 16).ok())
            .ok_or_else(|| invalid("recognition profile runtime hash is missing"))?;
        let phase_names = execution
            .content
            .get("phaseOrder")
            .and_then(serde_json::Value::as_array)
            .filter(|values| values.len() == 2)
            .and_then(|values| {
                Some([
                    values[0].as_str()?.to_owned(),
                    values[1].as_str()?.to_owned(),
                ])
            })
            .filter(|values| values.iter().all(|value| !value.trim().is_empty()))
            .ok_or_else(|| invalid("ExecutionContract phaseOrder must name two phases"))?;
        let task_endpoints = execution
            .content
            .get("taskEndpoints")
            .and_then(serde_json::Value::as_array)
            .filter(|values| values.len() == 3)
            .and_then(|values| {
                Some([
                    values[0].as_str()?.to_owned(),
                    values[1].as_str()?.to_owned(),
                    values[2].as_str()?.to_owned(),
                ])
            })
            .filter(|values| {
                values.iter().all(|value| !value.trim().is_empty())
                    && values.iter().collect::<HashSet<_>>().len() == values.len()
            })
            .ok_or_else(|| {
                invalid("ExecutionContract taskEndpoints must name three unique endpoints")
            })?;
        let expected_local_view = local_coarse_view(bundle.exact_context.capture_view)
            .ok_or_else(|| invalid("executable Bundle capture view has no local strategy"))?;
        if local
            .content
            .get("captureView")
            .and_then(serde_json::Value::as_str)
            != Some(bundle.exact_context.capture_view.catalog_slug())
        {
            return Err(invalid(
                "LocalCoordinateStrategy captureView does not match exact context",
            ));
        }
        let preparation_to_effort = match local
            .content
            .get("preparationToEffortDirection")
            .and_then(serde_json::Value::as_str)
        {
            Some("up") => crate::LocalActionAxisDirection::PreparationToEffortUp,
            Some("down") => crate::LocalActionAxisDirection::PreparationToEffortDown,
            Some("left") => crate::LocalActionAxisDirection::PreparationToEffortLeft,
            Some("right") => crate::LocalActionAxisDirection::PreparationToEffortRight,
            _ => {
                return Err(invalid(
                    "LocalCoordinateStrategy preparationToEffortDirection is unsupported",
                ));
            }
        };
        let local_coordinate_strategy = crate::LocalMotionCoordinateStrategy {
            capture_view: expected_local_view,
            preparation_to_effort,
            equipment_mode: local_equipment_mode(bundle.exact_context.equipment_semantics),
            pose_anchor: local_pose_anchor(bundle.exact_context.equipment_semantics),
        };
        if local
            .content
            .get("equipmentMode")
            .and_then(serde_json::Value::as_str)
            != Some(local_equipment_mode_id(
                local_coordinate_strategy.equipment_mode,
            ))
            || local
                .content
                .get("poseAnchor")
                .and_then(serde_json::Value::as_str)
                != Some(local_pose_anchor_id(local_coordinate_strategy.pose_anchor))
        {
            return Err(invalid(
                "LocalCoordinateStrategy equipmentMode or poseAnchor does not match exact context",
            ));
        }
        if execution
            .content
            .get("equipmentSemantics")
            .and_then(serde_json::Value::as_str)
            != Some(equipment_semantics_id(
                bundle.exact_context.equipment_semantics,
            ))
        {
            return Err(invalid(
                "ExecutionContract equipmentSemantics does not match exact context",
            ));
        }
        let expected_evidence_policy =
            equipment_evidence_policy(bundle.exact_context.equipment_semantics);
        if local
            .content
            .get("coordinateSpace")
            .and_then(serde_json::Value::as_str)
            != Some("causal_set_local_camera_plane")
            || equipment
                .content
                .get("evidencePolicy")
                .and_then(serde_json::Value::as_str)
                != Some(expected_evidence_policy)
            || equipment
                .content
                .get("conflictPolicy")
                .and_then(serde_json::Value::as_str)
                != Some("abstain_fused_preserve_channels")
            || equipment
                .content
                .get("poseFallback")
                .and_then(serde_json::Value::as_str)
                != Some("preserve_as_independent_channel")
            || feature
                .content
                .get("boundedFacts")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
            || rules
                .content
                .get("missingEvidence")
                .and_then(serde_json::Value::as_str)
                != Some("cannot_judge")
        {
            return Err(invalid(
                "coordinate or equipment policy is unsupported by this runtime",
            ));
        }
        if execution
            .content
            .get("dimensions")
            .and_then(serde_json::Value::as_array)
            .is_none()
            || local
                .content
                .get("requireNormalizedEndpoints")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
            || equipment
                .content
                .get("evidencePolicy")
                .and_then(serde_json::Value::as_str)
                .is_none()
            || feature
                .content
                .get("features")
                .and_then(serde_json::Value::as_array)
                .is_none()
            || reference
                .content
                .get("compareBeforeUpdate")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
        {
            return Err(invalid(
                "one or more executable program assets are incomplete",
            ));
        }
        let range_deviation_ratio = rules
            .content
            .get("rangeDeviationRatio")
            .and_then(serde_json::Value::as_f64)
            .map(|value| value as f32)
            .filter(|value| value.is_finite() && (0.0..1.0).contains(value))
            .ok_or_else(|| invalid("RulePack rangeDeviationRatio is invalid"))?;
        let feature_ids = feature
            .content
            .get("features")
            .and_then(serde_json::Value::as_array)
            .expect("feature array validated above")
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .filter(|feature_id| {
                        matches!(
                            *feature_id,
                            "cycle_duration"
                                | "rep_disposition"
                                | "first_phase_duration"
                                | "second_phase_duration"
                                | "phase_duration_ratio"
                                | "local_primary_excursion"
                                | "local_return_error"
                                | "equipment_primary_excursion"
                                | "pose_primary_excursion"
                                | "bilateral_endpoint_difference"
                                | "bilateral_turnaround_timing_difference"
                                | "authorization_phase_control"
                                | "authorization_support_stability"
                                | "authorization_bilateral_coordination"
                                | "authorization_trajectory_control"
                                | "authorization_standard_variant_compatibility"
                        )
                    })
                    .map(str::to_owned)
                    .ok_or_else(|| invalid("FeatureProgram contains an unknown operator"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        if feature_ids.is_empty() {
            return Err(invalid("FeatureProgram must contain at least one feature"));
        }
        if feature_ids.iter().collect::<HashSet<_>>().len() != feature_ids.len() {
            return Err(invalid("FeatureProgram contains duplicate features"));
        }
        let range_feature_id = rules
            .content
            .get("rangeFeatureId")
            .and_then(serde_json::Value::as_str)
            .filter(|feature_id| feature_ids.iter().any(|value| value == *feature_id))
            .ok_or_else(|| invalid("RulePack rangeFeatureId is not in FeatureProgram"))?
            .to_owned();
        let contract_dimensions = execution
            .content
            .get("dimensions")
            .and_then(serde_json::Value::as_array)
            .expect("execution dimensions validated above")
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .and_then(parse_assessment_dimension)
                    .ok_or_else(|| invalid("ExecutionContract contains an unknown dimension"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        if contract_dimensions.len() != AssessmentDimension::ALL.len()
            || AssessmentDimension::ALL
                .iter()
                .any(|dimension| !contract_dimensions.contains(dimension))
        {
            return Err(invalid(
                "ExecutionContract must classify every assessment dimension",
            ));
        }
        let reference_order = reference
            .content
            .get("order")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| invalid("ReferencePolicy order is missing"))?
            .iter()
            .map(|value| match value.as_str() {
                Some("self_geometry") => Ok(ReferenceComparisonKind::SelfGeometry),
                Some("set_prefix") => Ok(ReferenceComparisonKind::SetPrefix),
                Some("same_workout_prior_set") => Ok(ReferenceComparisonKind::SameWorkoutPriorSet),
                _ => Err(invalid("ReferencePolicy order contains an unknown source")),
            })
            .collect::<Result<Vec<_>, _>>()?;
        if reference_order.is_empty()
            || reference_order.iter().collect::<HashSet<_>>().len() != reference_order.len()
        {
            return Err(invalid(
                "ReferencePolicy order must be non-empty and contain unique sources",
            ));
        }
        let rep_rules = rules
            .content
            .get("repRules")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| invalid("RulePack repRules are missing"))?
            .iter()
            .map(|rule| {
                let operator = rule
                    .get("operator")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| invalid("Rep rule operator is missing"))?;
                let dimension = rule
                    .get("dimension")
                    .and_then(serde_json::Value::as_str)
                    .and_then(parse_assessment_dimension)
                    .filter(|dimension| contract_dimensions.contains(dimension))
                    .ok_or_else(|| invalid("Rep rule dimension is outside ExecutionContract"))?;
                match operator {
                    "rep_disposition" => {
                        if dimension != AssessmentDimension::TaskCompletion {
                            return Err(invalid(
                                "rep_disposition is restricted to task_completion",
                            ));
                        }
                        let feature_id = rule
                            .get("featureId")
                            .and_then(serde_json::Value::as_str)
                            .filter(|id| feature_ids.iter().any(|value| value == *id))
                            .ok_or_else(|| invalid("rep disposition feature is invalid"))?;
                        if feature_id != "rep_disposition" {
                            return Err(invalid(
                                "rep disposition must consume the typed rep_disposition fact",
                            ));
                        }
                        Ok(CompiledRepRule::RepDisposition {
                            dimension,
                            feature_id: feature_id.into(),
                        })
                    }
                    "reference_lower_bound" => {
                        let feature_id = rule
                            .get("featureId")
                            .and_then(serde_json::Value::as_str)
                            .filter(|id| feature_ids.iter().any(|value| value == *id))
                            .ok_or_else(|| invalid("reference rule feature is invalid"))?;
                        let return_feature_id = rule
                            .get("returnFeatureId")
                            .and_then(serde_json::Value::as_str)
                            .filter(|id| feature_ids.iter().any(|value| value == *id))
                            .filter(|id| *id == "local_return_error")
                            .ok_or_else(|| invalid("reference rule return feature is invalid"))?;
                        let maximum_return_error = rule
                            .get("maximumReturnError")
                            .and_then(serde_json::Value::as_f64)
                            .map(|value| value as f32)
                            .filter(|value| value.is_finite() && *value >= 0.0)
                            .ok_or_else(|| invalid("reference rule return threshold is invalid"))?;
                        Ok(CompiledRepRule::ReferenceLowerBound {
                            dimension,
                            feature_id: feature_id.into(),
                            return_feature_id: return_feature_id.into(),
                            maximum_return_error,
                        })
                    }
                    "features_available" => {
                        if dimension != AssessmentDimension::ObservationConfidence {
                            return Err(invalid(
                                "features_available is restricted to observation_confidence",
                            ));
                        }
                        let ids = rule
                            .get("featureIds")
                            .and_then(serde_json::Value::as_array)
                            .ok_or_else(|| invalid("availability rule features are missing"))?
                            .iter()
                            .map(|value| {
                                value
                                    .as_str()
                                    .filter(|id| feature_ids.iter().any(|item| item == *id))
                                    .map(str::to_owned)
                                    .ok_or_else(|| invalid("availability rule feature is invalid"))
                            })
                            .collect::<Result<Vec<_>, _>>()?;
                        if ids.is_empty() || ids.iter().collect::<HashSet<_>>().len() != ids.len() {
                            return Err(invalid(
                                "availability rule features must be non-empty and unique",
                            ));
                        }
                        Ok(CompiledRepRule::FeaturesAvailable {
                            dimension,
                            feature_ids: ids,
                        })
                    }
                    "abstain" | "not_applicable" => {
                        let feature_ids = rule
                            .get("featureIds")
                            .and_then(serde_json::Value::as_array)
                            .ok_or_else(|| invalid("non-verdict rule features are missing"))?
                            .iter()
                            .map(|value| {
                                value
                                    .as_str()
                                    .filter(|id| feature_ids.iter().any(|item| item == *id))
                                    .map(str::to_owned)
                                    .ok_or_else(|| invalid("non-verdict rule feature is invalid"))
                            })
                            .collect::<Result<Vec<_>, _>>()?;
                        if feature_ids.is_empty()
                            || feature_ids.iter().collect::<HashSet<_>>().len() != feature_ids.len()
                        {
                            return Err(invalid(
                                "non-verdict rule features must be non-empty and unique",
                            ));
                        }
                        let expected = format!("authorization_{}", dimension.as_str());
                        if feature_ids.as_slice() != [expected.as_str()] {
                            return Err(invalid(
                                "non-verdict rule must consume its typed authorization fact",
                            ));
                        }
                        if operator == "abstain" {
                            Ok(CompiledRepRule::Abstain {
                                dimension,
                                feature_ids,
                                reason: rule
                                    .get("reason")
                                    .and_then(serde_json::Value::as_str)
                                    .filter(|value| !value.trim().is_empty())
                                    .ok_or_else(|| invalid("abstain rule reason is missing"))?
                                    .into(),
                            })
                        } else {
                            Ok(CompiledRepRule::NotApplicable {
                                dimension,
                                feature_ids,
                            })
                        }
                    }
                    _ => Err(invalid("Rep rule operator is unsupported")),
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        let ruled_dimensions = rep_rules
            .iter()
            .map(compiled_rep_rule_dimension)
            .collect::<Vec<_>>();
        if ruled_dimensions.len() != contract_dimensions.len()
            || contract_dimensions
                .iter()
                .any(|dimension| !ruled_dimensions.contains(dimension))
        {
            return Err(invalid(
                "RulePack must define exactly the ExecutionContract dimensions",
            ));
        }
        let minimum_feature_confidence = rules
            .content
            .get("minimumFeatureConfidence")
            .and_then(serde_json::Value::as_f64)
            .map(|value| value as f32)
            .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
            .ok_or_else(|| invalid("RulePack minimumFeatureConfidence is invalid"))?;
        let late_set_window = aggregation
            .content
            .get("lateSetWindow")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| invalid("set aggregation lateSetWindow is invalid"))?;
        let minimum_persistent_reps = aggregation
            .content
            .get("minimumPersistentReps")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| invalid("minimumPersistentReps is invalid"))?;
        let requires_bilateral_thresholds = feature_ids.iter().any(|feature_id| {
            matches!(
                feature_id.as_str(),
                "bilateral_endpoint_difference" | "bilateral_turnaround_timing_difference"
            )
        });
        let bilateral_difference_threshold = aggregation
            .content
            .get("bilateralDifferenceThreshold")
            .and_then(serde_json::Value::as_f64)
            .map(|value| value as f32)
            .filter(|value| value.is_finite() && *value > 0.0)
            .or((!requires_bilateral_thresholds).then_some(0.15))
            .ok_or_else(|| {
                invalid("bilateralDifferenceThreshold is required and must be positive")
            })?;
        let bilateral_timing_difference_threshold_ms = aggregation
            .content
            .get("bilateralTimingDifferenceThresholdMs")
            .and_then(serde_json::Value::as_f64)
            .map(|value| value as f32)
            .filter(|value| value.is_finite() && *value > 0.0)
            .or((!requires_bilateral_thresholds).then_some(150.0))
            .ok_or_else(|| {
                invalid("bilateralTimingDifferenceThresholdMs is required and must be positive")
            })?;
        let set_rules = aggregation
            .content
            .get("setRules")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| invalid("setRules are missing"))?
            .iter()
            .map(|rule| {
                let dimension = rule
                    .get("dimension")
                    .and_then(serde_json::Value::as_str)
                    .and_then(parse_assessment_dimension)
                    .filter(|dimension| contract_dimensions.contains(dimension))
                    .ok_or_else(|| invalid("set rule dimension is invalid"))?;
                match rule.get("operator").and_then(serde_json::Value::as_str) {
                    Some("rollup_rep_dimension") => {
                        Ok(CompiledSetRule::RollupRepDimension { dimension })
                    }
                    Some("late_set_persistence") => {
                        if dimension != AssessmentDimension::RangeOfMotion {
                            return Err(invalid(
                                "late_set_persistence is restricted to range_of_motion",
                            ));
                        }
                        Ok(CompiledSetRule::LateSetPersistence { dimension })
                    }
                    _ => Err(invalid("set rule operator is unsupported")),
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        let set_dimensions = set_rules
            .iter()
            .map(|rule| match rule {
                CompiledSetRule::RollupRepDimension { dimension }
                | CompiledSetRule::LateSetPersistence { dimension } => *dimension,
            })
            .collect::<Vec<_>>();
        if set_dimensions.len() != contract_dimensions.len()
            || contract_dimensions
                .iter()
                .any(|dimension| !set_dimensions.contains(dimension))
        {
            return Err(invalid(
                "set rules must define exactly the ExecutionContract dimensions",
            ));
        }
        programs.insert(
            bundle.bundle_id.clone(),
            CompiledAssessmentProgram {
                runtime_profile_identity,
                runtime_profile_hash,
                feature_ids,
                range_feature_id,
                phase_names,
                task_endpoints,
                local_coordinate_strategy,
                reference_order,
                range_deviation_ratio,
                minimum_feature_confidence,
                late_set_window,
                minimum_persistent_reps,
                bilateral_difference_threshold,
                bilateral_timing_difference_threshold_ms,
                rep_rules,
                set_rules,
            },
        );
    }
    Ok(programs)
}

fn parse_assessment_dimension(value: &str) -> Option<AssessmentDimension> {
    AssessmentDimension::ALL
        .into_iter()
        .find(|dimension| dimension.as_str() == value)
}

fn equipment_semantics_id(value: AssessmentEquipmentSemantics) -> &'static str {
    match value {
        AssessmentEquipmentSemantics::RigidBarAxis => "rigid_bar_axis",
        AssessmentEquipmentSemantics::CableOrMovingHandle => "cable_or_moving_handle",
        AssessmentEquipmentSemantics::UnilateralCableHandle => "unilateral_cable_handle",
        AssessmentEquipmentSemantics::ConstrainedMachineLever => "constrained_machine_lever",
        AssessmentEquipmentSemantics::TwoIndependentDumbbells => "two_independent_dumbbells",
        AssessmentEquipmentSemantics::BodyOnly => "body_only",
        AssessmentEquipmentSemantics::FixedSupport => "fixed_support",
    }
}

fn local_coarse_view(view: AssessmentCaptureView) -> Option<crate::LocalCoarseView> {
    match view {
        AssessmentCaptureView::Front => Some(crate::LocalCoarseView::Front),
        AssessmentCaptureView::FrontObliqueLeft => Some(crate::LocalCoarseView::FrontObliqueLeft),
        AssessmentCaptureView::FrontObliqueRight => Some(crate::LocalCoarseView::FrontObliqueRight),
        AssessmentCaptureView::RearObliqueLeft => Some(crate::LocalCoarseView::RearObliqueLeft),
        AssessmentCaptureView::RearObliqueRight => Some(crate::LocalCoarseView::RearObliqueRight),
        AssessmentCaptureView::Rear => Some(crate::LocalCoarseView::Rear),
        AssessmentCaptureView::LeftSide => Some(crate::LocalCoarseView::LeftSide),
        AssessmentCaptureView::RightSide => Some(crate::LocalCoarseView::RightSide),
    }
}

fn local_equipment_mode(value: AssessmentEquipmentSemantics) -> crate::LocalEquipmentMode {
    match value {
        AssessmentEquipmentSemantics::RigidBarAxis => crate::LocalEquipmentMode::RigidBarAxis,
        AssessmentEquipmentSemantics::CableOrMovingHandle
        | AssessmentEquipmentSemantics::UnilateralCableHandle
        | AssessmentEquipmentSemantics::ConstrainedMachineLever => {
            crate::LocalEquipmentMode::MovingHandle
        }
        AssessmentEquipmentSemantics::TwoIndependentDumbbells => {
            crate::LocalEquipmentMode::TwoIndependentDumbbells
        }
        AssessmentEquipmentSemantics::BodyOnly => crate::LocalEquipmentMode::PoseOnly,
        AssessmentEquipmentSemantics::FixedSupport => crate::LocalEquipmentMode::FixedSupport,
    }
}

fn local_pose_anchor(value: AssessmentEquipmentSemantics) -> crate::LocalPoseAnchor {
    match value {
        AssessmentEquipmentSemantics::BodyOnly | AssessmentEquipmentSemantics::FixedSupport => {
            crate::LocalPoseAnchor::ShoulderMidpoint
        }
        _ => crate::LocalPoseAnchor::WristMidpoint,
    }
}

fn local_equipment_mode_id(value: crate::LocalEquipmentMode) -> &'static str {
    match value {
        crate::LocalEquipmentMode::RigidBarAxis => "rigidbaraxis",
        crate::LocalEquipmentMode::MovingHandle => "movinghandle",
        crate::LocalEquipmentMode::TwoIndependentDumbbells => "twoindependentdumbbells",
        crate::LocalEquipmentMode::PoseOnly => "poseonly",
        crate::LocalEquipmentMode::FixedSupport => "fixedsupport",
    }
}

fn local_pose_anchor_id(value: crate::LocalPoseAnchor) -> &'static str {
    match value {
        crate::LocalPoseAnchor::WristMidpoint => "wristmidpoint",
        crate::LocalPoseAnchor::ShoulderMidpoint => "shouldermidpoint",
    }
}

fn equipment_evidence_policy(value: AssessmentEquipmentSemantics) -> &'static str {
    match value {
        AssessmentEquipmentSemantics::RigidBarAxis => {
            "independent_subject_associated_rigid_bar_axis"
        }
        AssessmentEquipmentSemantics::CableOrMovingHandle => {
            "independent_subject_associated_moving_handle"
        }
        AssessmentEquipmentSemantics::UnilateralCableHandle => {
            "observed_side_subject_associated_moving_handle"
        }
        AssessmentEquipmentSemantics::ConstrainedMachineLever => {
            "moving_lever_separate_from_fixed_structure"
        }
        AssessmentEquipmentSemantics::TwoIndependentDumbbells => {
            "two_independent_subject_associated_loads"
        }
        AssessmentEquipmentSemantics::BodyOnly => "pose_only_no_moving_equipment",
        AssessmentEquipmentSemantics::FixedSupport => "body_relative_to_fixed_support",
    }
}

fn declared_load_unit(context: &SetExecutionContext) -> Option<String> {
    context
        .performed_load
        .as_ref()
        .or(context.planned_load.as_ref())
        .map(|load| load.unit.trim().to_ascii_lowercase())
        .filter(|unit| !unit.is_empty())
}

fn compiled_rep_rule_dimension(rule: &CompiledRepRule) -> AssessmentDimension {
    match rule {
        CompiledRepRule::RepDisposition { dimension, .. }
        | CompiledRepRule::ReferenceLowerBound { dimension, .. }
        | CompiledRepRule::FeaturesAvailable { dimension, .. }
        | CompiledRepRule::Abstain { dimension, .. }
        | CompiledRepRule::NotApplicable { dimension, .. } => *dimension,
    }
}

fn equipment_channel(
    evidence: &crate::LocalMotionCoordinateEvidence,
) -> Option<crate::LocalTrajectoryChannel> {
    evidence.equipment
}

fn validate_rep_provenance(
    active: &ActiveSet,
    rep: &SealedRep,
    subject_epoch: u64,
    sealed_at_timestamp_ms: u64,
) -> Result<(), AssessmentRuntimeError> {
    if rep.profile_identity != active.program.runtime_profile_identity
        || rep.profile_hash != active.program.runtime_profile_hash
    {
        return Err(AssessmentRuntimeError::RepProfileMismatch);
    }
    if rep.start_timestamp_ms > rep.peak_timestamp_ms
        || rep.peak_timestamp_ms > rep.turnaround_confirmed_timestamp_ms
        || rep.turnaround_confirmed_timestamp_ms > rep.end_timestamp_ms
        || rep.start_frame_id > rep.peak_frame_id
        || rep.peak_frame_id > rep.end_frame_id
        || rep.end_timestamp_ms > sealed_at_timestamp_ms
        || rep.canonical_slice_hash == 0
    {
        return Err(AssessmentRuntimeError::InvalidRepProvenance);
    }
    let endpoint_exists = |frame_id: u64, timestamp_ms: u64| {
        active.packets.iter().any(|packet| {
            packet.subject_epoch == subject_epoch
                && packet.frame_id == frame_id
                && packet.timestamp_ms == timestamp_ms
        })
    };
    if !endpoint_exists(rep.start_frame_id, rep.start_timestamp_ms)
        || !endpoint_exists(rep.peak_frame_id, rep.peak_timestamp_ms)
        || !endpoint_exists(rep.end_frame_id, rep.end_timestamp_ms)
    {
        return Err(AssessmentRuntimeError::InvalidRepProvenance);
    }
    Ok(())
}

fn pose_channel(
    evidence: &crate::LocalMotionCoordinateEvidence,
) -> Option<crate::LocalTrajectoryChannel> {
    evidence.pose
}

fn left_equipment_channel(
    evidence: &crate::LocalMotionCoordinateEvidence,
) -> Option<crate::LocalTrajectoryChannel> {
    evidence.anatomical_left_equipment
}

fn right_equipment_channel(
    evidence: &crate::LocalMotionCoordinateEvidence,
) -> Option<crate::LocalTrajectoryChannel> {
    evidence.anatomical_right_equipment
}

fn fused_channel(
    evidence: &crate::LocalMotionCoordinateEvidence,
) -> Option<crate::LocalTrajectoryChannel> {
    match evidence.channel_agreement {
        LocalChannelAgreement::Agreement | LocalChannelAgreement::EquipmentOnly => {
            evidence.equipment
        }
        LocalChannelAgreement::PoseOnly => evidence.pose,
        LocalChannelAgreement::Conflict | LocalChannelAgreement::CannotJudge => None,
    }
}

fn trajectory_metrics(
    endpoints: Option<&crate::NormalizedRepEndpointEvidence>,
    channel: fn(&crate::LocalMotionCoordinateEvidence) -> Option<crate::LocalTrajectoryChannel>,
) -> (Option<f32>, Option<f32>, f32, f32, f32) {
    let Some(endpoints) = endpoints else {
        return (None, None, 0.0, 0.0, 1.0);
    };
    let (Some(start), Some(turn), Some(end)) = (
        channel(&endpoints.start_anchor),
        channel(&endpoints.primary_turnaround),
        channel(&endpoints.end_return),
    ) else {
        return (None, None, 0.0, 0.0, 1.0);
    };
    (
        Some((turn.along_axis_progress - start.along_axis_progress).abs()),
        Some((end.along_axis_progress - start.along_axis_progress).abs()),
        start.coverage.min(turn.coverage).min(end.coverage),
        start.confidence.min(turn.confidence).min(end.confidence),
        start.uncertainty.max(turn.uncertainty).max(end.uncertainty),
    )
}

fn feature_facts(active: &ActiveSet, rep: &SealedRep) -> (Vec<MotionFeatureFact>, Option<f32>) {
    let source_range = EvidenceSourceRange {
        source_capture_id: active.context.video_context.source_capture_id.clone(),
        start_frame_id: rep.start_frame_id,
        end_frame_id: rep.end_frame_id,
        start_timestamp_ms: rep.start_timestamp_ms,
        end_timestamp_ms: rep.end_timestamp_ms,
        canonical_slice_hash: format!("{:016x}", rep.canonical_slice_hash),
    };
    let duration = rep.end_timestamp_ms.saturating_sub(rep.start_timestamp_ms) as f32;
    let first_phase = rep.peak_timestamp_ms.saturating_sub(rep.start_timestamp_ms) as f32;
    let second_phase = rep.end_timestamp_ms.saturating_sub(rep.peak_timestamp_ms) as f32;
    let phase_ratio = (second_phase > 0.0).then_some(first_phase / second_phase);
    let endpoints = rep.normalized_endpoints.as_ref();
    let (
        range_value,
        return_error,
        trajectory_coverage,
        trajectory_confidence,
        trajectory_uncertainty,
    ) = trajectory_metrics(endpoints, fused_channel);
    let (
        equipment_range,
        _equipment_return_error,
        equipment_coverage,
        equipment_confidence,
        equipment_uncertainty,
    ) = trajectory_metrics(endpoints, equipment_channel);
    let (pose_range, _pose_return_error, pose_coverage, pose_confidence, pose_uncertainty) =
        trajectory_metrics(endpoints, pose_channel);
    let (left_range, _, left_coverage, left_confidence, left_uncertainty) =
        trajectory_metrics(endpoints, left_equipment_channel);
    let (right_range, _, right_coverage, right_confidence, right_uncertainty) =
        trajectory_metrics(endpoints, right_equipment_channel);
    let bilateral_difference = left_range
        .zip(right_range)
        .map(|(left, right)| (left - right).abs());
    let bilateral_timing_difference = endpoints.and_then(|value| {
        value
            .anatomical_left_turnaround_timestamp_ms
            .zip(value.anatomical_right_turnaround_timestamp_ms)
            .map(|(left, right)| left.abs_diff(right) as f32)
    });
    let mut candidates = vec![
        numeric_feature(
            "cycle_duration",
            Some(duration),
            MotionFeatureUnit::Milliseconds,
            1.0,
            1.0,
            0.0,
            vec!["rep_engine_boundaries".into()],
            source_range.clone(),
        ),
        numeric_feature(
            "first_phase_duration",
            Some(first_phase),
            MotionFeatureUnit::Milliseconds,
            1.0,
            1.0,
            0.0,
            vec![
                "rep_engine_boundaries".into(),
                format!("phase:{}", active.program.phase_names[0]),
            ],
            source_range.clone(),
        ),
        numeric_feature(
            "second_phase_duration",
            Some(second_phase),
            MotionFeatureUnit::Milliseconds,
            1.0,
            1.0,
            0.0,
            vec![
                "rep_engine_boundaries".into(),
                format!("phase:{}", active.program.phase_names[1]),
            ],
            source_range.clone(),
        ),
        numeric_feature(
            "phase_duration_ratio",
            phase_ratio,
            MotionFeatureUnit::Ratio,
            1.0,
            1.0,
            0.0,
            vec![
                "rep_engine_boundaries".into(),
                format!("phase:{}", active.program.phase_names[0]),
                format!("phase:{}", active.program.phase_names[1]),
            ],
            source_range.clone(),
        ),
        numeric_feature(
            "local_primary_excursion",
            range_value,
            MotionFeatureUnit::NormalizedDisplacement,
            trajectory_coverage,
            trajectory_confidence,
            trajectory_uncertainty,
            vec![
                "local_motion_coordinate".into(),
                "pose_equipment_fusion".into(),
            ],
            source_range.clone(),
        ),
        numeric_feature(
            "local_return_error",
            return_error,
            MotionFeatureUnit::NormalizedDisplacement,
            trajectory_coverage,
            trajectory_confidence,
            trajectory_uncertainty,
            vec![
                "local_motion_coordinate".into(),
                "start_to_return_closure".into(),
                "pose_equipment_fusion".into(),
            ],
            source_range.clone(),
        ),
        numeric_feature(
            "equipment_primary_excursion",
            equipment_range,
            MotionFeatureUnit::NormalizedDisplacement,
            equipment_coverage,
            equipment_confidence,
            equipment_uncertainty,
            vec![
                "equipment_measured".into(),
                "local_motion_coordinate".into(),
            ],
            source_range.clone(),
        ),
        numeric_feature(
            "pose_primary_excursion",
            pose_range,
            MotionFeatureUnit::NormalizedDisplacement,
            pose_coverage,
            pose_confidence,
            pose_uncertainty,
            vec!["pose_measured".into(), "local_motion_coordinate".into()],
            source_range.clone(),
        ),
        numeric_feature(
            "bilateral_endpoint_difference",
            bilateral_difference,
            MotionFeatureUnit::NormalizedDisplacement,
            left_coverage.min(right_coverage),
            left_confidence.min(right_confidence),
            left_uncertainty.max(right_uncertainty),
            vec![
                "independent_left_equipment_track".into(),
                "independent_right_equipment_track".into(),
            ],
            source_range.clone(),
        ),
        numeric_feature(
            "bilateral_turnaround_timing_difference",
            bilateral_timing_difference,
            MotionFeatureUnit::Milliseconds,
            left_coverage.min(right_coverage),
            left_confidence.min(right_confidence),
            left_uncertainty.max(right_uncertainty),
            vec![
                "independent_left_equipment_turnaround".into(),
                "independent_right_equipment_turnaround".into(),
            ],
            source_range.clone(),
        ),
    ];
    for rule in &active.program.rep_rules {
        let categorical = match rule {
            CompiledRepRule::RepDisposition { feature_id, .. } => Some((
                feature_id.as_str(),
                format!("{:?}", rep.disposition).to_ascii_lowercase(),
                vec![
                    "rep_engine_disposition".into(),
                    format!("task_start:{}", active.program.task_endpoints[0]),
                    format!("task_turnaround:{}", active.program.task_endpoints[1]),
                    format!("task_return:{}", active.program.task_endpoints[2]),
                ],
            )),
            CompiledRepRule::Abstain {
                feature_ids,
                reason,
                ..
            } => Some((
                feature_ids[0].as_str(),
                "not_authorized".into(),
                vec!["execution_contract".into(), format!("rule_pack:{reason}")],
            )),
            CompiledRepRule::NotApplicable { feature_ids, .. } => Some((
                feature_ids[0].as_str(),
                "not_applicable".into(),
                vec!["execution_contract".into(), "rule_pack".into()],
            )),
            CompiledRepRule::ReferenceLowerBound { .. }
            | CompiledRepRule::FeaturesAvailable { .. } => None,
        };
        if let Some((feature_id, category, provenance)) = categorical
            && !candidates
                .iter()
                .any(|candidate| candidate.feature_id == feature_id)
        {
            candidates.push(categorical_feature(
                feature_id,
                category,
                provenance,
                source_range.clone(),
            ));
        }
    }
    let mut facts = active
        .program
        .feature_ids
        .iter()
        .filter_map(|feature_id| {
            candidates
                .iter()
                .find(|fact| &fact.feature_id == feature_id)
                .cloned()
        })
        .collect::<Vec<_>>();
    for fact in &mut facts {
        if fact.confidence < active.program.minimum_feature_confidence {
            fact.status = MotionFeatureStatus::CannotJudge;
            fact.value = None;
            fact.categorical_value = None;
        }
    }
    (facts, range_value)
}

#[allow(clippy::too_many_arguments)]
fn numeric_feature(
    feature_id: &str,
    value: Option<f32>,
    unit: MotionFeatureUnit,
    coverage: f32,
    confidence: f32,
    uncertainty: f32,
    provenance: Vec<String>,
    source_range: EvidenceSourceRange,
) -> MotionFeatureFact {
    MotionFeatureFact {
        feature_id: feature_id.into(),
        value,
        categorical_value: None,
        unit,
        status: if value.is_some() {
            MotionFeatureStatus::Observed
        } else {
            MotionFeatureStatus::CannotJudge
        },
        coverage: coverage.clamp(0.0, 1.0),
        confidence: confidence.clamp(0.0, 1.0),
        uncertainty: uncertainty.clamp(0.0, 1.0),
        provenance,
        source_range,
    }
}

fn categorical_feature(
    feature_id: &str,
    categorical_value: String,
    provenance: Vec<String>,
    source_range: EvidenceSourceRange,
) -> MotionFeatureFact {
    MotionFeatureFact {
        feature_id: feature_id.into(),
        value: None,
        categorical_value: Some(categorical_value),
        unit: MotionFeatureUnit::Categorical,
        status: MotionFeatureStatus::Observed,
        coverage: 1.0,
        confidence: 1.0,
        uncertainty: 0.0,
        provenance,
        source_range,
    }
}

fn compare_features(
    features: &[MotionFeatureFact],
    prefix_range_values: &[ReferenceSample],
    prior_workout_range_values: &[ReferenceSample],
    range_feature_id: &str,
    reference_order: &[ReferenceComparisonKind],
    subject_epoch: u64,
    subject_reference_key: Option<&str>,
    load_unit: Option<&str>,
) -> Vec<ReferenceComparisonFact> {
    features
        .iter()
        .map(|feature| {
            if feature.feature_id == range_feature_id {
                let compatible_prefix = prefix_range_values
                    .iter()
                    .filter(|sample| {
                        sample.subject_epoch == subject_epoch
                            && sample.load_unit.as_deref() == load_unit
                    })
                    .collect::<Vec<_>>();
                let compatible_prior = prior_workout_range_values
                    .iter()
                    .filter(|sample| {
                        subject_reference_key.is_some()
                            && sample.subject_reference_key.as_deref() == subject_reference_key
                            && sample.load_unit.as_deref() == load_unit
                    })
                    .collect::<Vec<_>>();
                let (kind, reference_values) = reference_order
                    .iter()
                    .find_map(|kind| match kind {
                        ReferenceComparisonKind::SetPrefix if !compatible_prefix.is_empty() => {
                            Some((*kind, compatible_prefix.as_slice()))
                        }
                        ReferenceComparisonKind::SameWorkoutPriorSet
                            if !compatible_prior.is_empty() =>
                        {
                            Some((*kind, compatible_prior.as_slice()))
                        }
                        _ => None,
                    })
                    .unwrap_or((ReferenceComparisonKind::NoReference, &[]));
                let reference_value = (!reference_values.is_empty()).then(|| {
                    reference_values
                        .iter()
                        .map(|sample| sample.value)
                        .sum::<f32>()
                        / reference_values.len() as f32
                });
                let delta_ratio =
                    feature
                        .value
                        .zip(reference_value)
                        .and_then(|(value, reference)| {
                            (reference.abs() > f32::EPSILON)
                                .then_some((value - reference) / reference)
                        });
                ReferenceComparisonFact {
                    feature_id: feature.feature_id.clone(),
                    kind,
                    observed_value: feature.value,
                    observed_category: feature.categorical_value.clone(),
                    reference_value,
                    delta_ratio,
                    reference_source_ids: reference_values
                        .iter()
                        .map(|sample| {
                            format!(
                                "{}:set:{}:rep:{}:subject_epoch:{}:subject_reference:{}:load_unit:{}",
                                sample.source_capture_id,
                                sample.set_id,
                                sample.rep_id,
                                sample.subject_epoch,
                                sample
                                    .subject_reference_key
                                    .as_deref()
                                    .unwrap_or("unverified"),
                                sample.load_unit.as_deref().unwrap_or("undeclared"),
                            )
                        })
                        .collect(),
                    reason: reference_value.is_none().then(|| {
                        "no action/view/subject/coordinate/load-compatible prior Rep exists; this Rep is published only after evaluation"
                            .into()
                    }),
                }
            } else if feature.feature_id == "phase_duration_ratio"
                && reference_order.contains(&ReferenceComparisonKind::SelfGeometry)
            {
                ReferenceComparisonFact {
                    feature_id: feature.feature_id.clone(),
                    kind: ReferenceComparisonKind::SelfGeometry,
                    observed_value: feature.value,
                    observed_category: feature.categorical_value.clone(),
                    reference_value: Some(1.0),
                    delta_ratio: feature.value.map(|value| value - 1.0),
                    reference_source_ids: vec![format!(
                        "{}:self:rep:{}",
                        feature.source_range.source_capture_id,
                        feature.source_range.canonical_slice_hash
                    )],
                    reason: Some("compares the two measured phases within the same Rep".into()),
                }
            } else {
                ReferenceComparisonFact {
                    feature_id: feature.feature_id.clone(),
                    kind: ReferenceComparisonKind::NoReference,
                    observed_value: feature.value,
                    observed_category: feature.categorical_value.clone(),
                    reference_value: None,
                    delta_ratio: None,
                    reference_source_ids: Vec::new(),
                    reason: Some(
                        "descriptive fact; no governed comparison reference applies".into(),
                    ),
                }
            }
        })
        .collect()
}

struct EvaluatedRepRule {
    conclusion: QualityConclusion,
    feature_dependencies: Vec<String>,
}

fn evaluate_rep_rules(
    active: &ActiveSet,
    comparisons: &[ReferenceComparisonFact],
) -> Vec<EvaluatedRepRule> {
    active
        .program
        .rep_rules
        .iter()
        .map(|rule| {
            let (conclusion, feature_dependencies) = match rule {
            CompiledRepRule::RepDisposition {
                dimension,
                feature_id,
            } => {
                let category = comparisons
                    .iter()
                    .find(|comparison| comparison.feature_id == *feature_id)
                    .and_then(|comparison| comparison.observed_category.as_deref());
                let (state, summary, reason, confidence) = match category {
                    Some("confirmed") => (
                        AssessmentConclusionState::ObservedAcceptable,
                        "RepEngine confirmed a complete causal movement cycle.".into(),
                        None,
                        1.0,
                    ),
                    Some("needsreview") => (
                        AssessmentConclusionState::CannotJudge,
                        "RepEngine sealed a reviewable cycle but did not confirm it.".into(),
                        Some("rep_needs_review".into()),
                        0.5,
                    ),
                    Some("rejected") => (
                        AssessmentConclusionState::ObservedDeviation,
                        "RepEngine rejected this movement candidate as an incomplete or invalid cycle."
                            .into(),
                        Some("rep_rejected".into()),
                        1.0,
                    ),
                    _ => (
                        AssessmentConclusionState::CannotJudge,
                        "The typed Rep disposition fact was unavailable.".into(),
                        Some("rep_disposition_unavailable".into()),
                        0.0,
                    ),
                };
                (
                    rule_finding(*dimension, state, summary, Vec::new(), reason, confidence),
                    vec![feature_id.clone()],
                )
            }
            CompiledRepRule::ReferenceLowerBound {
                dimension,
                feature_id,
                return_feature_id,
                maximum_return_error,
            } => {
                let comparison = comparisons
                    .iter()
                    .find(|comparison| comparison.feature_id == *feature_id);
                let return_error = comparisons
                    .iter()
                    .find(|comparison| comparison.feature_id == *return_feature_id)
                    .and_then(|comparison| comparison.observed_value);
                let Some(return_error) = return_error else {
                    return EvaluatedRepRule {
                        conclusion: rule_finding(
                            *dimension,
                            AssessmentConclusionState::CannotJudge,
                            "The visible return-to-start path was not observable.".into(),
                            vec![feature_id.clone(), return_feature_id.clone()],
                            Some("visible_return_unavailable".into()),
                            0.0,
                        ),
                        feature_dependencies: vec![
                            feature_id.clone(),
                            return_feature_id.clone(),
                        ],
                    };
                };
                let return_incomplete = return_error > *maximum_return_error;
                if return_incomplete {
                    return EvaluatedRepRule {
                        conclusion: rule_finding(
                            *dimension,
                            AssessmentConclusionState::ObservedDeviation,
                            format!(
                                "Visible return error {return_error:.3} exceeded the configured {maximum_return_error:.3} local-coordinate tolerance."
                            ),
                            vec![feature_id.clone(), return_feature_id.clone()],
                            None,
                            0.75,
                        ),
                        feature_dependencies: vec![
                            feature_id.clone(),
                            return_feature_id.clone(),
                        ],
                    };
                }
                let Some(delta_ratio) = comparison.and_then(|value| value.delta_ratio) else {
                    return EvaluatedRepRule {
                        conclusion: rule_finding(
                            *dimension,
                            AssessmentConclusionState::CannotJudge,
                            format!(
                                "Visible return error {return_error:.3} stayed within the configured tolerance, but no causal range reference exists yet."
                            ),
                            vec![feature_id.clone(), return_feature_id.clone()],
                            Some("no_reference".into()),
                            0.5,
                        ),
                        feature_dependencies: vec![
                            feature_id.clone(),
                            return_feature_id.clone(),
                        ],
                    };
                };
                let state = if delta_ratio < -active.program.range_deviation_ratio {
                    AssessmentConclusionState::ObservedDeviation
                } else {
                    AssessmentConclusionState::ObservedAcceptable
                };
                let summary = if state == AssessmentConclusionState::ObservedDeviation {
                    format!(
                        "Observed {feature_id} was {:.1}% below the causal {:?} reference.",
                        delta_ratio.abs() * 100.0,
                        comparison.expect("comparison exists").kind
                    )
                } else {
                    format!(
                        "Observed {feature_id} remained within the configured {:.0}% lower-bound tolerance.",
                        active.program.range_deviation_ratio * 100.0
                    )
                };
                (
                    rule_finding(
                        *dimension,
                        state,
                        summary,
                        vec![feature_id.clone(), return_feature_id.clone()],
                        None,
                        0.75,
                    ),
                    vec![feature_id.clone(), return_feature_id.clone()],
                )
            }
            CompiledRepRule::FeaturesAvailable {
                dimension,
                feature_ids,
            } => {
                let available = feature_ids.iter().all(|feature_id| {
                    comparisons.iter().any(|comparison| {
                        comparison.feature_id == *feature_id
                            && (comparison.observed_value.is_some()
                                || comparison.observed_category.is_some())
                    })
                });
                (
                    rule_finding(
                        *dimension,
                        if available {
                            AssessmentConclusionState::ObservedAcceptable
                        } else {
                            AssessmentConclusionState::CannotJudge
                        },
                        if available {
                            format!("Configured facts {} were observable.", feature_ids.join(", "))
                        } else {
                            format!(
                                "Configured facts {} were not all observable.",
                                feature_ids.join(", ")
                            )
                        },
                        feature_ids.clone(),
                        (!available).then(|| "required_feature_unavailable".into()),
                        if available { 0.75 } else { 0.0 },
                    ),
                    feature_ids.clone(),
                )
            }
            CompiledRepRule::Abstain {
                dimension,
                feature_ids,
                reason,
            } => {
                let authorization_observed = feature_ids.iter().all(|feature_id| {
                    comparisons.iter().any(|comparison| {
                        comparison.feature_id == *feature_id
                            && comparison.observed_category.as_deref() == Some("not_authorized")
                    })
                });
                (
                    rule_finding(
                        *dimension,
                        AssessmentConclusionState::CannotJudge,
                        if authorization_observed {
                            "The installed Bundle does not authorize a conclusion for this dimension."
                                .into()
                        } else {
                            "The Bundle authorization fact was unavailable.".into()
                        },
                        feature_ids.clone(),
                        Some(if authorization_observed {
                            reason.clone()
                        } else {
                            "authorization_fact_unavailable".into()
                        }),
                        0.0,
                    ),
                    feature_ids.clone(),
                )
            }
            CompiledRepRule::NotApplicable {
                dimension,
                feature_ids,
            } => {
                let not_applicable = feature_ids.iter().all(|feature_id| {
                    comparisons.iter().any(|comparison| {
                        comparison.feature_id == *feature_id
                            && comparison.observed_category.as_deref() == Some("not_applicable")
                    })
                });
                (
                    rule_finding(
                        *dimension,
                        if not_applicable {
                            AssessmentConclusionState::NotApplicable
                        } else {
                            AssessmentConclusionState::CannotJudge
                        },
                        if not_applicable {
                            "This dimension is not applicable to the installed execution contract."
                                .into()
                        } else {
                            "The Bundle applicability fact was unavailable.".into()
                        },
                        feature_ids.clone(),
                        (!not_applicable).then(|| "applicability_fact_unavailable".into()),
                        if not_applicable { 1.0 } else { 0.0 },
                    ),
                    feature_ids.clone(),
                )
            }
            };
            EvaluatedRepRule {
                conclusion,
                feature_dependencies,
            }
        })
        .collect()
}

fn rule_finding(
    dimension: AssessmentDimension,
    state: AssessmentConclusionState,
    summary: String,
    evidence: Vec<String>,
    reason: Option<String>,
    confidence: f32,
) -> QualityConclusion {
    QualityConclusion {
        conclusion_id: format!("rule:{}", dimension.as_str()),
        dimension,
        state,
        summary,
        evidence,
        reason,
        confidence,
    }
}

fn aggregate_set_patterns(active: &ActiveSet) -> Vec<SetPatternFact> {
    let mut patterns = AssessmentDimension::ALL
        .into_iter()
        .map(|dimension| {
            let findings = active
                .rep_assessments
                .iter()
                .filter_map(|assessment| {
                    assessment
                        .dimension_findings
                        .iter()
                        .find(|finding| finding.dimension == dimension)
                })
                .collect::<Vec<_>>();
            let deviations = findings
                .iter()
                .filter(|finding| finding.state == AssessmentConclusionState::ObservedDeviation)
                .count();
            let cannot_judge = findings
                .iter()
                .filter(|finding| finding.state == AssessmentConclusionState::CannotJudge)
                .count();
            SetPatternFact {
                pattern_id: format!("dimension_rollup:{}", dimension.as_str()),
                summary: format!(
                    "Across {} Rep conclusion(s), {deviations} deviation(s) and {cannot_judge} abstention(s) were observed for {}.",
                    findings.len(),
                    dimension.as_str(),
                ),
                supporting_rep_ids: active.reps.iter().map(|rep| rep.rep_id).collect(),
                evidence_dimensions: vec![dimension],
                confidence: if findings.is_empty() { 0.0 } else { 1.0 },
            }
        })
        .collect::<Vec<_>>();
    if let (Some(first), Some(last)) = (active.packets.first(), active.packets.last()) {
        let equipment_observed = active
            .packets
            .iter()
            .filter(|packet| packet.equipment_observed)
            .count();
        let fused = active
            .packets
            .iter()
            .filter(|packet| packet.channel_agreement == LocalChannelAgreement::Agreement)
            .count();
        let coordinate_frames = active
            .packets
            .iter()
            .map(|packet| packet.coordinate_frame_id)
            .collect::<HashSet<_>>()
            .len();
        patterns.push(SetPatternFact {
            pattern_id: "observation_chain_availability".into(),
            summary: format!(
                "Across {}–{} ms, {equipment_observed}/{} frames had independent equipment and {fused}/{} had agreeing pose/equipment channels; {} coordinate frame(s), ending {}.",
                first.timestamp_ms,
                last.timestamp_ms,
                active.packets.len(),
                active.packets.len(),
                coordinate_frames,
                last.local_state,
            ),
            supporting_rep_ids: active.reps.iter().map(|rep| rep.rep_id).collect(),
            evidence_dimensions: vec![AssessmentDimension::ObservationConfidence],
            confidence: u8::from(!active.packets.is_empty()) as f32,
        });
    }
    let ranges = active
        .rep_assessments
        .iter()
        .filter_map(|rep| {
            rep.features
                .iter()
                .find(|feature| feature.feature_id == active.program.range_feature_id)
                .and_then(|feature| feature.value)
                .map(|value| (rep.rep.rep_id, value))
        })
        .collect::<Vec<_>>();
    let late_window = active.program.late_set_window.min(ranges.len());
    if ranges.len() > late_window && late_window > 0 {
        let split = ranges.len() - late_window;
        let earlier = ranges[..split].iter().map(|(_, value)| *value).sum::<f32>() / split as f32;
        let late =
            ranges[split..].iter().map(|(_, value)| *value).sum::<f32>() / late_window as f32;
        if earlier > f32::EPSILON && late < earlier * (1.0 - active.program.range_deviation_ratio) {
            patterns.push(SetPatternFact {
                pattern_id: "late_set_excursion_reduction".into(),
                summary: "The late-set local excursion was persistently lower than the earlier set prefix."
                    .into(),
                supporting_rep_ids: ranges[split..].iter().map(|(rep_id, _)| *rep_id).collect(),
                evidence_dimensions: vec![AssessmentDimension::RangeOfMotion],
                confidence: 0.75,
            });
        }
    }
    let bilateral_differences = active
        .rep_assessments
        .iter()
        .filter_map(|rep| {
            let endpoint = rep
                .features
                .iter()
                .find(|feature| feature.feature_id == "bilateral_endpoint_difference")
                .and_then(|feature| feature.value);
            let timing = rep
                .features
                .iter()
                .find(|feature| feature.feature_id == "bilateral_turnaround_timing_difference")
                .and_then(|feature| feature.value);
            let exceeds = endpoint
                .is_some_and(|value| value >= active.program.bilateral_difference_threshold)
                || timing.is_some_and(|value| {
                    value >= active.program.bilateral_timing_difference_threshold_ms
                });
            exceeds.then_some((rep.rep.rep_id, endpoint, timing))
        })
        .collect::<Vec<_>>();
    if !bilateral_differences.is_empty() {
        let persistent = bilateral_differences.len() >= active.program.minimum_persistent_reps;
        let late_start = active
            .reps
            .len()
            .saturating_sub(active.program.late_set_window);
        let late_rep_ids = active.reps[late_start..]
            .iter()
            .map(|rep| rep.rep_id)
            .collect::<HashSet<_>>();
        let late_only = bilateral_differences
            .iter()
            .all(|(rep_id, _, _)| late_rep_ids.contains(rep_id));
        patterns.push(SetPatternFact {
            pattern_id: if persistent {
                "persistent_bilateral_endpoint_difference"
            } else {
                "isolated_bilateral_endpoint_difference"
            }
            .into(),
            summary: format!(
                "{} Rep(s) exceeded the Bundle's {:.3} normalized endpoint or {:.0} ms turnaround-timing difference observation threshold{}; this is an observed bilateral-difference fact, not a correctness standard.",
                bilateral_differences.len(),
                active.program.bilateral_difference_threshold,
                active.program.bilateral_timing_difference_threshold_ms,
                if late_only { " in the late-set window" } else { "" },
            ),
            supporting_rep_ids: bilateral_differences
                .iter()
                .map(|(rep_id, _, _)| *rep_id)
                .collect(),
            evidence_dimensions: vec![AssessmentDimension::BilateralCoordination],
            confidence: if persistent { 0.85 } else { 0.65 },
        });
    }
    patterns
}

fn aggregate_dimension_findings(
    active: &ActiveSet,
    patterns: &[SetPatternFact],
) -> Vec<QualityConclusion> {
    active
        .program
        .set_rules
        .iter()
        .map(|rule| {
            let dimension = match rule {
                CompiledSetRule::RollupRepDimension { dimension }
                | CompiledSetRule::LateSetPersistence { dimension } => *dimension,
            };
            let candidates = active
                .rep_assessments
                .iter()
                .flat_map(|rep| &rep.dimension_findings)
                .filter(|finding| finding.dimension == dimension)
                .collect::<Vec<_>>();
            let deviations = candidates
                .iter()
                .filter(|finding| finding.state == AssessmentConclusionState::ObservedDeviation)
                .count();
            let acceptable = candidates
                .iter()
                .filter(|finding| finding.state == AssessmentConclusionState::ObservedAcceptable)
                .count();
            let late_pattern = patterns
                .iter()
                .find(|pattern| pattern.pattern_id == "late_set_excursion_reduction")
                .filter(|pattern| {
                    pattern.supporting_rep_ids.len() >= active.program.minimum_persistent_reps
                });
            let persistent_deviation = match rule {
                CompiledSetRule::LateSetPersistence { .. } => late_pattern.is_some(),
                CompiledSetRule::RollupRepDimension { .. } => {
                    deviations >= active.program.minimum_persistent_reps
                }
            };
            if persistent_deviation {
                rule_finding(
                    dimension,
                    AssessmentConclusionState::ObservedDeviation,
                    late_pattern.map_or_else(
                        || {
                            format!(
                                "{} Rep findings showed a persistent set-level deviation.",
                                deviations
                            )
                        },
                        |pattern| pattern.summary.clone(),
                    ),
                    patterns
                        .iter()
                        .filter(|pattern| pattern.evidence_dimensions.contains(&dimension))
                        .map(|pattern| pattern.pattern_id.clone())
                        .collect(),
                    None,
                    0.75,
                )
            } else if acceptable > 0 {
                rule_finding(
                    dimension,
                    AssessmentConclusionState::ObservedAcceptable,
                    "No persistent set-level deviation satisfied the configured Set Rule.".into(),
                    candidates
                        .iter()
                        .flat_map(|finding| finding.evidence.clone())
                        .collect(),
                    None,
                    0.75,
                )
            } else if candidates
                .iter()
                .all(|finding| finding.state == AssessmentConclusionState::NotApplicable)
                && !candidates.is_empty()
            {
                rule_finding(
                    dimension,
                    AssessmentConclusionState::NotApplicable,
                    "The dimension is not applicable to this set contract.".into(),
                    Vec::new(),
                    None,
                    1.0,
                )
            } else {
                rule_finding(
                    dimension,
                    AssessmentConclusionState::CannotJudge,
                    "The set did not contain enough persistent judgeable evidence.".into(),
                    patterns
                        .iter()
                        .filter(|pattern| pattern.evidence_dimensions.contains(&dimension))
                        .map(|pattern| pattern.pattern_id.clone())
                        .collect(),
                    Some("insufficient_persistent_set_evidence".into()),
                    0.0,
                )
            }
        })
        .collect()
}

fn feature_summary(feature: &MotionFeatureFact) -> String {
    if let Some(value) = feature.value {
        format!("{} = {:.4} {:?}.", feature.feature_id, value, feature.unit)
    } else if let Some(category) = feature.categorical_value.as_deref() {
        format!("{} = {category}.", feature.feature_id)
    } else {
        format!(
            "{} cannot be judged from available evidence.",
            feature.feature_id
        )
    }
}

fn comparison_summary(comparison: &ReferenceComparisonFact) -> String {
    if let Some(category) = comparison.observed_category.as_deref() {
        return format!(
            "{} observed categorical state {category}; no external reference is required.",
            comparison.feature_id
        );
    }
    match comparison.delta_ratio {
        Some(delta) => format!(
            "{} differs from the {:?} reference by {:.1}%.",
            comparison.feature_id,
            comparison.kind,
            delta * 100.0
        ),
        None => comparison.reason.clone().unwrap_or_else(|| {
            format!(
                "{} has no applicable reference comparison.",
                comparison.feature_id
            )
        }),
    }
}

fn invalid_video_context_detail(context: &VideoRecognitionContext) -> Option<String> {
    if context.source_capture_id.trim().is_empty() {
        return Some("source capture ID must not be empty".into());
    }
    if context.exercise_id.trim().is_empty() {
        return Some("exercise ID must not be empty".into());
    }
    if context.frame_contract.width == 0 || context.frame_contract.height == 0 {
        return Some("video frame dimensions must be non-zero".into());
    }
    if context.pose_contract.runtime_id.trim().is_empty()
        || context.pose_contract.landmark_schema.trim().is_empty()
        || context.pose_contract.schema_version.trim().is_empty()
    {
        return Some("pose observation contract identity must be complete".into());
    }
    None
}

fn is_fixed_hash(value: &str) -> bool {
    value.len() == 16 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn asset_ref(kind: AssessmentAssetKind, id: String) -> AssessmentAssetRef {
    builtin_asset(kind, id).reference()
}

fn builtin_asset(kind: AssessmentAssetKind, id: String) -> AssessmentAsset {
    AssessmentAsset {
        kind,
        content: serde_json::json!({
            "bindingId": id.clone(),
            "deliveryStage": "ticket_01_context_resolution",
        }),
        id,
        schema_version: "v1".into(),
        content_hash: String::new(),
    }
    .with_computed_hash()
}

/// Versioned recognition context catalog for the currently governed motion set.
pub fn current_motion_assessment_catalog_v1() -> ExecutionAssessmentBundleCatalog {
    use AssessmentCaptureView as View;
    use AssessmentEquipmentSemantics as Equipment;

    let pose_contract = PoseObservationContract {
        runtime_id: "rtmpose-m".into(),
        landmark_schema: "halpe26".into(),
        schema_version: "v1".into(),
    };

    let specifications: &[(&str, Equipment, AssessmentLateralityMode, &[View])] = &[
        (
            "barbell_bench_press",
            Equipment::RigidBarAxis,
            AssessmentLateralityMode::Bilateral,
            &[View::Front, View::FrontObliqueLeft, View::FrontObliqueRight],
        ),
        (
            "barbell_row",
            Equipment::RigidBarAxis,
            AssessmentLateralityMode::Bilateral,
            &[
                View::Front,
                View::FrontObliqueLeft,
                View::FrontObliqueRight,
                View::RearObliqueLeft,
                View::RearObliqueRight,
            ],
        ),
        (
            "machine_chest_press",
            Equipment::ConstrainedMachineLever,
            AssessmentLateralityMode::Bilateral,
            &[View::Front, View::FrontObliqueRight],
        ),
        (
            "seated_shoulder_press",
            Equipment::RigidBarAxis,
            AssessmentLateralityMode::Bilateral,
            &[View::Front],
        ),
        (
            "push_up",
            Equipment::BodyOnly,
            AssessmentLateralityMode::Bilateral,
            &[View::RearObliqueRight],
        ),
        (
            "lat_pulldown",
            Equipment::CableOrMovingHandle,
            AssessmentLateralityMode::Bilateral,
            &[View::Rear, View::RearObliqueLeft],
        ),
        (
            "pull_up",
            Equipment::FixedSupport,
            AssessmentLateralityMode::Bilateral,
            &[View::RearObliqueLeft],
        ),
        (
            "seated_row",
            Equipment::CableOrMovingHandle,
            AssessmentLateralityMode::Bilateral,
            &[
                View::FrontObliqueLeft,
                View::RearObliqueLeft,
                View::RightSide,
            ],
        ),
        (
            "straight_arm_pulldown",
            Equipment::CableOrMovingHandle,
            AssessmentLateralityMode::Bilateral,
            &[View::FrontObliqueLeft, View::FrontObliqueRight],
        ),
        (
            "lateral_raise",
            Equipment::TwoIndependentDumbbells,
            AssessmentLateralityMode::Bilateral,
            &[View::Front],
        ),
        (
            "rear_delt_fly",
            Equipment::ConstrainedMachineLever,
            AssessmentLateralityMode::Bilateral,
            &[View::Front],
        ),
        (
            "single_arm_cable_lateral_raise",
            Equipment::UnilateralCableHandle,
            AssessmentLateralityMode::ObservedActiveSide,
            &[View::FrontObliqueLeft, View::RearObliqueRight],
        ),
    ];

    let mut action_definitions = Vec::new();
    let mut bundles = Vec::new();
    for (action_id, equipment, laterality, views) in specifications {
        let supported_views = views
            .iter()
            .map(|view| {
                let bundle_id = format!("{action_id}/{}/v1", view.catalog_slug());
                bundles.push(
                    ExecutionAssessmentBundle {
                        schema_version: EXECUTION_ASSESSMENT_BUNDLE_SCHEMA.into(),
                        bundle_id: bundle_id.clone(),
                        capability: AssessmentBundleCapability::ContextResolutionOnly,
                        exact_context: AssessmentExactContext {
                            action_id: (*action_id).into(),
                            variation_id: "standard_variant".into(),
                            equipment_semantics: *equipment,
                            laterality_mode: *laterality,
                            capture_view: *view,
                            pose_contract: pose_contract.clone(),
                        },
                        lineage: AssessmentBundleLineage {
                            recognition_profile: asset_ref(
                                AssessmentAssetKind::RecognitionProfile,
                                format!("{action_id}/{}/profile/v1", view.catalog_slug()),
                            ),
                            execution_contract: asset_ref(
                                AssessmentAssetKind::ExecutionContract,
                                format!("{action_id}/contract/v1"),
                            ),
                            local_coordinate_strategy: asset_ref(
                                AssessmentAssetKind::LocalCoordinateStrategy,
                                format!("{action_id}/local-coordinate/v1"),
                            ),
                            equipment_adapter: asset_ref(
                                AssessmentAssetKind::EquipmentAdapter,
                                format!("{equipment:?}/adapter/v1").to_ascii_lowercase(),
                            ),
                            feature_program: asset_ref(
                                AssessmentAssetKind::FeatureProgram,
                                format!("{action_id}/features/v1"),
                            ),
                            reference_policy: asset_ref(
                                AssessmentAssetKind::ReferencePolicy,
                                format!("{action_id}/reference-policy/v1"),
                            ),
                            rule_pack: asset_ref(
                                AssessmentAssetKind::RulePack,
                                format!("{action_id}/rules/v1"),
                            ),
                            set_aggregation_policy: asset_ref(
                                AssessmentAssetKind::SetAggregationPolicy,
                                format!("{action_id}/set-aggregation/v1"),
                            ),
                        },
                        content_hash: String::new(),
                    }
                    .with_computed_hash(),
                );
                ActionViewBinding {
                    capture_view: *view,
                    bundle_id,
                }
            })
            .collect();
        action_definitions.push(
            ActionDefinition {
                schema_version: ACTION_DEFINITION_SCHEMA.into(),
                action_definition_id: format!("{action_id}/action-definition/v1"),
                action_id: (*action_id).into(),
                default_variation_id: "standard_variant".into(),
                equipment_semantics: *equipment,
                laterality_mode: *laterality,
                pose_contract: pose_contract.clone(),
                supported_views,
                content_hash: String::new(),
            }
            .with_computed_hash(),
        );
    }
    let mut installed_asset_ids = HashSet::new();
    let mut installed_assets = Vec::new();
    for bundle in &bundles {
        for (asset, _) in bundle.lineage.assets() {
            if installed_asset_ids.insert(asset.id.clone()) {
                let installed = builtin_asset(asset.kind, asset.id.clone());
                debug_assert_eq!(installed.reference(), *asset);
                installed_assets.push(installed);
            }
        }
    }
    ExecutionAssessmentBundleCatalog {
        schema_version: EXECUTION_ASSESSMENT_CATALOG_SCHEMA.into(),
        catalog_id: "maxpower/current-motion-context/v1".into(),
        installed_assets,
        action_definitions,
        bundles,
    }
}

/// First executable catalog. Ticket 02 promotes one exact governed context;
/// every other binding remains an explicit context-resolution capability until
/// its action-family ticket supplies a compatible RecognitionProfile.
pub fn current_motion_assessment_catalog_v2() -> ExecutionAssessmentBundleCatalog {
    let mut catalog = current_motion_assessment_catalog_v1();
    catalog.catalog_id = "maxpower/current-motion-assessment/v2".into();
    let target_bundle_id = "barbell_bench_press/front-oblique-left/v1";
    let target = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == target_bundle_id)
        .expect("built-in bench front-oblique-left bundle")
        .clone();
    let profile =
        crate::ExerciseProfile::barbell_bench_press_touched_benchmark_front_left_provisional();
    let programs = [
        (
            target.lineage.recognition_profile.id.clone(),
            serde_json::json!({
                "runtimeProfileIdentity": profile.identity,
                "runtimeProfileHash": format!("{:016x}", profile.content_hash),
                "maturity": profile.maturity.as_str(),
                "deliveryStage": "ticket_02_first_complete_tracer",
            }),
        ),
        (
            target.lineage.execution_contract.id.clone(),
            serde_json::json!({
                "phaseOrder": ["eccentric", "concentric"],
                "taskEndpoints": ["locked_out_start", "visible_bottom_turnaround", "returned_lockout"],
                "dimensions": AssessmentDimension::ALL.map(AssessmentDimension::as_str),
                "equipmentSemantics": "rigid_bar_axis",
                "deliveryStage": "ticket_02_first_complete_tracer",
            }),
        ),
        (
            target.lineage.local_coordinate_strategy.id.clone(),
            serde_json::json!({
                "requireNormalizedEndpoints": true,
                "coordinateSpace": "causal_set_local_camera_plane",
                "captureView": "front-oblique-left",
                "preparationToEffortDirection": "down",
                "equipmentMode": "rigidbaraxis",
                "poseAnchor": "wristmidpoint",
                "deliveryStage": "ticket_02_first_complete_tracer",
            }),
        ),
        (
            target.lineage.equipment_adapter.id.clone(),
            serde_json::json!({
                "evidencePolicy": "independent_subject_associated_rigid_bar_axis",
                "conflictPolicy": "abstain_fused_preserve_channels",
                "poseFallback": "preserve_as_independent_channel",
                "deliveryStage": "ticket_02_first_complete_tracer",
            }),
        ),
        (
            target.lineage.feature_program.id.clone(),
            serde_json::json!({
                "features": [
                    "cycle_duration",
                    "rep_disposition",
                    "first_phase_duration",
                    "second_phase_duration",
                    "phase_duration_ratio",
                    "local_primary_excursion",
                    "local_return_error",
                    "equipment_primary_excursion",
                    "pose_primary_excursion",
                    "authorization_phase_control",
                    "authorization_support_stability",
                    "authorization_bilateral_coordination",
                    "authorization_trajectory_control",
                    "authorization_standard_variant_compatibility"
                ],
                "boundedFacts": true,
                "deliveryStage": "ticket_02_first_complete_tracer",
            }),
        ),
        (
            target.lineage.reference_policy.id.clone(),
            serde_json::json!({
                "order": ["self_geometry", "set_prefix", "same_workout_prior_set"],
                "compareBeforeUpdate": true,
                "deliveryStage": "ticket_02_first_complete_tracer",
            }),
        ),
        (
            target.lineage.rule_pack.id.clone(),
            serde_json::json!({
                "rangeFeatureId": "local_primary_excursion",
                "rangeDeviationRatio": 0.20,
                "minimumFeatureConfidence": 0.50,
                "missingEvidence": "cannot_judge",
                "repRules": [
                    {"dimension": "task_completion", "operator": "rep_disposition", "featureId": "rep_disposition"},
                    {"dimension": "range_of_motion", "operator": "reference_lower_bound", "featureId": "local_primary_excursion", "returnFeatureId": "local_return_error", "maximumReturnError": 0.15},
                    {"dimension": "phase_control", "operator": "abstain", "featureIds": ["authorization_phase_control"], "reason": "no_governed_phase_quality_threshold"},
                    {"dimension": "support_stability", "operator": "abstain", "featureIds": ["authorization_support_stability"], "reason": "support_stability_not_observed_by_tracer_contract"},
                    {"dimension": "bilateral_coordination", "operator": "abstain", "featureIds": ["authorization_bilateral_coordination"], "reason": "anatomical_endpoint_mapping_not_required_by_tracer_contract"},
                    {"dimension": "trajectory_control", "operator": "abstain", "featureIds": ["authorization_trajectory_control"], "reason": "no_governed_trajectory_quality_corridor"},
                    {"dimension": "standard_variant_compatibility", "operator": "abstain", "featureIds": ["authorization_standard_variant_compatibility"], "reason": "no_human_standard_variant_truth"},
                    {"dimension": "observation_confidence", "operator": "features_available", "featureIds": ["local_primary_excursion"]}
                ],
                "deliveryStage": "ticket_02_first_complete_tracer",
            }),
        ),
        (
            target.lineage.set_aggregation_policy.id.clone(),
            serde_json::json!({
                "lateSetWindow": 2,
                "minimumPersistentReps": 2,
                "setRules": [
                    {"dimension": "task_completion", "operator": "rollup_rep_dimension"},
                    {"dimension": "range_of_motion", "operator": "late_set_persistence"},
                    {"dimension": "phase_control", "operator": "rollup_rep_dimension"},
                    {"dimension": "support_stability", "operator": "rollup_rep_dimension"},
                    {"dimension": "bilateral_coordination", "operator": "rollup_rep_dimension"},
                    {"dimension": "trajectory_control", "operator": "rollup_rep_dimension"},
                    {"dimension": "standard_variant_compatibility", "operator": "rollup_rep_dimension"},
                    {"dimension": "observation_confidence", "operator": "rollup_rep_dimension"}
                ],
                "deliveryStage": "ticket_02_first_complete_tracer",
            }),
        ),
    ];
    for (asset_id, content) in programs {
        let asset = catalog
            .installed_assets
            .iter_mut()
            .find(|asset| asset.id == asset_id)
            .expect("built-in executable asset");
        asset.content = content;
        *asset = asset.clone().with_computed_hash();
    }
    let installed = catalog
        .installed_assets
        .iter()
        .map(|asset| (asset.id.clone(), asset.reference()))
        .collect::<HashMap<_, _>>();
    for bundle in &mut catalog.bundles {
        let lineage = &mut bundle.lineage;
        for reference in [
            &mut lineage.recognition_profile,
            &mut lineage.execution_contract,
            &mut lineage.local_coordinate_strategy,
            &mut lineage.equipment_adapter,
            &mut lineage.feature_program,
            &mut lineage.reference_policy,
            &mut lineage.rule_pack,
            &mut lineage.set_aggregation_policy,
        ] {
            if let Some(updated) = installed.get(&reference.id) {
                *reference = updated.clone();
            }
        }
        if bundle.bundle_id == target_bundle_id {
            bundle.capability = AssessmentBundleCapability::Executable;
        }
        *bundle = bundle.clone().with_computed_hash();
    }
    catalog
}

#[derive(Clone, Debug)]
pub struct RigidBarAssessmentProfileBinding {
    pub action_id: String,
    pub capture_view: AssessmentCaptureView,
    pub profile: crate::ExerciseProfile,
    pub local_coordinate_strategy: crate::LocalMotionCoordinateStrategy,
}

/// The currently governed rigid-bar action/view matrix. Profiles are
/// deliberately exact-context and provisional: they initialize Rep boundaries
/// but do not encode universal exercise-quality truth.
pub fn current_rigid_bar_assessment_profiles_v1() -> Vec<RigidBarAssessmentProfileBinding> {
    use AssessmentCaptureView as View;

    [
        ("barbell_bench_press", View::Front),
        ("barbell_bench_press", View::FrontObliqueLeft),
        ("barbell_bench_press", View::FrontObliqueRight),
        ("barbell_row", View::Front),
        ("barbell_row", View::FrontObliqueLeft),
        ("barbell_row", View::FrontObliqueRight),
        ("barbell_row", View::RearObliqueLeft),
        ("barbell_row", View::RearObliqueRight),
        ("seated_shoulder_press", View::Front),
    ]
    .into_iter()
    .map(|(action_id, capture_view)| {
        let local_axis_token = if action_id == "barbell_row" {
            "effort-up"
        } else {
            "effort-down"
        };
        let identity = format!(
            "{action_id}/{}/bilateral/rigid-bar/{local_axis_token}/provisional-v1",
            capture_view.catalog_slug(),
        );
        RigidBarAssessmentProfileBinding {
            action_id: action_id.into(),
            capture_view,
            profile: crate::ExerciseProfile::rigid_bar_provisional(
                &identity,
                rigid_bar_profile_initializer(action_id, capture_view),
            ),
            local_coordinate_strategy: crate::LocalMotionCoordinateStrategy {
                capture_view: local_coarse_view(capture_view)
                    .expect("rigid-bar views have local strategy support"),
                preparation_to_effort: if local_axis_token == "effort-down" {
                    crate::LocalActionAxisDirection::PreparationToEffortDown
                } else {
                    crate::LocalActionAxisDirection::PreparationToEffortUp
                },
                equipment_mode: crate::LocalEquipmentMode::RigidBarAxis,
                pose_anchor: crate::LocalPoseAnchor::WristMidpoint,
            },
        }
    })
    .collect()
}

fn rigid_bar_profile_initializer(
    action_id: &str,
    view: AssessmentCaptureView,
) -> crate::RigidBarProfileInitializer {
    use crate::{ExerciseSignal, ExerciseSignalKind as Kind, MovementDirection as Direction};
    let signal = |kind, landmarks: &[usize]| ExerciseSignal {
        kind,
        landmarks: landmarks.to_vec(),
    };
    let build = |primary_signal,
                 secondary_signal,
                 direction,
                 start_amplitude,
                 minimum_amplitude,
                 return_hysteresis,
                 ready_tolerance,
                 max_gap_ms,
                 min_rep_duration_ms,
                 max_rep_duration_ms| crate::RigidBarProfileInitializer {
        primary_signal,
        secondary_signal,
        direction,
        start_amplitude,
        minimum_amplitude,
        return_hysteresis,
        ready_tolerance,
        max_gap_ms,
        min_rep_duration_ms,
        max_rep_duration_ms,
    };
    match (action_id, view) {
        ("barbell_bench_press", AssessmentCaptureView::Front) => build(
            signal(Kind::LandmarkY, &[9]),
            signal(Kind::LandmarkY, &[10]),
            Direction::Increasing,
            0.02,
            0.08,
            0.02,
            0.025,
            700,
            350,
            8_000,
        ),
        ("barbell_bench_press", AssessmentCaptureView::FrontObliqueLeft) => build(
            signal(Kind::LandmarkY, &[9]),
            signal(Kind::LandmarkY, &[10]),
            Direction::Increasing,
            0.02,
            0.08,
            0.02,
            0.025,
            700,
            350,
            8_000,
        ),
        ("barbell_bench_press", AssessmentCaptureView::FrontObliqueRight) => build(
            signal(Kind::LandmarkY, &[7]),
            signal(Kind::LandmarkY, &[8]),
            Direction::Increasing,
            0.015,
            0.06,
            0.015,
            0.02,
            700,
            350,
            8_000,
        ),
        ("barbell_row", AssessmentCaptureView::Front) => build(
            signal(Kind::JointAngle, &[5, 7, 9]),
            signal(Kind::JointAngle, &[6, 8, 10]),
            Direction::Decreasing,
            5.0,
            20.0,
            5.0,
            6.0,
            700,
            350,
            8_000,
        ),
        ("barbell_row", AssessmentCaptureView::FrontObliqueLeft) => build(
            signal(Kind::JointAngle, &[5, 7, 9]),
            signal(Kind::JointAngle, &[5, 7, 9]),
            Direction::Decreasing,
            5.0,
            52.0,
            5.0,
            6.0,
            700,
            450,
            8_000,
        ),
        ("barbell_row", AssessmentCaptureView::FrontObliqueRight) => build(
            signal(Kind::JointAngle, &[12, 6, 8]),
            signal(Kind::JointAngle, &[12, 6, 8]),
            Direction::Decreasing,
            5.0,
            20.0,
            5.0,
            6.0,
            700,
            350,
            2_000,
        ),
        ("barbell_row", AssessmentCaptureView::RearObliqueLeft) => build(
            signal(Kind::JointAngle, &[5, 7, 9]),
            signal(Kind::JointAngle, &[5, 7, 9]),
            Direction::Decreasing,
            5.0,
            20.0,
            5.0,
            8.7,
            700,
            250,
            8_000,
        ),
        ("barbell_row", AssessmentCaptureView::RearObliqueRight) => build(
            signal(Kind::LandmarkY, &[8]),
            signal(Kind::LandmarkY, &[8]),
            Direction::Increasing,
            0.015,
            0.06,
            0.015,
            0.02,
            700,
            600,
            8_000,
        ),
        ("seated_shoulder_press", AssessmentCaptureView::Front) => build(
            signal(Kind::LandmarkY, &[10]),
            signal(Kind::LandmarkY, &[10]),
            Direction::Increasing,
            0.02,
            0.08,
            0.02,
            0.045,
            700,
            350,
            8_000,
        ),
        _ => unreachable!("rigid-bar initializer matrix is closed"),
    }
}

fn rigid_bar_execution_semantics(
    action_id: &str,
) -> (&'static [&'static str; 2], &'static [&'static str; 3]) {
    const BENCH_PHASES: [&str; 2] = ["lowering", "pressing"];
    const BENCH_ENDPOINTS: [&str; 3] = [
        "locked_out_start",
        "visible_bottom_turnaround",
        "returned_lockout",
    ];
    const ROW_PHASES: [&str; 2] = ["pulling", "return_to_reach"];
    const ROW_ENDPOINTS: [&str; 3] = [
        "arms_extended_start",
        "bar_to_torso_turnaround",
        "returned_reach",
    ];
    const SHOULDER_PHASES: [&str; 2] = ["lowering", "pressing"];
    const SHOULDER_ENDPOINTS: [&str; 3] = [
        "overhead_start",
        "visible_bottom_turnaround",
        "returned_overhead",
    ];
    match action_id {
        "barbell_bench_press" => (&BENCH_PHASES, &BENCH_ENDPOINTS),
        "barbell_row" => (&ROW_PHASES, &ROW_ENDPOINTS),
        "seated_shoulder_press" => (&SHOULDER_PHASES, &SHOULDER_ENDPOINTS),
        _ => unreachable!("rigid-bar binding action is closed"),
    }
}

fn executable_bundle_asset(
    kind: AssessmentAssetKind,
    id: String,
    content: serde_json::Value,
) -> AssessmentAsset {
    AssessmentAsset {
        kind,
        id,
        schema_version: "v1".into(),
        content,
        content_hash: String::new(),
    }
    .with_computed_hash()
}

/// Ticket 03 executable catalog for the current rigid-bar action family.
/// Each exact action/view Bundle owns a complete immutable asset lineage even
/// when two contexts currently select the same generic feature operators.
pub fn current_motion_assessment_catalog_v3() -> ExecutionAssessmentBundleCatalog {
    let mut catalog = current_motion_assessment_catalog_v1();
    catalog.catalog_id = "maxpower/current-rigid-bar-assessment/v3".into();

    for binding in current_rigid_bar_assessment_profiles_v1() {
        let bundle_id = format!(
            "{}/{}/v1",
            binding.action_id,
            binding.capture_view.catalog_slug()
        );
        let bundle = catalog
            .bundles
            .iter_mut()
            .find(|bundle| bundle.bundle_id == bundle_id)
            .expect("rigid-bar exact context is installed");
        let asset_prefix = format!("{bundle_id}/executable-v3");
        let (phase_order, task_endpoints) = rigid_bar_execution_semantics(&binding.action_id);
        let delivery_stage = "ticket_03_rigid_bar_family";
        let definitions = [
            (
                AssessmentAssetKind::RecognitionProfile,
                "recognition-profile",
                serde_json::json!({
                    "runtimeProfileIdentity": binding.profile.identity,
                    "runtimeProfileHash": format!("{:016x}", binding.profile.content_hash),
                    "maturity": binding.profile.maturity.as_str(),
                    "initializerEvidenceAssetId": "personal-human-rep-ranges-v2",
                    "evidenceScope": "governed_known_video_rep_counting_initializer",
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::ExecutionContract,
                "execution-contract",
                serde_json::json!({
                    "phaseOrder": phase_order,
                    "taskEndpoints": task_endpoints,
                    "dimensions": AssessmentDimension::ALL.map(AssessmentDimension::as_str),
                    "equipmentSemantics": "rigid_bar_axis",
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::LocalCoordinateStrategy,
                "local-coordinate-strategy",
                serde_json::json!({
                    "requireNormalizedEndpoints": true,
                    "coordinateSpace": "causal_set_local_camera_plane",
                    "captureView": binding.capture_view.catalog_slug(),
                    "preparationToEffortDirection": match binding.local_coordinate_strategy.preparation_to_effort {
                        crate::LocalActionAxisDirection::PreparationToEffortUp => "up",
                        crate::LocalActionAxisDirection::PreparationToEffortDown => "down",
                        crate::LocalActionAxisDirection::PreparationToEffortLeft => "left",
                        crate::LocalActionAxisDirection::PreparationToEffortRight => "right",
                    },
                    "equipmentMode": "rigidbaraxis",
                    "poseAnchor": "wristmidpoint",
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::EquipmentAdapter,
                "equipment-adapter",
                serde_json::json!({
                    "evidencePolicy": "independent_subject_associated_rigid_bar_axis",
                    "conflictPolicy": "abstain_fused_preserve_channels",
                    "poseFallback": "preserve_as_independent_channel",
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::FeatureProgram,
                "feature-program",
                serde_json::json!({
                    "features": [
                        "cycle_duration", "rep_disposition", "first_phase_duration",
                        "second_phase_duration", "phase_duration_ratio",
                        "local_primary_excursion", "local_return_error", "equipment_primary_excursion",
                        "pose_primary_excursion", "authorization_phase_control",
                        "authorization_support_stability",
                        "authorization_bilateral_coordination",
                        "authorization_trajectory_control",
                        "authorization_standard_variant_compatibility"
                    ],
                    "boundedFacts": true,
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::ReferencePolicy,
                "reference-policy",
                serde_json::json!({
                    "order": ["self_geometry", "set_prefix", "same_workout_prior_set"],
                    "compareBeforeUpdate": true,
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::RulePack,
                "rule-pack",
                serde_json::json!({
                    "rangeFeatureId": "local_primary_excursion",
                    "rangeDeviationRatio": 0.20,
                    "minimumFeatureConfidence": 0.50,
                    "missingEvidence": "cannot_judge",
                    "repRules": [
                        {"dimension": "task_completion", "operator": "rep_disposition", "featureId": "rep_disposition"},
                        {"dimension": "range_of_motion", "operator": "reference_lower_bound", "featureId": "local_primary_excursion", "returnFeatureId": "local_return_error", "maximumReturnError": 0.15},
                        {"dimension": "phase_control", "operator": "abstain", "featureIds": ["authorization_phase_control"], "reason": "no_governed_phase_quality_threshold"},
                        {"dimension": "support_stability", "operator": "abstain", "featureIds": ["authorization_support_stability"], "reason": "support_stability_not_observed_by_current_contract"},
                        {"dimension": "bilateral_coordination", "operator": "abstain", "featureIds": ["authorization_bilateral_coordination"], "reason": "bilateral_quality_threshold_not_yet_governed"},
                        {"dimension": "trajectory_control", "operator": "abstain", "featureIds": ["authorization_trajectory_control"], "reason": "no_governed_trajectory_quality_corridor"},
                        {"dimension": "standard_variant_compatibility", "operator": "abstain", "featureIds": ["authorization_standard_variant_compatibility"], "reason": "no_human_standard_variant_truth"},
                        {"dimension": "observation_confidence", "operator": "features_available", "featureIds": ["local_primary_excursion"]}
                    ],
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::SetAggregationPolicy,
                "set-aggregation-policy",
                serde_json::json!({
                    "lateSetWindow": 2,
                    "minimumPersistentReps": 2,
                    "setRules": [
                        {"dimension": "task_completion", "operator": "rollup_rep_dimension"},
                        {"dimension": "range_of_motion", "operator": "late_set_persistence"},
                        {"dimension": "phase_control", "operator": "rollup_rep_dimension"},
                        {"dimension": "support_stability", "operator": "rollup_rep_dimension"},
                        {"dimension": "bilateral_coordination", "operator": "rollup_rep_dimension"},
                        {"dimension": "trajectory_control", "operator": "rollup_rep_dimension"},
                        {"dimension": "standard_variant_compatibility", "operator": "rollup_rep_dimension"},
                        {"dimension": "observation_confidence", "operator": "rollup_rep_dimension"}
                    ],
                    "deliveryStage": delivery_stage,
                }),
            ),
        ];
        let mut references = Vec::new();
        for (kind, slug, content) in definitions {
            let asset = executable_bundle_asset(kind, format!("{asset_prefix}/{slug}"), content);
            references.push(asset.reference());
            catalog.installed_assets.push(asset);
        }
        bundle.lineage = AssessmentBundleLineage {
            recognition_profile: references[0].clone(),
            execution_contract: references[1].clone(),
            local_coordinate_strategy: references[2].clone(),
            equipment_adapter: references[3].clone(),
            feature_program: references[4].clone(),
            reference_policy: references[5].clone(),
            rule_pack: references[6].clone(),
            set_aggregation_policy: references[7].clone(),
        };
        bundle.capability = AssessmentBundleCapability::Executable;
        *bundle = bundle.clone().with_computed_hash();
    }
    catalog
}

#[derive(Clone, Debug)]
pub struct ActionFamilyAssessmentProfileBinding {
    pub action_id: String,
    pub capture_view: AssessmentCaptureView,
    pub profile: crate::ExerciseProfile,
    pub local_coordinate_strategy: crate::LocalMotionCoordinateStrategy,
}

fn action_family_profile_binding(
    action_id: &str,
    capture_view: AssessmentCaptureView,
    equipment: AssessmentEquipmentSemantics,
) -> ActionFamilyAssessmentProfileBinding {
    let direction = local_direction(action_id, capture_view);
    let identity = format!(
        "{action_id}/{}/{}/{}/provisional-known-video-v1",
        capture_view.catalog_slug(),
        if equipment == AssessmentEquipmentSemantics::UnilateralCableHandle {
            "observed-active-side"
        } else {
            "bilateral"
        },
        equipment_semantics_id(equipment),
    );
    let mut profile = crate::ExerciseProfile::rigid_bar_provisional(
        &identity,
        action_family_profile_initializer(action_id, capture_view),
    );
    if action_id == "rear_delt_fly" {
        profile.min_secondary_amplitude = 24.65;
        profile.content_hash = profile.computed_content_hash();
    }
    ActionFamilyAssessmentProfileBinding {
        action_id: action_id.into(),
        capture_view,
        profile,
        local_coordinate_strategy: crate::LocalMotionCoordinateStrategy {
            capture_view: local_coarse_view(capture_view)
                .expect("current exact context has a local view strategy"),
            preparation_to_effort: direction,
            equipment_mode: local_equipment_mode(equipment),
            pose_anchor: local_pose_anchor(equipment),
        },
    }
}

pub fn current_cable_assessment_profiles_v1() -> Vec<ActionFamilyAssessmentProfileBinding> {
    use AssessmentCaptureView as View;
    use AssessmentEquipmentSemantics as Equipment;
    [
        ("lat_pulldown", View::Rear, Equipment::CableOrMovingHandle),
        (
            "lat_pulldown",
            View::RearObliqueLeft,
            Equipment::CableOrMovingHandle,
        ),
        (
            "seated_row",
            View::FrontObliqueLeft,
            Equipment::CableOrMovingHandle,
        ),
        (
            "seated_row",
            View::RearObliqueLeft,
            Equipment::CableOrMovingHandle,
        ),
        (
            "seated_row",
            View::RightSide,
            Equipment::CableOrMovingHandle,
        ),
        (
            "straight_arm_pulldown",
            View::FrontObliqueLeft,
            Equipment::CableOrMovingHandle,
        ),
        (
            "straight_arm_pulldown",
            View::FrontObliqueRight,
            Equipment::CableOrMovingHandle,
        ),
        (
            "single_arm_cable_lateral_raise",
            View::FrontObliqueLeft,
            Equipment::UnilateralCableHandle,
        ),
        (
            "single_arm_cable_lateral_raise",
            View::RearObliqueRight,
            Equipment::UnilateralCableHandle,
        ),
    ]
    .into_iter()
    .map(|(action, view, equipment)| action_family_profile_binding(action, view, equipment))
    .collect()
}

pub fn current_machine_assessment_profiles_v1() -> Vec<ActionFamilyAssessmentProfileBinding> {
    use AssessmentCaptureView as View;
    use AssessmentEquipmentSemantics as Equipment;
    [
        ("machine_chest_press", View::Front),
        ("machine_chest_press", View::FrontObliqueRight),
        ("rear_delt_fly", View::Front),
    ]
    .into_iter()
    .map(|(action, view)| {
        action_family_profile_binding(action, view, Equipment::ConstrainedMachineLever)
    })
    .collect()
}

pub fn current_dual_dumbbell_assessment_profiles_v1() -> Vec<ActionFamilyAssessmentProfileBinding> {
    vec![action_family_profile_binding(
        "lateral_raise",
        AssessmentCaptureView::Front,
        AssessmentEquipmentSemantics::TwoIndependentDumbbells,
    )]
}

pub fn current_bodyweight_assessment_profiles_v1() -> Vec<ActionFamilyAssessmentProfileBinding> {
    vec![
        action_family_profile_binding(
            "push_up",
            AssessmentCaptureView::RearObliqueRight,
            AssessmentEquipmentSemantics::BodyOnly,
        ),
        action_family_profile_binding(
            "pull_up",
            AssessmentCaptureView::RearObliqueLeft,
            AssessmentEquipmentSemantics::FixedSupport,
        ),
    ]
}

fn local_direction(
    action_id: &str,
    view: AssessmentCaptureView,
) -> crate::LocalActionAxisDirection {
    use crate::LocalActionAxisDirection as Direction;
    match (action_id, view) {
        ("seated_row", AssessmentCaptureView::RightSide) => Direction::PreparationToEffortRight,
        ("machine_chest_press", _) | ("rear_delt_fly", _) => Direction::PreparationToEffortRight,
        ("lat_pulldown", _) | ("straight_arm_pulldown", _) | ("pull_up", _) => {
            Direction::PreparationToEffortDown
        }
        _ => Direction::PreparationToEffortUp,
    }
}

fn action_family_profile_initializer(
    action_id: &str,
    view: AssessmentCaptureView,
) -> crate::RigidBarProfileInitializer {
    use crate::{ExerciseSignal, ExerciseSignalKind as Kind, MovementDirection as Direction};
    let signal = |kind, landmarks: &[usize]| ExerciseSignal {
        kind,
        landmarks: landmarks.to_vec(),
    };
    let build = |primary_signal,
                 secondary_signal,
                 direction,
                 start_amplitude,
                 minimum_amplitude,
                 return_hysteresis,
                 ready_tolerance,
                 min_rep_duration_ms,
                 max_rep_duration_ms| crate::RigidBarProfileInitializer {
        primary_signal,
        secondary_signal,
        direction,
        start_amplitude,
        minimum_amplitude,
        return_hysteresis,
        ready_tolerance,
        max_gap_ms: 700,
        min_rep_duration_ms,
        max_rep_duration_ms,
    };
    match (action_id, view) {
        ("lat_pulldown", AssessmentCaptureView::Rear) => build(
            signal(Kind::LandmarkY, &[9, 10]),
            signal(Kind::LandmarkY, &[7, 8]),
            Direction::Increasing,
            0.02,
            0.19951468,
            0.06983014,
            0.011,
            523,
            2630,
        ),
        ("lat_pulldown", AssessmentCaptureView::RearObliqueLeft) => build(
            signal(Kind::LandmarkY, &[9, 10]),
            signal(Kind::LandmarkY, &[7, 8]),
            Direction::Increasing,
            0.02,
            0.17038266,
            0.05963393,
            0.011,
            586,
            3069,
        ),
        ("seated_row", AssessmentCaptureView::RightSide) => build(
            signal(Kind::LandmarkY, &[8]),
            signal(Kind::LandmarkY, &[8]),
            Direction::Increasing,
            0.015,
            0.06,
            0.015,
            0.02,
            800,
            8000,
        ),
        (
            "seated_row",
            AssessmentCaptureView::FrontObliqueLeft | AssessmentCaptureView::RearObliqueLeft,
        ) => build(
            signal(Kind::LandmarkY, &[7]),
            signal(Kind::LandmarkY, &[7]),
            Direction::Decreasing,
            0.015,
            0.06,
            0.015,
            0.02,
            350,
            8000,
        ),
        ("straight_arm_pulldown", AssessmentCaptureView::FrontObliqueLeft) => build(
            signal(Kind::JointAngle, &[11, 5, 7]),
            signal(Kind::JointAngle, &[11, 5, 7]),
            Direction::Decreasing,
            7.25,
            20.0,
            2.75,
            6.0,
            350,
            8000,
        ),
        ("straight_arm_pulldown", AssessmentCaptureView::FrontObliqueRight) => build(
            signal(Kind::LandmarkY, &[8]),
            signal(Kind::LandmarkY, &[8]),
            Direction::Increasing,
            0.027,
            0.06,
            0.015,
            0.02,
            350,
            8000,
        ),
        ("single_arm_cable_lateral_raise", AssessmentCaptureView::FrontObliqueLeft) => build(
            signal(Kind::JointAngle, &[11, 5, 9]),
            signal(Kind::JointAngle, &[11, 5, 9]),
            Direction::Increasing,
            5.0,
            20.0,
            5.0,
            6.0,
            350,
            8000,
        ),
        ("single_arm_cable_lateral_raise", AssessmentCaptureView::RearObliqueRight) => build(
            signal(Kind::JointAngle, &[11, 5, 6]),
            signal(Kind::JointAngle, &[11, 5, 6]),
            Direction::Increasing,
            1.1,
            7.0,
            2.0,
            3.0,
            600,
            8000,
        ),
        ("machine_chest_press", AssessmentCaptureView::Front) => build(
            signal(Kind::LandmarkY, &[9]),
            signal(Kind::LandmarkY, &[10]),
            Direction::Decreasing,
            0.011,
            0.08,
            0.02,
            0.025,
            350,
            8000,
        ),
        ("machine_chest_press", AssessmentCaptureView::FrontObliqueRight) => build(
            signal(Kind::JointAngle, &[5, 7, 9]),
            signal(Kind::JointAngle, &[6, 8, 10]),
            Direction::Increasing,
            5.0,
            20.0,
            5.0,
            6.0,
            350,
            8000,
        ),
        ("rear_delt_fly", AssessmentCaptureView::Front) => build(
            signal(Kind::JointAngle, &[11, 5, 9]),
            signal(Kind::JointAngle, &[11, 5, 9]),
            Direction::Increasing,
            5.075,
            75.69,
            5.0,
            7.2,
            600,
            8000,
        ),
        ("lateral_raise", AssessmentCaptureView::Front) => build(
            signal(Kind::JointAngle, &[11, 5, 9]),
            signal(Kind::JointAngle, &[12, 6, 10]),
            Direction::Increasing,
            5.0,
            41.2547,
            8.02175,
            2.75,
            600,
            2618,
        ),
        ("push_up", AssessmentCaptureView::RearObliqueRight) => build(
            signal(Kind::JointAngle, &[6, 8, 10]),
            signal(Kind::JointAngle, &[6, 8, 10]),
            Direction::Increasing,
            7.6613,
            21.1055,
            18.805,
            7.6613,
            800,
            2262,
        ),
        ("pull_up", AssessmentCaptureView::RearObliqueLeft) => build(
            signal(Kind::JointAngle, &[11, 5, 7]),
            signal(Kind::JointAngle, &[11, 5, 7]),
            Direction::Decreasing,
            5.0,
            20.0,
            5.0,
            6.0,
            350,
            8000,
        ),
        _ => unreachable!("current action-family initializer matrix is closed"),
    }
}

fn action_execution_semantics(action_id: &str) -> ([&'static str; 2], [&'static str; 3]) {
    match action_id {
        "lat_pulldown" | "straight_arm_pulldown" => (
            ["pulling", "controlled_return"],
            ["extended_start", "pulled_turnaround", "returned_extension"],
        ),
        "seated_row" => (
            ["pulling", "return_to_reach"],
            ["reach_start", "handle_to_torso", "returned_reach"],
        ),
        "single_arm_cable_lateral_raise" | "lateral_raise" | "rear_delt_fly" => (
            ["raising", "lowering"],
            ["lowered_start", "visible_top", "returned_lowered"],
        ),
        "machine_chest_press" => (
            ["concentric_press", "eccentric_return"],
            ["retracted_start", "visible_extension", "returned_retracted"],
        ),
        "push_up" => (
            ["lowering", "pressing"],
            ["extended_start", "visible_bottom", "returned_extension"],
        ),
        "pull_up" => (
            ["pulling", "lowering"],
            ["hanging_start", "visible_top", "returned_hang"],
        ),
        _ => (["effort", "return"], ["start", "turnaround", "return"]),
    }
}

fn direction_id(direction: crate::LocalActionAxisDirection) -> &'static str {
    match direction {
        crate::LocalActionAxisDirection::PreparationToEffortUp => "up",
        crate::LocalActionAxisDirection::PreparationToEffortDown => "down",
        crate::LocalActionAxisDirection::PreparationToEffortLeft => "left",
        crate::LocalActionAxisDirection::PreparationToEffortRight => "right",
    }
}

fn promote_action_family(
    mut catalog: ExecutionAssessmentBundleCatalog,
    catalog_id: &str,
    delivery_stage: &str,
    bindings: Vec<ActionFamilyAssessmentProfileBinding>,
) -> ExecutionAssessmentBundleCatalog {
    catalog.catalog_id = catalog_id.into();
    for binding in bindings {
        let bundle_id = format!(
            "{}/{}/v1",
            binding.action_id,
            binding.capture_view.catalog_slug()
        );
        let bundle = catalog
            .bundles
            .iter_mut()
            .find(|bundle| bundle.bundle_id == bundle_id)
            .expect("action-family exact context is installed");
        let semantics = bundle.exact_context.equipment_semantics;
        let (phases, endpoints) = action_execution_semantics(&binding.action_id);
        let prefix = format!("{bundle_id}/{delivery_stage}");
        let mut common_features = vec![
            "cycle_duration",
            "rep_disposition",
            "first_phase_duration",
            "second_phase_duration",
            "phase_duration_ratio",
            "local_primary_excursion",
            "local_return_error",
            "equipment_primary_excursion",
            "pose_primary_excursion",
            "authorization_phase_control",
            "authorization_support_stability",
            "authorization_bilateral_coordination",
            "authorization_trajectory_control",
            "authorization_standard_variant_compatibility",
        ];
        if semantics == AssessmentEquipmentSemantics::TwoIndependentDumbbells {
            common_features.push("bilateral_endpoint_difference");
            common_features.push("bilateral_turnaround_timing_difference");
        }
        let definitions = [
            (
                AssessmentAssetKind::RecognitionProfile,
                "recognition-profile",
                serde_json::json!({
                    "runtimeProfileIdentity": binding.profile.identity,
                    "runtimeProfileHash": format!("{:016x}", binding.profile.content_hash),
                    "maturity": binding.profile.maturity.as_str(),
                    "initializerEvidenceAssetId": "personal-human-rep-ranges-v2",
                    "evidenceScope": "governed_known_video_rep_counting_initializer",
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::ExecutionContract,
                "execution-contract",
                serde_json::json!({
                    "phaseOrder": phases, "taskEndpoints": endpoints,
                    "dimensions": AssessmentDimension::ALL.map(AssessmentDimension::as_str),
                    "equipmentSemantics": equipment_semantics_id(semantics), "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::LocalCoordinateStrategy,
                "local-coordinate-strategy",
                serde_json::json!({
                    "requireNormalizedEndpoints": true, "coordinateSpace": "causal_set_local_camera_plane",
                    "captureView": binding.capture_view.catalog_slug(),
                    "preparationToEffortDirection": direction_id(binding.local_coordinate_strategy.preparation_to_effort),
                    "equipmentMode": local_equipment_mode_id(binding.local_coordinate_strategy.equipment_mode),
                    "poseAnchor": local_pose_anchor_id(binding.local_coordinate_strategy.pose_anchor),
                    "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::EquipmentAdapter,
                "equipment-adapter",
                serde_json::json!({
                    "evidencePolicy": equipment_evidence_policy(semantics),
                    "conflictPolicy": "abstain_fused_preserve_channels",
                    "poseFallback": "preserve_as_independent_channel", "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::FeatureProgram,
                "feature-program",
                serde_json::json!({
                    "features": common_features, "boundedFacts": true, "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::ReferencePolicy,
                "reference-policy",
                serde_json::json!({
                    "order": ["self_geometry", "set_prefix", "same_workout_prior_set"],
                    "compareBeforeUpdate": true, "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::RulePack,
                "rule-pack",
                serde_json::json!({
                    "rangeFeatureId": "local_primary_excursion", "rangeDeviationRatio": 0.20,
                    "minimumFeatureConfidence": 0.50, "missingEvidence": "cannot_judge",
                    "repRules": [
                        {"dimension":"task_completion","operator":"rep_disposition","featureId":"rep_disposition"},
                        {"dimension":"range_of_motion","operator":"reference_lower_bound","featureId":"local_primary_excursion","returnFeatureId":"local_return_error","maximumReturnError":0.15},
                        {"dimension":"phase_control","operator":"abstain","featureIds":["authorization_phase_control"],"reason":"no_governed_phase_quality_threshold"},
                        {"dimension":"support_stability","operator":"abstain","featureIds":["authorization_support_stability"],"reason":"support_or_trunk_quality_threshold_not_governed"},
                        {"dimension":"bilateral_coordination","operator":"abstain","featureIds":["authorization_bilateral_coordination"],"reason":"bilateral_quality_threshold_not_governed"},
                        {"dimension":"trajectory_control","operator":"abstain","featureIds":["authorization_trajectory_control"],"reason":"no_governed_trajectory_quality_corridor"},
                        {"dimension":"standard_variant_compatibility","operator":"abstain","featureIds":["authorization_standard_variant_compatibility"],"reason":"no_human_standard_variant_truth"},
                        {"dimension":"observation_confidence","operator":"features_available","featureIds":["local_primary_excursion"]}
                    ], "deliveryStage": delivery_stage,
                }),
            ),
            (
                AssessmentAssetKind::SetAggregationPolicy,
                "set-aggregation-policy",
                serde_json::json!({
                    "lateSetWindow": 2, "minimumPersistentReps": 2,
                    "bilateralDifferenceThreshold": 0.15,
                    "bilateralTimingDifferenceThresholdMs": 150,
                    "setRules": AssessmentDimension::ALL.map(|dimension| serde_json::json!({
                        "dimension": dimension.as_str(),
                        "operator": if dimension == AssessmentDimension::RangeOfMotion { "late_set_persistence" } else { "rollup_rep_dimension" }
                    })), "deliveryStage": delivery_stage,
                }),
            ),
        ];
        let references = definitions
            .into_iter()
            .map(|(kind, slug, content)| {
                let asset = executable_bundle_asset(kind, format!("{prefix}/{slug}"), content);
                let reference = asset.reference();
                catalog.installed_assets.push(asset);
                reference
            })
            .collect::<Vec<_>>();
        bundle.lineage = AssessmentBundleLineage {
            recognition_profile: references[0].clone(),
            execution_contract: references[1].clone(),
            local_coordinate_strategy: references[2].clone(),
            equipment_adapter: references[3].clone(),
            feature_program: references[4].clone(),
            reference_policy: references[5].clone(),
            rule_pack: references[6].clone(),
            set_aggregation_policy: references[7].clone(),
        };
        bundle.capability = AssessmentBundleCapability::Executable;
        *bundle = bundle.clone().with_computed_hash();
    }
    catalog
}

pub fn current_motion_assessment_catalog_v4() -> ExecutionAssessmentBundleCatalog {
    promote_action_family(
        current_motion_assessment_catalog_v3(),
        "maxpower/current-cable-assessment/v4",
        "ticket_04_cable_family",
        current_cable_assessment_profiles_v1(),
    )
}

pub fn current_motion_assessment_catalog_v5() -> ExecutionAssessmentBundleCatalog {
    promote_action_family(
        current_motion_assessment_catalog_v4(),
        "maxpower/current-machine-assessment/v5",
        "ticket_05_machine_family",
        current_machine_assessment_profiles_v1(),
    )
}

pub fn current_motion_assessment_catalog_v6() -> ExecutionAssessmentBundleCatalog {
    promote_action_family(
        current_motion_assessment_catalog_v5(),
        "maxpower/current-dual-dumbbell-assessment/v6",
        "ticket_06_dual_dumbbell_family",
        current_dual_dumbbell_assessment_profiles_v1(),
    )
}

pub fn current_motion_assessment_catalog_v7() -> ExecutionAssessmentBundleCatalog {
    promote_action_family(
        current_motion_assessment_catalog_v6(),
        "maxpower/current-all-family-assessment/v7",
        "ticket_07_bodyweight_family",
        current_bodyweight_assessment_profiles_v1(),
    )
}

fn rep_reference(rep: &SealedRep, subject_epoch: u64) -> SealedRepReference {
    SealedRepReference {
        rep_id: rep.rep_id,
        subject_epoch,
        disposition: match rep.disposition {
            RepDisposition::Confirmed => "confirmed",
            RepDisposition::NeedsReview => "needs_review",
            RepDisposition::Rejected => "rejected",
        }
        .into(),
        start_timestamp_ms: rep.start_timestamp_ms,
        turnaround_timestamp_ms: rep.peak_timestamp_ms,
        end_timestamp_ms: rep.end_timestamp_ms,
        canonical_slice_hash: format!("{:016x}", rep.canonical_slice_hash),
    }
}

fn packet_lineage_id(lineage: &crate::PacketLineage) -> String {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct StablePacketLineage<'a> {
        sequence_id: &'a str,
        contract_major: u16,
        contract_minor: u16,
        algorithm_version: &'a str,
        config_version: &'a str,
        inference_version: &'a str,
        diagnostic_version: &'a str,
        active_profile_identity: Option<&'a str>,
        active_profile_hash: Option<u64>,
    }
    hash_serialized(&StablePacketLineage {
        sequence_id: &lineage.sequence_id,
        contract_major: lineage.contract.major,
        contract_minor: lineage.contract.minor,
        algorithm_version: &lineage.algorithm_version,
        config_version: &lineage.config_version,
        inference_version: &lineage.inference_version,
        diagnostic_version: &lineage.diagnostic_version,
        active_profile_identity: lineage.active_profile_identity.as_deref(),
        active_profile_hash: lineage.active_profile_hash,
    })
}

fn hash_serialized<T: Serialize>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).expect("assessment contract is JSON serializable");
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

    fn unilateral_track(
        track_id: u64,
        hand: crate::EquipmentHand,
        x: f32,
        y: f32,
    ) -> crate::EquipmentTrackEvidence {
        crate::EquipmentTrackEvidence {
            track_id,
            proposal_id: track_id,
            subject_candidate_id: 7,
            kind: crate::EquipmentKind::MachineHandle,
            bbox: crate::NormalizedRect::new(x - 0.01, y - 0.01, 0.02, 0.02),
            axis: None,
            center_x: x,
            center_y: y,
            observation_score: 0.95,
            association_confidence: 0.95,
            uncertainty_px: Some(1.0),
            source: crate::EquipmentSource::Detector,
            held_by: hand,
            judgeable_path: true,
        }
    }

    fn local_channel(
        progress: f32,
        provenance: crate::LocalChannelProvenance,
    ) -> crate::LocalTrajectoryChannel {
        crate::LocalTrajectoryChannel {
            along_axis_progress: progress,
            cross_axis_displacement: 0.0,
            confidence: 0.9,
            coverage: 0.9,
            uncertainty: 0.1,
            provenance,
        }
    }

    #[test]
    fn conflicting_pose_and_equipment_remain_independent_and_cannot_be_fused() {
        let mut evidence = crate::LocalMotionCoordinateEvidence::default();
        evidence.equipment = Some(local_channel(
            0.4,
            crate::LocalChannelProvenance::EquipmentMeasured,
        ));
        evidence.pose = Some(local_channel(
            -0.3,
            crate::LocalChannelProvenance::PoseMeasured,
        ));
        evidence.channel_agreement = LocalChannelAgreement::Conflict;
        assert!(equipment_channel(&evidence).is_some());
        assert!(pose_channel(&evidence).is_some());
        assert_eq!(fused_channel(&evidence), None);
    }

    #[test]
    fn catalog_hash_and_duplicate_context_validation_fail_closed() {
        let mut stale_catalog = current_motion_assessment_catalog_v1();
        let stale_id = stale_catalog.bundles[0].bundle_id.clone();
        stale_catalog.bundles[0].lineage.rule_pack.id = "changed".into();
        assert_eq!(
            ExecutionAssessmentEngine::configure(
                stale_catalog,
                WorkoutAssessmentContext {
                    workout_session_id: "workout-1".into(),
                },
            )
            .err(),
            Some(AssessmentConfigurationError::InvalidBundleHash {
                bundle_id: stale_id,
            })
        );

        let mut duplicate_catalog = current_motion_assessment_catalog_v1();
        let original_context = duplicate_catalog.bundles[0].exact_context.clone();
        let mut duplicate = duplicate_catalog.bundles[0].clone();
        duplicate.bundle_id = "duplicate-context/v1".into();
        duplicate = duplicate.with_computed_hash();
        duplicate_catalog.bundles.push(duplicate);
        assert_eq!(
            ExecutionAssessmentEngine::configure(
                duplicate_catalog,
                WorkoutAssessmentContext {
                    workout_session_id: "workout-1".into(),
                },
            )
            .err(),
            Some(AssessmentConfigurationError::DuplicateExactContext(
                original_context,
            ))
        );
    }

    #[test]
    fn unilateral_side_requires_motion_and_preserves_later_conflict() {
        let mut candidates = HashMap::new();
        let mut resolved = None;
        let mut conflicted = false;
        update_observed_active_side(
            &mut candidates,
            &[unilateral_track(1, crate::EquipmentHand::Left, 0.4, 0.5)],
            &mut resolved,
            &mut conflicted,
        );
        assert_eq!(
            resolved, None,
            "one static association is not motion evidence"
        );
        update_observed_active_side(
            &mut candidates,
            &[unilateral_track(1, crate::EquipmentHand::Left, 0.4, 0.505)],
            &mut resolved,
            &mut conflicted,
        );
        assert_eq!(resolved, None, "sub-threshold jitter cannot establish side");
        update_observed_active_side(
            &mut candidates,
            &[unilateral_track(1, crate::EquipmentHand::Left, 0.4, 0.54)],
            &mut resolved,
            &mut conflicted,
        );
        assert_eq!(resolved, Some(AnatomicalSide::Left));
        update_observed_active_side(
            &mut candidates,
            &[unilateral_track(2, crate::EquipmentHand::Right, 0.6, 0.5)],
            &mut resolved,
            &mut conflicted,
        );
        update_observed_active_side(
            &mut candidates,
            &[unilateral_track(2, crate::EquipmentHand::Right, 0.6, 0.54)],
            &mut resolved,
            &mut conflicted,
        );
        assert!(conflicted);
        assert_eq!(
            resolved, None,
            "opposite motion remains an explicit conflict"
        );
    }
}
