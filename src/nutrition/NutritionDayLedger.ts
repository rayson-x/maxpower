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
}

export type CoreNutrientId =
  | "energy"
  | "protein"
  | "carbohydrate"
  | "fat"
  | "fiber"
  | "sodium"
  | "potassium"
  | "calcium"
  | "iron"
  | "magnesium";

export type NutrientId = CoreNutrientId | `vitamin_${string}` | `mineral_${string}`;
export type NutrientUnit = "kcal" | "kJ" | "g" | "mg" | "mcg";
export type NutrientValueSourceKind =
  | "manual_form"
  | "current_user_statement"
  | "manually_transcribed_label";

export interface NutrientValueData {
  nutrientId: NutrientId;
  amount: number;
  unit: NutrientUnit;
  source: {
    kind: NutrientValueSourceKind;
    ref: string;
  };
}

export interface NutrientLedgerValue {
  unit: "kcal" | "g" | "mg" | "mcg";
  target?: number;
  minimum?: number;
  maximum?: number;
  consumedLogged: number;
  remainingAgainstLogged?: number;
  overage?: number;
  intakeKnown: boolean;
  reportedValueCount: number;
  missing: readonly string[];
}

export type NutritionLedgerNutrients = Record<CoreNutrientId, NutrientLedgerValue>
  & Partial<Record<`vitamin_${string}` | `mineral_${string}`, NutrientLedgerValue>>;

const CORE_NUTRIENTS: readonly CoreNutrientId[] = [
  "energy",
  "protein",
  "carbohydrate",
  "fat",
  "fiber",
  "sodium",
  "potassium",
  "calcium",
  "iron",
  "magnesium",
];

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
  nutrientTargets: NonNullable<NutritionStrategyData["nutrientTargets"]>;
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
    nutrients?: readonly NutrientValueData[];
    correctsEventId?: string;
  }[];
  nutrients: NutritionLedgerNutrients;
}

export function deriveNutritionDayPlan(input: {
  date: string;
  timezoneOffsetMinutes: number;
  strategy?: NutritionStrategyData;
  /** Canonical fallback from the materialized plan when strategy day-types have not yet been revised. */
  plannedDayKind?: NutritionDayPlan["dayKind"];
  recoveryConstraint?: Pick<RecoveryConstraintData, "id" | "level" | "validUntil" | "scope">;
}): NutritionDayPlan {
  const day = input.strategy?.dayTypes?.find((candidate) => candidate.date === input.date);
  const dayKind = day?.kind ?? input.plannedDayKind ?? "unknown";
  const energy = day?.energy
    ?? (input.strategy?.calorieRange ? midpointEnergy(input.strategy.calorieRange) : undefined);
  const proteinRange = input.strategy?.macronutrientTargets?.proteinGrams;
  const fatPercent = input.strategy?.macronutrientTargets?.fatEnergyFloorPercent;
  const fat = energy && fatPercent !== undefined ? Math.round((energy.value * fatPercent) / 100 / 9) : undefined;
  return {
    date: input.date,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    dayKind,
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
    nutrientTargets: input.strategy?.nutrientTargets ?? {},
    ...(input.recoveryConstraint ? { recoveryLevel: input.recoveryConstraint.level } : {}),
    assumptions: [
      ...(input.strategy ? [] : ["no_active_nutrition_strategy"]),
      ...(input.strategy && !day && input.plannedDayKind ? ["day_type_from_materialized_plan_targets_use_strategy_range"] : []),
      ...(input.strategy && !day && !input.plannedDayKind ? ["day_type_missing_targets_use_strategy_range_or_unknown"] : []),
    ],
    notes: input.recoveryConstraint && input.recoveryConstraint.level !== "normal"
      ? [`recovery constraint ${input.recoveryConstraint.level} changes today's coaching context, not the long-term energy direction`]
      : [],
    missing: [
      ...(input.strategy ? [] : ["no_active_nutrition_strategy"]),
      ...(input.strategy && !day && !input.plannedDayKind ? ["day_type_missing"] : []),
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
      ...(fact.nutrients?.length ? { nutrients: fact.nutrients } : {}),
      ...(event.correctsEventId ? { correctsEventId: event.correctsEventId } : {}),
    };
  });
  const confirmed = active.filter((event) => event.fact.kind === "nutrition" && event.fact.confidence === "confirmed");
  const completeCoverageEvents = confirmed.filter((event) => event.fact.kind === "nutrition" && event.fact.dayCoverage === "complete");
  const dayComplete = completeCoverageEvents.length > 0;
  const quantified = confirmed.filter((event) => event.fact.kind === "nutrition" && Boolean(event.fact.nutrients?.length));
  const unquantifiedMealCount = confirmed.length - quantified.length;
  const allNutrientIds = [...new Set<NutrientId>([
    ...CORE_NUTRIENTS,
    ...confirmed.flatMap((event) => event.fact.kind === "nutrition" ? (event.fact.nutrients ?? []).map((value) => value.nutrientId) : []),
  ])];
  const target = (nutrient: NutrientId): { target?: number; minimum?: number; maximum?: number } => {
    if (nutrient === "energy" || nutrient === "protein" || nutrient === "carbohydrate" || nutrient === "fat") {
      const targetValue = input.plan.targets[nutrient].value as number | EnergyQuantity | undefined;
      const value = typeof targetValue === "number" ? targetValue : targetValue?.value;
      return value === undefined ? {} : { target: value };
    }
    const explicit = input.plan.nutrientTargets[nutrient];
    if (!explicit) return {};
    const normalize = (amount: number | undefined) => amount === undefined ? undefined : normalizeNutrientAmount({ nutrientId: nutrient, amount, unit: explicit.unit, source: { kind: "manual_form", ref: "nutrition_strategy_target" } });
    return { ...(normalize(explicit.target) !== undefined ? { target: normalize(explicit.target) } : {}), ...(normalize(explicit.minimum) !== undefined ? { minimum: normalize(explicit.minimum) } : {}), ...(normalize(explicit.maximum) !== undefined ? { maximum: normalize(explicit.maximum) } : {}) };
  };
  const nutrients = Object.fromEntries(allNutrientIds.map((nutrient) => {
    const reported = confirmed.flatMap((event) => event.fact.kind === "nutrition"
      ? (event.fact.nutrients ?? []).filter((value) => value.nutrientId === nutrient)
      : []);
    const consumedLogged = reported.reduce((total, value) => total + normalizeNutrientAmount(value), 0);
    const targetValue = target(nutrient);
    const remaining = confirmed.length === 0 ? undefined : (targetValue.target ?? targetValue.minimum) === undefined ? undefined : (targetValue.target ?? targetValue.minimum)! - consumedLogged;
    const overage = confirmed.length > 0 && targetValue.maximum !== undefined && consumedLogged > targetValue.maximum ? consumedLogged - targetValue.maximum : remaining !== undefined && targetValue.target !== undefined && remaining < 0 ? Math.abs(remaining) : undefined;
    return [nutrient, {
      unit: canonicalNutrientUnit(nutrient),
      ...targetValue,
      consumedLogged,
      ...(remaining !== undefined ? { remainingAgainstLogged: remaining } : {}),
      ...(overage !== undefined ? { overage } : {}),
      // `complete` closes the day's log; it does not turn omitted values in
      // earlier meals into zero. A nutrient is known only when every confirmed
      // intake record for that day explicitly supplied it.
      intakeKnown: dayComplete && confirmed.length > 0 && reported.length === confirmed.length,
      reportedValueCount: reported.length,
      missing: [
        ...(confirmed.length === 0 ? ["no_confirmed_meal"] : []),
        ...(confirmed.length > 0 && reported.length !== confirmed.length ? ["nutrient_not_provided"] : []),
        ...(confirmed.length > 0 && !dayComplete ? ["day_intake_not_confirmed_complete"] : []),
      ],
    }];
  })) as unknown as NutritionDayLedger["nutrients"];
  return {
    date: input.plan.date,
    coverage: confirmed.length === 0 ? "no_log" : !dayComplete || unquantifiedMealCount > 0 ? "partial" : "logged",
    loggedMealCount: meals.length,
    unquantifiedMealCount,
    meals,
    nutrients,
  };
}

export function assertNutrientValues(values: readonly NutrientValueData[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!Number.isFinite(value.amount) || value.amount < 0) throw new Error("nutrition_value_invalid");
    if (!value.source.ref.trim()) throw new Error("nutrition_value_source_ref_required");
    const key = `${value.nutrientId}:${value.unit}`;
    if (seen.has(key)) throw new Error("nutrition_value_duplicate");
    seen.add(key);
    normalizeNutrientAmount(value);
  }
}

function canonicalNutrientUnit(nutrient: NutrientId): NutrientLedgerValue["unit"] {
  if (nutrient === "energy") return "kcal";
  if (nutrient === "protein" || nutrient === "carbohydrate" || nutrient === "fat" || nutrient === "fiber") return "g";
  return "mg";
}

function normalizeNutrientAmount(value: NutrientValueData): number {
  const canonical = canonicalNutrientUnit(value.nutrientId);
  if (canonical === "kcal") {
    if (value.unit === "kcal") return value.amount;
    if (value.unit === "kJ") return value.amount / 4.184;
    throw new Error("nutrition_unit_invalid");
  }
  if (canonical === "g") {
    if (value.unit === "g") return value.amount;
    if (value.unit === "mg") return value.amount / 1000;
    if (value.unit === "mcg") return value.amount / 1_000_000;
    throw new Error("nutrition_unit_invalid");
  }
  if (value.unit === "mg") return value.amount;
  if (value.unit === "g") return value.amount * 1000;
  if (value.unit === "mcg") return value.amount / 1000;
  throw new Error("nutrition_unit_invalid");
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
