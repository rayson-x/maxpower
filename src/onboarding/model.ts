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
  trainingExperience?: "beginner" | "intermediate" | "advanced";
  returningStatus?: "new" | "returning" | "consistent";
  schedule?: { weeklyFrequency: number; sessionDurationMinutes: number };
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

export interface OnboardingPatch {
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
      };
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
  confirmedSections: OnboardingSection[];
  nextRequiredSections: OnboardingSection[];
  lastInputMode?: "form" | "conversation";
  inputModeBySection: Partial<Record<OnboardingSection, "form" | "conversation">>;
  updatedAt: string;
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
      | "local_user_presence_required",
    readonly fields: readonly string[] = [],
  ) {
    super(`${code}${fields.length ? `: ${fields.join(", ")}` : ""}`);
    this.name = "OnboardingValidationError";
  }
}
