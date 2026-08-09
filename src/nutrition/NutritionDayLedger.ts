import type {
  EnergyQuantity,
  NutritionStrategyData,
  RecoveryConstraintData,
  TimelineProjectionEvent,
} from "../coach/domain";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export interface FoodEntryData {
  id: string;
  name: string;
  portion?: string;
  energy?: EnergyQuantity;
  proteinGrams?: number;
  fatGrams?: number;
  carbohydrateGrams?: number;
  source: "manual" | "label" | "import" | "estimate";
}
type Nutrient = "energy" | "protein" | "carbohydrate" | "fat";

export interface NutritionDayPlan {
  date: string;
  timezoneOffsetMinutes: number;
  dayKind: "training" | "rest" | "deload" | "recovery" | "unknown";
  targets: {
    energy: TargetValue<number>;
    protein: TargetValue<number>;
    carbohydrate: TargetValue<number>;
    fat: TargetValue<number>;
  };
  recoveryLevel?: RecoveryConstraintData["level"];
  assumptions: readonly string[];
  notes: readonly string[];
  missing: readonly string[];
}

interface TargetValue<T> {
  value?: T;
  range?: { min: number; max: number };
  basis: "day_type" | "protein_floor" | "fat_floor" | "strategy_range_midpoint" | "unknown";
}

export interface NutritionDayLedger {
  date: string;
  coverage: "no_log" | "partial" | "logged";
  loggedMealCount: number;
  unquantifiedMealCount: number;
  meals: readonly {
    eventId: string;
    slot: MealSlot;
    occurredAt: string;
    origin: string;
    confirmed: boolean;
    description?: string;
    foods?: readonly FoodEntryData[];
    nutrients?: {
      energy?: number;
      proteinGrams?: number;
      carbohydrateGrams?: number;
      fatGrams?: number;
    };
    correctsEventId?: string;
  }[];
  nutrients: Record<Nutrient, {
    target?: number;
    consumedLogged: number;
    remainingAgainstLogged?: number;
    overage?: number;
    intakeKnown: boolean;
    missing: readonly string[];
  }>;
}

export function deriveNutritionDayPlan(input: {
  date: string;
  timezoneOffsetMinutes: number;
  strategy?: NutritionStrategyData;
  recoveryConstraint?: Pick<RecoveryConstraintData, "id" | "level" | "validUntil" | "scope">;
}): NutritionDayPlan {
  const day = input.strategy?.dayTypes?.find((candidate) => candidate.date === input.date);
  const energy = day?.energy
    ?? (input.strategy?.calorieRange ? midpointEnergy(input.strategy.calorieRange) : undefined);
  const proteinRange = input.strategy?.macronutrientTargets?.proteinGrams;
  const fatPercent = input.strategy?.macronutrientTargets?.fatEnergyFloorPercent;
  const fat = energy && fatPercent !== undefined ? Math.round((energy.value * fatPercent) / 100 / 9) : undefined;
  return {
    date: input.date,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    dayKind: day?.kind ?? "unknown",
    targets: {
      energy: energy
        ? { value: energy.value, basis: day?.energy ? "day_type" : "strategy_range_midpoint", ...(day?.energy ? {} : { range: { min: input.strategy!.calorieRange!.min.value, max: input.strategy!.calorieRange!.max.value } }) }
        : { basis: "unknown" },
      protein: proteinRange
        ? { value: proteinRange.min, range: proteinRange, basis: "protein_floor" }
        : { basis: "unknown" },
      carbohydrate: day?.carbohydrateGrams !== undefined ? { value: day.carbohydrateGrams, basis: "day_type" } : { basis: "unknown" },
      fat: fat !== undefined ? { value: fat, basis: "fat_floor" } : { basis: "unknown" },
    },
    ...(input.recoveryConstraint ? { recoveryLevel: input.recoveryConstraint.level } : {}),
    assumptions: [
      ...(input.strategy ? [] : ["no_active_nutrition_strategy"]),
      ...(input.strategy && !day ? ["day_type_missing_targets_use_strategy_range_or_unknown"] : []),
    ],
    notes: input.recoveryConstraint && input.recoveryConstraint.level !== "normal"
      ? [`recovery constraint ${input.recoveryConstraint.level} changes today's coaching context, not the long-term energy direction`]
      : [],
    missing: [
      ...(input.strategy ? [] : ["no_active_nutrition_strategy"]),
      ...(input.strategy && !day ? ["day_type_missing"] : []),
    ],
  };
}

export function projectNutritionDayLedger(input: {
  plan: NutritionDayPlan;
  events: readonly TimelineProjectionEvent[];
}): NutritionDayLedger {
  const active = input.events
    .filter((event) => event.lifecycle === "active")
    .filter((event) => event.fact.kind === "nutrition")
    .filter((event) => localDate(event.occurredAt, input.plan.timezoneOffsetMinutes) === input.plan.date)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  const meals = active.map((event) => {
    const fact = event.fact;
    if (fact.kind !== "nutrition") throw new Error("nutrition_fact_expected");
    return {
      eventId: event.eventId,
      slot: fact.mealSlot ?? inferSlot(event.occurredAt, input.plan.timezoneOffsetMinutes),
      occurredAt: event.occurredAt,
      origin: event.envelope?.provenance.origin ?? "unknown",
      confirmed: fact.confidence === "confirmed",
      ...(fact.mealDescription ? { description: fact.mealDescription } : {}),
      ...(fact.foods ? { foods: fact.foods } : {}),
      ...(fact.energy || fact.proteinGrams !== undefined || fact.carbohydrateGrams !== undefined || fact.fatGrams !== undefined
        ? {
            nutrients: {
              ...(fact.energy ? { energy: fact.energy.unit === "kcal" ? fact.energy.value : fact.energy.value / 4.184 } : {}),
              ...(fact.proteinGrams !== undefined ? { proteinGrams: fact.proteinGrams } : {}),
              ...(fact.carbohydrateGrams !== undefined ? { carbohydrateGrams: fact.carbohydrateGrams } : {}),
              ...(fact.fatGrams !== undefined ? { fatGrams: fact.fatGrams } : {}),
            },
          }
        : {}),
      ...(event.correctsEventId ? { correctsEventId: event.correctsEventId } : {}),
    };
  });
  const confirmed = active.filter((event) => event.fact.kind === "nutrition" && event.fact.confidence === "confirmed");
  const quantified = confirmed.filter((event) => event.fact.kind === "nutrition" && (event.fact.energy || event.fact.proteinGrams !== undefined || event.fact.carbohydrateGrams !== undefined || event.fact.fatGrams !== undefined));
  const unquantifiedMealCount = confirmed.length - quantified.length;
  const value = (nutrient: Nutrient): number => quantified.reduce((total, event) => {
    if (event.fact.kind !== "nutrition") return total;
    if (nutrient === "energy") return total + (event.fact.energy?.unit === "kcal" ? event.fact.energy.value : event.fact.energy ? event.fact.energy.value / 4.184 : 0);
    return total + (event.fact[nutrient === "protein" ? "proteinGrams" : nutrient === "carbohydrate" ? "carbohydrateGrams" : "fatGrams"] ?? 0);
  }, 0);
  const target = (nutrient: Nutrient): number | undefined => {
    const targetValue = input.plan.targets[nutrient].value as number | EnergyQuantity | undefined;
    return typeof targetValue === "number" ? targetValue : targetValue?.value;
  };
  const nutrients = Object.fromEntries(([
    "energy", "protein", "carbohydrate", "fat",
  ] as const).map((nutrient) => {
    const consumedLogged = value(nutrient);
    const targetValue = target(nutrient);
    const remaining = targetValue === undefined || confirmed.length === 0 ? undefined : targetValue - consumedLogged;
    return [nutrient, {
      ...(targetValue !== undefined ? { target: targetValue } : {}),
      consumedLogged,
      ...(remaining !== undefined ? { remainingAgainstLogged: remaining, ...(remaining < 0 ? { overage: Math.abs(remaining) } : {}) } : {}),
      intakeKnown: confirmed.length > 0 && unquantifiedMealCount === 0,
      missing: [
        ...(confirmed.length === 0 ? ["no_confirmed_meal"] : []),
        ...(unquantifiedMealCount > 0 ? ["unquantified_meal"] : []),
      ],
    }];
  })) as unknown as NutritionDayLedger["nutrients"];
  return {
    date: input.plan.date,
    coverage: confirmed.length === 0 ? "no_log" : unquantifiedMealCount > 0 ? "partial" : "logged",
    loggedMealCount: meals.length,
    unquantifiedMealCount,
    meals,
    nutrients,
  };
}

function midpointEnergy(range: NonNullable<NutritionStrategyData["calorieRange"]>): EnergyQuantity {
  return { value: Math.round((range.min.value + range.max.value) / 2), unit: range.min.unit };
}

function localDate(iso: string, offsetMinutes: number): string {
  return new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function inferSlot(iso: string, offsetMinutes: number): MealSlot {
  const hour = Number(new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(11, 13));
  return hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 20 ? "dinner" : "snack";
}
