import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCarbDistributionInvariant,
  createNutritionStrategy,
} from "../../src/nutrition";

const base = {
  id: "nutrition-1",
  goalContractRef: { kind: "goal_contract" as const, id: "goal", revision: 1 },
  bodyMassKg: 80,
  estimatedMaintenanceKcal: 2500,
  reviewWindow: { startsAt: "2026-08-01", endsAt: "2026-08-15", minimumWeightObservations: 3 },
  safety: { adultConfirmed: true },
};

test("Nutrition Strategy 生成保守的增肌、力量与减脂范围，而非观察到的 TDEE", () => {
  const gain = createNutritionStrategy({ ...base, phase: "hypertrophy" });
  const strength = createNutritionStrategy({ ...base, id: "strength", phase: "strength_stable" });
  const loss = createNutritionStrategy({ ...base, id: "loss", phase: "fat_loss_preserve_lean_mass" });
  assert.equal(gain.confidence, "provisional");
  assert.ok(gain.calorieRange && strength.calorieRange && loss.calorieRange);
  assert.equal(gain.calorieRange.min.value < gain.calorieRange.max.value, true);
  assert.equal(strength.calorieRange.min.value < gain.calorieRange.min.value, true);
  assert.equal(loss.calorieRange.max.value < strength.calorieRange.max.value, true);
  assert.equal(Number.isInteger(loss.calorieRange.min.value), true);
  assert.equal(Number.isInteger(loss.calorieRange.max.value), true);
  assert.equal(loss.macronutrientTargets?.proteinGrams.min, 144);
});

test("未提供体重时保持蛋白质目标未知，不生成 0–0 g 的伪目标", () => {
  const strategy = createNutritionStrategy({
    ...base,
    id: "nutrition-without-body-mass",
    bodyMassKg: undefined,
    estimatedMaintenanceKcal: undefined,
    phase: "hypertrophy",
  });
  assert.equal(strategy.calorieRange, undefined);
  assert.equal(strategy.macronutrientTargets, undefined);
  assert.equal(strategy.confidence, "low");
});


test("碳水分配不改变七日总能量，安全筛查暂停自动数值建议", () => {
  const strategy = createNutritionStrategy({
    ...base,
    phase: "hypertrophy",
  });
  const cycled = {
    ...strategy,
    dayTypes: [
      { date: "2026-08-10", kind: "training" as const, namedSessionId: "heavy", energy: { value: 2800, unit: "kcal" as const }, carbohydrateGrams: 350 },
      { date: "2026-08-11", kind: "rest" as const, energy: { value: 2200, unit: "kcal" as const }, carbohydrateGrams: 200 },
    ],
  };
  assertCarbDistributionInvariant({ strategy: cycled, weeklyBaselineEnergyKcal: 5000 });
  assert.throws(() => assertCarbDistributionInvariant({ strategy: cycled, weeklyBaselineEnergyKcal: 4900 }), /weekly_energy/);
  const paused = createNutritionStrategy({ ...base, id: "paused", phase: "hypertrophy", safety: { adultConfirmed: false } });
  assert.equal(paused.status, "paused");
});
