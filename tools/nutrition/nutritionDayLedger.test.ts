import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveNutritionDayPlan,
  projectNutritionDayLedger,
  type MealSlot,
} from "../../src/nutrition";
import type { NutritionStrategyData, TimelineProjectionEvent } from "../../src/coach/domain";

const OFFSET = 480; // +08:00

const strategy: NutritionStrategyData = {
  id: "nutrition-strategy-1",
  goalContractRef: { kind: "goal_contract", id: "goal-1", revision: 1 },
  status: "active",
  phase: "fat_loss_preserve_lean_mass",
  calorieRange: { min: { value: 2000, unit: "kcal" }, max: { value: 2200, unit: "kcal" } },
  macronutrientTargets: { proteinGrams: { min: 150, max: 180 }, fatEnergyFloorPercent: 25 },
  dayTypes: [
    { date: "2026-08-09", kind: "training", energy: { value: 2300, unit: "kcal" }, carbohydrateGrams: 260 },
    { date: "2026-08-10", kind: "rest", energy: { value: 1900, unit: "kcal" }, carbohydrateGrams: 160 },
  ],
  ruleVersion: "1.0.0",
};

function mealEvent(input: {
  eventId: string;
  occurredAt: string;
  slot: MealSlot;
  energyKcal?: number;
  proteinGrams?: number;
  fatGrams?: number;
  carbohydrateGrams?: number;
  simplified?: boolean;
  confidence?: "confirmed" | "estimated";
  lifecycle?: "active" | "superseded" | "tombstoned";
  correctsEventId?: string;
}): TimelineProjectionEvent {
  return {
    eventId: input.eventId,
    revision: 1,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    timezoneOffsetMinutes: OFFSET,
    lifecycle: input.lifecycle ?? "active",
    ...(input.correctsEventId ? { correctsEventId: input.correctsEventId } : {}),
    fact: {
      kind: "nutrition",
      observationId: `${input.eventId}-observation`,
      mealSlot: input.slot,
      ...(input.energyKcal === undefined ? {} : { energy: { value: input.energyKcal, unit: "kcal" as const } }),
      ...(input.proteinGrams === undefined ? {} : { proteinGrams: input.proteinGrams }),
      ...(input.fatGrams === undefined ? {} : { fatGrams: input.fatGrams }),
      ...(input.carbohydrateGrams === undefined ? {} : { carbohydrateGrams: input.carbohydrateGrams }),
      ...(input.simplified
        ? {
            observationMode: "simplified" as const,
            simplified: { proteinCompletion: "met" as const, hunger: "moderate" as const, deviation: "none" as const },
          }
        : { observationMode: "precise" as const }),
      confidence: input.confidence ?? "confirmed",
    },
    envelope: {
      id: `${input.eventId}-envelope`,
      schemaVersion: 1,
      factType: "nutrition",
      time: { startedAt: input.occurredAt, timezoneOffsetMinutes: OFFSET },
      recordedAt: input.occurredAt,
      actor: { kind: "user", id: "u1" },
      provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "sensitive",
      causalRefs: [],
      evidenceRefs: [],
      layer: "raw_observation",
    },
  };
}

test("训练日与休息日从同一 NutritionStrategy 得到不同的四项日目标", () => {
  const training = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET, strategy });
  const rest = deriveNutritionDayPlan({ date: "2026-08-10", timezoneOffsetMinutes: OFFSET, strategy });

  assert.equal(training.dayKind, "training");
  assert.equal(training.targets.energy.value, 2300);
  assert.equal(training.targets.energy.basis, "day_type");
  assert.equal(training.targets.carbohydrate.value, 260);
  assert.equal(rest.dayKind, "rest");
  assert.equal(rest.targets.energy.value, 1900);
  assert.equal(rest.targets.carbohydrate.value, 160);

  // 蛋白质是下限而不是上限，范围必须保留可见。
  assert.equal(training.targets.protein.value, 150);
  assert.deepEqual(training.targets.protein.range, { min: 150, max: 180 });
  assert.equal(training.targets.protein.basis, "protein_floor");

  // 脂肪下限来自能量百分比，不是凭空的克数。
  assert.equal(training.targets.fat.basis, "fat_floor");
  assert.equal(training.targets.fat.value, Math.round((2300 * 0.25) / 9));
});

test("没有当天 dayType 时退回策略热量区间，并把这一点标成假设而不是精确目标", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-11", timezoneOffsetMinutes: OFFSET, strategy });
  assert.equal(plan.dayKind, "unknown");
  assert.equal(plan.targets.energy.basis, "strategy_range_midpoint");
  assert.deepEqual(plan.targets.energy.range, { min: 2000, max: 2200 });
  assert.equal(plan.targets.energy.value, 2100);
  assert.ok(plan.assumptions.some((item) => item.includes("day_type")));
});

test("没有营养策略时四项目标保持 unknown，不编造维护热量", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET });
  for (const nutrient of ["energy", "protein", "carbohydrate", "fat"] as const) {
    assert.equal(plan.targets[nutrient].value, undefined);
    assert.equal(plan.targets[nutrient].basis, "unknown");
  }
  assert.ok(plan.missing.includes("no_active_nutrition_strategy"));
});

test("恢复约束只影响当天说明，不静默改写长期能量方向", () => {
  const plan = deriveNutritionDayPlan({
    date: "2026-08-09",
    timezoneOffsetMinutes: OFFSET,
    strategy,
    recoveryConstraint: {
      id: "recovery-1",
      level: "recovery_priority",
      validUntil: "2026-08-10T00:00:00.000+08:00",
    },
  });
  assert.equal(plan.targets.energy.value, 2300);
  assert.equal(plan.recoveryLevel, "recovery_priority");
  assert.ok(plan.notes.some((note) => note.includes("recovery")));
});

test("账本按计划时区分桶：当天深夜算今天，跨零点算次日", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET, strategy });
  const ledger = projectNutritionDayLedger({
    plan,
    events: [
      mealEvent({ eventId: "e1", occurredAt: "2026-08-09T23:30:00.000+08:00", slot: "snack", energyKcal: 300, proteinGrams: 20 }),
      mealEvent({ eventId: "e2", occurredAt: "2026-08-10T00:30:00.000+08:00", slot: "snack", energyKcal: 400, proteinGrams: 30 }),
    ],
  });
  assert.equal(ledger.meals.length, 1);
  assert.equal(ledger.nutrients.energy.consumedLogged, 300);
});

test("四项账本给出 target、consumed 和 remaining，超额时保留负 remaining 并单列 overage", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET, strategy });
  const ledger = projectNutritionDayLedger({
    plan,
    events: [
      mealEvent({ eventId: "e1", occurredAt: "2026-08-09T08:00:00.000+08:00", slot: "breakfast", energyKcal: 900, proteinGrams: 60, fatGrams: 30, carbohydrateGrams: 90 }),
      mealEvent({ eventId: "e2", occurredAt: "2026-08-09T12:30:00.000+08:00", slot: "lunch", energyKcal: 1600, proteinGrams: 70, fatGrams: 50, carbohydrateGrams: 200 }),
    ],
  });

  assert.equal(ledger.coverage, "logged");
  assert.equal(ledger.nutrients.energy.consumedLogged, 2500);
  assert.equal(ledger.nutrients.energy.remainingAgainstLogged, -200);
  assert.equal(ledger.nutrients.energy.overage, 200);
  assert.equal(ledger.nutrients.protein.consumedLogged, 130);
  assert.equal(ledger.nutrients.protein.remainingAgainstLogged, 20);
  assert.equal(ledger.nutrients.protein.overage, undefined);
});

test("完全没有记录时账本是 unknown 而不是零摄入", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET, strategy });
  const ledger = projectNutritionDayLedger({ plan, events: [] });

  assert.equal(ledger.coverage, "no_log");
  assert.equal(ledger.nutrients.energy.intakeKnown, false);
  assert.equal(ledger.nutrients.energy.consumedLogged, 0);
  assert.ok(ledger.nutrients.energy.missing.includes("no_confirmed_meal"));
});

test("轻量记录计入覆盖但不产生数值摄入，剩余额度只对已量化部分成立", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET, strategy });
  const ledger = projectNutritionDayLedger({
    plan,
    events: [
      mealEvent({ eventId: "e1", occurredAt: "2026-08-09T08:00:00.000+08:00", slot: "breakfast", energyKcal: 500, proteinGrams: 40 }),
      mealEvent({ eventId: "e2", occurredAt: "2026-08-09T12:30:00.000+08:00", slot: "lunch", simplified: true }),
    ],
  });

  assert.equal(ledger.coverage, "partial");
  assert.equal(ledger.loggedMealCount, 2);
  assert.equal(ledger.unquantifiedMealCount, 1);
  assert.equal(ledger.nutrients.energy.consumedLogged, 500);
  assert.equal(ledger.nutrients.energy.intakeKnown, false);
  assert.ok(ledger.nutrients.energy.missing.includes("unquantified_meal"));
});

test("未确认的估算不计入 consumed", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET, strategy });
  const ledger = projectNutritionDayLedger({
    plan,
    events: [
      mealEvent({ eventId: "e1", occurredAt: "2026-08-09T08:00:00.000+08:00", slot: "breakfast", energyKcal: 500 }),
      mealEvent({ eventId: "e2", occurredAt: "2026-08-09T12:00:00.000+08:00", slot: "lunch", energyKcal: 800, confidence: "estimated" }),
    ],
  });
  assert.equal(ledger.nutrients.energy.consumedLogged, 500);
});

test("餐次按早午晚加餐分组并保留每条事实的来源与确认状态", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET, strategy });
  const ledger = projectNutritionDayLedger({
    plan,
    events: [
      mealEvent({ eventId: "e2", occurredAt: "2026-08-09T12:30:00.000+08:00", slot: "lunch", energyKcal: 800 }),
      mealEvent({ eventId: "e1", occurredAt: "2026-08-09T08:00:00.000+08:00", slot: "breakfast", energyKcal: 500 }),
      mealEvent({ eventId: "e3", occurredAt: "2026-08-09T15:00:00.000+08:00", slot: "snack", energyKcal: 200 }),
    ],
  });

  assert.deepEqual(ledger.meals.map((meal) => meal.slot), ["breakfast", "lunch", "snack"]);
  assert.equal(ledger.meals[0]?.eventId, "e1");
  assert.equal(ledger.meals[0]?.origin, "manual");
  assert.equal(ledger.meals[0]?.confirmed, true);
});

test("更正后的账本使用新事实，被更正的原事实不参与汇总但仍保留在历史中", () => {
  const plan = deriveNutritionDayPlan({ date: "2026-08-09", timezoneOffsetMinutes: OFFSET, strategy });
  const ledger = projectNutritionDayLedger({
    plan,
    events: [
      mealEvent({ eventId: "e1", occurredAt: "2026-08-09T08:00:00.000+08:00", slot: "breakfast", energyKcal: 900, lifecycle: "superseded" }),
      mealEvent({ eventId: "e1-fix", occurredAt: "2026-08-09T08:00:00.000+08:00", slot: "breakfast", energyKcal: 500, correctsEventId: "e1" }),
    ],
  });

  assert.equal(ledger.meals.length, 1);
  assert.equal(ledger.nutrients.energy.consumedLogged, 500);
  assert.equal(ledger.meals[0]?.correctsEventId, "e1");
});
