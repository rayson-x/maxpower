import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveDailyIntakeBudget,
  deriveNutritionDayPlan,
  projectNutritionDayLedger,
} from "../../src/nutrition";

function ledger(consumedKcal?: number, partial = false) {
  const plan = deriveNutritionDayPlan({
    date: "2026-08-10",
    timezoneOffsetMinutes: 480,
    plannedDayKind: "training",
    strategy: {
      id: "nutrition-1",
      goalContractRef: { kind: "goal_contract", id: "goal-1", revision: 1 },
      calorieRange: {
        min: { value: 1900, unit: "kcal" },
        max: { value: 2100, unit: "kcal" },
      },
    },
  });
  const events = consumedKcal === undefined ? [] : [{
    eventId: "meal-1",
    revision: 1,
    occurredAt: "2026-08-10T12:00:00.000+08:00",
    recordedAt: "2026-08-10T12:01:00.000+08:00",
    timezoneOffsetMinutes: 480,
    lifecycle: "active" as const,
    fact: {
      kind: "nutrition" as const,
      observationId: "meal-1",
      ...(partial ? {} : { energy: { value: consumedKcal, unit: "kcal" as const } }),
      confidence: "confirmed" as const,
    },
  }];
  return { plan, ledger: projectNutritionDayLedger({ plan, events }) };
}

test("training and rest budgets redistribute the weekly target while activity adds only a capped allowance", () => {
  const training = ledger();
  const trainingBudget = deriveDailyIntakeBudget({
    ...training,
    weeklyTrainingDays: 3,
    weeklyPlannedDays: 7,
    activities: [{ durationMinutes: 45, intensity: "moderate" }],
  });
  assert.equal(trainingBudget.baseTargetKcal, 2000);
  assert.equal(trainingBudget.dayTypeAdjustmentKcal, 160);
  assert.equal(trainingBudget.activityAdjustmentKcal, 90);
  assert.equal(trainingBudget.recommendedKcal, 2250);

  const restPlan = { ...training.plan, dayKind: "rest" as const };
  const restBudget = deriveDailyIntakeBudget({
    plan: restPlan,
    ledger: training.ledger,
    weeklyTrainingDays: 3,
    weeklyPlannedDays: 7,
  });
  assert.equal(restBudget.dayTypeAdjustmentKcal, -120);
  assert.equal(restBudget.recommendedKcal, 1880);

  const capped = deriveDailyIntakeBudget({
    ...training,
    weeklyTrainingDays: 3,
    activities: [{ durationMinutes: 180, intensity: "hard" }],
  });
  assert.equal(capped.activityAdjustmentKcal, 200);
});

test("a user-confirmed cardio expenditure raises the daily allowance without the fallback cap", () => {
  const training = ledger();
  const budget = deriveDailyIntakeBudget({
    ...training,
    weeklyTrainingDays: 3,
    weeklyPlannedDays: 7,
    activities: [{ durationMinutes: 60, intensity: "hard", energyExpenditureKcal: 580 }],
  });
  assert.equal(budget.recordedActivityExpenditureKcal, 580);
  assert.equal(budget.estimatedActivityExpenditureKcal, 0);
  assert.equal(budget.activityAdjustmentKcal, 580);
  assert.equal(budget.recommendedKcal, 2740);
});

test("intake status uses green within ten percent, yellow above ten and red above twenty", () => {
  const statuses = [
    { intake: 1188, expected: "far_below" },
    { intake: 1600, expected: "below" },
    { intake: 2200, expected: "on_track" },
    { intake: 2376, expected: "on_track" },
    { intake: 2377, expected: "slightly_over" },
    { intake: 2390, expected: "slightly_over" },
    { intake: 2592, expected: "slightly_over" },
    { intake: 2593, expected: "high" },
    { intake: 2600, expected: "high" },
  ] as const;
  for (const item of statuses) {
    const value = ledger(item.intake);
    const budget = deriveDailyIntakeBudget({
      ...value,
      weeklyTrainingDays: 3,
      weeklyPlannedDays: 7,
    });
    assert.equal(budget.recommendedKcal, 2160);
    assert.equal(budget.status, item.expected);
  }
});

test("missing or unquantified meals remain unknown instead of becoming zero intake", () => {
  const missing = ledger();
  assert.equal(deriveDailyIntakeBudget({ ...missing, weeklyTrainingDays: 3 }).status, "unknown");

  const partial = ledger(600, true);
  const budget = deriveDailyIntakeBudget({ ...partial, weeklyTrainingDays: 3 });
  assert.equal(partial.ledger.coverage, "partial");
  assert.equal(budget.consumedKcal, undefined);
  assert.equal(budget.status, "unknown");
});
