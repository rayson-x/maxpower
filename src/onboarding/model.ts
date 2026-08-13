import type {
  CoachingMandateData,
  EnergyQuantity,
  EquipmentRequirement,
  MassQuantity,
  PercentageQuantity,
  LengthQuantity,
  PermissionStatus,
  ProfessionalConstraint,
  StopSignal,
} from "../coach/domain";
import type { AgentKnowledgeArtifactRef } from "../agent-knowledge";
import type { KnowledgeVersionPin } from "../agent-knowledge/runtimeSelection";
import type { ExerciseConstraintState, MovementPattern } from "../knowledge/model";

export const ONBOARDING_DRAFT_SCHEMA_VERSION = 1 as const;

export type OnboardingDepth = "basic" | "professional";
export type OnboardingSection =
  | "profile"
  | "goal"
  | "mandate"
  | "permissions"
  | "safety"
  | "professional";

export interface ProfileDraft {
  adultConfirmed?: boolean;
  demographics?: {
    ageYears?: number;
    sex?: "female" | "male" | "intersex" | "prefer_not_to_say" | "unknown";
    height?: LengthQuantity;
    currentWeight?: MassQuantity;
  };
  trainingExperience?: "beginner" | "intermediate" | "advanced" | "unknown";
  returningStatus?: "new" | "returning" | "consistent";
  schedule?: { weeklyFrequency: number; sessionDurationMinutes: number };
  /** Non-training daily movement, captured separately from workout frequency. */
  dailyActivityLevel?: "sedentary" | "lightly_active" | "active" | "very_active";
  locations?: readonly {
    id: string;
    kind: "home" | "gym" | "hotel" | "outdoor" | "other";
    environment: { space: "small" | "medium" | "large"; noise: "quiet" | "moderate" | "any" };
    availableEquipment: readonly string[];
  }[];
  bodyDirection?: "gain_mass" | "decrease_body_fat" | "maintain" | "performance_only";
  exerciseConstraints?: readonly ExerciseConstraintState[];
  nutritionPreferences?: readonly string[];
  professionalConstraints?: readonly ProfessionalConstraint[];
}

export interface GoalDraft {
  primaryGoal?: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass";
  proposedPrimaryGoals?: readonly ("hypertrophy" | "strength" | "fat_loss_preserve_lean_mass")[];
  modifiers?: readonly ("conditioning" | "health")[];
  expectedDirection?: string;
  successMetrics?: readonly string[];
  horizon?: { startDate: string; endDate?: string };
  acceptableCosts?: readonly string[];
  measurementStrategy?: readonly string[];
  maintenanceFloors?: readonly string[];
  goalType?: "hypertrophy" | "fat_loss" | "strength" | "maintain" | "return_to_training";
  targets?: {
    targetWeight?: MassQuantity;
    targetBodyFat?: PercentageQuantity;
    strength?: {
      squat?: MassQuantity;
      benchPress?: MassQuantity;
      deadlift?: MassQuantity;
      combinedTotal?: MassQuantity;
    };
    circumferences?: Readonly<Record<string, LengthQuantity>>;
  };
  unacceptableCosts?: readonly string[];
}

export interface MandateDraft {
  mode?: CoachingMandateData["mode"];
  scopes?: NonNullable<CoachingMandateData["scopes"]>;
  limits?: NonNullable<CoachingMandateData["limits"]>;
  locks?: NonNullable<CoachingMandateData["locks"]>;
  validUntil?: string;
}

export interface PermissionDraft {
  camera?: PermissionStatus;
  health?: PermissionStatus;
  notifications?: PermissionStatus;
  remoteLlm?: PermissionStatus;
  cloudSync?: PermissionStatus;
  mediaUpload?: PermissionStatus;
}

export interface SafetyDraft {
  adultConfirmed?: boolean;
  professionalRestriction?: boolean;
  recentSurgeryOrAcuteInjury?: boolean;
  pregnancyOrPostpartumSpecialConsideration?: boolean;
  eatingDisorderOrLowEnergyRiskDeclared?: boolean;
  stopSignals?: readonly StopSignal[];
  professionalConstraints?: readonly ProfessionalConstraint[];
}

export interface ProfessionalDraft {
  priorStrategies?: readonly string[];
  strengthBaseline?: {
    squat?: MassQuantity;
    benchPress?: MassQuantity;
    deadlift?: MassQuantity;
    measuredAt?: string;
    source?: "user_confirmed" | "estimated";
  };
  recentSplit?: readonly string[];
  setHistory?: readonly {
    occurredAt: string;
    exerciseVariantId: string;
    load: MassQuantity;
    reps: number;
    rir?: number;
  }[];
  weeklyVolume?: readonly { muscleGroup: string; sets: number }[];
  bodyObservations?: readonly {
    occurredAt: string;
    metric: "body_weight" | "body_fat_percentage" | "circumference";
    quantity: MassQuantity | PercentageQuantity | LengthQuantity;
    site?: string;
    condition?: string;
  }[];
  nutritionObservations?: readonly {
    occurredAt: string;
    energy: EnergyQuantity;
    source: "user_exact" | "user_estimate" | "import";
  }[];
  bodyFatEstimate?: {
    formulaId: string;
    method: string;
    measuredAt: string;
    inputs: Readonly<Record<string, LengthQuantity | MassQuantity | number>>;
    estimateRange: { min: PercentageQuantity; max: PercentageQuantity };
    userOverride?: PercentageQuantity;
  };
  plateauHistory?: {
    durationWeeks?: number;
    priorStrategies?: readonly string[];
    executionAdherence?: "unknown" | "low" | "mixed" | "high";
    recoveryChange?: "unknown" | "worse" | "stable" | "better";
    suspectedReasons?: readonly string[];
  };
  majorWeightLossHistory?: {
    lostWeight?: MassQuantity;
    maintenanceExperience?: "unknown" | "short" | "established";
    reboundOrHunger?: "unknown" | "present" | "not_reported";
  };
  recoveryObservations?: readonly {
    occurredAt: string;
    perceivedRecovery?: number;
    fatigue?: number;
    soreness?: number;
    sleepHours?: number;
  }[];
  availableCustomExercises?: readonly {
    name: string;
    movement: MovementPattern;
    equipmentRequirement?: EquipmentRequirement;
  }[];
}

/**
 * Identifies the user input that supplied an onboarding value.  This is kept
 * on the draft value itself because conversation and form cards update the
 * same draft and neither is intrinsically more authoritative.
 */
export type OnboardingInputSource =
  | { kind: "conversation_message"; messageId: string }
  | { kind: "form_submission"; submissionId: string };

export interface BaselineAgeCapture {
  ageYears: number;
  /** When the user stated this age, rather than an inferred birth year. */
  observedAt: string;
  source: OnboardingInputSource;
}

export interface BaselineQuantityCapture<Q> {
  value: Q;
  observedAt: string;
  source: OnboardingInputSource;
}

export interface BaselineGoalNarrativeCapture {
  /** Unmodified user wording. Goal classification is a later, reviewable step. */
  text: string;
  observedAt: string;
  source: OnboardingInputSource;
}

/** Closed reasons that let us audit question value without storing model reasoning. */
export type OnboardingQuestionReasonCode =
  | "goal_disambiguation"
  | "planning_gate"
  | "safety_gate"
  | "measurement_quality"
  | "schedule_feasibility"
  | "conflict_resolution";

/** A concrete capability that may be limited by an unknown onboarding field. */
export type OnboardingActionGate =
  | "initial_plan"
  | "reliable_energy_target"
  | "dated_session_schedule"
  | "fasted_cardio"
  | "high_intensity_cardio"
  | "training_execution"
  | "exercise_selection"
  | "comparable_strength_progression"
  | "body_composition_trend"
  | "managed_plan_changes"
  | "remote_coach_conversation";

export type OnboardingDraftFieldStatus =
  | "empty"
  | "captured_explicit"
  | "normalized_needs_review"
  | "estimated_needs_review"
  | "confirmed"
  | "invalid"
  | "conflicted"
  | "explicit_unknown";

/**
 * A product-owned dynamic field value. The raw event history remains the
 * audit trail; this is only the current draft projection for a catalog ID.
 */
export interface OnboardingDynamicFieldCapture {
  fieldId: string;
  catalogVersion: string;
  state: Exclude<OnboardingDraftFieldStatus, "empty">;
  value?: unknown;
  observedAt: string;
  source: OnboardingInputSource;
}

export interface OnboardingDynamicFormRequest {
  cardId: string;
  catalogVersion: string;
  draftRevision: number;
  topic: string;
  fieldIds: readonly string[];
  reasonCode: OnboardingQuestionReasonCode;
  requiredFor: OnboardingActionGate;
  /** Exact active knowledge inputs selected by the Agent for this card. */
  knowledgeArtifactIds?: readonly string[];
  knowledgeArtifactRefs?: readonly AgentKnowledgeArtifactRef[];
  knowledgeReleasePin?: KnowledgeVersionPin;
}

/**
 * The only four fixed onboarding inputs. This deliberately does not project
 * into the legacy ProfileDraft or GoalDraft: doing so would turn extraction or
 * inference into a confirmed fact before the user reviews the dossier.
 */
export interface BaselineIntakeDraft {
  age?: BaselineAgeCapture;
  height?: BaselineQuantityCapture<LengthQuantity>;
  currentWeight?: BaselineQuantityCapture<MassQuantity>;
  goalNarrative?: BaselineGoalNarrativeCapture;
}

export type BaselineIntakeField = "age" | "height" | "current_weight" | "goal_narrative";

/**
 * Draft status is intentionally finer than a value's TypeScript shape. In
 * particular, a normalized phrase or an estimate must never masquerade as a
 * statement made by the user.
 */
export type OnboardingDraftValueStatus =
  | "captured_explicit"
  | "normalized_needs_review"
  | "estimated_needs_review"
  | "explicit_unknown"
  | "conflicted";

export interface GoalCaptureRef {
  id: string;
  observedAt: string;
  source: OnboardingInputSource;
}

/** A target belongs to the future Goal Contract, not to Timeline. */
export interface GoalTargetCapture extends GoalCaptureRef {
  kind: "target_body_fat";
  status: "captured_explicit" | "normalized_needs_review" | "conflicted";
  value: PercentageQuantity;
  normalizerVersion?: string;
}

/** A reported current measurement is a Timeline baseline candidate. */
export interface TimelineBaselineMeasurementDraft extends GoalCaptureRef {
  kind: "body_fat_percentage";
  owner: "timeline_baseline";
  status: "captured_explicit" | "normalized_needs_review" | "estimated_needs_review" | "conflicted";
  value: PercentageQuantity;
  /** Never infer a measurement method from a number in a goal sentence. */
  measurementMethod: "unknown" | "user_reported";
  normalizerVersion?: string;
}

export interface VisualGoalIntentCapture extends GoalCaptureRef {
  kind: "wide_shoulders_narrow_waist";
  status: "normalized_needs_review" | "conflicted";
  normalizerVersion: string;
}

export interface GoalProtectionIntentCapture extends GoalCaptureRef {
  kind: "bench_press_performance";
  status: "normalized_needs_review" | "conflicted";
  normalizerVersion: string;
}

export interface GoalTradeoffCapture extends GoalCaptureRef {
  kind: "slower_progress_accepted";
  status: "normalized_needs_review" | "conflicted";
  normalizerVersion: string;
}

/**
 * The presence of a conflict is a product fact. It is never represented by
 * silently overwriting an older target or measurement in the draft reducer.
 */
export interface OnboardingGoalConflict {
  id: string;
  subject: "target_body_fat" | "current_body_fat";
  state: "unresolved";
  captureIds: readonly [string, string];
}

/**
 * The structured interpretation of free-language goal statements. Raw
 * narratives stay alongside the interpretation so the UI can show exactly
 * what the person said and allow the interpretation to be corrected.
 */
export interface GoalNarrativeCaptureDraft {
  narratives: readonly BaselineGoalNarrativeCapture[];
  goalTargets: readonly GoalTargetCapture[];
  timelineBaselineMeasurements: readonly TimelineBaselineMeasurementDraft[];
  visualIntents: readonly VisualGoalIntentCapture[];
  protectionIntents: readonly GoalProtectionIntentCapture[];
  tradeoffs: readonly GoalTradeoffCapture[];
  conflicts: readonly OnboardingGoalConflict[];
}

/**
 * User-confirmed training history. This is deliberately separate from the
 * legacy `trainingExperience` selector: duration, continuity and familiarity
 * answer different planning questions and must remain independently reviewable.
 */
export interface TrainingBackgroundDraft {
  capturedAt: string;
  source: OnboardingInputSource;
  /** Conversation extraction stays reviewable until the dossier is confirmed. */
  captureStatus?: "captured_explicit" | "normalized_needs_review";
  /** Per-field source survives later rounds; top-level source is only legacy fallback. */
  fieldProvenance?: Readonly<Record<string, {
    capturedAt: string;
    source: OnboardingInputSource;
    captureStatus: "captured_explicit" | "normalized_needs_review";
  }>>;
  cumulativeTrainingMonths?: { minimum: number; maximum: number };
  recentContinuity?: {
    consecutiveWeeks?: number;
    usualSessionsPerWeek?: number;
    timeAwayWeeks?: number;
  };
  recentSplit?: readonly string[];
  exactExerciseFamiliarity?: readonly string[];
  comparableSets?: readonly {
    exerciseVariantId: string;
    load: MassQuantity;
    reps: number;
    rir?: number;
    rpe?: number;
    performedOn: string;
    conditions?: string;
  }[];
  environments?: readonly string[];
  availableEquipment?: readonly string[];
  schedule?: { weeklyFrequency: number; sessionDurationMinutes: number };
  executionStability?: "reported_consistent" | "reported_variable" | "unknown";
  /** Weak, non-decisive evidence retained so it cannot silently raise a level. */
  reportedTerminology?: readonly string[];
}

export type CoachingAssessmentStatus = "supported" | "provisional" | "unknown" | "contradicted";

/**
 * Structured reason codes are reviewable and auditable without storing model
 * reasoning. Sources point back to a user statement, never to an LLM claim.
 */
export interface CoachingAssessmentEvidence {
  code:
    | "recent_continuity_reported"
    | "recent_time_away_reported"
    | "recent_split_reported"
    | "exact_exercise_familiarity_reported"
    | "comparable_set_reported"
    | "execution_consistency_reported"
    | "duration_and_vocabulary_not_sufficient";
  source?: OnboardingInputSource;
  capturedAt?: string;
  exerciseVariantId?: string;
}

export interface CoachingAssessmentDimension {
  status: CoachingAssessmentStatus;
  supportingEvidence: readonly CoachingAssessmentEvidence[];
  refutingEvidence: readonly CoachingAssessmentEvidence[];
  unknowns: readonly string[];
  /** Exact variants only. Familiarity never expands by muscle group or name. */
  applicableExerciseVariantIds: readonly string[];
  reassessWhen: readonly string[];
}

export interface CoachingLevelAssessment {
  id: string;
  userId: string;
  /** Revision of this independent assessment artifact, not a Profile revision. */
  revision: number;
  assessedAt: string;
  sourceDraft: { id: string; revision: number };
  priority: "multi_dimensional_assessment";
  /** Read-only migration context; never used to calculate the dimensions. */
  legacyTrainingExperience?: ProfileDraft["trainingExperience"];
  dimensions: {
    trainingProgrammingUnderstanding: CoachingAssessmentDimension;
    exactExerciseFamiliarity: CoachingAssessmentDimension;
    currentComparablePerformance: CoachingAssessmentDimension;
    trainingContinuity: CoachingAssessmentDimension;
    selfRegulation: CoachingAssessmentDimension;
    executionStability: CoachingAssessmentDimension;
  };
}

export interface OnboardingPatch {
  baseline?: BaselineIntakeDraft;
  /** Dynamic Catalog fields not yet promoted to their owned dossier record. */
  dynamicFields?: Readonly<Record<string, OnboardingDynamicFieldCapture>>;
  /** Goal Contract and Timeline-baseline candidates remain distinct here. */
  goalCapture?: GoalNarrativeCaptureDraft;
  trainingBackground?: TrainingBackgroundDraft;
  profile?: ProfileDraft;
  goal?: GoalDraft;
  mandate?: MandateDraft;
  permissions?: PermissionDraft;
  safety?: SafetyDraft;
  professional?: ProfessionalDraft;
}

export type OnboardingDraftEvent =
  | {
      id: string;
      schemaVersion: typeof ONBOARDING_DRAFT_SCHEMA_VERSION;
      type: "onboarding.started";
      userId: string;
      draftId: string;
      recordedAt: string;
      payload: { depth: OnboardingDepth };
    }
  | {
      id: string;
      schemaVersion: typeof ONBOARDING_DRAFT_SCHEMA_VERSION;
      type: "onboarding.progress_saved";
      userId: string;
      draftId: string;
      recordedAt: string;
      payload: {
        inputMode: "form" | "conversation";
        patch: OnboardingPatch;
        confirmedSections: readonly OnboardingSection[];
        dynamicForm?: {
          catalogVersion: string;
          cardId?: string;
          submissionId: string;
          fieldIds: readonly string[];
        };
      };
    }
  | {
      id: string;
      schemaVersion: typeof ONBOARDING_DRAFT_SCHEMA_VERSION;
      type: "onboarding.dynamic_form_requested";
      userId: string;
      draftId: string;
      recordedAt: string;
      payload: OnboardingDynamicFormRequest;
    }
  | {
      id: string;
      schemaVersion: typeof ONBOARDING_DRAFT_SCHEMA_VERSION;
      type: "onboarding.coaching_level_assessed";
      userId: string;
      draftId: string;
      recordedAt: string;
      payload: CoachingLevelAssessment;
    }
  | {
      id: string;
      schemaVersion: typeof ONBOARDING_DRAFT_SCHEMA_VERSION;
      type: "onboarding.completed";
      userId: string;
      draftId: string;
      recordedAt: string;
      payload: { domainEventIds: readonly string[] };
    };

export interface OnboardingProgress {
  id: string;
  userId: string;
  depth: OnboardingDepth;
  status: "in_progress" | "completed";
  patch: OnboardingPatch;
  /** Monotonically increases for every append-only event in this draft. */
  revision: number;
  /** Missing fixed baseline inputs. Later action gates are not listed here. */
  baselineMissingFields: BaselineIntakeField[];
  /** Append-only assessment revisions; these are Coach judgments, not Profile facts. */
  coachingLevelAssessments?: readonly CoachingLevelAssessment[];
  confirmedSections: OnboardingSection[];
  nextRequiredSections: OnboardingSection[];
  lastInputMode?: "form" | "conversation";
  inputModeBySection: Partial<Record<OnboardingSection, "form" | "conversation">>;
  /** Capabilities currently constrained by an explicit unknown, not a global block. */
  limitedActions: OnboardingActionGate[];
  updatedAt: string;
}

/**
 * The account-entry projection is deliberately smaller than the editable
 * draft. It tells a product shell where to send an account without exposing
 * Ledger events or making a second completion decision in the UI.
 */
export type OnboardingEntryStatus =
  | "dossier_complete"
  | "not_started"
  | "in_progress"
  | "ready_for_confirmation"
  | "commit_pending"
  | "safety_hold";

export interface OnboardingEntryState {
  status: OnboardingEntryStatus;
  destination: "home" | "onboarding";
  /** Present only when the account must resume a durable onboarding draft. */
  draft?: OnboardingProgress;
}

export interface OnboardingCompletion {
  status: "completed" | "idempotent";
  userId: string;
  profileId: string;
  goalContractId: string;
  mandateId: string;
  knownFields: readonly string[];
  estimatedFields: readonly string[];
  unknownFields: readonly string[];
  permissions: Readonly<Required<PermissionDraft>>;
  nextStep: "review_initial_plan";
}

export class OnboardingValidationError extends Error {
  constructor(
    readonly code:
      | "draft_not_found"
      | "draft_completed"
      | "missing_required_fields"
      | "adult_confirmation_required"
      | "primary_goal_conflict"
      | "invalid_professional_history"
      | "invalid_baseline_intake"
      | "dynamic_form_rejected"
      | "stale_dynamic_form"
      | "stale_dossier_confirmation"
      | "draft_user_mismatch"
      | "local_user_presence_required",
    readonly fields: readonly string[] = [],
  ) {
    super(`${code}${fields.length ? `: ${fields.join(", ")}` : ""}`);
    this.name = "OnboardingValidationError";
  }
}
