import type { MealObservation } from "./NutritionStrategyEngine";
import { assertNutrientValues, type FoodEntryData, type MealSlot, type NutrientValueData, type NutrientValueSourceKind } from "./NutritionDayLedger";

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
  mode: "structured" | "descriptive";
  provenance: NutrientValueSourceKind;
  nutrients?: readonly NutrientValueData[];
  qualitative?: NonNullable<MealObservation["qualitative"]>;
  dayCoverage?: "partial" | "complete";
}

/**
 * Creates a user-confirmed meal observation without converting incomplete
 * qualitative input into a fictional calorie or macro value.
 */
export function createManualMealObservation(input: ManualMealObservationInput): MealObservation {
  const description = input.description.trim();
  if (!description) throw new Error("nutrition_description_required");
  if (!input.id || !input.occurredAt) throw new Error("nutrition_observation_identity_required");

  assertNutrientValues(input.nutrients ?? []);

  if (input.mode === "structured") {
    if (!input.nutrients?.length) throw new Error("nutrition_structured_value_required");
    if (input.nutrients.some((value) => value.source.kind !== input.provenance)) {
      throw new Error("nutrition_value_source_mismatch");
    }
    return {
      id: input.id,
      occurredAt: input.occurredAt,
      mode: "structured",
      description,
      ...(input.mealSlot ? { mealSlot: input.mealSlot } : {}),
      ...(input.foods ? { foods: input.foods } : {}),
      nutrients: input.nutrients,
      provenance: input.provenance,
      ...(input.dayCoverage ? { dayCoverage: input.dayCoverage } : {}),
    };
  }

  return {
    id: input.id,
    occurredAt: input.occurredAt,
    mode: "descriptive",
    description,
    ...(input.mealSlot ? { mealSlot: input.mealSlot } : {}),
    ...(input.foods ? { foods: input.foods } : {}),
    ...(input.qualitative ? { qualitative: input.qualitative } : {}),
    provenance: input.provenance,
    ...(input.dayCoverage ? { dayCoverage: input.dayCoverage } : {}),
  };
}
