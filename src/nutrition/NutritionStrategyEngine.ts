import type {
  EnergyQuantity,
  NutritionStrategyData,
} from "../coach/domain";

export interface NutritionStrategyRulePack {
  id: string;
  version: string;
  proteinGramsPerKg: Record<"hypertrophy" | "strength_stable" | "fat_loss_preserve_lean_mass", { min: number; max: number }>;
  fatFloorPercent: number;
  review: {
    minimumWeightObservations: number;
    minimumComparableWeeks: number;
    /** Numeric energy changes need enough distinct days of precise logging. */
    minimumPreciseDaysPerWeek: number;
    maximumDailyAdjustmentKcal: number;
  };
}

export const DEFAULT_NUTRITION_RULE_PACK: NutritionStrategyRulePack = {
  id: "maxpower-nutrition",
  version: "1.0.0",
  proteinGramsPerKg: {
    hypertrophy: { min: 1.6, max: 2.2 },
    strength_stable: { min: 1.6, max: 2.0 },
    fat_loss_preserve_lean_mass: { min: 1.8, max: 2.2 },
  },
  fatFloorPercent: 20,
  review: { minimumWeightObservations: 3, minimumComparableWeeks: 2, minimumPreciseDaysPerWeek: 3, maximumDailyAdjustmentKcal: 200 },
};

export interface MealObservation {
  id: string;
  occurredAt: string;
  mode: "structured" | "descriptive";
  description?: string;
  mealSlot?: import("./NutritionDayLedger").MealSlot;
  foods?: readonly import("./NutritionDayLedger").FoodEntryData[];
  nutrients?: readonly import("./NutritionDayLedger").NutrientValueData[];
  qualitative?: {
    proteinCompletion: "none" | "partial" | "met";
    hunger: "low" | "moderate" | "high";
    deviation: "none" | "small" | "large";
  };
  provenance: import("./NutritionDayLedger").NutrientValueSourceKind;
  /** Defaults to partial; complete must be explicitly selected by the user. */
  dayCoverage?: "partial" | "complete";
}

export interface NutritionObservationDraft {
  id: string;
  schemaVersion: 1;
  observation: MealObservation;
  generatedAt?: string;
  missing?: readonly string[];
  clarificationRequired?: boolean;
  status: "draft" | "confirmed" | "rejected";
}

/** Fixed safety inputs shared by strategy creation and candidate validation. */
export interface NutritionSafetyScreen {
  adultConfirmed: boolean;
  pregnancyOrLactation?: boolean;
  eatingDisorderOrExtremeRestriction?: boolean;
  diseaseSpecificDiet?: boolean;
  medicationOrSurgery?: boolean;
  professionalConflict?: boolean;
  rapidDehydrationOrWeightCut?: boolean;
  acuteSignal?: "chest_discomfort" | "fainting" | "severe_dizziness" | "rapid_unexplained_weight_change";
}

export function createNutritionStrategy(input: {
  id: string;
  goalContractRef: NutritionStrategyData["goalContractRef"];
  phase: NonNullable<NutritionStrategyData["phase"]>;
  bodyMassKg?: number;
  estimatedMaintenanceKcal?: number;
  reviewWindow: NutritionStrategyData["reviewWindow"];
  safety: NutritionSafetyScreen;
  rulePack?: NutritionStrategyRulePack;
}): NutritionStrategyData {
  const safetyReason = nutritionSafetyBlockReason(input.safety);
  const rules = input.rulePack ?? DEFAULT_NUTRITION_RULE_PACK;
  const maintenance = input.estimatedMaintenanceKcal;
  const multiplier = input.phase === "hypertrophy" ? 1.05 : input.phase === "fat_loss_preserve_lean_mass" ? 0.85 : 1;
  const proteinRange = input.bodyMassKg
    ? {
        min: round(input.bodyMassKg * rules.proteinGramsPerKg[input.phase].min),
        max: round(input.bodyMassKg * rules.proteinGramsPerKg[input.phase].max),
      }
    : undefined;
  return {
    id: input.id,
    goalContractRef: input.goalContractRef,
    status: safetyReason ? "paused" : "active",
    phase: input.phase,
    ...(maintenance ? {
      calorieRange: {
        // A daily calorie target does not gain useful accuracy from decimal
        // kcal. Whole numbers make the provisional range easier to read while
        // preserving the exact same bounded rule.
        min: { value: Math.round(maintenance * multiplier * 0.95), unit: "kcal" },
        max: { value: Math.round(maintenance * multiplier * 1.05), unit: "kcal" },
      },
    } : {}),
    ...(proteinRange ? {
      macronutrientTargets: {
        proteinGrams: proteinRange,
        fatEnergyFloorPercent: rules.fatFloorPercent,
      },
    } : {}),
    reviewWindow: input.reviewWindow,
    ruleVersion: `${rules.id}@${rules.version}`,
    confidence: maintenance && input.bodyMassKg ? "provisional" : "low",
    evidenceRefs: safetyReason ? [safetyReason] : [],
  };
}

/** Validates a candidate's day-type distribution without changing weekly energy. */
export function assertCarbDistributionInvariant(input: {
  strategy: NutritionStrategyData;
  weeklyBaselineEnergyKcal: number;
}): void {
  const days = input.strategy.dayTypes ?? [];
  if (!days.length) return;
  const weekly = days.reduce((sum, day) => sum + (day.energy?.value ?? 0), 0);
  if (Math.round(weekly) !== Math.round(input.weeklyBaselineEnergyKcal)) {
    throw new Error("carb_distribution_cannot_change_weekly_energy");
  }
  if (input.strategy.macronutrientTargets?.fatEnergyFloorPercent !== undefined && input.strategy.macronutrientTargets.fatEnergyFloorPercent < 20) {
    throw new Error("automatic_fat_floor_violation");
  }
}

export function confirmNutritionDraft(input: {
  draft: NutritionObservationDraft;
  observation: MealObservation;
}): MealObservation {
  if (input.draft.status !== "draft") throw new Error("nutrition_draft_not_confirmable");
  return input.observation;
}

/** Shared deterministic safety gate for creating and applying a strategy change. */
export function nutritionSafetyBlockReason(safety: NutritionSafetyScreen): string | undefined {
  if (!safety.adultConfirmed) return "nutrition_adult_confirmation_required";
  if (safety.pregnancyOrLactation) return "nutrition_pregnancy_or_lactation";
  if (safety.eatingDisorderOrExtremeRestriction) return "nutrition_disordered_eating_or_extreme_restriction";
  if (safety.diseaseSpecificDiet || safety.medicationOrSurgery) return "nutrition_medical_context";
  if (safety.professionalConflict) return "nutrition_professional_constraint";
  if (safety.rapidDehydrationOrWeightCut) return "nutrition_rapid_weight_cut";
  if (safety.acuteSignal) return `nutrition_${safety.acuteSignal}`;
  return undefined;
}

function round(value: number): number { return Math.round(value * 10) / 10; }
