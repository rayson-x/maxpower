import assert from "node:assert/strict";
import test from "node:test";

import type { GoalContractData, UserProfileData } from "../../src/coach/domain";
import { aerobicPlanFor } from "../../src/planning/aerobicPlan";

function profile(overrides: Partial<UserProfileData> = {}): UserProfileData {
  return {
    id: "profile", trainingExperience: "intermediate", locale: "zh-CN", adultConfirmed: true,
    demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } },
    schedule: { weeklyFrequency: 4, sessionDurationMinutes: 90 },
    ...overrides,
  };
}

function goal(overrides: Partial<GoalContractData> = {}): GoalContractData {
  return {
    id: "goal", primaryGoal: "fat_loss_preserve_lean_mass", horizon: { startDate: "2026-08-12" },
    ...overrides,
  };
}

test("减脂加速不是默认空腹：默认力量后、低至中等强度，且把空腹作为独立时段的可选项", () => {
  const plan = aerobicPlanFor({
    goal: goal({ aerobicPreference: { role: "fat_loss_acceleration" } }),
    profile: profile(),
  });
  assert.equal(plan?.placement, "after_strength");
  assert.equal(plan?.intensity, "moderate");
  assert.equal(plan?.fastedEligible, false, "练后有氧不应标成空腹计划");
  assert.equal(plan?.sessionsPerWeek, 2);
  assert.ok(plan?.reasonCodes.includes("aerobic_placement_after_strength"));
});

test("空腹与间歇在低血糖/相关用药风险下被自动屏蔽，而不是用加餐公式越过安全边界", () => {
  const plan = aerobicPlanFor({
    goal: goal({ aerobicPreference: { role: "fat_loss_acceleration", intensityPreference: "intervals", timingPreference: "separate_session" } }),
    profile: profile({ metabolicExerciseSafety: { usesInsulinOrSecretagogue: true } }),
  });
  assert.equal(plan?.fastedEligible, false);
  assert.equal(plan?.blockIntervals, true);
  assert.notEqual(plan?.intensity, "vigorous");
  assert.ok(plan?.safetyNote?.includes("既有临床运动与监测方案"));
});

test("无明确加速诉求的减脂计划只给渐进健康基线，不把恢复日默认填满", () => {
  const plan = aerobicPlanFor({ goal: goal(), profile: profile() });
  assert.equal(plan?.role, "health_baseline");
  assert.equal(plan?.sessionsPerWeek, 1);
  assert.equal(plan?.placement, "after_strength");
});
