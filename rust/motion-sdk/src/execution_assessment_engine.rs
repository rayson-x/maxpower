//! Workout-scoped execution assessment behind one small event interface.
//!
//! Hosts configure a versioned bundle catalog once and then advance canonical
//! lifecycle events. Feature evaluation, comparisons, rules, aggregation and
//! trace construction stay private implementation details as they land.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{
    AssessmentConclusionState, AssessmentDimension, QualityConclusion, RepDisposition, SealedRep,
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
    pub disposition: String,
    pub start_timestamp_ms: u64,
    pub turnaround_timestamp_ms: u64,
    pub end_timestamp_ms: u64,
    pub canonical_slice_hash: String,
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
    pub dimension_findings: Vec<QualityConclusion>,
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
    ExecutableBundleNotSupported {
        bundle_id: String,
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
}

struct ActiveSet {
    context: SetExecutionContext,
    resolved_context: ResolvedAssessmentContext,
    bundle: ExecutionAssessmentBundle,
    paused: bool,
    latest_frame_id: Option<u64>,
    latest_timestamp_ms: Option<u64>,
    reps: Vec<SealedRepReference>,
    rep_ids: HashSet<u64>,
}

pub struct ExecutionAssessmentEngine {
    workout: WorkoutAssessmentContext,
    action_definitions: HashMap<String, ActionDefinition>,
    bundles: HashMap<String, ExecutionAssessmentBundle>,
    active_set: Option<ActiveSet>,
    last_terminal: Option<SealedSetAssessment>,
    workout_finished: bool,
}

impl ExecutionAssessmentEngine {
    pub fn configure(
        catalog: ExecutionAssessmentBundleCatalog,
        workout: WorkoutAssessmentContext,
    ) -> Result<Self, AssessmentConfigurationError> {
        validate_catalog(&catalog)?;
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
            active_set: None,
            last_terminal: None,
            workout_finished: false,
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
            AssessmentEvent::RepSealed(rep) => self.seal_rep(*rep),
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
        self.active_set = Some(ActiveSet {
            context,
            resolved_context,
            bundle,
            paused: false,
            latest_frame_id: None,
            latest_timestamp_ms: None,
            reps: Vec::new(),
            rep_ids: HashSet::new(),
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
        Ok(AssessmentEmission::LiveMotionFacts(self.live_facts()))
    }

    fn seal_rep(&mut self, rep: SealedRep) -> Result<AssessmentEmission, AssessmentRuntimeError> {
        if self.active_set.as_ref().is_some_and(|active| {
            active.bundle.capability == AssessmentBundleCapability::ContextResolutionOnly
        }) {
            return self.bundle_not_executable_refusal();
        }
        let active = self
            .active_set
            .as_mut()
            .ok_or(AssessmentRuntimeError::NoActiveSet)?;
        if active.paused {
            return Err(AssessmentRuntimeError::SetPaused);
        }
        if rep.profile_identity != active.bundle.lineage.recognition_profile.id {
            return Err(AssessmentRuntimeError::RepProfileMismatch);
        }
        if !active.rep_ids.insert(rep.rep_id) {
            return Err(AssessmentRuntimeError::DuplicateRepId(rep.rep_id));
        }
        active.reps.push(rep_reference(&rep));
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
        let active = self.active_set.take().expect("active set checked above");
        let assessment_id = format!(
            "{}:{}:{}",
            self.workout.workout_session_id, active.context.set_id, active.bundle.bundle_id
        );
        let mut assessment = SealedSetAssessment {
            schema_version: "maxpower.sealed-set-assessment/v1".into(),
            assessment_id,
            workout_session_id: self.workout.workout_session_id.clone(),
            set_context: active.context,
            resolved_context: active.resolved_context,
            bundle_id: active.bundle.bundle_id,
            bundle_hash: active.bundle.content_hash,
            reps: active.reps,
            dimension_findings: scaffold_findings(),
            content_hash: String::new(),
        };
        assessment.content_hash = assessment.computed_content_hash();
        self.last_terminal = Some(assessment.clone());
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
        if bundle.capability == AssessmentBundleCapability::Executable {
            return Err(AssessmentConfigurationError::ExecutableBundleNotSupported {
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

fn rep_reference(rep: &SealedRep) -> SealedRepReference {
    SealedRepReference {
        rep_id: rep.rep_id,
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

fn scaffold_findings() -> Vec<QualityConclusion> {
    AssessmentDimension::ALL
        .iter()
        .map(|dimension| QualityConclusion {
            conclusion_id: format!("set:{}", dimension.as_str()),
            dimension: *dimension,
            state: AssessmentConclusionState::CannotJudge,
            summary: "Cannot judge until the configured FeatureProgram and RulePack run.".into(),
            evidence: Vec::new(),
            reason: Some("execution_assessment_engine_scaffold".into()),
            confidence: 0.0,
        })
        .collect()
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
}
