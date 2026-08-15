//! Asset-driven action semantics and exact-view observation-plan compilation.
//! No action name is dispatched in this module and no numeric quality threshold
//! is inferred from qualitative motion semantics.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionMotionCatalog {
    pub schema_version: String,
    pub catalog_id: String,
    pub definitions: Vec<ActionMotionDefinition>,
}

impl ActionMotionCatalog {
    pub fn from_json(json: &str) -> Result<Self, ActionMotionError> {
        let mut value: Self = serde_json::from_str(json)
            .map_err(|error| ActionMotionError::InvalidAsset(error.to_string()))?;
        if value.schema_version != "maxpower.action-motion-catalog/v1"
            || value.catalog_id.trim().is_empty()
        {
            return Err(ActionMotionError::UnsupportedCatalog);
        }
        let (mut ids, mut actions) = (HashSet::new(), HashSet::new());
        for definition in &mut value.definitions {
            definition.validate()?;
            if !ids.insert(definition.definition_id.clone())
                || !actions.insert(definition.action_id.clone())
            {
                return Err(ActionMotionError::DuplicateLeaf(
                    definition.action_id.clone(),
                ));
            }
            let computed = definition.computed_hash();
            if definition.content_hash.is_empty() {
                definition.content_hash = computed;
            } else if definition.content_hash != computed {
                return Err(ActionMotionError::InvalidDefinitionHash {
                    definition_id: definition.definition_id.clone(),
                });
            }
        }
        Ok(value)
    }

    pub fn definition(&self, action_id: &str) -> Option<&ActionMotionDefinition> {
        self.definitions
            .iter()
            .find(|definition| definition.action_id == action_id)
    }
}

/// Reviewed 30-family / 248-leaf catalog materialized by the repository
/// generator. The generated asset is read identically by native and WASM.
pub fn reviewed_action_motion_catalog_v1() -> Result<ActionMotionCatalog, ActionMotionError> {
    ActionMotionCatalog::from_json(include_str!("../assets/action-motion-catalog-v1.json"))
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionMotionDefinition {
    pub schema_version: String,
    pub definition_id: String,
    pub action_id: String,
    pub exact_identity: ExactActionIdentity,
    pub executable_leaf: bool,
    pub relations: Vec<MotionRelationDefinition>,
    pub tracks: Vec<MotionTrackDefinition>,
    pub rep_boundary: RepBoundarySemantics,
    pub phases: Vec<PhaseSemantics>,
    pub allowed_claims: Vec<String>,
    pub supported_views: Vec<String>,
    #[serde(default)]
    pub admitted_views: Vec<String>,
    pub content_hash: String,
}

impl ActionMotionDefinition {
    pub fn with_computed_hash(mut self) -> Self {
        self.content_hash = self.computed_hash();
        self
    }
    pub fn computed_hash(&self) -> String {
        let mut semantic = self.clone();
        semantic.content_hash.clear();
        stable_hash(&semantic)
    }
    fn validate(&self) -> Result<(), ActionMotionError> {
        let complete_identity = [
            &self.definition_id,
            &self.action_id,
            &self.exact_identity.movement_family,
            &self.exact_identity.posture,
            &self.exact_identity.support,
            &self.exact_identity.equipment_topology,
            &self.exact_identity.laterality,
            &self.exact_identity.setup,
        ]
        .into_iter()
        .all(|value| !value.trim().is_empty());
        let has_primary_relation = self.relations.iter().any(|relation| {
            relation.role == MotionRole::TaskPrimary
                && relation.required
                && relation.identity_defining
        });
        let has_primary_track = self.tracks.iter().any(|track| {
            track.role == TrackRole::Primary && track.required && track.identity_defining
        });
        let complete_boundary = [
            &self.rep_boundary.activation,
            &self.rep_boundary.start,
            &self.rep_boundary.turnaround,
            &self.rep_boundary.return_boundary,
            &self.rep_boundary.release,
        ]
        .into_iter()
        .all(|value| !value.trim().is_empty());
        let relation_ids = self
            .relations
            .iter()
            .map(|relation| relation.relation_id.as_str())
            .collect::<HashSet<_>>();
        let track_ids = self
            .tracks
            .iter()
            .map(|track| track.track_id.as_str())
            .collect::<HashSet<_>>();
        let complete_relations = self.relations.iter().all(|relation| {
            !relation.relation_id.trim().is_empty()
                && !relation.operator_id.trim().is_empty()
                && !relation.unit.trim().is_empty()
                && !relation.scope.trim().is_empty()
                && !relation.semantic_statement.trim().is_empty()
                && !relation.inputs.is_empty()
                && relation
                    .inputs
                    .iter()
                    .all(|input| !input.source.trim().is_empty() && !input.unit.trim().is_empty())
        });
        let complete_tracks = self
            .tracks
            .iter()
            .all(|track| !track.track_id.trim().is_empty() && !track.source.trim().is_empty());
        let required_roles = [
            MotionRole::TaskPrimary,
            MotionRole::CoordinatedMotion,
            MotionRole::StabilityRelation,
            MotionRole::SubstitutionGuard,
        ]
        .into_iter()
        .all(|role| self.relations.iter().any(|relation| relation.role == role));
        let unique_nonempty_lists = relation_ids.len() == self.relations.len()
            && track_ids.len() == self.tracks.len()
            && self
                .allowed_claims
                .iter()
                .all(|claim| !claim.trim().is_empty())
            && self
                .supported_views
                .iter()
                .all(|view| !view.trim().is_empty())
            && self.phases.iter().all(|phase| {
                !phase.phase_id.trim().is_empty()
                    && !phase.from.trim().is_empty()
                    && !phase.to.trim().is_empty()
            });
        if self.schema_version != "maxpower.action-motion-definition/v1"
            || !self.executable_leaf
            || !complete_identity
            || !has_primary_relation
            || !has_primary_track
            || !complete_boundary
            || !complete_relations
            || !complete_tracks
            || !required_roles
            || !unique_nonempty_lists
            || self.phases.is_empty()
            || self.allowed_claims.is_empty()
            || self.supported_views.is_empty()
        {
            return Err(ActionMotionError::DefinitionBuildFailure {
                action_id: self.action_id.clone(),
                detail: "complete executable leaf semantics are required".into(),
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExactActionIdentity {
    pub movement_family: String,
    pub posture: String,
    pub support: String,
    pub equipment_topology: String,
    pub laterality: String,
    pub setup: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotionRole {
    TaskPrimary,
    CoordinatedMotion,
    StabilityRelation,
    SubstitutionGuard,
    TechniqueConstraint,
    ContextAnchor,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotionValueType {
    Point2d,
    Segment2d,
    Scalar,
    Category,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionInput {
    pub source: String,
    pub value_type: MotionValueType,
    pub unit: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionRelationDefinition {
    pub relation_id: String,
    pub role: MotionRole,
    pub operator_id: String,
    pub inputs: Vec<MotionInput>,
    pub output_type: MotionValueType,
    pub unit: String,
    pub scope: String,
    pub required: bool,
    pub identity_defining: bool,
    #[serde(default)]
    pub semantic_statement: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackRole {
    Primary,
    Corroborating,
    Stability,
    Conflict,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionTrackDefinition {
    pub track_id: String,
    pub source: String,
    pub role: TrackRole,
    pub required: bool,
    pub identity_defining: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepBoundarySemantics {
    pub activation: String,
    pub start: String,
    pub turnaround: String,
    #[serde(rename = "return")]
    pub return_boundary: String,
    pub release: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhaseSemantics {
    pub phase_id: String,
    pub from: String,
    pub to: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperatorContract {
    pub operator_id: String,
    pub accepted_inputs: Vec<MotionValueType>,
    pub output_type: MotionValueType,
    pub allowed_units: Vec<String>,
    pub permitted_sources: Vec<String>,
    pub source_requirement: OperatorSourceRequirement,
    pub coverage_policy: FeatureCoveragePolicy,
    pub confidence_policy: FeatureConfidencePolicy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperatorSourceRequirement {
    CurrentMeasuredPose,
    CurrentMeasuredEquipment,
    CurrentMeasuredMixed,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FeatureCoveragePolicy {
    IntersectionOfObservedInputs,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FeatureConfidencePolicy {
    MinimumObservedInputConfidence,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FeatureJudgeability {
    RequiredForRep,
    DimensionScopedCannotJudge,
}

#[derive(Clone, Debug)]
pub struct OperatorRegistry {
    contracts: HashMap<String, OperatorContract>,
}

impl OperatorRegistry {
    pub fn standard() -> Self {
        let values = [
            operator(
                "equipment_axis_displacement",
                &[MotionValueType::Point2d],
                MotionValueType::Scalar,
                &["local_scale_ratio"],
                &[
                    "equipment_axis_center",
                    "machine_handle_center",
                    "dumbbell_center",
                ],
            ),
            operator(
                "point_displacement",
                &[MotionValueType::Point2d],
                MotionValueType::Scalar,
                &["local_scale_ratio"],
                POSE_POINTS,
            ),
            operator(
                "segment_angle",
                &[MotionValueType::Segment2d],
                MotionValueType::Scalar,
                &["radians"],
                &[
                    "shoulder_hip_axis",
                    "shoulder_axis",
                    "hip_axis",
                    "upper_arm",
                    "thigh",
                    "shin",
                ],
            ),
            operator(
                "joint_angle",
                &[
                    MotionValueType::Point2d,
                    MotionValueType::Point2d,
                    MotionValueType::Point2d,
                ],
                MotionValueType::Scalar,
                &["radians"],
                POSE_POINTS,
            ),
            operator(
                "relative_distance",
                &[MotionValueType::Point2d, MotionValueType::Point2d],
                MotionValueType::Scalar,
                &["local_scale_ratio"],
                ALL_POINTS,
            ),
            operator(
                "constrained_path_deviation",
                &[MotionValueType::Point2d],
                MotionValueType::Scalar,
                &["local_scale_ratio"],
                &["equipment_axis_center", "machine_handle_center"],
            ),
        ];
        Self {
            contracts: values
                .into_iter()
                .map(|contract| (contract.operator_id.clone(), contract))
                .collect(),
        }
    }
    pub fn register(&mut self, contract: OperatorContract) -> Result<(), ActionMotionError> {
        if self
            .contracts
            .insert(contract.operator_id.clone(), contract)
            .is_some()
        {
            return Err(ActionMotionError::DuplicateOperator);
        }
        Ok(())
    }
}

const POSE_POINTS: &[&str] = &[
    "left_wrist",
    "right_wrist",
    "left_elbow",
    "right_elbow",
    "left_shoulder",
    "right_shoulder",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
    "shoulder_midpoint",
    "hip_midpoint",
];
const ALL_POINTS: &[&str] = &[
    "equipment_axis_center",
    "machine_handle_center",
    "dumbbell_center",
    "left_wrist",
    "right_wrist",
    "left_elbow",
    "right_elbow",
    "shoulder_midpoint",
    "hip_midpoint",
];
fn operator(
    id: &str,
    inputs: &[MotionValueType],
    output: MotionValueType,
    units: &[&str],
    sources: &[&str],
) -> OperatorContract {
    let has_equipment = sources.iter().any(|source| equipment_source(source));
    let has_pose = sources.iter().any(|source| !equipment_source(source));
    let source_requirement = match (has_equipment, has_pose) {
        (true, true) => OperatorSourceRequirement::CurrentMeasuredMixed,
        (true, false) => OperatorSourceRequirement::CurrentMeasuredEquipment,
        (false, _) => OperatorSourceRequirement::CurrentMeasuredPose,
    };
    OperatorContract {
        operator_id: id.into(),
        accepted_inputs: inputs.to_vec(),
        output_type: output,
        allowed_units: units.iter().map(|value| (*value).into()).collect(),
        permitted_sources: sources.iter().map(|value| (*value).into()).collect(),
        source_requirement,
        coverage_policy: FeatureCoveragePolicy::IntersectionOfObservedInputs,
        confidence_policy: FeatureConfidencePolicy::MinimumObservedInputConfidence,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MotionEvidenceChannel {
    VideoEquipment,
    Pose,
    Other,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MissingFramePolicy {
    PreserveNoObservation,
    HoldCausalContext,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChannelClockPolicy {
    pub channel: MotionEvidenceChannel,
    pub advances_pose_state: bool,
    pub maximum_causal_age_ms: u64,
    pub missing_frame_policy: MissingFramePolicy,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionPlanCapability {
    FullExecutable,
    PoseSupportedLimited,
    UnsupportedEquipmentCatalogOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionCapabilityState {
    FullPlanCompiled,
    PoseSupportedLimitedSuccess,
    UnsupportedEquipmentCatalogOnly,
    AdmissibleVisualRefusal,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionCapabilityRecord {
    pub action_id: String,
    pub equipment_topology: String,
    pub capture_view: String,
    pub state: ActionCapabilityState,
    pub detail: Option<String>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ViewProjectedRelation {
    pub relation_id: String,
    pub semantic_role: MotionRole,
    pub observable: bool,
    pub refusal_reason: Option<String>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ViewProjectionPlan {
    pub definition_id: String,
    pub definition_hash: String,
    pub exact_view: String,
    pub relations: Vec<ViewProjectedRelation>,
    pub projection_hash: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompiledMotionRelation {
    pub relation_id: String,
    pub role: MotionRole,
    pub operator_id: String,
    pub inputs: Vec<MotionInput>,
    pub output_type: MotionValueType,
    pub unit: String,
    pub scope: String,
    pub source_requirement: OperatorSourceRequirement,
    pub coverage_policy: FeatureCoveragePolicy,
    pub confidence_policy: FeatureConfidencePolicy,
    pub judgeability: FeatureJudgeability,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionObservationPlan {
    pub action_id: String,
    pub definition_id: String,
    pub definition_hash: String,
    pub capture_view: String,
    pub capability: ActionPlanCapability,
    pub projection: ViewProjectionPlan,
    pub relations: Vec<CompiledMotionRelation>,
    pub channels: Vec<ChannelClockPolicy>,
    pub rep_boundary: RepBoundarySemantics,
    pub phases: Vec<PhaseSemantics>,
    pub allowed_claims: Vec<String>,
    pub rep_authority: Option<String>,
    pub cannot_judge_dimensions: Vec<String>,
    pub plan_hash: String,
}

pub struct ActionMotionCompiler {
    registry: OperatorRegistry,
}
impl ActionMotionCompiler {
    pub fn new(registry: OperatorRegistry) -> Self {
        Self { registry }
    }
    pub fn compile(
        &self,
        definition: &ActionMotionDefinition,
        view: &str,
    ) -> Result<ActionObservationPlan, ActionMotionError> {
        definition.validate()?;
        if !definition
            .supported_views
            .iter()
            .any(|declared| declared == view)
        {
            return Err(ActionMotionError::PlanRefusal {
                action_id: definition.action_id.clone(),
                detail: "exact view is not declared".into(),
            });
        }
        let projection = project_definition(definition, view, &self.registry);
        let required_equipment = definition.tracks.iter().any(|track| {
            track.required && track.identity_defining && equipment_source(&track.source)
        });
        let supported_topology = matches!(
            definition.exact_identity.equipment_topology.as_str(),
            "free_rigid_barbell" | "smith_guided_bar" | "none" | "bodyweight_station"
        );
        if required_equipment && !supported_topology {
            return Ok(plan(
                definition,
                projection,
                ActionPlanCapability::UnsupportedEquipmentCatalogOnly,
                Vec::new(),
                None,
                definition.allowed_claims.clone(),
            ));
        }
        if !definition
            .admitted_views
            .iter()
            .any(|admitted| admitted == view)
        {
            return Err(ActionMotionError::PlanRefusal {
                action_id: definition.action_id.clone(),
                detail: "exact view lacks admitted observability evidence".into(),
            });
        }
        let mut relations = Vec::new();
        for relation in &definition.relations {
            let Some(contract) = self.registry.contracts.get(&relation.operator_id) else {
                if relation.required && relation.identity_defining {
                    return Err(ActionMotionError::PlanRefusal {
                        action_id: definition.action_id.clone(),
                        detail: format!("missing operator {}", relation.operator_id),
                    });
                }
                continue;
            };
            let input_types = relation
                .inputs
                .iter()
                .map(|input| input.value_type)
                .collect::<Vec<_>>();
            if input_types != contract.accepted_inputs
                || relation.output_type != contract.output_type
                || !contract.allowed_units.contains(&relation.unit)
                || relation
                    .inputs
                    .iter()
                    .any(|input| !contract.permitted_sources.contains(&input.source))
            {
                return Err(ActionMotionError::OperatorTypeMismatch {
                    relation_id: relation.relation_id.clone(),
                });
            }
            if relation.role == MotionRole::TaskPrimary && relation.identity_defining {
                let primary = definition
                    .tracks
                    .iter()
                    .find(|track| track.role == TrackRole::Primary && track.identity_defining)
                    .expect("validated primary");
                if equipment_source(&primary.source)
                    && relation
                        .inputs
                        .iter()
                        .any(|input| !equipment_source(&input.source))
                {
                    return Err(ActionMotionError::IdentitySourceConflict {
                        relation_id: relation.relation_id.clone(),
                    });
                }
            }
            relations.push(CompiledMotionRelation {
                relation_id: relation.relation_id.clone(),
                role: relation.role,
                operator_id: relation.operator_id.clone(),
                inputs: relation.inputs.clone(),
                output_type: relation.output_type,
                unit: relation.unit.clone(),
                scope: relation.scope.clone(),
                source_requirement: contract.source_requirement,
                coverage_policy: contract.coverage_policy,
                confidence_policy: contract.confidence_policy,
                judgeability: if relation.required && relation.identity_defining {
                    FeatureJudgeability::RequiredForRep
                } else {
                    FeatureJudgeability::DimensionScopedCannotJudge
                },
            });
        }
        let missing_required = definition.relations.iter().any(|source| {
            source.required
                && source.identity_defining
                && !relations
                    .iter()
                    .any(|compiled| compiled.relation_id == source.relation_id)
        });
        if missing_required {
            return Err(ActionMotionError::PlanRefusal {
                action_id: definition.action_id.clone(),
                detail: "identity-defining relation is not computable".into(),
            });
        }
        let capability = if supported_topology {
            ActionPlanCapability::FullExecutable
        } else {
            ActionPlanCapability::PoseSupportedLimited
        };
        let cannot_judge_dimensions = if capability == ActionPlanCapability::PoseSupportedLimited {
            definition
                .allowed_claims
                .iter()
                .filter(|claim| claim.contains("trajectory") || claim.contains("equipment"))
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        Ok(plan(
            definition,
            projection,
            capability,
            relations,
            Some(definition.rep_boundary.turnaround.clone()),
            cannot_judge_dimensions,
        ))
    }
}

pub fn reviewed_action_capability_matrix_v1()
-> Result<Vec<ActionCapabilityRecord>, ActionMotionError> {
    let catalog = reviewed_action_motion_catalog_v1()?;
    let compiler = ActionMotionCompiler::new(OperatorRegistry::standard());
    catalog
        .definitions
        .iter()
        .map(|definition| {
            let view = definition
                .admitted_views
                .first()
                .or_else(|| definition.supported_views.first())
                .expect("validated view")
                .clone();
            match compiler.compile(definition, &view) {
                Ok(plan) => Ok(ActionCapabilityRecord {
                    action_id: definition.action_id.clone(),
                    equipment_topology: definition.exact_identity.equipment_topology.clone(),
                    capture_view: view,
                    state: match plan.capability {
                        ActionPlanCapability::FullExecutable => {
                            ActionCapabilityState::FullPlanCompiled
                        }
                        ActionPlanCapability::PoseSupportedLimited => {
                            ActionCapabilityState::PoseSupportedLimitedSuccess
                        }
                        ActionPlanCapability::UnsupportedEquipmentCatalogOnly => {
                            ActionCapabilityState::UnsupportedEquipmentCatalogOnly
                        }
                    },
                    detail: None,
                }),
                Err(ActionMotionError::PlanRefusal { detail, .. }) => Ok(ActionCapabilityRecord {
                    action_id: definition.action_id.clone(),
                    equipment_topology: definition.exact_identity.equipment_topology.clone(),
                    capture_view: view,
                    state: ActionCapabilityState::AdmissibleVisualRefusal,
                    detail: Some(detail),
                }),
                Err(error) => Err(error),
            }
        })
        .collect()
}

fn project_definition(
    definition: &ActionMotionDefinition,
    view: &str,
    registry: &OperatorRegistry,
) -> ViewProjectionPlan {
    let relations = definition
        .relations
        .iter()
        .map(|relation| {
            let observable = registry.contracts.contains_key(&relation.operator_id);
            ViewProjectedRelation {
                relation_id: relation.relation_id.clone(),
                semantic_role: relation.role,
                observable,
                refusal_reason: (!observable).then(|| {
                    format!(
                        "operator {} is unavailable in exact view {view}",
                        relation.operator_id
                    )
                }),
            }
        })
        .collect::<Vec<_>>();
    let projection_hash = stable_hash(&(
        definition.definition_id.as_str(),
        definition.computed_hash(),
        view,
        relations
            .iter()
            .map(|relation| {
                (
                    &relation.relation_id,
                    format!("{:?}", relation.semantic_role),
                    relation.observable,
                    &relation.refusal_reason,
                )
            })
            .collect::<Vec<_>>(),
    ));
    ViewProjectionPlan {
        definition_id: definition.definition_id.clone(),
        definition_hash: definition.computed_hash(),
        exact_view: view.into(),
        relations,
        projection_hash,
    }
}

fn plan(
    definition: &ActionMotionDefinition,
    projection: ViewProjectionPlan,
    capability: ActionPlanCapability,
    relations: Vec<CompiledMotionRelation>,
    rep_authority: Option<String>,
    cannot_judge_dimensions: Vec<String>,
) -> ActionObservationPlan {
    let capture_view = projection.exact_view.clone();
    let channels = vec![
        ChannelClockPolicy {
            channel: MotionEvidenceChannel::VideoEquipment,
            advances_pose_state: false,
            maximum_causal_age_ms: 180,
            missing_frame_policy: MissingFramePolicy::PreserveNoObservation,
        },
        ChannelClockPolicy {
            channel: MotionEvidenceChannel::Pose,
            advances_pose_state: true,
            maximum_causal_age_ms: 0,
            missing_frame_policy: MissingFramePolicy::HoldCausalContext,
        },
    ];
    let plan_hash = stable_hash(&(
        definition.definition_id.as_str(),
        definition.computed_hash(),
        projection.projection_hash.as_str(),
        format!("{capability:?}"),
        relations
            .iter()
            .map(|relation| {
                (
                    &relation.relation_id,
                    &relation.operator_id,
                    &relation.unit,
                    &relation.scope,
                    format!("{:?}", relation.role),
                    format!("{:?}", relation.judgeability),
                )
            })
            .collect::<Vec<_>>(),
        &rep_authority,
        &cannot_judge_dimensions,
        &definition.rep_boundary,
        &definition.phases,
        &definition.allowed_claims,
    ));
    ActionObservationPlan {
        action_id: definition.action_id.clone(),
        definition_id: definition.definition_id.clone(),
        definition_hash: definition.computed_hash(),
        capture_view,
        capability,
        projection,
        relations,
        channels,
        rep_boundary: definition.rep_boundary.clone(),
        phases: definition.phases.clone(),
        allowed_claims: definition.allowed_claims.clone(),
        rep_authority,
        cannot_judge_dimensions,
        plan_hash,
    }
}
fn equipment_source(source: &str) -> bool {
    source.contains("equipment")
        || source.contains("dumbbell")
        || source.contains("machine_handle")
        || source.contains("bar_axis")
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActionMotionError {
    InvalidAsset(String),
    UnsupportedCatalog,
    DuplicateLeaf(String),
    DuplicateOperator,
    InvalidDefinitionHash { definition_id: String },
    DefinitionBuildFailure { action_id: String, detail: String },
    PlanRefusal { action_id: String, detail: String },
    OperatorTypeMismatch { relation_id: String },
    IdentitySourceConflict { relation_id: String },
}

fn stable_hash<T: Serialize>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).expect("serializable motion definition");
    let hash = bytes
        .into_iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
    format!("{hash:016x}")
}
