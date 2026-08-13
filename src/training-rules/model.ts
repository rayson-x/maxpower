import type {
  CoachingMandateData,
  MassQuantity,
  RecoveryConstraintData,
  SafetyConstraintData,
} from "../coach/domain";
import type { FactRef } from "../coach/model";
import type { BodyweightDifficultyGraph, VersionPin } from "../knowledge/model";

export const TRAINING_RULE_INPUT_SCHEMA_VERSION = 1 as const;

export type TrainingGoal = "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass";

/** Executable, version-pinned priority policy for exercise substitutions. */
export interface SubstitutionRankingPolicy {
  sameMovement: number;
  sameMovementPattern: number;
  sameLoadMode: number;
  sameStimulusContract: number;
  exactHistory: number;
  mastery: number;
  explicitPreference: number;
  unknownEquipmentPenalty: number;
  cameraCapabilityBonus: number;
  cardioOrLocomotionBonus: number;
  recoveryActivityBonus: number;
}

export interface TrainingRulePackDescriptor {
  id: string;
  goal: TrainingGoal;
  population: readonly string[];
  scope: readonly string[];
  semanticVersion: string;
  schemaVersion: 1;
  contentHash: string;
  requiredEvidence: readonly string[];
  optionalEvidence: readonly string[];
  safetyExclusions: readonly string[];
  defaults: {
    calibrationRir: { min: 4; max: 5 };
    workingRir: { min: number; max: number };
    maxAutomaticLoadIncreasePercent: number;
    conservativeWeeklyDirectSets?: number;
  };
  substitutionRanking: SubstitutionRankingPolicy;
  unknownHandling: "hold_and_request_minimum_evidence";
  supportedDecisionTypes: readonly RuleDecisionType[];
}

export interface ComparableExerciseContext {
  exerciseVariantId: string;
  performanceIdentity: string;
  equipmentId: string;
  loadMode: string;
  setup: string;
  rom: string;
  prescriptionMode: "weighted_reps" | "bodyweight_reps";
  setContext: "working" | "warmup" | "calibration";
}

export interface PerformedSetEvidence {
  setId: string;
  actualLoad?: MassQuantity;
  actualLoadSource?: "user_confirmed" | "imported" | "camera" | "llm" | "wearable";
  actualReps?: number;
  actualRir?: number;
  rirSource?: "user_reported" | "llm" | "camera" | "wearable";
  completed: boolean;
}

export interface ComparableSessionEvidence {
  sessionId: string;
  occurredAt: string;
  context: ComparableExerciseContext;
  sets: readonly PerformedSetEvidence[];
  stopSignals: readonly string[];
  partial: boolean;
  evidenceRefs: readonly FactRef[];
}

export interface VolumeEvidence {
  muscleGroup: string;
  comparableExposureCount: number;
  plannedDirectSets: number;
  completedDirectSets: number;
  weeklyDataComplete: boolean;
  performanceTrend: "improving" | "stable" | "declining" | "unknown";
  repeatedUnrecoveredCount: number;
  timeCapacityReached: boolean;
  supportiveSignals?: readonly {
    kind: "pump" | "doms" | "subjective_ease" | "subjective_workload";
    value: string;
    provenance: string;
  }[];
  evidenceRefs: readonly FactRef[];
}

export interface IndependentSupportSignal {
  kind:
    | "multiple_muscles_unrecovered"
    | "subjective_fatigue"
    | "training_motivation_decline"
    | "user_requested"
    | "time_constraint"
    | "single_low_hrv"
    | "single_high_rhr"
    | "single_bad_sleep"
    | "single_readiness_score"
    | "single_rir_deviation"
    | "single_doms"
    | "weight_trend_too_fast"
    | "energy_availability_concern";
  evidenceRef?: FactRef;
}

export interface BodyweightProgressionContext {
  graph: BodyweightDifficultyGraph;
  currentNodeId: string;
  availableNodeIds: readonly string[];
  reviewedAdjacentNodeIds: readonly string[];
  canSafelyStop: boolean;
  minimumAddedLoad?: MassQuantity;
}

export interface RuleEvaluationContext {
  schemaVersion: typeof TRAINING_RULE_INPUT_SCHEMA_VERSION;
  userId: string;
  goal: TrainingGoal;
  comparableContext: ComparableExerciseContext;
  prescription: {
    load?: MassQuantity;
    repRange: { min: number; max: number };
    targetRir: { min: number; max: number };
    setCount: number;
  };
  recentSessions: readonly ComparableSessionEvidence[];
  volume?: VolumeEvidence;
  equipment: {
    availableLoads: readonly MassQuantity[];
    configuredMicroloads?: readonly MassQuantity[];
  };
  recoveryConstraint: RecoveryConstraintData["level"];
  safetyConstraints: readonly SafetyConstraintData[];
  supportSignals: readonly IndependentSupportSignal[];
  plannedRecoveryWindow: boolean;
  mandate: CoachingMandateData;
  locks: readonly ("load" | "reps" | "sets" | "exercise" | "week_structure")[];
  boundary: "current_set" | "between_sets" | "session_complete" | "weekly_review" | "mesocycle_review";
  bodyweight?: BodyweightProgressionContext;
  stableHistory: boolean;
  requestedLoadingPattern?: "simple" | "light_medium_heavy";
  calibrationAttemptCount?: number;
  explicitLowRirPreference: boolean;
  exerciseCanSafelyStop: boolean;
  syncConflict?: boolean;
}

export type PerformanceProgressionState =
  | "INSUFFICIENT_EVIDENCE"
  | "ON_TARGET"
  | "TOO_EASY"
  | "TOO_HARD"
  | "UNDERPERFORMANCE"
  | "STOP_SIGNAL";

export type VolumeProgressionState =
  | "INSUFFICIENT_EVIDENCE"
  | "HOLD"
  | "ELIGIBLE_ADD_SET"
  | "REDUCE_VOLUME";

export type RuleDecisionType =
  | "unavailable"
  | "safety_stop"
  | "calibrate_load"
  | "hold"
  | "add_rep"
  | "increase_load"
  | "reduce_load"
  | "add_set"
  | "remove_set"
  | "bodyweight_progression"
  | "deload_proposal"
  | "review_plan";

export interface RuleDecision {
  decision: RuleDecisionType;
  scope: "next_unstarted_set" | "next_session" | "week" | "mesocycle";
  states: {
    performance: PerformanceProgressionState;
    volume: VolumeProgressionState;
  };
  reasonCodes: readonly string[];
  evidenceRefs: readonly FactRef[];
  missing: readonly string[];
  conflicts: readonly string[];
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  change?: {
    variable:
      | "load"
      | "reps"
      | "sets"
      | "exercise_difficulty"
      | "loading_pattern"
      | "deload_strategy";
    value: unknown;
  };
  rule: { id: string; semanticVersion: string; contentHash: string };
  confidence: number;
  requiresConfirmation: boolean;
  reviewBoundary: RuleEvaluationContext["boundary"];
  safetyBoundary: readonly string[];
  explanation: string;
  alternatives?: readonly string[];
}

export type RulePackLoadResult =
  | { status: "available"; pack: TrainingRulePack }
  | {
      status: "unavailable";
      reason: "missing_version_pin" | "pin_mismatch" | "unsupported_goal";
      decision: RuleDecision;
    };

export interface TrainingRulePack {
  readonly descriptor: TrainingRulePackDescriptor;
  evaluate(context: RuleEvaluationContext): RuleDecision;
}

export interface RulePackLoadRequest {
  goal: TrainingGoal;
  pin?: VersionPin;
}

export interface ShadowRuleMetric {
  ruleId: string;
  ruleVersion: string;
  decision: RuleDecisionType;
  accepted?: boolean;
  modified?: boolean;
  undone?: boolean;
  completed?: boolean;
  targetRirDeviation?: number;
  repeatedPerformanceDecline?: boolean;
  ruleCoverage: number;
}
