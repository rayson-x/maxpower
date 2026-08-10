import type { EquipmentRequirement } from "../coach/domain";

export const KNOWLEDGE_PACK_SCHEMA_VERSION = 1 as const;
export const EXERCISE_CATALOG_SCHEMA_VERSION = 1 as const;
export const RULE_PACK_SCHEMA_VERSION = 1 as const;

declare const exerciseConceptBrand: unique symbol;
export type ExerciseConceptId = string & { readonly [exerciseConceptBrand]: true };

export interface ExerciseConcept {
  id: ExerciseConceptId;
  displayName: { zh: string; en: string };
  aliases: readonly string[];
  sourceRefs: readonly string[];
  license: {
    content: "project_authored_metadata" | "third_party_metadata";
    text: "project_authored" | "redistributable" | "not_bundled_pending_review";
    media: "none_bundled" | "redistributable" | "not_bundled_pending_review";
  };
  catalogVersion: string;
  status: "active" | "tombstone";
  replacementConceptId?: ExerciseConceptId;
  limitations: readonly string[];
  reviewedAt: string;
}

export type KnowledgeClassification =
  | "EvidenceFact"
  | "ProductPolicy"
  | "Unknown"
  | "SafetyBoundary"
  | "CompetitorPrecedent";

export interface SourceRef {
  id: string;
  title: string;
  uri: string;
  classification: KnowledgeClassification;
  reviewedAt: string;
}

export interface KnowledgePackManifest {
  id: string;
  semanticVersion: string;
  schemaVersion: typeof KNOWLEDGE_PACK_SCHEMA_VERSION;
  contentHash: string;
  publishedAt: string;
  reviewedAt: string;
  sourceRefs: readonly SourceRef[];
  population: readonly string[];
  scope: readonly string[];
  capabilityFlags: readonly string[];
  compatibility: { minAppSchema: number; maxAppSchema: number };
  supersedes?: { packId: string; semanticVersion: string; contentHash: string };
  signature: {
    status: "reviewed_digest" | "unsigned" | "invalid";
    algorithm: "fnv1a-32";
    value: string;
  };
}

export interface VersionPin {
  id: string;
  semanticVersion: string;
  schemaVersion: number;
  contentHash: string;
}

export interface KnowledgeVersionPins {
  knowledgePack: VersionPin;
  exerciseCatalog: VersionPin;
  rulePacks: readonly VersionPin[];
}

export type MovementPattern =
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "squat"
  | "hip_hinge"
  | "lunge"
  | "knee_extension"
  | "knee_flexion"
  | "elbow_flexion"
  | "elbow_extension"
  | "shoulder_abduction"
  | "shoulder_flexion"
  | "shoulder_horizontal_abduction"
  | "shoulder_external_rotation"
  | "ankle_plantarflexion"
  | "core_anti_extension"
  | "core_anti_rotation"
  | "core_flexion"
  | "locomotion"
  | "cardio"
  | "mobility"
  | "recovery";

export interface ExerciseVariantIdentity {
  movement: string;
  variation: string;
  loadMode: string;
  equipmentConfiguration: string;
  support: string;
  setup: string;
  angleOrStance: string;
  grip: string;
  unilateralContext: "bilateral" | "left" | "right" | "alternating";
  romContext: string;
  loadMeasurement: "external_mass" | "bodyweight_node" | "time" | "distance" | "none";
  /** Camera view is observation context, never training/performance identity. */
  cameraView?: never;
}

export interface ComparableExerciseContext {
  exerciseVariantId: string;
  performanceIdentity: string;
  comparable: "exact_variant" | "not_comparable";
  loadTransfer: "same_measurement_history_only" | "forbidden_cold_start";
  observationContextExcluded: readonly ["camera_view", "lens", "pose_model", "recognition_profile"];
}

export interface ExerciseEquipmentDescriptor {
  loadMode:
    | "bodyweight"
    | "barbell"
    | "dumbbell"
    | "kettlebell"
    | "machine"
    | "cable"
    | "band"
    | "cardio_machine"
    | "none"
    | "custom";
  requirement: EquipmentRequirement;
}

export interface StimulusContract {
  id: string;
  movementPattern: MovementPattern;
  mechanicalFunctions: readonly string[];
  jointActions: readonly string[];
  primaryMuscleIntent: readonly string[];
  secondaryMuscleIntent: readonly string[];
  stability: "supported" | "free" | "either";
  unilateral: boolean | "either";
  prescriptionMode: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  repOrTimeRange?: { min: number; max: number; unit: "reps" | "seconds" | "minutes" };
  targetRir?: { min: number; max: number };
  fatigueCost: "low" | "medium" | "high";
  priority: "primary" | "maintenance" | "optional";
  lockedFields: readonly string[];
}

export interface ExpectedMuscleAssociation {
  exerciseVariantId: string;
  contextHash: string;
  status: "reviewed_expected_participation" | "unknown";
  associations: readonly {
    muscleId: string;
    role: "primary_intent" | "secondary_intent" | "stabilizer";
    evidenceStatus: "evidence_fact" | "product_policy" | "unknown";
  }[];
  disclaimer: "expected_participation_not_observed_activation";
}

export interface MotionEvidenceRequirement {
  cameraView: "front" | "rear" | "side" | "front_oblique" | "rear_oblique";
  maturity: "none" | "experimental" | "validated" | "suspended";
  recognitionProfileId?: string;
  referenceTrajectoryProfileId?: string;
  cueMappingId?: string;
  fallback: "manual_recording" | "video_only" | "count_tempo_only";
}

export interface ExerciseVariant {
  id: string;
  conceptId: ExerciseConceptId;
  schemaVersion: typeof EXERCISE_CATALOG_SCHEMA_VERSION;
  semanticVersion: string;
  displayName: { zh: string; en: string };
  aliases: readonly string[];
  identity: ExerciseVariantIdentity;
  performanceIdentity: string;
  movementPattern: MovementPattern;
  equipment: ExerciseEquipmentDescriptor;
  stimulusContractIds: readonly string[];
  expectedMuscleAssociation: ExpectedMuscleAssociation;
  motionEvidenceRequirements: readonly MotionEvidenceRequirement[];
  bodyweightDifficultyNodeId?: string;
  status: "active" | "deprecated";
  replacementId?: string;
  sourceRefs: readonly string[];
  unknownFields: readonly string[];
  dataEligibility: {
    recordable: boolean;
    plannerEligible: boolean;
    expectedMuscleMetadata: "reviewed" | "unknown";
    motionCapabilityRequirement: "independent_exact_resolver";
  };
}

export interface BodyweightDifficultyEdge {
  from: string;
  to: string;
  direction: "progression" | "regression";
  changes: readonly (
    | "support_points"
    | "body_angle"
    | "rom"
    | "unilateral"
    | "assistance"
    | "band"
    | "external_load"
    | "safe_stop"
  )[];
}

export interface BodyweightDifficultyGraph {
  id: string;
  nodes: readonly string[];
  edges: readonly BodyweightDifficultyEdge[];
}

export interface RulePackArtifact {
  id: string;
  semanticVersion: string;
  schemaVersion: typeof RULE_PACK_SCHEMA_VERSION;
  contentHash: string;
  reviewed: boolean;
  reviewedAt: string;
  sourceRefs: readonly string[];
  scope: readonly string[];
  executable: true;
}

export interface WikiDocumentRef {
  path: string;
  semanticVersion: string;
  executable: false;
}

export interface ExerciseCatalogArtifact {
  id: string;
  semanticVersion: string;
  schemaVersion: typeof EXERCISE_CATALOG_SCHEMA_VERSION;
  contentHash: string;
  migrationPolicy: {
    mode: "additive_deprecation";
    preservePinnedVersions: true;
  };
  substitutionProfiles: readonly {
    goalPack: "hypertrophy" | "strength" | "fat_loss" | "conditioning" | "health";
    weights: {
      sameMovement: number;
      sameMovementPattern: number;
      sameLoadMode: number;
      cameraCapabilityBonus: number;
      cardioOrLocomotionBonus: number;
      recoveryActivityBonus: number;
    };
  }[];
  concepts: readonly ExerciseConcept[];
  variants: readonly ExerciseVariant[];
  stimulusContracts: readonly StimulusContract[];
  difficultyGraphs: readonly BodyweightDifficultyGraph[];
}

export interface KnowledgePack {
  manifest: KnowledgePackManifest;
  classifications: readonly KnowledgeClassification[];
  exerciseCatalog: ExerciseCatalogArtifact;
  executableRulePacks: readonly RulePackArtifact[];
  wikiDocuments: readonly WikiDocumentRef[];
  /** 安全词表（ticket 09/07）：禁止声称清单与领域锚定词，随包版本化更新。 */
  safetyLexicon?: SafetyLexicon;
}

/** 禁止声称规则：patterns 全部命中（AND）才拦截，降低误伤。 */
export interface ForbiddenClaimRule {
  id: string;
  patterns: readonly string[];
  replacement: string;
}

export interface SafetyLexicon {
  semanticVersion: string;
  forbiddenClaims: readonly ForbiddenClaimRule[];
  /** 领域锚定词（运动/健康/饮食），用于领域边界判定（ticket 07）。 */
  domainAnchors: readonly string[];
}

export interface MotionCapabilitySet {
  countPhase: "available" | "unavailable";
  tempo: "available" | "unavailable";
  calibratedTrajectoryComparison: "available" | "unavailable";
  evidenceLinkedCue: "available" | "unavailable";
  fallback: "manual_recording" | "video_only" | "count_tempo_only";
  evidenceRefs: readonly string[];
}

export interface SubstitutionCandidate {
  exercise: ExerciseVariant;
  hardConstraintsSatisfied: boolean;
  eligibility: "eligible" | "needs_equipment_confirmation";
  satisfiedFields: readonly string[];
  deviatedFields: readonly string[];
  rankingReasons: readonly string[];
  coldStart: {
    loadHistory: "known" | "unknown";
    exerciseHistory: "known" | "unknown";
  };
  requiredEquipment: readonly string[];
  performanceComparability: "exact_variant" | "cold_start";
  timeImpactMinutes: number;
  fatigueImpact: StimulusContract["fatigueCost"];
  motionCapability: MotionCapabilitySet;
  ruleVersion: VersionPin;
}

export type ExerciseConstraintState =
  | {
      kind: "cannot_do";
      exerciseVariantId?: string;
      movementPattern?: MovementPattern;
      reason: string;
      priority: "hard";
      scope: "current_session" | "future_policy";
    }
  | {
      kind: "dislike";
      exerciseVariantId?: string;
      movementPattern?: MovementPattern;
      reason?: string;
      priority: "preference";
      scope: "current_session" | "future_policy";
    }
  | {
      kind: "temporary_unavailable";
      exerciseVariantId?: string;
      movementPattern?: MovementPattern;
      reason?: string;
      priority: "session_hard";
      scope: "current_session";
    }
  | {
      kind: "do_not_recommend";
      exerciseVariantId?: string;
      movementPattern?: MovementPattern;
      reasonCode: string;
      priority: "policy";
      scope: "future_policy";
    };

export interface KnowledgeLayerRefs {
  recognitionProfileId?: string;
  trajectoryEvidenceId?: string;
  expectedMuscleAssociationId?: string;
  coachingClaimId?: string;
}

export interface CustomExerciseVariantView {
  id: string;
  userId: string;
  name: string;
  movement?: MovementPattern;
  prescriptionMode: StimulusContract["prescriptionMode"];
  equipmentRequirement: EquipmentRequirement;
  unknownFields: readonly string[];
  motionCapability: "unknown";
  createdAt: string;
  revision: number;
  status: "active" | "archived";
}

export interface CustomExerciseMetadataProposal {
  kind: "custom_exercise_metadata_proposal";
  customExerciseId: string;
  proposed: {
    movement?: MovementPattern;
    expectedMuscleIds?: readonly string[];
    stimulusContractId?: string;
    substitutionIds?: readonly string[];
  };
  authority: "non_authoritative_pending_user_confirmation";
  source: "llm" | "user";
  unlocksPlannerEligibility: false;
  unlocksMotionCapability: false;
}

export class KnowledgePackValidationError extends Error {
  constructor(
    readonly code:
      | "schema_incompatible"
      | "hash_mismatch"
      | "signature_invalid"
      | "catalog_invalid"
      | "missing_reference",
    readonly details: readonly string[] = [],
  ) {
    super(`${code}${details.length ? `: ${details.join(", ")}` : ""}`);
    this.name = "KnowledgePackValidationError";
  }
}
