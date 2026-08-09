import type { MealObservation } from "./NutritionStrategyEngine";
import type { FoodEntryData, MealSlot } from "./NutritionDayLedger";

/**
 * A small, local-only boundary between a mobile form and canonical meal facts.
 * It intentionally has no food database, model, or nutrition calculation: the
 * values are exactly what the person chose to record.
 */
export interface ManualMealObservationInput {
  id: string;
  occurredAt: string;
  description: string;
  mealSlot?: MealSlot;
  foods?: readonly FoodEntryData[];
  mode: "precise" | "simplified";
  provenance: "manual" | "label";
  energyKcal?: number;
  proteinGrams?: number;
  fatGrams?: number;
  carbohydrateGrams?: number;
  simplified?: NonNullable<MealObservation["simplified"]>;
}

/**
 * Creates a user-confirmed meal observation without converting incomplete
 * qualitative input into a fictional calorie or macro value.
 */
export function createManualMealObservation(input: ManualMealObservationInput): MealObservation {
  const description = input.description.trim();
  if (!description) throw new Error("nutrition_description_required");
  if (!input.id || !input.occurredAt) throw new Error("nutrition_observation_identity_required");

  const nutrients = {
    ...(input.energyKcal === undefined ? {} : { energy: { value: input.energyKcal, unit: "kcal" as const } }),
    ...(input.proteinGrams === undefined ? {} : { proteinGrams: input.proteinGrams }),
    ...(input.fatGrams === undefined ? {} : { fatGrams: input.fatGrams }),
    ...(input.carbohydrateGrams === undefined ? { } : { carbohydrateGrams: input.carbohydrateGrams }),
  };
  for (const value of [input.energyKcal, input.proteinGrams, input.fatGrams, input.carbohydrateGrams]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error("nutrition_value_invalid");
    }
  }

  if (input.mode === "precise") {
    if (!Object.keys(nutrients).length) throw new Error("nutrition_precise_value_required");
    return {
      id: input.id,
      occurredAt: input.occurredAt,
      mode: "precise",
      description,
      ...(input.mealSlot ? { mealSlot: input.mealSlot } : {}),
      ...(input.foods ? { foods: input.foods } : {}),
      ...nutrients,
      provenance: input.provenance,
    };
  }

  if (input.provenance !== "manual") throw new Error("nutrition_simplified_requires_manual_provenance");
  if (!input.simplified) throw new Error("nutrition_simplified_details_required");
  return {
    id: input.id,
    occurredAt: input.occurredAt,
    mode: "simplified",
    description,
    ...(input.mealSlot ? { mealSlot: input.mealSlot } : {}),
    ...(input.foods ? { foods: input.foods } : {}),
    simplified: input.simplified,
    provenance: "manual",
  };
}
