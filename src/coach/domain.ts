export const DOMAIN_EVENT_SCHEMA_VERSION = 1 as const;
export const COACH_LEDGER_SNAPSHOT_SCHEMA_VERSION = 6 as const;

export type DomainAggregateKind =
  | "user_profile"
  | "goal_contract"
  | "coaching_mandate"
  | "goal_cycle"
  | "plan"
  | "workout_session"
  | "timeline"
  | "equipment_profile"
  | "recovery_constraint"
  | "nutrition_strategy"
  | "custom_exercise"
  | "permission_set"
  | "safety_constraint";

export interface DomainAggregateRef<K extends DomainAggregateKind = DomainAggregateKind> {
  kind: K;
  id: string;
  revision: number;
}

export interface DomainActor {
  kind: "user" | "agent" | "rule_engine" | "sensor" | "sync" | "system";
  id: string;
}

export interface CommandMeta {
  userId: string;
  actor: DomainActor;
  deviceId: string;
  occurredAt: string;
  timezoneOffsetMinutes: number;
  idempotencyKey: string;
  /** Import/replay only: preserves an immutable source event identity. */
  eventId?: string;
}

export interface LocalSettingsAuthorization {
  kind: "local_user_presence";
  verifiedAt: string;
  nonce: string;
}

export interface MassQuantity {
  value: number;
  unit: "kg" | "lb";
}

export interface EnergyQuantity {
  value: number;
  unit: "kcal" | "kJ";
}

export interface DurationQuantity {
  value: number;
  unit: "seconds" | "minutes" | "hours";
}

export interface PercentageQuantity {
  value: number;
  unit: "percent";
}

export interface LengthQuantity {
  value: number;
  unit: "cm" | "in";
}

export type EquipmentRequirement =
  | {
      kind: "item";
      id: string;
      quantity?: number;
      attachments?: readonly string[];
      loadRange?: { min: MassQuantity; max: MassQuantity; increment?: MassQuantity };
      discreteLoads?: readonly MassQuantity[];
      settings?: { min?: number; max?: number; increment?: number };
      fixedInstallation?: boolean;
      safeStopRequired?: boolean;
    }
  | {
      kind: "all";
      items: readonly EquipmentRequirement[];
    }
  | {
      kind: "any";
      items: readonly EquipmentRequirement[];
    }
  | {
      kind: "environment";
      space: "small" | "medium" | "large";
      noise: "quiet" | "moderate" | "any";
      floorImpact: "low" | "any";
      fixedConditions?: readonly string[];
    }
  | {
      /** A deliberate unknown is not equivalent to unavailable or available. */
      kind: "unknown";
      description?: string;
    };

export type ImmutableEvidenceRef =
  | {
      kind: "canonical_packet";
      id: string;
      version: number;
      hash: string;
    }
  | {
      kind: "media";
      id: string;
      version: number;
      hash: string;
      mediaType: "image" | "video" | "document";
    };

export interface UserProfileData {
  id: string;
  trainingExperience: "beginner" | "intermediate" | "advanced";
  locale: string;
  /** Optional intake facts stay absent when the user did not provide them. */
  demographics?: {
    ageYears?: number;
    sex?: "female" | "male" | "intersex" | "prefer_not_to_say" | "unknown";
    height?: LengthQuantity;
    currentWeight?: MassQuantity;
  };
  adultConfirmed?: boolean;
  returningStatus?: "new" | "returning" | "consistent";
  schedule?: { weeklyFrequency: number; sessionDurationMinutes: number };
  locations?: readonly {
    id: string;
    kind: "home" | "gym" | "hotel" | "outdoor" | "other";
    environment: { space: "small" | "medium" | "large"; noise: "quiet" | "moderate" | "any" };
    availableEquipment: readonly string[];
  }[];
  bodyDirection?: "gain_mass" | "decrease_body_fat" | "maintain" | "performance_only";
  exerciseConstraints?: readonly import("../knowledge/model").ExerciseConstraintState[];
  /** Explicit user choices; a preference is never inferred from one temporary substitution. */
  exercisePreferences?: readonly {
    id: string;
    exerciseVariantId: string;
    movementPattern?: import("../knowledge/model").MovementPattern;
    scope: "future_preference";
    createdAt: string;
  }[];
  /** Per-metric; choosing a scale must not also choose a sleep/wearable source. */
  primaryDataSources?: import("../timeline").PrimarySourcePreferences;
  nutritionPreferences?: readonly string[];
  professionalConstraints?: readonly ProfessionalConstraint[];
  trainingHistorySummary?: {
    recentSplit?: readonly string[];
    weeklyVolume?: readonly { muscleGroup: string; sets: number }[];
  };
  strengthBaseline?: {
    squat?: MassQuantity;
    benchPress?: MassQuantity;
    deadlift?: MassQuantity;
    measuredAt?: string;
    source?: "user_confirmed" | "estimated";
  };
  historyModifiers?: {
    priorStrategies?: readonly string[];
    plateau?: {
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
  };
  bodyObservationRefs?: readonly string[];
  fieldProvenance?: Readonly<Record<string, FieldProvenance>>;
}

export interface FieldProvenance {
  source: "form" | "conversation" | "health" | "import" | "professional";
  confidence: "confirmed" | "estimated" | "unknown";
  confirmedAt?: string;
}

export interface ProfessionalConstraint {
  id: string;
  sourceDescription: string;
  scope: readonly ("training" | "nutrition" | "exercise" | "schedule")[];
  instruction: string;
  validUntil?: string;
}

export interface GoalContractData {
  id: string;
  primaryGoal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass";
  modifiers?: readonly ("conditioning" | "health")[];
  expectedDirection?: string;
  successMetrics?: readonly string[];
  horizon: { startDate: string; endDate?: string };
  acceptableCosts?: readonly string[];
  measurementStrategy?: readonly string[];
  maintenanceFloors?: readonly string[];
  /** Structured goal intent keeps maintain/return-to-training explicit while
   * legacy primaryGoal remains the executable training-rule key. */
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
  status?: "draft" | "active";
}

export interface CoachingMandateData {
  id: string;
  mode: "manual" | "collaborative" | "managed";
  scopes?: {
    loadReps: "manual" | "confirm" | "managed_small_step";
    volume: "manual" | "confirm" | "managed_small_step";
    substitution: "manual" | "confirm" | "managed_small_step";
    schedule: "manual" | "confirm" | "managed_small_step";
    deload: "manual" | "confirm" | "managed_small_step";
    nutrition: "advice_only" | "confirm" | "managed_small_step";
  };
  limits?: { maxLoadIncreasePercent?: number; maxWeeklySetChange?: number };
  locks?: readonly {
    id: string;
    field: "exercise" | "training_day" | "load" | "sets" | "week_structure" | "professional_constraint";
    scope: "next_unstarted_set" | "current_session" | "future_sessions" | "week" | "mesocycle" | "goal" | "nutrition";
    value: unknown;
    expiresAt?: string;
  }[];
  validUntil?: string;
}

export type PermissionStatus = "not_configured" | "denied" | "granted";

/**
 * Non-secret selection metadata for a user-owned remote language provider.
 * The API credential is deliberately absent: it lives only in SecureCredentialPort.
 */
export interface PermissionSetData {
  id: string;
  camera: PermissionStatus;
  health: PermissionStatus;
  notifications: PermissionStatus;
  remoteLlm: PermissionStatus;
  cloudSync: PermissionStatus;
  mediaUpload: PermissionStatus;
  remoteLlmDisclosure?: {
    taskRelevantHealthTrainingNutritionSleepAndExperienceSent: true;
    directIdentityFieldsRemoved: readonly (
      | "name"
      | "address"
      | "contact_details"
      | "precise_location"
      | "external_account_id"
    )[];
    consentedAt: string;
  };
}

export type StopSignal =
  | "chest_pain"
  | "dizziness_or_fainting"
  | "unusual_shortness_of_breath"
  | "new_significant_pain"
  | "palpitations"
  | "unusual_fatigue";

export interface SafetyConstraintData {
  id: string;
  disposition: "clear" | "pause_and_confirm" | "stop_and_seek_professional_guidance";
  reasons: readonly string[];
  stopSignals: readonly StopSignal[];
  professionalConstraints: readonly ProfessionalConstraint[];
  diagnosis?: never;
  validUntil?: string;
}

export interface GoalCycleData {
  id: string;
  goalContractRef: DomainAggregateRef<"goal_contract">;
  intent: string;
  allocations?: readonly GoalAllocationData[];
  phasePath?: readonly MesocycleData[];
  successMetrics?: readonly string[];
  forecastAssumptions?: readonly string[];
  reviewCadence?: {
    weekly: true;
    mesocycleEnd: true;
    midCycleRequiresConsecutiveDeviation: number;
  };
  knowledgePins?: import("../knowledge/model").KnowledgeVersionPins;
  createdFromFactFrontier?: readonly DomainAggregateRef[];
  strategySelection?: import("../planning").StrategySelection;
  appliedPhaseStrategy?: import("../planning").AppliedPhaseStrategy;
}

export interface GoalAllocationData {
  goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass" | "conditioning" | "health";
  role: "primary" | "secondary";
  budgetShare: number;
  maintenanceFloor?: string;
}

export interface MesocycleData {
  id: string;
  ordinal: number;
  startDate: string;
  endDate: string;
  intent: string;
  weeklyIntents: readonly WeeklyIntentData[];
  stimulusBudget: readonly StimulusBudgetData[];
  plannedRecoveryWindow: { weekOrdinal: number; intent: string };
  scheduleConstraints: {
    weeklyFrequency: number;
    sessionDurationMinutes: number;
    allowedWeekdays: readonly number[];
  };
  progressionStrategy: string;
}

export interface WeeklyIntentData {
  id: string;
  ordinal: number;
  startDate: string;
  endDate: string;
  intent: string;
  materialization: "materialized" | "intent_only";
  stimulusBudget: readonly StimulusBudgetData[];
}

export interface StimulusBudgetData {
  key: string;
  movementPattern?: import("../knowledge/model").MovementPattern;
  muscleGroup?: string;
  targetExposure: number;
  priority: "primary" | "maintenance" | "optional";
}

export interface ExerciseSetPrescription {
  id: string;
  targetReps?: { min: number; max: number };
  targetDuration?: DurationQuantity;
  targetDistance?: { value: number; unit: "m" | "km" };
  targetLoad?: MassQuantity;
  targetLoadStatus?: "unknown" | "historical_anchor" | "predicted_target";
  targetLoadBasis?: {
    source: "exact_variant_history";
    evidenceRef: string;
    equipmentIncrement?: MassQuantity;
    upperBound?: MassQuantity;
    confidence: number;
  };
  calibrationIntent?: string;
  targetRir?: number;
  rest?: DurationQuantity;
}

export interface ExerciseTaskPrescription {
  id: string;
  exerciseVariantId: string;
  stimulusSlotId?: string;
  mode?: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  sets: readonly ExerciseSetPrescription[];
}

export interface StimulusIntentData {
  movementPattern: import("../knowledge/model").MovementPattern;
  muscleGroups: readonly string[];
  stability: "supported" | "free" | "either";
  prescriptionMode: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  fatigueIntent: "low" | "medium" | "high";
  priority: "primary" | "maintenance" | "optional";
}

export interface ExerciseResolutionData {
  status: "resolved" | "unresolved";
  exerciseVariantId?: string;
  satisfiedContracts: readonly string[];
  deviatedContracts: readonly string[];
  requiredEquipment: readonly string[];
  performanceComparability: "exact_variant" | "cold_start";
  coldStart: boolean;
  sessionTimeImpactMinutes: number;
  fatigueImpact: "low" | "medium" | "high";
  cameraCapability: "available" | "manual_only";
  reasonCodes: readonly string[];
}

export interface StimulusSlotData {
  id: string;
  intent: StimulusIntentData;
  prescription: {
    setCount: number;
    repRange?: { min: number; max: number };
    duration?: DurationQuantity;
    distance?: { value: number; unit: "m" | "km" };
    targetRir?: number;
    rest?: DurationQuantity;
  };
  exerciseSlot: ExerciseResolutionData;
  lockedFields: readonly string[];
}

export interface SessionPrescriptionData {
  id: string;
  title: string;
  scheduledFor: string;
  knowledgePins: import("../knowledge/model").KnowledgeVersionPins;
  kind?: "weighted_reps" | "bodyweight_reps" | "cardio" | "recovery" | "rest";
  locationId?: string;
  durationBudget?: DurationQuantity;
  stimulusSlots?: readonly StimulusSlotData[];
  status?: "planned" | "frozen_for_workout";
  tasks: readonly ExerciseTaskPrescription[];
}

export interface WeekPlanData {
  id: string;
  ordinal: number;
  startDate: string;
  endDate: string;
  sessions: readonly SessionPrescriptionData[];
  stimulusBudget: readonly StimulusBudgetData[];
  materializedAt: string;
}

export interface PlanRevisionData {
  id: string;
  goalContractRef: DomainAggregateRef<"goal_contract">;
  goalCycleRef?: DomainAggregateRef<"goal_cycle">;
  baseRevision?: number;
  effectiveFrom: string;
  knowledgePins: import("../knowledge/model").KnowledgeVersionPins;
  materializedWeeks?: readonly WeekPlanData[];
  futureIntentRefs?: readonly string[];
  reasonCodes?: readonly string[];
  strategySelection?: import("../planning").StrategySelection;
  appliedPhaseStrategy?: import("../planning").AppliedPhaseStrategy;
  trainingStrategy?: import("../planning").TrainingStrategy;
  nutritionStrategy?: import("../planning").PlanningNutritionStrategy;
  recoveryStrategy?: import("../planning").RecoveryStrategy;
  explanation?: import("../planning").RecommendationExplanation;
  adaptiveForecasts?: readonly import("../planning").AdaptiveForecastScenario[];
  sessions: readonly SessionPrescriptionData[];
}

export interface PrescriptionRef {
  planId: string;
  planRevision: number;
  sessionPrescriptionId: string;
}

export type WorkoutSessionStatus = "planned" | "active" | "paused" | "completed" | "partial" | "abandoned";
export type WorkoutExecutionMode = "record_only" | "coach_monitor";

export interface WorkoutSessionPolicy {
  id: string;
  version: string;
  /** Explicit policy, not a magic UI timeout. */
  resumeWindowHours: number;
  defaultRest?: DurationQuantity;
}

export interface RestTimerData {
  id: string;
  setId: string;
  deadlineMonotonicMs: number;
  /** Optional because legacy/default clocks may not expose a stable epoch. */
  monotonicClockEpoch?: string;
  deadlineWallClockAt: string;
  duration: DurationQuantity;
  notificationId?: string;
}

export interface WorkoutExecutionState {
  status: WorkoutSessionStatus;
  mode: WorkoutExecutionMode;
  currentTaskId?: string;
  currentSetId?: string;
  pauseReason?: "user" | "safety" | "background" | "schedule";
  restTimer?: RestTimerData;
  policy: WorkoutSessionPolicy;
  transitions: readonly {
    from: WorkoutSessionStatus;
    to: WorkoutSessionStatus;
    reason: string;
    actor: DomainActor;
    occurredAt: string;
    idempotencyKey: string;
  }[];
}

export interface SetDraftData {
  id: string;
  prescriptionSetId: string;
  exerciseVariantId: string;
  /** Copied for UI convenience only; never becomes a SetOutcome until explicit confirmation. */
  proposedFromPrescription: ExerciseSetPrescription;
  actualLoad?: MassQuantity;
  actualReps?: number;
  actualDuration?: DurationQuantity;
  actualDistance?: { value: number; unit: "m" | "km" };
  assistance?: string;
  actualRir?: number;
  noviceFeedback?: "easy" | "appropriate" | "hard";
  noviceFeedbackMappingVersion?: string;
  note?: string;
  status: "draft";
  createdAt: string;
  updatedAt: string;
}

export interface SessionOutcomeData {
  status: "completed" | "partial" | "abandoned";
  completedAt: string;
  completedWorkSets: number;
  directSets: number;
  incompletePrescriptionSetIds: readonly string[];
  /** Explicitly skipped prescription sets are resolved, but never counted as performed volume. */
  skippedPrescriptionSetIds?: readonly string[];
  subjectiveFeedback?: "easy" | "appropriate" | "hard";
  motionPacketRefs: readonly { id: string; version: number; hash: string }[];
  dataCompleteness: "complete" | "partial" | "manual_only";
}

export interface SetOutcomeData {
  id: string;
  prescriptionSetId: string;
  exerciseVariantId: string;
  actualLoad?: MassQuantity;
  actualReps?: number;
  actualDuration?: DurationQuantity;
  actualDistance?: { value: number; unit: "m" | "km" };
  assistance?: string;
  actualRir?: number;
  noviceFeedback?: "easy" | "appropriate" | "hard";
  noviceFeedbackMappingVersion?: string;
  note?: string;
  completedAs?: "confirmed_as_planned" | "user_edited" | "imported" | "camera_confirmed";
  source: "user_confirmed" | "imported" | "camera_confirmed";
  packetRef?: {
    id: string;
    version: number;
    hash: string;
  };
}

/**
 * An explicit execution fact for a prescribed set the user chose not to do.
 * It advances the task frontier without fabricating a performed SetOutcome.
 */
export interface SkippedSetData {
  id: string;
  prescriptionSetId: string;
  exerciseVariantId: string;
  reason: string;
  skippedAt: string;
}

/**
 * A correction is a new, append-only fact about a committed set.  It keeps
 * the semantic set identity stable for comparable-performance queries while
 * the ledger retains both the recorded outcome and every correction event.
 */
export interface SetOutcomeCorrectionData {
  id: string;
  correctsOutcomeId: string;
  replacement: SetOutcomeData;
  reason: string;
}

/** Null explicitly clears a user-entered field; omission preserves it. */
export interface SetOutcomeCorrectionPatch {
  actualLoad?: MassQuantity | null;
  actualReps?: number | null;
  actualDuration?: DurationQuantity | null;
  actualDistance?: { value: number; unit: "m" | "km" } | null;
  assistance?: string | null;
  actualRir?: number | null;
  noviceFeedback?: "easy" | "appropriate" | "hard" | null;
  note?: string | null;
}

/**
 * Session totals are derived from committed set outcomes; the only
 * user-correctable session-level field in the first delivery is the user's
 * subjective feedback.  A terminal state is never reopened by a correction.
 */
export interface SessionOutcomeCorrectionData {
  id: string;
  outcome: SessionOutcomeData;
  reason: string;
}

export interface SessionOutcomeCorrectionPatch {
  status?: "completed" | "partial";
  subjectiveFeedback?: "easy" | "appropriate" | "hard" | null;
}

/**
 * A deliberately small, typed surface for edits made while a WorkoutSession
 * is running.  The caller never supplies a whole replacement document: this
 * keeps completed sets, an in-progress draft, and the immutable session
 * identity outside the editable surface.
 */
export type UpcomingWorkoutPrescriptionChange =
  | {
      kind: "adjust_set";
      taskId: string;
      setId: string;
      patch: {
        targetReps?: { min: number; max: number } | null;
        targetDuration?: DurationQuantity | null;
        targetDistance?: { value: number; unit: "m" | "km" } | null;
        targetLoad?: MassQuantity | null;
        targetRir?: number | null;
        rest?: DurationQuantity | null;
      };
    }
  | {
      kind: "add_task";
      task: ExerciseTaskPrescription;
      index?: number;
    }
  | {
      kind: "remove_task";
      taskId: string;
    }
  | {
      kind: "replace_task_exercise";
      taskId: string;
      replacementExerciseVariantId: string;
      /**
       * A replacement starts a new comparable-performance context.  Caller
       * supplied sets may change reps/RIR/rest, but may never carry an
       * absolute target load from the prior exercise.
       */
      replacementSets?: readonly ExerciseSetPrescription[];
    }
  | {
      kind: "reorder_task";
      taskId: string;
      toIndex: number;
    };

export type TimelineFact =
  | {
      kind: "training";
      workoutSessionRef?: DomainAggregateRef<"workout_session">;
      historicalSet?: {
        exerciseVariantId: string;
        load: MassQuantity;
        reps: number;
        rir?: number;
      };
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "activity";
      activityType: string;
      duration?: DurationQuantity;
      distance?: { value: number; unit: "m" | "km" };
      intensity?: "easy" | "moderate" | "hard" | "unknown";
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "nutrition";
      observationId: string;
      /** Absent when the person only recorded a time; it is then inferred for display only. */
      mealSlot?: import("../nutrition").MealSlot;
      /** The foods the meal was built from, kept so a total can be traced back. */
      foods?: readonly import("../nutrition").FoodEntryData[];
      energy?: EnergyQuantity;
      proteinGrams?: number;
      fatGrams?: number;
      carbohydrateGrams?: number;
      observationMode?: "precise" | "simplified" | "user_confirmed_estimate";
      mealDescription?: string;
      /** Qualitative self-report stays qualitative; it is never converted to calories. */
      simplified?: {
        proteinCompletion: "none" | "partial" | "met";
        hunger: "low" | "moderate" | "high";
        deviation: "none" | "small" | "large";
      };
      /** Confirmation preserves the original estimate range/provenance. */
      estimate?: {
        sourceDraftId?: string;
        estimates: readonly import("../nutrition").NutrientEstimate[];
        provider?: { id: string; modelVersion: string; processingScope: "text" | "photo" };
        userEdited?: boolean;
        /** Original Draft remains immutable; this is a user-confirmed diff. */
        userEdits?: import("../nutrition").NutritionObservationDraftEdits;
      };
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "sleep";
      duration?: DurationQuantity;
      quality?: number;
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "body";
      measurement:
        | { metric: "body_weight"; quantity: MassQuantity; condition?: string }
        | {
            metric: "body_fat_percentage";
            quantity: PercentageQuantity;
            condition?: string;
            method?: string;
            algorithmVersion?: string;
            estimate?: {
              formulaId: string;
              inputs: Readonly<Record<string, LengthQuantity | MassQuantity | number>>;
              range: { min: PercentageQuantity; max: PercentageQuantity };
              measuredAt: string;
              userOverride?: PercentageQuantity;
            };
          }
        | {
            metric: "circumference";
            site: string;
            quantity: LengthQuantity;
            condition?: string;
          };
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "recovery";
      perceivedRecovery?: number;
      fatigue?: number;
      hrv?: number;
      /** SDNN and RMSSD are intentionally never a shared baseline. */
      hrvMetric?: "sdnn" | "rmssd";
      hrvUnit?: "milliseconds";
      restingHeartRate?: number;
      restingHeartRateUnit?: "beats_per_minute";
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "symptom";
      symptom: "soreness" | "pain";
      area?: string;
      severity?: number;
      note?: string;
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "schedule";
      effect: "availability_changed" | "travel" | "work_conflict" | "other";
      note?: string;
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "rest";
      note?: string;
      confidence: "confirmed" | "estimated";
    };

export interface EquipmentProfileData {
  id: string;
  name: string;
  schemaVersion?: 1;
  locationKind?: "home" | "gym" | "hotel" | "outdoor" | "other";
  environment?: {
    space: "small" | "medium" | "large";
    noise: "quiet" | "moderate" | "any";
    floorImpact: "low" | "any";
    fixedConditions?: readonly string[];
  };
  /** Kept as an import-friendly projection; `equipment` is authoritative when present. */
  equipmentIds: readonly string[];
  equipment?: readonly EquipmentProfileItemData[];
  catalogVersion?: string;
  reviewedAt?: string;
}

export interface EquipmentProfileItemData {
  id: string;
  status: "available" | "busy" | "broken" | "unknown";
  quantity?: number;
  attachments?: readonly string[];
  loadRange?: { min: MassQuantity; max: MassQuantity; increment?: MassQuantity };
  discreteLoads?: readonly MassQuantity[];
  settings?: readonly number[];
  note?: string;
}

export interface TemporaryEquipmentStateData {
  equipmentId: string;
  status: "available" | "busy" | "broken" | "unknown";
  scope: "current_session";
  observedAt: string;
  note?: string;
}

export interface RecoveryConstraintData {
  id: string;
  level: "normal" | "slight_reduction" | "recovery_priority" | "pause_and_confirm";
  validUntil: string;
  scope?: "next_set" | "remaining_session" | "next_session" | "future_plan";
  intentions?: readonly {
    kind: "increase_rir" | "remove_optional_sets" | "shorten_session" | "extend_rest" | "avoid_area" | "reschedule" | "pause" | "warmup_check";
    magnitude?: number;
    area?: string;
  }[];
  evaluation?: {
    rulePackId: string;
    ruleVersion: string;
    evaluatedAt: string;
    triggeringFactRefs: readonly string[];
    corroboratingFactRefs: readonly string[];
    contradictingFactRefs: readonly string[];
    missingOrStale: readonly string[];
    reasonCodes: readonly string[];
    confirmationRequired: boolean;
  };
}

export interface NutritionStrategyData {
  id: string;
  goalContractRef: DomainAggregateRef<"goal_contract">;
  calorieRange?: { min: EnergyQuantity; max: EnergyQuantity };
  status?: "draft" | "active" | "paused" | "review_required";
  goalCycleRef?: DomainAggregateRef<"goal_cycle">;
  phase?: "hypertrophy" | "strength_stable" | "fat_loss_preserve_lean_mass";
  reviewWindow?: { startsAt: string; endsAt: string; minimumWeightObservations: number };
  macronutrientTargets?: {
    proteinGrams: { min: number; max: number };
    fatEnergyFloorPercent: number;
    carbohydrateGrams?: { min: number; max: number };
  };
  dayTypes?: readonly {
    date: string;
    kind: "training" | "rest" | "deload" | "recovery";
    namedSessionId?: string;
    energy?: EnergyQuantity;
    carbohydrateGrams?: number;
  }[];
  ruleVersion?: string;
  confidence?: "provisional" | "trend_calibrated" | "low";
  evidenceRefs?: readonly string[];
}

export interface CustomExerciseVariantData {
  id: string;
  name: string;
  movement?: import("../knowledge/model").MovementPattern;
  prescriptionMode: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  equipmentRequirement: EquipmentRequirement;
  unknownFields: readonly (
    | "expected_muscles"
    | "stimulus"
    | "difficulty"
    | "load_history"
    | "equipment"
    | "motion_capability"
  )[];
  motionCapability: "unknown";
}

export interface DomainEventEnvelope<
  Name extends DomainEventName,
  Kind extends DomainAggregateKind,
  Payload,
> {
  id: string;
  schemaVersion: typeof DOMAIN_EVENT_SCHEMA_VERSION;
  name: Name;
  userId: string;
  aggregate: DomainAggregateRef<Kind>;
  actor: DomainActor;
  deviceId: string;
  occurredAt: string;
  recordedAt: string;
  timezoneOffsetMinutes: number;
  provenance: {
    source: DomainActor["kind"];
    confidence: "confirmed" | "estimated" | "unknown";
  };
  evidenceRefs: readonly ImmutableEvidenceRef[];
  causationId: string;
  correlationId: string;
  payload: Payload;
}

export type DomainEventName =
  | "user_profile.created"
  | "user_profile.revised"
  | "user_profile.corrected"
  | "goal_contract.created"
  | "goal_contract.revised"
  | "coaching_mandate.created"
  | "coaching_mandate.revised"
  | "goal_cycle.created"
  | "goal_cycle.revised"
  | "plan.revised"
  | "workout.prepared"
  | "workout.started"
  | "workout.state_changed"
  | "workout.draft_set_saved"
  | "workout.draft_set_retracted"
  | "workout.prescription_revised"
  | "workout.set_recorded"
  | "workout.set_skipped"
  | "workout.set_corrected"
  | "workout.completed"
  | "workout.outcome_corrected"
  | "timeline.fact_appended"
  | "timeline.fact_corrected"
  | "timeline.source_mutated"
  | "timeline.source_tombstoned"
  | "equipment_profile.created"
  | "equipment_profile.revised"
  | "recovery_constraint.created"
  | "recovery_constraint.revised"
  | "nutrition_strategy.created"
  | "nutrition_strategy.revised"
  | "custom_exercise.created"
  | "custom_exercise.revised"
  | "permission_set.created"
  | "permission_set.revised"
  | "safety_constraint.created"
  | "safety_constraint.revised"
  | "aggregate.archived"
  | "aggregate.restored";

export type DomainEvent =
  | DomainEventEnvelope<"user_profile.created" | "user_profile.revised", "user_profile", UserProfileData>
  | DomainEventEnvelope<
      "user_profile.corrected",
      "user_profile",
      { profile: UserProfileData; correctsEventId: string; reason: string }
    >
  | DomainEventEnvelope<"goal_contract.created" | "goal_contract.revised", "goal_contract", GoalContractData>
  | DomainEventEnvelope<"coaching_mandate.created" | "coaching_mandate.revised", "coaching_mandate", CoachingMandateData>
  | DomainEventEnvelope<"goal_cycle.created" | "goal_cycle.revised", "goal_cycle", GoalCycleData>
  | DomainEventEnvelope<"plan.revised", "plan", PlanRevisionData>
  | DomainEventEnvelope<
      "workout.prepared",
      "workout_session",
      {
        prescriptionRef: PrescriptionRef;
        frozenPrescription: SessionPrescriptionData;
        state: WorkoutExecutionState;
      }
    >
  | DomainEventEnvelope<
      "workout.started",
      "workout_session",
      {
        prescriptionRef: PrescriptionRef;
        frozenPrescription: SessionPrescriptionData;
        state?: WorkoutExecutionState;
      }
    >
  | DomainEventEnvelope<"workout.state_changed", "workout_session", { state: WorkoutExecutionState }>
  | DomainEventEnvelope<"workout.draft_set_saved", "workout_session", { draft: SetDraftData }>
  | DomainEventEnvelope<"workout.draft_set_retracted", "workout_session", { draftId: string; reason: string }>
  | DomainEventEnvelope<
      "workout.prescription_revised",
      "workout_session",
      { frozenPrescription: SessionPrescriptionData; reason: string; scope: "next_set" | "future_sets" | "future_tasks" }
    >
  | DomainEventEnvelope<"workout.set_recorded", "workout_session", { outcome: SetOutcomeData }>
  | DomainEventEnvelope<"workout.set_skipped", "workout_session", { skipped: SkippedSetData }>
  | DomainEventEnvelope<"workout.set_corrected", "workout_session", { correction: SetOutcomeCorrectionData }>
  | DomainEventEnvelope<
      "workout.completed",
      "workout_session",
      { status: "completed" | "partial"; completedAt: string; outcome?: SessionOutcomeData }
    >
  | DomainEventEnvelope<
      "workout.outcome_corrected",
      "workout_session",
      { correction: SessionOutcomeCorrectionData }
    >
  | DomainEventEnvelope<
      "timeline.fact_appended",
      "timeline",
      { fact: TimelineFact; entry?: import("../timeline").TimelineFactEnvelope }
    >
  | DomainEventEnvelope<
      "timeline.fact_corrected",
      "timeline",
      {
        fact: TimelineFact;
        correctsEventId: string;
        reason?: string;
        entry?: import("../timeline").TimelineFactEnvelope;
      }
    >
  | DomainEventEnvelope<
      "timeline.source_mutated",
      "timeline",
      {
        fact: TimelineFact;
        sourceEventId: string;
        reason: "source_updated" | "source_deleted" | "source_revoked";
        entry: import("../timeline").TimelineFactEnvelope;
      }
    >
  | DomainEventEnvelope<
      "timeline.source_tombstoned",
      "timeline",
      { sourceEventId: string; reason: "source_deleted" | "source_revoked" }
    >
  | DomainEventEnvelope<
      "equipment_profile.created" | "equipment_profile.revised",
      "equipment_profile",
      EquipmentProfileData
    >
  | DomainEventEnvelope<
      "recovery_constraint.created" | "recovery_constraint.revised",
      "recovery_constraint",
      RecoveryConstraintData
    >
  | DomainEventEnvelope<
      "nutrition_strategy.created" | "nutrition_strategy.revised",
      "nutrition_strategy",
      NutritionStrategyData
    >
  | DomainEventEnvelope<
      "custom_exercise.created" | "custom_exercise.revised",
      "custom_exercise",
      CustomExerciseVariantData
    >
  | DomainEventEnvelope<
      "permission_set.created" | "permission_set.revised",
      "permission_set",
      PermissionSetData
    >
  | DomainEventEnvelope<
      "safety_constraint.created" | "safety_constraint.revised",
      "safety_constraint",
      SafetyConstraintData
    >
  | DomainEventEnvelope<
      "aggregate.archived" | "aggregate.restored",
      DomainAggregateKind,
      { reason?: string }
    >;

export interface AggregateRevisionState {
  kind: DomainAggregateKind;
  id: string;
  userId: string;
  revision: number;
  archived: boolean;
}

export interface DomainIdempotencyRecord {
  userId: string;
  actorId: string;
  intent: string;
  key: string;
  eventIds: readonly string[];
  aggregateRevisions: readonly DomainAggregateRef[];
  recordedAt: string;
}

export interface OutboxEntry {
  id: string;
  userId: string;
  replicaId: string;
  deviceId: string;
  domainEventId: string;
  payloadHash: string;
  status: "pending" | "acknowledged" | "conflict";
  createdAt: string;
  acknowledgedAt?: string;
  remoteCursor?: string;
  conflict?: {
    code: "concurrent_revision" | "unknown_schema" | "account_mismatch";
    remoteRevision?: number;
  };
}

export interface DataLifecycleStatus {
  aggregate: DomainAggregateRef;
  structuredData: "active" | "archived" | "missing";
  replicaReferences: {
    pending: number;
    acknowledged: number;
    conflicts: number;
  };
  evidenceReferences: {
    canonicalPackets: number;
    media: number;
    disposition: "retained" | "not_present";
  };
}

interface CommandBase<Type extends string> {
  type: Type;
  meta: CommandMeta;
}

export type DomainCommand =
  | (CommandBase<"user.bootstrap"> & {
      profile: UserProfileData;
      goalContract: GoalContractData;
      mandate: CoachingMandateData;
    })
  | (CommandBase<"profile.revise"> & {
      profileId: string;
      expectedRevision: number;
      profile: UserProfileData;
    })
  | (CommandBase<"profile.correct"> & {
      profileId: string;
      expectedRevision: number;
      correctsEventId: string;
      reason: string;
      profile: UserProfileData;
    })
  | (CommandBase<"goal_contract.revise"> & {
      goalContractId: string;
      expectedRevision: number;
      goalContract: GoalContractData;
    })
  | (CommandBase<"mandate.revise"> & {
      mandateId: string;
      expectedRevision: number;
      mandate: CoachingMandateData;
      authorization: LocalSettingsAuthorization;
    })
  | (CommandBase<"goal_cycle.revise"> & {
      goalCycleId: string;
      expectedRevision: number;
      goalCycle: GoalCycleData;
    })
  | (CommandBase<"timeline.append"> & {
      timelineId: string;
      expectedRevision: number;
      fact: TimelineFact;
      entry?: import("../timeline").TimelineFactEnvelope;
    })
  | (CommandBase<"timeline.correct"> & {
      timelineId: string;
      expectedRevision: number;
      correctsEventId: string;
      fact: TimelineFact;
      reason?: string;
      entry?: import("../timeline").TimelineFactEnvelope;
    })
  | (CommandBase<"timeline.source_mutate"> & {
      timelineId: string;
      expectedRevision: number;
      sourceEventId: string;
      reason: "source_updated" | "source_deleted" | "source_revoked";
      fact: TimelineFact;
      entry: import("../timeline").TimelineFactEnvelope;
    })
  | (CommandBase<"timeline.source_tombstone"> & {
      timelineId: string;
      expectedRevision: number;
      sourceEventId: string;
      reason: "source_deleted" | "source_revoked";
    })
  | (CommandBase<"plan.revise"> & {
      planId: string;
      expectedRevision: number;
      revision: PlanRevisionData;
    })
  | (CommandBase<"workout.start"> & {
      workoutId: string;
      expectedRevision: number;
      prescriptionRef: PrescriptionRef;
      mode?: WorkoutExecutionMode;
      policy?: WorkoutSessionPolicy;
    })
  | (CommandBase<"workout.prepare"> & {
      workoutId: string;
      expectedRevision: number;
      prescriptionRef: PrescriptionRef;
      mode: WorkoutExecutionMode;
      policy: WorkoutSessionPolicy;
    })
  | (CommandBase<"workout.transition"> & {
      workoutId: string;
      expectedRevision: number;
      state: WorkoutExecutionState;
    })
  | (CommandBase<"workout.save_draft_set"> & {
      workoutId: string;
      expectedRevision: number;
      draft: SetDraftData;
    })
  | (CommandBase<"workout.retract_draft_set"> & {
      workoutId: string;
      expectedRevision: number;
      draftId: string;
      reason: string;
    })
  | (CommandBase<"workout.revise_prescription"> & {
      workoutId: string;
      expectedRevision: number;
      frozenPrescription: SessionPrescriptionData;
      reason: string;
      scope: "next_set" | "future_sets" | "future_tasks";
    })
  | (CommandBase<"workout.record_set"> & {
      workoutId: string;
      expectedRevision: number;
      outcome: SetOutcomeData;
    })
  | (CommandBase<"workout.skip_set"> & {
      workoutId: string;
      expectedRevision: number;
      skipped: SkippedSetData;
    })
  | (CommandBase<"workout.correct_set_outcome"> & {
      workoutId: string;
      expectedRevision: number;
      correction: SetOutcomeCorrectionData;
    })
  | (CommandBase<"workout.complete"> & {
      workoutId: string;
      expectedRevision: number;
      status: "completed" | "partial";
      outcome?: SessionOutcomeData;
      timeline?: {
        timelineId: string;
        expectedRevision: number;
        fact: TimelineFact;
        entry?: import("../timeline").TimelineFactEnvelope;
      };
    })
  | (CommandBase<"workout.correct_session_outcome"> & {
      workoutId: string;
      expectedRevision: number;
      correction: SessionOutcomeCorrectionData;
    })
  | (CommandBase<"equipment_profile.revise"> & {
      equipmentProfileId: string;
      expectedRevision: number;
      equipmentProfile: EquipmentProfileData;
    })
  | (CommandBase<"recovery_constraint.revise"> & {
      recoveryConstraintId: string;
      expectedRevision: number;
      recoveryConstraint: RecoveryConstraintData;
    })
  | (CommandBase<"nutrition_strategy.revise"> & {
      nutritionStrategyId: string;
      expectedRevision: number;
      nutritionStrategy: NutritionStrategyData;
    })
  | (CommandBase<"custom_exercise.create"> & {
      customExerciseId: string;
      exercise: CustomExerciseVariantData;
    })
  | (CommandBase<"custom_exercise.revise"> & {
      customExerciseId: string;
      expectedRevision: number;
      exercise: CustomExerciseVariantData;
    })
  | (CommandBase<"permission_set.revise"> & {
      permissionSetId: string;
      expectedRevision: number;
      permissionSet: PermissionSetData;
      authorization: LocalSettingsAuthorization;
    })
  | (CommandBase<"safety_constraint.revise"> & {
      safetyConstraintId: string;
      expectedRevision: number;
      safetyConstraint: SafetyConstraintData;
    })
  | (CommandBase<"aggregate.archive" | "aggregate.restore"> & {
      aggregateRef: DomainAggregateRef;
      reason?: string;
    });

export interface DomainCommandResult {
  status: "committed" | "idempotent";
  eventIds: readonly string[];
  aggregateRevisions: readonly DomainAggregateRef[];
}

export interface Revisioned<T> {
  revision: number;
  value: T;
}

export interface TimelineProjectionEvent {
  eventId: string;
  revision: number;
  occurredAt: string;
  recordedAt: string;
  timezoneOffsetMinutes: number;
  fact: TimelineFact;
  envelope?: import("../timeline").TimelineFactEnvelope;
  correctsEventId?: string;
  sourceMutationOfEventId?: string;
  tombstonesEventId?: string;
  lifecycle?: "active" | "superseded" | "tombstoned";
}

export interface WorkoutProjection {
  id: string;
  revision: number;
  prescriptionRef: PrescriptionRef;
  frozenPrescription: SessionPrescriptionData;
  setOutcomes: readonly SetOutcomeData[];
  skippedSets?: readonly SkippedSetData[];
  /** Effective corrections; original event facts remain in the Ledger. */
  setOutcomeCorrections?: readonly SetOutcomeCorrectionData[];
  drafts: readonly SetDraftData[];
  state: WorkoutExecutionState;
  outcome?: SessionOutcomeData;
  sessionOutcomeCorrections?: readonly SessionOutcomeCorrectionData[];
  status: WorkoutSessionStatus;
}

export interface DomainProjection {
  userId: string;
  profile?: Revisioned<UserProfileData>;
  goalContract?: Revisioned<GoalContractData>;
  mandate?: Revisioned<CoachingMandateData>;
  goalCycles: readonly Revisioned<GoalCycleData>[];
  plan?: Revisioned<PlanRevisionData>;
  planStatus?: "current" | "stale_goal_contract";
  equipmentProfiles: readonly Revisioned<EquipmentProfileData>[];
  recoveryConstraints: readonly Revisioned<RecoveryConstraintData>[];
  nutritionStrategies: readonly Revisioned<NutritionStrategyData>[];
  customExercises: readonly Revisioned<CustomExerciseVariantData>[];
  permissions?: Revisioned<PermissionSetData>;
  safetyConstraints: readonly Revisioned<SafetyConstraintData>[];
  timeline: {
    revision: number;
    events: readonly TimelineProjectionEvent[];
    current: readonly TimelineProjectionEvent[];
    tombstones: readonly {
      eventId: string;
      revision: number;
      sourceEventId: string;
      reason: "source_deleted" | "source_revoked";
      occurredAt: string;
      recordedAt: string;
    }[];
  };
  workouts: readonly WorkoutProjection[];
  archivedAggregates: readonly DomainAggregateRef[];
}

export interface DomainProjectionQuery {
  userId: string;
  date?: string;
}

export function projectDomainEvents(
  events: readonly DomainEvent[],
  query: DomainProjectionQuery,
): DomainProjection {
  const relevant = events.filter((event) => event.userId === query.userId);
  let profile: Revisioned<UserProfileData> | undefined;
  let goalContract: Revisioned<GoalContractData> | undefined;
  let mandate: Revisioned<CoachingMandateData> | undefined;
  let plan: Revisioned<PlanRevisionData> | undefined;
  const goalCycles = new Map<string, Revisioned<GoalCycleData>>();
  const equipmentProfiles = new Map<string, Revisioned<EquipmentProfileData>>();
  const recoveryConstraints = new Map<string, Revisioned<RecoveryConstraintData>>();
  const nutritionStrategies = new Map<string, Revisioned<NutritionStrategyData>>();
  const customExercises = new Map<string, Revisioned<CustomExerciseVariantData>>();
  let permissions: Revisioned<PermissionSetData> | undefined;
  const safetyConstraints = new Map<string, Revisioned<SafetyConstraintData>>();
  const archivedAggregates = new Map<string, DomainAggregateRef>();
  const timelineEvents: TimelineProjectionEvent[] = [];
  const timelineTombstones: {
    eventId: string;
    revision: number;
    sourceEventId: string;
    reason: "source_deleted" | "source_revoked";
    occurredAt: string;
    recordedAt: string;
  }[] = [];
  const workouts = new Map<string, WorkoutProjection>();

  for (const event of relevant) {
    if (event.name === "user_profile.created" || event.name === "user_profile.revised") {
      profile = { revision: event.aggregate.revision, value: event.payload };
    } else if (event.name === "user_profile.corrected") {
      profile = { revision: event.aggregate.revision, value: event.payload.profile };
    } else if (event.name === "goal_contract.created" || event.name === "goal_contract.revised") {
      goalContract = { revision: event.aggregate.revision, value: event.payload };
    } else if (
      event.name === "coaching_mandate.created" ||
      event.name === "coaching_mandate.revised"
    ) {
      mandate = { revision: event.aggregate.revision, value: event.payload };
    } else if (event.name === "plan.revised") {
      plan = { revision: event.aggregate.revision, value: event.payload };
    } else if (event.name === "goal_cycle.created" || event.name === "goal_cycle.revised") {
      goalCycles.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (
      event.name === "equipment_profile.created" ||
      event.name === "equipment_profile.revised"
    ) {
      equipmentProfiles.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (
      event.name === "recovery_constraint.created" ||
      event.name === "recovery_constraint.revised"
    ) {
      recoveryConstraints.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (
      event.name === "nutrition_strategy.created" ||
      event.name === "nutrition_strategy.revised"
    ) {
      nutritionStrategies.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (
      event.name === "custom_exercise.created" ||
      event.name === "custom_exercise.revised"
    ) {
      customExercises.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (event.name === "permission_set.created" || event.name === "permission_set.revised") {
      permissions = { revision: event.aggregate.revision, value: event.payload };
    } else if (
      event.name === "safety_constraint.created" ||
      event.name === "safety_constraint.revised"
    ) {
      safetyConstraints.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (event.name === "aggregate.archived") {
      archivedAggregates.set(`${event.aggregate.kind}:${event.aggregate.id}`, event.aggregate);
      if (event.aggregate.kind === "user_profile" && profile?.value.id === event.aggregate.id) {
        profile = { ...profile, revision: event.aggregate.revision };
      } else if (
        event.aggregate.kind === "goal_contract" &&
        goalContract?.value.id === event.aggregate.id
      ) {
        goalContract = { ...goalContract, revision: event.aggregate.revision };
      } else if (event.aggregate.kind === "plan" && plan?.value.id === event.aggregate.id) {
        plan = { ...plan, revision: event.aggregate.revision };
      } else if (event.aggregate.kind === "custom_exercise") {
        const current = customExercises.get(event.aggregate.id);
        if (current) customExercises.set(event.aggregate.id, { ...current, revision: event.aggregate.revision });
      }
    } else if (event.name === "aggregate.restored") {
      archivedAggregates.delete(`${event.aggregate.kind}:${event.aggregate.id}`);
      if (event.aggregate.kind === "user_profile" && profile?.value.id === event.aggregate.id) {
        profile = { ...profile, revision: event.aggregate.revision };
      } else if (
        event.aggregate.kind === "goal_contract" &&
        goalContract?.value.id === event.aggregate.id
      ) {
        goalContract = { ...goalContract, revision: event.aggregate.revision };
      } else if (event.aggregate.kind === "plan" && plan?.value.id === event.aggregate.id) {
        plan = { ...plan, revision: event.aggregate.revision };
      } else if (event.aggregate.kind === "custom_exercise") {
        const current = customExercises.get(event.aggregate.id);
        if (current) customExercises.set(event.aggregate.id, { ...current, revision: event.aggregate.revision });
      }
    } else if (
      event.name === "timeline.fact_appended" ||
      event.name === "timeline.fact_corrected" ||
      event.name === "timeline.source_mutated"
    ) {
      timelineEvents.push({
        eventId: event.id,
        revision: event.aggregate.revision,
        occurredAt: event.occurredAt,
        recordedAt: event.recordedAt,
        timezoneOffsetMinutes: event.timezoneOffsetMinutes,
        fact: event.payload.fact,
        ...(event.payload.entry ? { envelope: event.payload.entry } : {}),
        ...(event.name === "timeline.fact_corrected"
          ? { correctsEventId: event.payload.correctsEventId }
          : {}),
        ...(event.name === "timeline.source_mutated"
          ? { sourceMutationOfEventId: event.payload.sourceEventId }
          : {}),
      });
    } else if (event.name === "timeline.source_tombstoned") {
      timelineTombstones.push({
        eventId: event.id,
        revision: event.aggregate.revision,
        sourceEventId: event.payload.sourceEventId,
        reason: event.payload.reason,
        occurredAt: event.occurredAt,
        recordedAt: event.recordedAt,
      });
    } else if (event.name === "workout.prepared" || event.name === "workout.started") {
      const state = event.payload.state ?? legacyWorkoutState(event, "active");
      workouts.set(event.aggregate.id, {
        id: event.aggregate.id,
        revision: event.aggregate.revision,
        prescriptionRef: event.payload.prescriptionRef,
        frozenPrescription: event.payload.frozenPrescription,
        setOutcomes: [],
        skippedSets: [],
        setOutcomeCorrections: [],
        drafts: [],
        state,
        status: state.status,
        sessionOutcomeCorrections: [],
      });
    } else if (event.name === "workout.state_changed") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          state: event.payload.state,
          status: event.payload.state.status,
        });
      }
    } else if (event.name === "workout.draft_set_saved") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          drafts: [
            ...current.drafts.filter((draft) => draft.id !== event.payload.draft.id),
            event.payload.draft,
          ],
        });
      }
    } else if (event.name === "workout.draft_set_retracted") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          drafts: current.drafts.filter((draft) => draft.id !== event.payload.draftId),
        });
      }
    } else if (event.name === "workout.prescription_revised") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          frozenPrescription: event.payload.frozenPrescription,
        });
      }
    } else if (event.name === "workout.set_recorded") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const setOutcomes = [...current.setOutcomes, event.payload.outcome];
        const next = nextWorkoutPrescriptionSet(current.frozenPrescription, [
          ...setOutcomes.map((outcome) => outcome.prescriptionSetId),
          ...(current.skippedSets ?? []).map((skipped) => skipped.prescriptionSetId),
        ]);
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          setOutcomes,
          drafts: current.drafts.filter(
            (draft) => draft.prescriptionSetId !== event.payload.outcome.prescriptionSetId,
          ),
          state: {
            ...current.state,
            ...(next ? { currentTaskId: next.taskId, currentSetId: next.setId } : { currentTaskId: undefined, currentSetId: undefined }),
          },
        });
      }
    } else if (event.name === "workout.set_skipped") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const skippedSets = current.skippedSets?.some(
          (skipped) => skipped.prescriptionSetId === event.payload.skipped.prescriptionSetId,
        )
          ? current.skippedSets
          : [...(current.skippedSets ?? []), event.payload.skipped];
        const next = nextWorkoutPrescriptionSet(current.frozenPrescription, [
          ...current.setOutcomes.map((outcome) => outcome.prescriptionSetId),
          ...skippedSets.map((skipped) => skipped.prescriptionSetId),
        ]);
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          skippedSets,
          drafts: current.drafts.filter(
            (draft) => draft.prescriptionSetId !== event.payload.skipped.prescriptionSetId,
          ),
          state: {
            ...current.state,
            ...(next ? { currentTaskId: next.taskId, currentSetId: next.setId } : { currentTaskId: undefined, currentSetId: undefined }),
          },
        });
      }
    } else if (event.name === "workout.set_corrected") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const correction = event.payload.correction;
        const original = current.setOutcomes.find((outcome) => outcome.id === correction.correctsOutcomeId);
        if (!original) continue;
        const setOutcomes = current.setOutcomes.map((outcome) =>
          outcome.id === correction.correctsOutcomeId ? correction.replacement : outcome,
        );
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          setOutcomes,
          setOutcomeCorrections: [...(current.setOutcomeCorrections ?? []), correction],
        });
      }
    } else if (event.name === "workout.completed") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const status = event.payload.outcome?.status ?? event.payload.status;
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          state: {
            ...current.state,
            status,
            transitions: [
              ...current.state.transitions,
              {
                from: current.state.status,
                to: status,
                reason: "session_completed",
                actor: event.actor,
                occurredAt: event.payload.completedAt,
                idempotencyKey: event.correlationId,
              },
            ],
          },
          ...(event.payload.outcome ? { outcome: event.payload.outcome } : {}),
          status,
        });
      }
    } else if (event.name === "workout.outcome_corrected") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const correction = event.payload.correction;
        const status = correction.outcome.status;
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          outcome: correction.outcome,
          status,
          state: {
            ...current.state,
            status,
            transitions: [
              ...current.state.transitions,
              {
                from: current.state.status,
                to: status,
                reason: "session_outcome_corrected",
                actor: event.actor,
                occurredAt: event.occurredAt,
                idempotencyKey: event.correlationId,
              },
            ],
          },
          sessionOutcomeCorrections: [...(current.sessionOutcomeCorrections ?? []), correction],
        });
      }
    }
  }

  const supersededIds = new Set(
    timelineEvents.flatMap((event) => [
      ...(event.correctsEventId ? [event.correctsEventId] : []),
      ...(event.sourceMutationOfEventId ? [event.sourceMutationOfEventId] : []),
    ]),
  );
  const tombstonedIds = new Set(
    relevant.flatMap((event) =>
      event.name === "timeline.source_tombstoned" ? [event.payload.sourceEventId] : [],
    ),
  );
  const lifecycleTimelineEvents = timelineEvents.map((event) => ({
    ...event,
    lifecycle: tombstonedIds.has(event.eventId)
      ? ("tombstoned" as const)
      : supersededIds.has(event.eventId)
        ? ("superseded" as const)
        : ("active" as const),
  }));
  const timelineRevision = relevant
    .filter((event) => event.aggregate.kind === "timeline")
    .reduce((revision, event) => Math.max(revision, event.aggregate.revision), 0);
  const visibleTimelineEvents = query.date
    ? lifecycleTimelineEvents.filter((event) => timelineDateKey(event) === query.date)
    : lifecycleTimelineEvents;

  const profileArchived = profile
    ? archivedAggregates.has(`user_profile:${profile.value.id}`)
    : false;
  const goalArchived = goalContract
    ? archivedAggregates.has(`goal_contract:${goalContract.value.id}`)
    : false;
  const planArchived = plan ? archivedAggregates.has(`plan:${plan.value.id}`) : false;
  const visiblePlan = planArchived ? undefined : plan;

  return {
    userId: query.userId,
    ...(profile && !profileArchived ? { profile } : {}),
    ...(goalContract && !goalArchived ? { goalContract } : {}),
    ...(mandate ? { mandate } : {}),
    goalCycles: [...goalCycles.values()],
    ...(visiblePlan ? { plan: visiblePlan } : {}),
    ...(visiblePlan && goalContract
      ? {
          planStatus:
            visiblePlan.value.goalContractRef.id === goalContract.value.id &&
            visiblePlan.value.goalContractRef.revision === goalContract.revision
              ? ("current" as const)
              : ("stale_goal_contract" as const),
        }
      : {}),
    equipmentProfiles: [...equipmentProfiles.values()],
    recoveryConstraints: [...recoveryConstraints.values()],
    nutritionStrategies: [...nutritionStrategies.values()],
    customExercises: [...customExercises.values()],
    ...(permissions ? { permissions } : {}),
    safetyConstraints: [...safetyConstraints.values()],
    timeline: {
      revision: timelineRevision,
      events: visibleTimelineEvents,
      current: visibleTimelineEvents.filter((event) => event.lifecycle === "active"),
      tombstones: timelineTombstones,
    },
    workouts: [...workouts.values()],
    archivedAggregates: [...archivedAggregates.values()],
  };
}

function legacyWorkoutState(
  event: Pick<DomainEventEnvelope<DomainEventName, DomainAggregateKind, unknown>, "actor" | "occurredAt" | "correlationId">,
  status: "active",
): WorkoutExecutionState {
  return {
    status,
    mode: "record_only",
    policy: { id: "legacy-session-policy", version: "1", resumeWindowHours: 24 },
    transitions: [
      {
        from: "planned",
        to: status,
        reason: "legacy_start",
        actor: event.actor,
        occurredAt: event.occurredAt,
        idempotencyKey: event.correlationId,
      },
    ],
  };
}

function nextWorkoutPrescriptionSet(
  prescription: SessionPrescriptionData,
  resolvedPrescriptionSetIds: readonly string[],
): { taskId: string; setId: string } | undefined {
  const resolved = new Set(resolvedPrescriptionSetIds);
  for (const task of prescription.tasks) {
    for (const set of task.sets) {
      if (!resolved.has(set.id)) return { taskId: task.id, setId: set.id };
    }
  }
  return undefined;
}

function timelineDateKey(event: TimelineProjectionEvent): string {
  const envelope = event.envelope;
  const sleep = event.fact.kind === "sleep";
  const instant = sleep ? envelope?.time.endedAt ?? event.occurredAt : envelope?.time.startedAt ?? event.occurredAt;
  const offset = sleep
    ? envelope?.time.endedTimezoneOffsetMinutes ?? envelope?.time.timezoneOffsetMinutes ?? event.timezoneOffsetMinutes
    : envelope?.time.timezoneOffsetMinutes ?? event.timezoneOffsetMinutes;
  const timestamp = Date.parse(instant);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + offset * 60_000).toISOString().slice(0, 10)
    : instant.slice(0, 10);
}
