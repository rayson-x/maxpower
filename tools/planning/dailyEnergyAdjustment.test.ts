import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfileData } from "../../src/coach/domain";
import { dailyEnergyAdjustment, deficitOverSafeLimit } from "../../src/planning/dailyEnergyAdjustment";

/** 每日热量动态调整验收：纯公式计算，不经 LLM。 */

function profile(level: UserProfileData["dailyActivityLevel"] = "sedentary"): UserProfileData {
  return {
    id: "p", trainingExperience: "intermediate", locale: "zh-CN",
    demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } },
    schedule: { weeklyFrequency: 5, sessionDurationMinutes: 75 },
    ...(level ? { dailyActivityLevel: level } : {}),
  };
}

const BASE = { min: 1951, max: 2075 };

test("步数超出基准才算额外消耗（基准已计入档案的日常活动）", () => {
  // 久坐档基准 3500 步；走 10000 步 → 超出 6500
  const result = dailyEnergyAdjustment({ profile: profile("sedentary"), actualSteps: 10000, baseIntakeKcal: BASE });
  assert.equal(result.source, "steps_estimate");
  assert.equal(result.steps?.baseline, 3500);
  assert.equal(result.steps?.surplus, 6500);
  // 6500 × 75kg × 0.0004 = 195 kcal
  assert.equal(result.extraActivityKcal, 195);
  assert.equal(result.estimated, true, "步数折算是估算");
});

test("走到基准以内 → 零调整（不奖励本来就该做的事）", () => {
  const result = dailyEnergyAdjustment({ profile: profile("sedentary"), actualSteps: 3000, baseIntakeKcal: BASE });
  assert.equal(result.extraActivityKcal, 0);
  assert.equal(result.adjustedIntakeKcal?.min, BASE.min);
});

test("同样步数下，活动档位越高额外消耗越少（基准更高）", () => {
  const sedentary = dailyEnergyAdjustment({ profile: profile("sedentary"), actualSteps: 10000 });
  const active = dailyEnergyAdjustment({ profile: profile("active"), actualSteps: 10000 });
  assert.ok(sedentary.extraActivityKcal > active.extraActivityKcal,
    `久坐(${sedentary.extraActivityKcal}) 应多于常走动(${active.extraActivityKcal})`);
});

test("eat_back 策略：赤字恒定，额外消耗加回摄入", () => {
  const result = dailyEnergyAdjustment({
    profile: profile("sedentary"), actualSteps: 10000,
    baseIntakeKcal: BASE, baseDeficitKcal: 371, strategy: "eat_back",
  });
  assert.equal(result.adjustedIntakeKcal?.min, 1951 + 195);
  assert.equal(result.effectiveDeficitKcal, 371, "赤字应保持不变");
});

test("accelerate 策略：摄入不变，赤字扩大", () => {
  const result = dailyEnergyAdjustment({
    profile: profile("sedentary"), actualSteps: 10000,
    baseIntakeKcal: BASE, baseDeficitKcal: 371, strategy: "accelerate",
  });
  assert.equal(result.adjustedIntakeKcal?.min, 1951, "摄入不变");
  assert.equal(result.effectiveDeficitKcal, 371 + 195, "赤字应扩大");
});

test("设备/用户填报的活动消耗优先于步数折算，且不标为估算", () => {
  const result = dailyEnergyAdjustment({
    profile: profile("sedentary"), actualSteps: 10000, reportedActivityKcal: 320, baseIntakeKcal: BASE,
  });
  assert.equal(result.source, "device_or_user_reported");
  assert.equal(result.extraActivityKcal, 320, "应用填报值而非步数折算的 195");
  assert.equal(result.estimated, false);
  assert.equal(result.steps, undefined, "用填报值时不输出步数明细");
});

test("无任何活动数据 → 零调整且标记 no_data（不猜）", () => {
  const result = dailyEnergyAdjustment({ profile: profile("sedentary"), baseIntakeKcal: BASE });
  assert.equal(result.source, "no_data");
  assert.equal(result.extraActivityKcal, 0);
  assert.equal(result.adjustedIntakeKcal?.min, BASE.min);
});

test("缺体重时步数无法折算（不编造）", () => {
  const p = profile("sedentary");
  delete (p.demographics as { currentWeight?: unknown }).currentWeight;
  const result = dailyEnergyAdjustment({ profile: p, actualSteps: 10000 });
  assert.equal(result.source, "no_data");
  assert.equal(result.extraActivityKcal, 0);
});

test("加速策略的赤字超安全上限时可被检出（供提示改回 eat_back）", () => {
  const over = deficitOverSafeLimit({ effectiveDeficitKcal: 700, maxSafeDailyDeficitKcal: 500 });
  assert.equal(over, 200);
  assert.equal(deficitOverSafeLimit({ effectiveDeficitKcal: 400, maxSafeDailyDeficitKcal: 500 }), 0);
});
