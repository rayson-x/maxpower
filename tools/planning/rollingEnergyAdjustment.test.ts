import assert from "node:assert/strict";
import test from "node:test";

import type { TimelineProjectionEvent, UserProfileData } from "../../src/coach/domain";
import { estimateThermicEffect } from "../../src/nutrition/thermicEffect";
import { rollingEnergyAdjustmentFor } from "../../src/planning/rollingEnergyAdjustment";

const profile: UserProfileData = {
  id: "p", trainingExperience: "intermediate", locale: "zh-CN",
  demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } },
  dailyActivityLevel: "sedentary",
};

function meal(energy: number, protein = 0, carbohydrate = 0, fat = 0): TimelineProjectionEvent {
  return {
    eventId: "party", revision: 1, occurredAt: "2026-08-11T12:00:00.000Z", recordedAt: "2026-08-11T12:00:00.000Z", timezoneOffsetMinutes: 480,
    fact: { kind: "nutrition", observationId: "nutrition-party", energy: { value: energy, unit: "kcal" }, proteinGrams: protein, carbohydrateGrams: carbohydrate, fatGrams: fat, confidence: "confirmed" },
  };
}

test("TEF 优先按宏量营养素估算，剩余未拆分热量才用保守回退", () => {
  const estimate = estimateThermicEffect({ energyKcal: 1_000, proteinGrams: 100, carbohydrateGrams: 100, fatGrams: 0 });
  assert.equal(estimate.source, "macro_estimate");
  assert.equal(estimate.kcal, 150, "蛋白 100g 的 TEF 不应被统一 10% 吞没");
  assert.equal(estimate.unknownEnergyKcal, 200);
});

test("聚餐后的滚动调整只在量化摄入存在时启动，并受日额外缺口与恢复门限制", () => {
  const adjustment = rollingEnergyAdjustmentFor({
    currentDate: "2026-08-12", profile, timeline: [meal(2_700, 120, 250, 80)], targetDailyDeficitKcal: 370,
    futureDates: ["2026-08-12", "2026-08-14", "2026-08-19"],
  });
  assert.equal(adjustment.status, "gentle_rebalance");
  assert.ok(adjustment.unrecoveredSurplusKcal > 0);
  assert.ok((adjustment.dailyAdditionalDeficitCapKcal ?? Infinity) <= 120);
  assert.ok(adjustment.actions.every((action) => action.gate === "only_if_recovery_normal"));
  assert.ok(adjustment.actions.every((action) => action.extraLowImpactCardioMinutes <= 15));
});

test("未量化但明确说吃多/聚餐时，Planner 给出低置信度差额范围与待确认的温和回调", () => {
  const adjustment = rollingEnergyAdjustmentFor({
    currentDate: "2026-08-12", profile,
    timeline: [{ ...meal(0), fact: { kind: "nutrition", observationId: "nutrition-unquantified", mealDescription: "昨晚聚餐", confidence: "confirmed" } }],
    targetDailyDeficitKcal: 370, futureDates: ["2026-08-12"],
  });
  assert.equal(adjustment.status, "gentle_rebalance");
  assert.equal(adjustment.surplusSource, "description_estimate");
  assert.deepEqual(adjustment.estimatedSurplusRangeKcal, { min: 250, max: 550 });
  assert.ok(adjustment.actions.length > 0, "明确的吃多描述应产出待确认行动，而不是静默忽略");
  assert.ok(adjustment.reasonCodes.includes("rolling_energy_rebalance_from_description_estimate_requires_confirmation"));
});

test("普通未量化餐食不等于吃多，Planner 保持未知且不安排回调", () => {
  const adjustment = rollingEnergyAdjustmentFor({
    currentDate: "2026-08-12", profile,
    timeline: [{ ...meal(0), fact: { kind: "nutrition", observationId: "nutrition-unquantified-normal", mealDescription: "午餐吃了盖饭", confidence: "confirmed" } }],
    targetDailyDeficitKcal: 370, futureDates: ["2026-08-12"],
  });
  assert.equal(adjustment.status, "no_quantified_intake");
  assert.deepEqual(adjustment.actions, []);
});
