//! Asset-driven action semantics and exact-view observation-plan compilation.
//! No action name is dispatched in this module and no numeric quality threshold
//! is inferred from qualitative motion semantics.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::{EquipmentProviderId, EquipmentProviderRegistry, EquipmentProviderTopology};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionMotionCatalog {
    pub schema_version: String,
    pub catalog_id: String,
    pub definitions: Vec<ActionMotionDefinition>,
}

/// Product-entry contract for one action card.  It contains semantic camera
/// choices only; equipment providers, algorithms and thresholds remain hidden
/// inside the plan compiled after the caller chooses a view.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionEntryOptions {
    pub action_id: String,
    pub recommended_view: String,
    pub available_views: Vec<String>,
}

/// One relation from the action's semantic authority, rendered as a stable
/// explanation rather than reinterpreted by a client or language model.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEvidenceItem {
    pub relation_id: String,
    pub role: MotionRole,
    pub operator_id: String,
    pub input_sources: Vec<String>,
    pub supporting_track_ids: Vec<String>,
    pub required_for_rep: bool,
    pub identity_defining: bool,
    pub semantic_statement: String,
    pub evidence_rationale: String,
    pub expected_pattern: String,
    pub missing_consequence: EvidenceMissingConsequence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceMissingConsequence {
    RepRefusal,
    DimensionCannotJudge,
}

/// A client-readable explanation derived entirely from one registered action
/// definition.  Categories may overlap (the primary relation is also an
/// equipment or skeleton trajectory), but no second movement truth is stored.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEvidenceExplanation {
    pub action_id: String,
    pub definition_id: String,
    pub definition_hash: String,
    pub exact_identity: ExactActionIdentity,
    pub variant_statement: String,
    pub primary_relation: ActionEvidenceItem,
    pub equipment_trajectories: Vec<ActionEvidenceItem>,
    pub skeleton_trajectories: Vec<ActionEvidenceItem>,
    pub joint_angles: Vec<ActionEvidenceItem>,
    pub rep_boundary: RepBoundarySemantics,
    pub allowed_claims: Vec<String>,
    pub limited_claims: Vec<String>,
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

    /// Resolves the action-card camera choices that may safely start a
    /// recognition session. A declared but geometrically unobservable exact
    /// view remains in the asset for typed refusal/audit, but is not offered as
    /// a selectable product entry.
    pub fn entry_options(&self, action_id: &str) -> Result<ActionEntryOptions, ActionMotionError> {
        let definition =
            self.definition(action_id)
                .ok_or_else(|| ActionMotionError::UnknownAction {
                    action_id: action_id.to_owned(),
                })?;
        let compiler = ActionMotionCompiler::new(OperatorRegistry::standard());
        let mut available_views = Vec::new();
        for view in &definition.supported_views {
            match compiler.compile(definition, view) {
                Ok(_) => available_views.push(view.clone()),
                Err(ActionMotionError::IdentityRelationNotObservable { .. }) => {}
                Err(error) => return Err(error),
            }
        }
        if available_views.is_empty()
            || !available_views
                .iter()
                .any(|view| view == &definition.recommended_view)
        {
            return Err(ActionMotionError::RecommendedViewNotExecutable {
                action_id: definition.action_id.clone(),
                view: definition.recommended_view.clone(),
            });
        }
        Ok(ActionEntryOptions {
            action_id: definition.action_id.clone(),
            recommended_view: definition.recommended_view.clone(),
            available_views,
        })
    }

    pub fn explain_action(
        &self,
        action_id: &str,
    ) -> Result<ActionEvidenceExplanation, ActionMotionError> {
        let definition =
            self.definition(action_id)
                .ok_or_else(|| ActionMotionError::UnknownAction {
                    action_id: action_id.to_owned(),
                })?;
        let explain_relation = |relation: &MotionRelationDefinition| {
            let supporting_track_ids = definition
                .tracks
                .iter()
                .filter(|track| track.supports_relation_ids.contains(&relation.relation_id))
                .map(|track| track.track_id.clone())
                .collect::<Vec<_>>();
            ActionEvidenceItem {
                relation_id: relation.relation_id.clone(),
                role: relation.role,
                operator_id: relation.operator_id.clone(),
                input_sources: relation
                    .inputs
                    .iter()
                    .map(|input| input.source.clone())
                    .collect(),
                supporting_track_ids,
                required_for_rep: relation.required && relation.identity_defining,
                identity_defining: relation.identity_defining,
                semantic_statement: relation.semantic_statement.clone(),
                evidence_rationale: relation.evidence_rationale.clone(),
                expected_pattern: relation.expected_pattern.clone(),
                missing_consequence: if relation.required && relation.identity_defining {
                    EvidenceMissingConsequence::RepRefusal
                } else {
                    EvidenceMissingConsequence::DimensionCannotJudge
                },
            }
        };
        let primary = definition
            .relations
            .iter()
            .find(|relation| {
                relation.role == MotionRole::TaskPrimary
                    && relation.required
                    && relation.identity_defining
            })
            .expect("validated action definition has one identity primary");
        let equipment_trajectories = definition
            .relations
            .iter()
            .filter(|relation| {
                relation
                    .inputs
                    .iter()
                    .any(|input| equipment_source(&input.source))
            })
            .map(explain_relation)
            .collect();
        let skeleton_trajectories = definition
            .relations
            .iter()
            .filter(|relation| {
                relation.operator_id != "joint_angle"
                    && relation
                        .inputs
                        .iter()
                        .any(|input| !equipment_source(&input.source))
            })
            .map(explain_relation)
            .collect();
        let joint_angles = definition
            .relations
            .iter()
            .filter(|relation| relation.operator_id == "joint_angle")
            .map(explain_relation)
            .collect();
        Ok(ActionEvidenceExplanation {
            action_id: definition.action_id.clone(),
            definition_id: definition.definition_id.clone(),
            definition_hash: definition.computed_hash(),
            exact_identity: definition.exact_identity.clone(),
            variant_statement: definition.variant_statement.clone(),
            primary_relation: explain_relation(primary),
            equipment_trajectories,
            skeleton_trajectories,
            joint_angles,
            rep_boundary: definition.rep_boundary.clone(),
            allowed_claims: definition.allowed_claims.clone(),
            limited_claims: definition.limited_claims.clone(),
        })
    }
}

/// Installed 30-family / 248-leaf catalog materialized by the repository
/// generator. The generated asset is read identically by native and WASM.
pub fn installed_action_motion_catalog_v1() -> Result<ActionMotionCatalog, ActionMotionError> {
    ActionMotionCatalog::from_json(include_str!("../assets/action-motion-catalog-v1.json"))
}

/// Structural inventory of the action library installed in this SDK build.
///
/// This deliberately contains no review, validation-maturity, accuracy or
/// release state. Those are properties of the external data/release workflow,
/// not action semantics consumed by the runtime.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionAssetInventoryReport {
    pub catalog_id: String,
    pub leaf_action_count: usize,
    pub exact_view_count: usize,
    /// Count of geometrically explicit exact-context refusals. This is not a
    /// review/maturity tier: the action asset remains installed and the
    /// compiler returns a deterministic refusal instead of borrowing a
    /// different relation for that capture projection.
    pub identity_unobservable_view_count: usize,
}

/// Validates that every action and declared view in the checked-in library can
/// produce the same executable plan shape used at runtime. The SDK does not
/// consume a capability/admission matrix.
pub fn installed_action_asset_inventory_v1() -> Result<ActionAssetInventoryReport, ActionMotionError>
{
    let catalog = installed_action_motion_catalog_v1()?;
    validate_action_asset_inventory(&catalog)
}

pub fn validate_action_asset_inventory(
    catalog: &ActionMotionCatalog,
) -> Result<ActionAssetInventoryReport, ActionMotionError> {
    let compiler = ActionMotionCompiler::new(OperatorRegistry::standard());
    let mut expected_rows = 0_usize;
    let mut identity_unobservable_view_count = 0_usize;
    for definition in &catalog.definitions {
        catalog.entry_options(&definition.action_id)?;
        for view in &definition.supported_views {
            expected_rows += 1;
            match compiler.compile(definition, view) {
                Ok(_) => {}
                Err(ActionMotionError::IdentityRelationNotObservable { .. }) => {
                    identity_unobservable_view_count += 1;
                }
                Err(error) => return Err(error),
            }
        }
    }

    Ok(ActionAssetInventoryReport {
        catalog_id: catalog.catalog_id.clone(),
        leaf_action_count: catalog.definitions.len(),
        exact_view_count: expected_rows,
        identity_unobservable_view_count,
    })
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionMotionDefinition {
    pub schema_version: String,
    pub definition_id: String,
    pub action_id: String,
    pub exact_identity: ExactActionIdentity,
    /// Leaf-specific distinction from other actions in the same movement
    /// family.  It is kept separate from TaskPrimary so a setup/stability
    /// constraint cannot be mislabeled as the movement that creates a Rep.
    pub variant_statement: String,
    pub executable_leaf: bool,
    pub relations: Vec<MotionRelationDefinition>,
    pub tracks: Vec<MotionTrackDefinition>,
    pub rep_consensus: RepConsensusPolicy,
    pub rep_boundary: RepBoundarySemantics,
    pub phases: Vec<PhaseSemantics>,
    pub allowed_claims: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub limited_claims: Vec<String>,
    /// Asset-authored default shown before recognition starts. It is not
    /// inferred from pixels and must itself compile as an observable exact
    /// context.
    pub recommended_view: String,
    pub supported_views: Vec<String>,
    /// Exact action × view evidence authority.  This is deliberately asset
    /// data, rather than an inference from an operator being compiled: an
    /// operator can exist while its identity relation is occluded or
    /// semantically meaningless in one projection.
    pub view_observation_plans: Vec<ViewObservationPlan>,
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
    pub(crate) fn validate(&self) -> Result<(), ActionMotionError> {
        let complete_identity = [
            &self.definition_id,
            &self.action_id,
            &self.exact_identity.movement_family,
            &self.exact_identity.posture,
            &self.exact_identity.support,
            &self.exact_identity.equipment_topology,
            &self.exact_identity.laterality,
            &self.exact_identity.setup,
            &self.variant_statement,
        ]
        .into_iter()
        .all(|value| !value.trim().is_empty());
        let primary_relations = self
            .relations
            .iter()
            .filter(|relation| {
                relation.role == MotionRole::TaskPrimary
                    && relation.required
                    && relation.identity_defining
            })
            .collect::<Vec<_>>();
        let primary_tracks = self
            .tracks
            .iter()
            .filter(|track| {
                track.role == TrackRole::Primary && track.required && track.identity_defining
            })
            .collect::<Vec<_>>();
        let has_one_bound_primary = primary_relations.len() == 1
            && primary_tracks.len() == 1
            && primary_tracks[0]
                .supports_relation_ids
                .contains(&primary_relations[0].relation_id);
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
        let phase_ids = self
            .phases
            .iter()
            .map(|phase| phase.phase_id.as_str())
            .collect::<HashSet<_>>();
        let complete_relations = self.relations.iter().all(|relation| {
            !relation.relation_id.trim().is_empty()
                && !relation.operator_id.trim().is_empty()
                && !relation.unit.trim().is_empty()
                && !relation.scope.trim().is_empty()
                && !relation.semantic_statement.trim().is_empty()
                && !relation.evidence_rationale.trim().is_empty()
                && !relation.expected_pattern.trim().is_empty()
                && !relation.inputs.is_empty()
                && relation
                    .inputs
                    .iter()
                    .all(|input| !input.source.trim().is_empty() && !input.unit.trim().is_empty())
                && relation.required_phase_id.as_ref().is_none_or(|phase_id| {
                    !phase_id.trim().is_empty() && phase_ids.contains(phase_id.as_str())
                })
                && (relation.phase_alignment == RelationPhaseAlignment::Unconstrained
                    || relation.required_phase_id.is_some())
                && (relation.side_policy == RelationSidePolicy::Declared
                    || relation.inputs.iter().any(|input| {
                        input.source.starts_with("left_") || input.source.starts_with("right_")
                    }))
                && (relation.temporal_pattern != RelationTemporalPattern::SustainedMagnitude
                    || relation.minimum_magnitude_milli > 0)
        });
        let complete_tracks = self.tracks.iter().all(|track| {
            !track.track_id.trim().is_empty()
                && !track.source.trim().is_empty()
                && !track.evidence_rationale.trim().is_empty()
                && !track.supports_relation_ids.is_empty()
                && track
                    .supports_relation_ids
                    .iter()
                    .collect::<HashSet<_>>()
                    .len()
                    == track.supports_relation_ids.len()
                && track
                    .supports_relation_ids
                    .iter()
                    .all(|relation_id| relation_ids.contains(relation_id.as_str()))
        });
        let relations_have_tracks = self.relations.iter().all(|relation| {
            self.tracks
                .iter()
                .any(|track| track.supports_relation_ids.contains(&relation.relation_id))
        });
        let complete_consensus = self.rep_consensus.minimum_observed_frames > 0
            && !self.rep_consensus.required_primary_tracks.is_empty()
            && self
                .rep_consensus
                .required_primary_tracks
                .iter()
                .all(|track_id| track_ids.contains(track_id.as_str()));
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
                .limited_claims
                .iter()
                .all(|claim| !claim.trim().is_empty())
            && self
                .supported_views
                .iter()
                .all(|view| !view.trim().is_empty())
            && !self.recommended_view.trim().is_empty()
            && self.supported_views.contains(&self.recommended_view)
            && self.phases.iter().all(|phase| {
                !phase.phase_id.trim().is_empty()
                    && !phase.from.trim().is_empty()
                    && !phase.to.trim().is_empty()
            });
        let view_plans_are_complete = self.view_observation_plans.len()
            == self.supported_views.len()
            && self.supported_views.iter().all(|view| {
                self.view_observation_plans
                    .iter()
                    .filter(|plan| &plan.view_id == view)
                    .count()
                    == 1
            })
            && self
                .view_observation_plans
                .iter()
                .all(|plan| plan.validate(&relation_ids, &self.relations));
        if self.schema_version != "maxpower.action-motion-definition/v1"
            || !self.executable_leaf
            || !complete_identity
            || !has_one_bound_primary
            || !complete_boundary
            || !complete_relations
            || !complete_tracks
            || !relations_have_tracks
            || !complete_consensus
            || !required_roles
            || !unique_nonempty_lists
            || self.phases.is_empty()
            || self.allowed_claims.is_empty()
            || self.supported_views.is_empty()
            || !view_plans_are_complete
        {
            return Err(ActionMotionError::DefinitionBuildFailure {
                action_id: self.action_id.clone(),
                detail: "complete executable leaf semantics are required".into(),
            });
        }
        Ok(())
    }
}

/// The action-specific topology parameters consumed by the RepEngine before
/// a candidate is sealed.  Amplitudes use milli local-scale units so action
/// assets remain deterministic and equality/hashable across native and WASM.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepTopologyProfile {
    pub topology_id: String,
    pub primary_relation_id: String,
    /// Modules selected by this exact action × view topology.  The compiler
    /// verifies this graph before a runtime profile can be installed; actions
    /// never acquire hidden action-name branches in the module registry.
    pub algorithm_module_ids: Vec<String>,
    pub direction_policy: LocalDirectionPolicy,
    pub start_threshold_milli: u16,
    pub minimum_excursion_milli: u16,
    pub turnaround_hysteresis_milli: u16,
    pub return_tolerance_milli: u16,
    /// Maximum visible cross-axis span for an identity-defining constrained
    /// path. It is consumed only when the action declares a
    /// `constrained_path_deviation` relation; keeping it in the exact
    /// action×view topology makes the admission corridor data-driven.
    pub maximum_constrained_path_deviation_milli: u16,
    pub ready_tolerance_milli: u16,
    pub minimum_phase_dwell_ms: u64,
    pub maximum_gap_ms: u64,
    pub minimum_rep_duration_ms: u64,
    pub maximum_rep_duration_ms: u64,
}

impl RepTopologyProfile {
    pub fn start_threshold(&self) -> f32 {
        f32::from(self.start_threshold_milli) / 1_000.0
    }
    pub fn minimum_excursion(&self) -> f32 {
        f32::from(self.minimum_excursion_milli) / 1_000.0
    }
    pub fn turnaround_hysteresis(&self) -> f32 {
        f32::from(self.turnaround_hysteresis_milli) / 1_000.0
    }
    pub fn return_tolerance(&self) -> f32 {
        f32::from(self.return_tolerance_milli) / 1_000.0
    }
    pub fn maximum_constrained_path_deviation(&self) -> f32 {
        f32::from(self.maximum_constrained_path_deviation_milli) / 1_000.0
    }

    fn is_complete(&self) -> bool {
        !self.topology_id.trim().is_empty()
            && !self.primary_relation_id.trim().is_empty()
            && !self.algorithm_module_ids.is_empty()
            && self
                .algorithm_module_ids
                .iter()
                .all(|module_id| !module_id.trim().is_empty())
            && self
                .algorithm_module_ids
                .iter()
                .collect::<HashSet<_>>()
                .len()
                == self.algorithm_module_ids.len()
            && self.start_threshold_milli > 0
            && self.minimum_excursion_milli >= self.start_threshold_milli
            && self.turnaround_hysteresis_milli > 0
            && self.return_tolerance_milli > 0
            && self.maximum_constrained_path_deviation_milli > 0
            && self.ready_tolerance_milli > 0
            && self.minimum_phase_dwell_ms > 0
            && self.maximum_gap_ms > 0
            && self.minimum_rep_duration_ms >= self.minimum_phase_dwell_ms
            && self.maximum_rep_duration_ms > self.minimum_rep_duration_ms
    }
}

/// A positive/negative local-axis convention is never inferred from screen
/// pixels.  Most round-trip actions are sign-invariant; fixed signs are only
/// legal when the exact asset explicitly declares them.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalDirectionPolicy {
    SignInvariant,
    PreparationToEffortPositive,
    PreparationToEffortNegative,
}

/// View-specific observation contract.  It records what may become evidence,
/// what must not be used, and which candidate topology is permitted for this
/// exact projection.  It is a semantic projection contract, not an accuracy
/// or release tier.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewObservationPlan {
    pub view_id: String,
    pub visible_relation_ids: Vec<String>,
    #[serde(default)]
    pub prohibited_relation_ids: Vec<String>,
    #[serde(default)]
    pub prohibited_signal_sources: Vec<String>,
    #[serde(default)]
    pub occlusion_risks: Vec<String>,
    pub primary_relation_candidates: Vec<String>,
    pub side_observability: String,
    pub equipment_observability: String,
    pub support_observability: String,
    pub local_axis_policy: String,
    /// The action-local image-plane axis selected before the set starts.
    /// Its sign never defines action identity; it only chooses which measured
    /// component the plan-authorized primary anchor contributes to candidate
    /// segmentation.
    pub preparation_to_effort_direction: crate::LocalActionAxisDirection,
    #[serde(default)]
    pub dimension_availability: Vec<String>,
    pub rep_topology: RepTopologyProfile,
}

impl ViewObservationPlan {
    fn validate(
        &self,
        relation_ids: &HashSet<&str>,
        relations: &[MotionRelationDefinition],
    ) -> bool {
        let known_relation = |relation_id: &String| relation_ids.contains(relation_id.as_str());
        let visible = self.visible_relation_ids.iter().all(known_relation)
            && !self.visible_relation_ids.is_empty();
        let prohibited = self.prohibited_relation_ids.iter().all(known_relation)
            && self
                .prohibited_relation_ids
                .iter()
                .all(|relation_id| !self.visible_relation_ids.contains(relation_id));
        let primary_relation = relations.iter().find(|relation| {
            relation.role == MotionRole::TaskPrimary
                && relation.required
                && relation.identity_defining
        });
        let primary_is_declared = primary_relation.is_some_and(|relation| {
            let declared_primary = self
                .primary_relation_candidates
                .contains(&relation.relation_id);
            let explicitly_unobservable_primary = self.primary_relation_candidates.is_empty()
                && !self.visible_relation_ids.contains(&relation.relation_id)
                && self.prohibited_relation_ids.contains(&relation.relation_id);
            self.rep_topology.primary_relation_id == relation.relation_id
                && (declared_primary || explicitly_unobservable_primary)
        });
        !self.view_id.trim().is_empty()
            && visible
            && prohibited
            && primary_is_declared
            && !self.side_observability.trim().is_empty()
            && !self.equipment_observability.trim().is_empty()
            && !self.support_observability.trim().is_empty()
            && !self.local_axis_policy.trim().is_empty()
            && self.rep_topology.is_complete()
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

/// A reusable runtime algorithm contract.  It is intentionally independent of
/// action ID: an ActionMotionDefinition selects a compatible module graph and
/// parameters, while the descriptor states what evidence the module may
/// consume and what facts it may produce.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlgorithmModuleCategory {
    PoseRelation,
    LocalCoordinate,
    RepTopology,
    CandidateAdmission,
    BoundaryRefinement,
    EquipmentObservation,
    EquipmentFusion,
    PostSealFeature,
    QualityRule,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactMissingPolicy {
    RefusePlan,
    CannotJudge,
    NeedsReview,
    RejectCandidate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactConflictPolicy {
    RefusePlan,
    PreserveChannels,
    RejectCandidate,
    CannotJudge,
}

/// Frame-local availability of one typed module input.  This is deliberately
/// smaller than a motion fact value: the reusable algorithm layer only needs
/// to decide whether the fact is causally admissible before an implementation
/// reads its payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AlgorithmFactState {
    Observed,
    Missing,
    Conflict,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlgorithmFactObservation {
    pub fact_id: String,
    pub value_type: MotionValueType,
    pub state: AlgorithmFactState,
    pub age_ms: u64,
}

/// Executable result of a module's evidence policy.  A descriptor is not
/// considered an algorithm contract until runtime invocations pass through
/// this decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AlgorithmInvocationDisposition {
    Execute,
    RefusePlan,
    CannotJudge,
    NeedsReview,
    RejectCandidate,
    PreserveConflict,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlgorithmFactContract {
    pub fact_id: String,
    pub value_type: MotionValueType,
    pub required: bool,
    /// A fact may only be consumed for recognition or quality when it carries
    /// the complete causal evidence envelope.  This is checked at plan
    /// compilation so a numeric value cannot silently become judgeable.
    pub evidence: FactEvidenceContract,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FactEvidenceContract {
    pub source_lineage: bool,
    pub event_clock: bool,
    pub causal_age: bool,
    pub coverage: bool,
    pub confidence: bool,
    pub uncertainty: bool,
}

impl FactEvidenceContract {
    fn complete() -> Self {
        Self {
            source_lineage: true,
            event_clock: true,
            causal_age: true,
            coverage: true,
            confidence: true,
            uncertainty: true,
        }
    }

    fn is_complete(&self) -> bool {
        self.source_lineage
            && self.event_clock
            && self.causal_age
            && self.coverage
            && self.confidence
            && self.uncertainty
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlgorithmModuleDescriptor {
    pub module_id: String,
    pub version: String,
    pub category: AlgorithmModuleCategory,
    pub applicable_topologies: Vec<String>,
    pub required_inputs: Vec<AlgorithmFactContract>,
    pub produced_facts: Vec<AlgorithmFactContract>,
    pub maximum_causal_age_ms: u64,
    pub missing_policy: FactMissingPolicy,
    pub conflict_policy: FactConflictPolicy,
    pub parameter_schema: String,
    pub latency_budget_ms: u64,
    pub allowed_conclusions: Vec<String>,
}

impl AlgorithmModuleDescriptor {
    /// Applies this module's declared age, missing and conflict policies to a
    /// concrete invocation. Unknown or mistyped facts are structural input
    /// errors; stale facts follow the declared missing-evidence policy.
    pub fn evaluate_invocation(
        &self,
        observations: &[AlgorithmFactObservation],
    ) -> AlgorithmInvocationDisposition {
        let mut missing = false;
        let mut conflict = false;
        for required in self.required_inputs.iter().filter(|input| input.required) {
            let Some(observed) = observations
                .iter()
                .find(|observed| observed.fact_id == required.fact_id)
            else {
                missing = true;
                continue;
            };
            if observed.value_type != required.value_type {
                return AlgorithmInvocationDisposition::RefusePlan;
            }
            match observed.state {
                AlgorithmFactState::Conflict => conflict = true,
                AlgorithmFactState::Missing => missing = true,
                AlgorithmFactState::Observed if observed.age_ms > self.maximum_causal_age_ms => {
                    missing = true;
                }
                AlgorithmFactState::Observed => {}
            }
        }
        if conflict {
            return match self.conflict_policy {
                FactConflictPolicy::RefusePlan => AlgorithmInvocationDisposition::RefusePlan,
                FactConflictPolicy::PreserveChannels => {
                    AlgorithmInvocationDisposition::PreserveConflict
                }
                FactConflictPolicy::RejectCandidate => {
                    AlgorithmInvocationDisposition::RejectCandidate
                }
                FactConflictPolicy::CannotJudge => AlgorithmInvocationDisposition::CannotJudge,
            };
        }
        if missing {
            return match self.missing_policy {
                FactMissingPolicy::RefusePlan => AlgorithmInvocationDisposition::RefusePlan,
                FactMissingPolicy::CannotJudge => AlgorithmInvocationDisposition::CannotJudge,
                FactMissingPolicy::NeedsReview => AlgorithmInvocationDisposition::NeedsReview,
                FactMissingPolicy::RejectCandidate => {
                    AlgorithmInvocationDisposition::RejectCandidate
                }
            };
        }
        AlgorithmInvocationDisposition::Execute
    }

    pub fn allows_conclusion(&self, conclusion: &str) -> bool {
        self.allowed_conclusions
            .iter()
            .any(|allowed| allowed == conclusion)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlgorithmModuleRegistry {
    descriptors: HashMap<String, AlgorithmModuleDescriptor>,
}

impl AlgorithmModuleRegistry {
    pub fn empty() -> Self {
        Self {
            descriptors: HashMap::new(),
        }
    }

    pub fn from_descriptors(
        descriptors: Vec<AlgorithmModuleDescriptor>,
    ) -> Result<Self, ActionMotionError> {
        let mut registry = Self::empty();
        for descriptor in descriptors {
            registry.register(descriptor)?;
        }
        Ok(registry)
    }

    pub fn register(
        &mut self,
        descriptor: AlgorithmModuleDescriptor,
    ) -> Result<(), ActionMotionError> {
        if descriptor.module_id.trim().is_empty()
            || descriptor.version.trim().is_empty()
            || descriptor.applicable_topologies.is_empty()
            || descriptor.parameter_schema.trim().is_empty()
            || descriptor.latency_budget_ms == 0
            || descriptor.maximum_causal_age_ms > descriptor.latency_budget_ms
            || descriptor.produced_facts.is_empty()
            || descriptor
                .required_inputs
                .iter()
                .chain(descriptor.produced_facts.iter())
                .any(|fact| fact.fact_id.trim().is_empty() || !fact.evidence.is_complete())
        {
            return Err(ActionMotionError::InvalidAlgorithmModuleContract {
                module_id: descriptor.module_id,
            });
        }
        if self.descriptors.contains_key(&descriptor.module_id) {
            return Err(ActionMotionError::DuplicateAlgorithmModule {
                module_id: descriptor.module_id,
            });
        }
        self.descriptors
            .insert(descriptor.module_id.clone(), descriptor);
        Ok(())
    }

    pub fn standard() -> Self {
        let descriptor =
            |module_id: &str,
             category,
             applicable_topologies: &[&str],
             required_inputs: &[(&str, MotionValueType)],
             produced_facts: &[(&str, MotionValueType)],
             maximum_causal_age_ms,
             missing_policy,
             conflict_policy,
             allowed_conclusions: &[&str]| AlgorithmModuleDescriptor {
                module_id: module_id.into(),
                version: "v1".into(),
                category,
                applicable_topologies: applicable_topologies
                    .iter()
                    .map(|value| (*value).into())
                    .collect(),
                required_inputs: required_inputs
                    .iter()
                    .map(|(fact_id, value_type)| AlgorithmFactContract {
                        fact_id: (*fact_id).into(),
                        value_type: *value_type,
                        required: true,
                        evidence: FactEvidenceContract::complete(),
                    })
                    .collect(),
                produced_facts: produced_facts
                    .iter()
                    .map(|(fact_id, value_type)| AlgorithmFactContract {
                        fact_id: (*fact_id).into(),
                        value_type: *value_type,
                        required: true,
                        evidence: FactEvidenceContract::complete(),
                    })
                    .collect(),
                maximum_causal_age_ms,
                missing_policy,
                conflict_policy,
                parameter_schema: format!("maxpower.algorithm-module/{module_id}/v1"),
                latency_budget_ms: maximum_causal_age_ms.max(16),
                allowed_conclusions: allowed_conclusions
                    .iter()
                    .map(|value| (*value).into())
                    .collect(),
            };
        let topology_ids = [
            "bilateral_synchronous_cycle/v1",
            "independent_bilateral_cycle/v1",
            "unilateral_cycle/v1",
            "alternating_cycle/v1",
            "pose_primary_cycle/v1",
            "hold_interval/v1",
            "locomotion_step_cycle/v1",
            "multi_stage_cycle/v1",
        ];
        let values = vec![
            descriptor(
                "pose_relation",
                AlgorithmModuleCategory::PoseRelation,
                &topology_ids,
                &[("canonical_pose", MotionValueType::Point2d)],
                &[("pose_relation", MotionValueType::Scalar)],
                0,
                FactMissingPolicy::CannotJudge,
                FactConflictPolicy::PreserveChannels,
                &[],
            ),
            descriptor(
                "local_coordinate",
                AlgorithmModuleCategory::LocalCoordinate,
                &topology_ids,
                &[("pose_relation", MotionValueType::Scalar)],
                &[("local_coordinate", MotionValueType::Scalar)],
                0,
                FactMissingPolicy::NeedsReview,
                FactConflictPolicy::PreserveChannels,
                &[],
            ),
            descriptor(
                "equipment_observation",
                AlgorithmModuleCategory::EquipmentObservation,
                &topology_ids,
                &[("raw_equipment", MotionValueType::Point2d)],
                &[("equipment_geometry", MotionValueType::Point2d)],
                0,
                FactMissingPolicy::CannotJudge,
                FactConflictPolicy::PreserveChannels,
                &[],
            ),
            descriptor(
                "equipment_fusion",
                AlgorithmModuleCategory::EquipmentFusion,
                &topology_ids,
                &[
                    ("pose_relation", MotionValueType::Scalar),
                    ("equipment_geometry", MotionValueType::Point2d),
                ],
                &[("subject_equipment_association", MotionValueType::Category)],
                180,
                FactMissingPolicy::CannotJudge,
                FactConflictPolicy::PreserveChannels,
                &[],
            ),
            descriptor(
                "rep_topology",
                AlgorithmModuleCategory::RepTopology,
                &topology_ids,
                &[("local_coordinate", MotionValueType::Scalar)],
                &[("raw_rep_candidate", MotionValueType::Category)],
                250,
                FactMissingPolicy::NeedsReview,
                FactConflictPolicy::RejectCandidate,
                &[],
            ),
            descriptor(
                "candidate_admission",
                AlgorithmModuleCategory::CandidateAdmission,
                &topology_ids,
                &[("raw_rep_candidate", MotionValueType::Category)],
                &[("sealed_rep", MotionValueType::Category)],
                250,
                FactMissingPolicy::RejectCandidate,
                FactConflictPolicy::RejectCandidate,
                &["confirmed_rep", "needs_review", "rejected_candidate"],
            ),
            descriptor(
                "boundary_refinement",
                AlgorithmModuleCategory::BoundaryRefinement,
                &topology_ids,
                &[("sealed_rep", MotionValueType::Category)],
                &[("causal_rep_boundary", MotionValueType::Scalar)],
                250,
                FactMissingPolicy::CannotJudge,
                FactConflictPolicy::PreserveChannels,
                &[],
            ),
            descriptor(
                "post_seal_feature",
                AlgorithmModuleCategory::PostSealFeature,
                &topology_ids,
                &[("sealed_rep", MotionValueType::Category)],
                &[("rep_feature", MotionValueType::Scalar)],
                0,
                FactMissingPolicy::CannotJudge,
                FactConflictPolicy::PreserveChannels,
                &[],
            ),
            descriptor(
                "quality_rule",
                AlgorithmModuleCategory::QualityRule,
                &topology_ids,
                &[("rep_feature", MotionValueType::Scalar)],
                &[("dimension_conclusion", MotionValueType::Category)],
                0,
                FactMissingPolicy::CannotJudge,
                FactConflictPolicy::CannotJudge,
                &["cannot_judge", "not_applicable", "observed_fact"],
            ),
        ];
        Self::from_descriptors(values)
            .expect("the built-in algorithm-module registry must be internally valid")
    }

    pub fn descriptor(&self, module_id: &str) -> Option<&AlgorithmModuleDescriptor> {
        self.descriptors.get(module_id)
    }

    fn compile_graph(
        &self,
        topology: &RepTopologyProfile,
        source_requirement: OperatorSourceRequirement,
    ) -> Result<Vec<AlgorithmModuleDescriptor>, ActionMotionError> {
        let needs_equipment = matches!(
            source_requirement,
            OperatorSourceRequirement::CurrentMeasuredEquipment
                | OperatorSourceRequirement::CurrentMeasuredMixed
        );
        let mandatory_modules = [
            "pose_relation",
            "local_coordinate",
            "rep_topology",
            "candidate_admission",
            "boundary_refinement",
            "post_seal_feature",
            "quality_rule",
        ];
        for module_id in mandatory_modules {
            if !topology
                .algorithm_module_ids
                .iter()
                .any(|id| id == module_id)
            {
                return Err(ActionMotionError::RequiredAlgorithmModuleNotSelected {
                    topology_id: topology.topology_id.clone(),
                    module_id: module_id.into(),
                });
            }
        }
        if needs_equipment {
            for module_id in ["equipment_observation", "equipment_fusion"] {
                if !topology
                    .algorithm_module_ids
                    .iter()
                    .any(|id| id == module_id)
                {
                    return Err(ActionMotionError::RequiredAlgorithmModuleNotSelected {
                        topology_id: topology.topology_id.clone(),
                        module_id: module_id.into(),
                    });
                }
            }
        }
        let mut selected = topology
            .algorithm_module_ids
            .iter()
            .map(|module_id| {
                self.descriptor(module_id).cloned().ok_or_else(|| {
                    ActionMotionError::MissingAlgorithmModule {
                        module_id: module_id.clone(),
                    }
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        for descriptor in &mut selected {
            if !descriptor
                .applicable_topologies
                .iter()
                .any(|candidate| candidate == &topology.topology_id)
            {
                return Err(ActionMotionError::IncompatibleAlgorithmTopology {
                    module_id: descriptor.module_id.clone(),
                    topology_id: topology.topology_id.clone(),
                });
            }
            if matches!(
                descriptor.module_id.as_str(),
                "local_coordinate" | "rep_topology"
            ) && needs_equipment
            {
                descriptor.required_inputs.push(AlgorithmFactContract {
                    fact_id: "subject_equipment_association".into(),
                    value_type: MotionValueType::Category,
                    required: true,
                    evidence: FactEvidenceContract::complete(),
                });
            }
        }
        let mut all_producers = HashMap::<String, MotionValueType>::new();
        for descriptor in &selected {
            for output in descriptor
                .produced_facts
                .iter()
                .filter(|output| output.required)
            {
                if all_producers
                    .insert(output.fact_id.clone(), output.value_type)
                    .is_some()
                {
                    return Err(ActionMotionError::DuplicateAlgorithmFactProducer {
                        fact_id: output.fact_id.clone(),
                    });
                }
            }
        }
        let mut produced = HashMap::<String, MotionValueType>::new();
        let roots = HashMap::from([
            ("canonical_pose".to_string(), MotionValueType::Point2d),
            ("raw_equipment".to_string(), MotionValueType::Point2d),
        ]);
        let mut graph = Vec::with_capacity(selected.len());
        while !selected.is_empty() {
            let ready_index = selected.iter().position(|descriptor| {
                descriptor
                    .required_inputs
                    .iter()
                    .filter(|input| input.required)
                    .all(|input| {
                        produced
                            .get(&input.fact_id)
                            .or_else(|| roots.get(&input.fact_id))
                            == Some(&input.value_type)
                    })
            });
            if let Some(index) = ready_index {
                let descriptor = selected.remove(index);
                for output in descriptor
                    .produced_facts
                    .iter()
                    .filter(|output| output.required)
                {
                    produced.insert(output.fact_id.clone(), output.value_type);
                }
                graph.push(descriptor);
                continue;
            }
            let descriptor = &selected[0];
            let missing = descriptor
                .required_inputs
                .iter()
                .filter(|input| input.required)
                .find(|input| {
                    !roots.contains_key(&input.fact_id)
                        && !all_producers.contains_key(&input.fact_id)
                });
            if let Some(input) = missing {
                return Err(ActionMotionError::AlgorithmFactHasNoProducer {
                    module_id: descriptor.module_id.clone(),
                    fact_id: input.fact_id.clone(),
                });
            }
            return Err(ActionMotionError::AlgorithmDependencyCycle {
                module_ids: selected
                    .iter()
                    .map(|descriptor| descriptor.module_id.clone())
                    .collect(),
            });
        }
        Ok(graph)
    }
}

impl Default for AlgorithmModuleRegistry {
    fn default() -> Self {
        Self::standard()
    }
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
    /// Optional declared action phase whose timing constrains this relation.
    /// The compiler verifies that the phase exists in the same definition.
    #[serde(default)]
    pub required_phase_id: Option<String>,
    #[serde(default)]
    pub phase_alignment: RelationPhaseAlignment,
    #[serde(default)]
    pub side_policy: RelationSidePolicy,
    #[serde(default)]
    pub temporal_pattern: RelationTemporalPattern,
    #[serde(default)]
    pub minimum_magnitude_milli: u16,
    #[serde(default)]
    pub semantic_statement: String,
    #[serde(default)]
    pub evidence_rationale: String,
    #[serde(default)]
    pub expected_pattern: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationPhaseAlignment {
    #[default]
    Unconstrained,
    AtPrimaryTurnaround,
    AfterPrimaryTurnaround,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationSidePolicy {
    #[default]
    Declared,
    ActiveLeadSide,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationTemporalPattern {
    #[default]
    RoundTrip,
    CrossZeroRoundTrip,
    SustainedMagnitude,
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
    pub side_scope: String,
    #[serde(default)]
    pub supports_relation_ids: Vec<String>,
    #[serde(default)]
    pub evidence_rationale: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepConsensusMode {
    SharedRigid,
    BilateralSynchronous,
    IndependentBilateral,
    Unilateral,
    Alternating,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepConflictPolicy {
    RejectConfirmedRep,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepConsensusPolicy {
    pub mode: RepConsensusMode,
    pub required_primary_tracks: Vec<String>,
    pub required_sides: Vec<String>,
    pub minimum_observed_frames: u8,
    pub conflict_policy: RepConflictPolicy,
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
                    "cable_handle_center",
                    "landmine_load_point",
                    "trap_bar_center",
                    "kettlebell_center",
                    "band_attachment_point",
                    "weight_plate_center",
                    "single_load_center",
                    "fixed_support_anchor",
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
                "projected_shoulder_rotation",
                &[
                    MotionValueType::Point2d,
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
                "relative_vertical_offset",
                &[MotionValueType::Point2d, MotionValueType::Point2d],
                MotionValueType::Scalar,
                &["local_scale_ratio"],
                POSE_POINTS,
            ),
            operator(
                "relative_horizontal_offset",
                &[MotionValueType::Point2d, MotionValueType::Point2d],
                MotionValueType::Scalar,
                &["local_scale_ratio"],
                POSE_POINTS,
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
    pub required_phase_id: Option<String>,
    pub phase_alignment: RelationPhaseAlignment,
    pub side_policy: RelationSidePolicy,
    pub temporal_pattern: RelationTemporalPattern,
    pub minimum_magnitude_milli: u16,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionObservationPlan {
    pub action_id: String,
    pub definition_id: String,
    pub definition_hash: String,
    /// Exact equipment/posture identity carried from the signed action
    /// definition. Runtime binding consumes this field directly; it must not
    /// reconstruct action semantics from a legacy assessment Bundle or a host
    /// profile selection.
    pub exact_identity: ExactActionIdentity,
    pub capture_view: String,
    pub projection: ViewProjectionPlan,
    pub view_observation: ViewObservationPlan,
    pub rep_topology: RepTopologyProfile,
    /// The only visual equipment provider permitted for this frozen exact
    /// action context. `None` means that the identity relation is pose-only;
    /// it does not give a host permission to choose a fallback detector.
    pub equipment_provider: Option<EquipmentProviderRequirement>,
    pub algorithm_modules: Vec<AlgorithmModuleDescriptor>,
    pub relations: Vec<CompiledMotionRelation>,
    pub rep_consensus: RepConsensusPolicy,
    pub channels: Vec<ChannelClockPolicy>,
    pub rep_boundary: RepBoundarySemantics,
    pub phases: Vec<PhaseSemantics>,
    pub allowed_claims: Vec<String>,
    pub rep_authority: Option<String>,
    pub cannot_judge_dimensions: Vec<String>,
    pub plan_hash: String,
}

/// Provider selection materialized by the compiler, rather than supplied by a
/// web/native caller. The provider itself still produces only frame-local raw
/// observations; fusion and Rep admission remain separate runtime stages.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EquipmentProviderRequirement {
    pub topology: EquipmentProviderTopology,
    pub provider_id: EquipmentProviderId,
    /// `false` means the provider is still Rust-selected and observable, but
    /// its facts only corroborate a pose-primary Rep. Missing optional
    /// equipment must never block or manufacture that Rep.
    pub required_for_rep: bool,
}

pub struct ActionMotionCompiler {
    registry: OperatorRegistry,
    modules: AlgorithmModuleRegistry,
    equipment_providers: EquipmentProviderRegistry,
}
impl ActionMotionCompiler {
    pub fn new(registry: OperatorRegistry) -> Self {
        Self {
            registry,
            modules: AlgorithmModuleRegistry::standard(),
            equipment_providers: EquipmentProviderRegistry::standard(),
        }
    }

    pub fn with_modules(registry: OperatorRegistry, modules: AlgorithmModuleRegistry) -> Self {
        Self {
            registry,
            modules,
            equipment_providers: EquipmentProviderRegistry::standard(),
        }
    }

    /// Test and embedding seam for an explicitly installed provider registry.
    /// A missing provider is a compile-time context refusal, never a host-side
    /// invitation to substitute wrist or pose geometry.
    pub fn with_modules_and_equipment_providers(
        registry: OperatorRegistry,
        modules: AlgorithmModuleRegistry,
        equipment_providers: EquipmentProviderRegistry,
    ) -> Self {
        Self {
            registry,
            modules,
            equipment_providers,
        }
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
            return Err(ActionMotionError::UnsupportedView {
                action_id: definition.action_id.clone(),
                view: view.into(),
            });
        }
        let view_observation = definition
            .view_observation_plans
            .iter()
            .find(|candidate| candidate.view_id == view)
            .ok_or_else(|| ActionMotionError::MissingViewObservationPlan {
                action_id: definition.action_id.clone(),
                view: view.into(),
            })?
            .clone();
        let projection = project_definition(definition, view, &view_observation);
        let mut relations = Vec::new();
        for relation in &definition.relations {
            let is_visible = view_observation
                .visible_relation_ids
                .contains(&relation.relation_id);
            let uses_prohibited_signal = relation.inputs.iter().any(|input| {
                view_observation
                    .prohibited_signal_sources
                    .contains(&input.source)
            });
            if (!is_visible || uses_prohibited_signal)
                && relation.required
                && relation.identity_defining
            {
                return Err(ActionMotionError::IdentityRelationNotObservable {
                    action_id: definition.action_id.clone(),
                    view: view.into(),
                    relation_id: relation.relation_id.clone(),
                });
            }
            let Some(contract) = self.registry.contracts.get(&relation.operator_id) else {
                if relation.required && relation.identity_defining {
                    return Err(ActionMotionError::MissingOperator {
                        action_id: definition.action_id.clone(),
                        operator_id: relation.operator_id.clone(),
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
                // Mixed-capability operators such as relative_distance can
                // accept either pose or equipment points. The concrete
                // relation inputs—not the operator's full permitted-source
                // catalog—own runtime source authority.
                source_requirement: source_requirement_for_inputs(&relation.inputs),
                coverage_policy: contract.coverage_policy,
                confidence_policy: contract.confidence_policy,
                judgeability: if relation.required && relation.identity_defining && is_visible {
                    FeatureJudgeability::RequiredForRep
                } else {
                    FeatureJudgeability::DimensionScopedCannotJudge
                },
                required_phase_id: relation.required_phase_id.clone(),
                phase_alignment: relation.phase_alignment,
                side_policy: relation.side_policy,
                temporal_pattern: relation.temporal_pattern,
                minimum_magnitude_milli: relation.minimum_magnitude_milli,
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
            return Err(ActionMotionError::DefinitionBuildFailure {
                action_id: definition.action_id.clone(),
                detail: "identity-defining relation is not computable".into(),
            });
        }
        let primary_relation = relations
            .iter()
            .find(|relation| {
                relation.role == MotionRole::TaskPrimary
                    && relation.judgeability == FeatureJudgeability::RequiredForRep
            })
            .ok_or_else(|| ActionMotionError::IdentityRelationNotObservable {
                action_id: definition.action_id.clone(),
                view: view.into(),
                relation_id: view_observation.rep_topology.primary_relation_id.clone(),
            })?;
        if primary_relation.relation_id != view_observation.rep_topology.primary_relation_id
            || !view_observation
                .primary_relation_candidates
                .contains(&primary_relation.relation_id)
        {
            return Err(ActionMotionError::TopologyPrimaryConflict {
                action_id: definition.action_id.clone(),
                view: view.into(),
                relation_id: primary_relation.relation_id.clone(),
            });
        }
        let algorithm_modules = self.modules.compile_graph(
            &view_observation.rep_topology,
            primary_relation.source_requirement,
        )?;
        let equipment_required_for_rep = requires_measured_equipment(primary_relation);
        let provider_topology =
            equipment_provider_topology(&definition.exact_identity.equipment_topology);
        let optional_visible_equipment = relations.iter().any(|relation| {
            relation.judgeability == FeatureJudgeability::DimensionScopedCannotJudge
                && relation
                    .inputs
                    .iter()
                    .any(|input| equipment_source(&input.source))
        });
        let equipment_provider = if equipment_required_for_rep {
            Some({
                let topology = provider_topology.ok_or_else(|| {
                    ActionMotionError::MissingEquipmentProvider {
                        action_id: definition.action_id.clone(),
                        topology: definition.exact_identity.equipment_topology.clone(),
                    }
                })?;
                let provider_id = self.equipment_providers.resolve(topology).ok_or_else(|| {
                    ActionMotionError::MissingEquipmentProvider {
                        action_id: definition.action_id.clone(),
                        topology: definition.exact_identity.equipment_topology.clone(),
                    }
                })?;
                Ok(EquipmentProviderRequirement {
                    topology,
                    provider_id,
                    required_for_rep: true,
                })
            })
        } else if optional_visible_equipment {
            provider_topology
                .and_then(|topology| {
                    self.equipment_providers
                        .resolve(topology)
                        .map(|provider_id| EquipmentProviderRequirement {
                            topology,
                            provider_id,
                            required_for_rep: false,
                        })
                })
                .map(Ok)
        } else {
            None
        }
        .transpose()?;
        let provider_tracks_equipment = matches!(
            definition.exact_identity.equipment_topology.as_str(),
            "free_rigid_barbell"
                | "smith_guided_bar"
                | "independent_dumbbell"
                | "constrained_machine_handle"
                | "none"
                | "bodyweight_station"
        );
        let cannot_judge_dimensions = if provider_tracks_equipment {
            Vec::new()
        } else {
            definition
                .allowed_claims
                .iter()
                .filter(|claim| claim.contains("trajectory") || claim.contains("equipment"))
                .cloned()
                .collect()
        };
        Ok(plan(
            definition,
            projection,
            view_observation,
            equipment_provider,
            algorithm_modules,
            relations,
            Some(definition.rep_boundary.turnaround.clone()),
            cannot_judge_dimensions,
        ))
    }
}

fn project_definition(
    definition: &ActionMotionDefinition,
    view: &str,
    observation: &ViewObservationPlan,
) -> ViewProjectionPlan {
    let relations = definition
        .relations
        .iter()
        .map(|relation| {
            let observable = observation
                .visible_relation_ids
                .contains(&relation.relation_id);
            ViewProjectedRelation {
                relation_id: relation.relation_id.clone(),
                semantic_role: relation.role,
                observable,
                refusal_reason: (!observable).then(|| {
                    format!(
                        "relation {} is not declared observable in exact view {view}",
                        relation.relation_id
                    )
                }),
            }
        })
        .collect::<Vec<_>>();
    let projection_hash = stable_hash(&(
        definition.definition_id.as_str(),
        definition.computed_hash(),
        &definition.exact_identity,
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
        observation,
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
    view_observation: ViewObservationPlan,
    equipment_provider: Option<EquipmentProviderRequirement>,
    algorithm_modules: Vec<AlgorithmModuleDescriptor>,
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
        &view_observation,
        &equipment_provider,
        &algorithm_modules,
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
        &definition.rep_consensus,
        &definition.rep_boundary,
        &definition.phases,
        &definition.allowed_claims,
    ));
    ActionObservationPlan {
        action_id: definition.action_id.clone(),
        definition_id: definition.definition_id.clone(),
        definition_hash: definition.computed_hash(),
        exact_identity: definition.exact_identity.clone(),
        capture_view,
        projection,
        rep_topology: view_observation.rep_topology.clone(),
        view_observation,
        equipment_provider,
        algorithm_modules,
        relations,
        rep_consensus: definition.rep_consensus.clone(),
        channels,
        rep_boundary: definition.rep_boundary.clone(),
        phases: definition.phases.clone(),
        allowed_claims: definition.allowed_claims.clone(),
        rep_authority,
        cannot_judge_dimensions,
        plan_hash,
    }
}

fn requires_measured_equipment(relation: &CompiledMotionRelation) -> bool {
    matches!(
        relation.source_requirement,
        OperatorSourceRequirement::CurrentMeasuredEquipment
            | OperatorSourceRequirement::CurrentMeasuredMixed
    )
}

fn source_requirement_for_inputs(inputs: &[MotionInput]) -> OperatorSourceRequirement {
    let has_equipment = inputs.iter().any(|input| equipment_source(&input.source));
    let has_pose = inputs.iter().any(|input| !equipment_source(&input.source));
    match (has_equipment, has_pose) {
        (true, true) => OperatorSourceRequirement::CurrentMeasuredMixed,
        (true, false) => OperatorSourceRequirement::CurrentMeasuredEquipment,
        (false, true) => OperatorSourceRequirement::CurrentMeasuredPose,
        (false, false) => OperatorSourceRequirement::CurrentMeasuredPose,
    }
}

fn equipment_provider_topology(topology: &str) -> Option<EquipmentProviderTopology> {
    match topology {
        "free_rigid_barbell" | "smith_guided_bar" => Some(EquipmentProviderTopology::RigidBarAxis),
        "independent_dumbbell" => Some(EquipmentProviderTopology::IndependentDumbbells),
        "constrained_machine_handle" => Some(EquipmentProviderTopology::ConstrainedMachineHandle),
        "cable_handle" => Some(EquipmentProviderTopology::CableHandle),
        "unilateral_cable_handle" => Some(EquipmentProviderTopology::UnilateralCableHandle),
        "landmine_lever" => Some(EquipmentProviderTopology::LandminePivot),
        "trap_bar" => Some(EquipmentProviderTopology::TrapBar),
        "kettlebell" => Some(EquipmentProviderTopology::Kettlebell),
        "resistance_band" => Some(EquipmentProviderTopology::ResistanceBand),
        "weight_plate" => Some(EquipmentProviderTopology::WeightPlate),
        "bodyweight_station" => Some(EquipmentProviderTopology::FixedSupport),
        "none" => Some(EquipmentProviderTopology::BodyOnly),
        _ => None,
    }
}

fn equipment_source(source: &str) -> bool {
    source.contains("equipment")
        || source.contains("dumbbell")
        || source.contains("machine_handle")
        || source.contains("bar_axis")
        || source.contains("cable_handle")
        || source.contains("landmine")
        || source.contains("trap_bar")
        || source.contains("kettlebell")
        || source.contains("band_attachment")
        || source.contains("weight_plate")
        || source.contains("single_load")
        || source.contains("fixed_support")
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActionMotionError {
    InvalidAsset(String),
    UnsupportedCatalog,
    DuplicateLeaf(String),
    DuplicateOperator,
    UnknownAction {
        action_id: String,
    },
    InvalidDefinitionHash {
        definition_id: String,
    },
    DefinitionBuildFailure {
        action_id: String,
        detail: String,
    },
    UnsupportedView {
        action_id: String,
        view: String,
    },
    RecommendedViewNotExecutable {
        action_id: String,
        view: String,
    },
    RuntimeBindingFailure {
        action_id: String,
        view: String,
        detail: String,
    },
    MissingViewObservationPlan {
        action_id: String,
        view: String,
    },
    IdentityRelationNotObservable {
        action_id: String,
        view: String,
        relation_id: String,
    },
    TopologyPrimaryConflict {
        action_id: String,
        view: String,
        relation_id: String,
    },
    MissingAlgorithmModule {
        module_id: String,
    },
    RequiredAlgorithmModuleNotSelected {
        topology_id: String,
        module_id: String,
    },
    DuplicateAlgorithmModule {
        module_id: String,
    },
    InvalidAlgorithmModuleContract {
        module_id: String,
    },
    IncompatibleAlgorithmTopology {
        module_id: String,
        topology_id: String,
    },
    AlgorithmFactHasNoProducer {
        module_id: String,
        fact_id: String,
    },
    DuplicateAlgorithmFactProducer {
        fact_id: String,
    },
    AlgorithmDependencyCycle {
        module_ids: Vec<String>,
    },
    MissingOperator {
        action_id: String,
        operator_id: String,
    },
    OperatorTypeMismatch {
        relation_id: String,
    },
    IdentitySourceConflict {
        relation_id: String,
    },
    MissingEquipmentProvider {
        action_id: String,
        topology: String,
    },
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
