import assert from "node:assert/strict";
import test from "node:test";

import { negotiateGoalPaths } from "../../src/goal-path";

test("目标协商对体脂、围度和力量使用各自的确定性安全速度", () => {
  const profile = {
    id: "profile",
    locale: "zh-CN" as const,
    demographics: {
      currentWeight: { value: 80, unit: "kg" as const },
      currentCircumferences: { waist: { value: 100, unit: "cm" as const }, shoulder: { value: 120, unit: "cm" as const } },
    },
    strengthBaseline: { benchPress: { value: 80, unit: "kg" as const }, benchPressReps: 1, source: "user_confirmed" as const },
  };
  const preview = negotiateGoalPaths({
    profile,
    today: "2026-08-15",
    goal: {
      id: "goal",
      primaryGoal: "physique",
      horizon: { startDate: "2026-08-15", endDate: "2026-09-12" },
      targets: {
        currentBodyFat: { value: 30, unit: "percent" },
        targetBodyFat: { value: 20, unit: "percent" },
        targetWaist: { value: 90, unit: "cm" },
        targetShoulder: { value: 125, unit: "cm" },
        strength: { benchPress: { value: 100, unit: "kg" } },
      },
    },
  });
  assert.equal(preview.status, "options");
  assert.equal(preview.options.find((option) => option.id === "gradual")?.feasible, true);
  assert.equal(preview.options.find((option) => option.id === "balanced")?.feasible, true);
  assert.equal(preview.options.find((option) => option.id === "faster")?.feasible, false);
  assert.ok(preview.options.find((option) => option.id === "faster")?.conflictReasons.some((reason) => reason.startsWith("target_time_below_guardrail_minimum:")));
  assert.ok((preview.options.find((option) => option.id === "balanced")?.targetWeeks ?? 0) >= 21, "安全路径必须延长期限，而不是降低护栏");
});

test("目标有数值但缺当前起点时要求补充证据，不把未知当可行", () => {
  const preview = negotiateGoalPaths({
    today: "2026-08-15",
    goal: {
      id: "goal",
      primaryGoal: "physique",
      horizon: { startDate: "2026-08-15", endDate: "2026-12-15" },
      targets: { targetBodyFat: { value: 18, unit: "percent" }, targetShoulderWaistRatio: 1.5 },
    },
  });
  assert.equal(preview.status, "needs_clarification");
  assert.ok(preview.missing.includes("current_body_fat_missing_for_deadline"));
  assert.ok(preview.missing.includes("current_shoulder_waist_measurements_missing_for_deadline"));
});
