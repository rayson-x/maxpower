import assert from "node:assert/strict";
import test from "node:test";

import type { GoalContractData, UserProfileData } from "../../src/coach/domain";
import { estimateTimeToGoal, fatToLoseKg, maxDailyDeficitKcal } from "../../src/planning/goalTimeline";

/** 目标→时间反推验收：时间从目标算出来，不是拍出来的。 */

function profile(weightKg: number, heightCm: number): UserProfileData {
  return {
    id: "p1",
    trainingExperience: "intermediate",
    locale: "zh-CN",
    demographics: {
      ageYears: 30,
      sex: "male",
      height: { value: heightCm, unit: "cm" },
      currentWeight: { value: weightKg, unit: "kg" },
    },
    schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
  };
}

function goal(currentBf?: number, targetBf?: number): GoalContractData {
  return {
    id: "g1",
    primaryGoal: "fat_loss_preserve_lean_mass",
    goalType: "fat_loss",
    horizon: { startDate: "2026-08-12" },
    status: "active",
    ...(currentBf !== undefined || targetBf !== undefined
      ? {
          targets: {
            ...(currentBf !== undefined ? { currentBodyFat: { value: currentBf, unit: "percent" as const } } : {}),
            ...(targetBf !== undefined ? { targetBodyFat: { value: targetBf, unit: "percent" as const } } : {}),
          },
        }
      : {}),
  };
}

test("需要减掉的脂肪量：由当前与目标体脂率计算（瘦体重保持不变）", () => {
  // 75kg、18% → 12%：脂肪 13.5kg，瘦体重 61.5kg，目标体重 = 61.5/0.88 ≈ 69.9，需减 ≈ 5.1kg
  const fat = fatToLoseKg({ weightKg: 75, currentBodyFatPercent: 18, targetBodyFatPercent: 12 });
  assert.ok(fat !== undefined);
  assert.ok(Math.abs(fat - 5.1) < 0.3, `75kg 18%→12% 应约减 5.1kg 脂肪，实际 ${fat}`);
});

test("安全日赤字上限随体型分档：体脂越高上限越大", () => {
  assert.ok(maxDailyDeficitKcal("very_high") > maxDailyDeficitKcal("normal"));
  assert.ok(maxDailyDeficitKcal("normal") > maxDailyDeficitKcal("low"));
});

test("完整反推：目标 18%→12%（75kg 正常 BMI）给出最快天数与三档", () => {
  const estimate = estimateTimeToGoal(profile(75, 178), goal(18, 12));
  assert.equal(estimate.precision, "precise");
  assert.ok(estimate.fatToLoseKg !== undefined && estimate.fatToLoseKg > 4 && estimate.fatToLoseKg < 6);
  assert.ok(estimate.totalDeficitKcal !== undefined && estimate.totalDeficitKcal > 30000);
  assert.ok(estimate.fastestDays !== undefined && estimate.fastestDays > 0);
  assert.equal(estimate.paceOptions?.length, 3);

  const [aggressive, standard, gentle] = estimate.paceOptions!;
  assert.ok(aggressive!.days < standard!.days && standard!.days < gentle!.days, "越激进越快");
  assert.ok(estimate.fastestDays >= 70 && estimate.fastestDays <= 85, `最快天数应约 77 天，实际 ${estimate.fastestDays}`);
});

test("缺当前体脂率 → 退回体重趋势兜底，给出区间与可观察目标（不编造精确周数）", () => {
  const estimate = estimateTimeToGoal(profile(75, 178), goal(undefined, 12));
  assert.equal(estimate.precision, "weight_trend_fallback");
  assert.ok(estimate.weeklyWeightChangeTarget, "兜底应给周降幅区间");
  assert.ok(estimate.fallbackNote?.zh.includes("取决于执行"), "兜底说明要诚实");
  assert.ok((estimate.fallbackNote?.en.length ?? 0) > 20, "兜底说明应有英文");
  assert.ok(estimate.upgradableWith?.zh.includes("体脂率") && estimate.upgradableWith?.en.length > 0, "要说明补什么能升级精确模式");
});

test("缺体重 → 兜底，但周降幅只能给百分比（无公斤换算）", () => {
  const p = profile(75, 178);
  delete (p.demographics as { currentWeight?: unknown }).currentWeight;
  const estimate = estimateTimeToGoal(p, goal(18, 12));
  assert.equal(estimate.precision, "weight_trend_fallback");
  assert.ok(estimate.weeklyWeightChangeTarget);
  assert.ok(!estimate.fallbackNote?.zh.includes("kg）"), "无体重时不给公斤换算");
});

test("有精确数据用精确，没有就兜底——两种模式互斥且都可用", () => {
  const precise = estimateTimeToGoal(profile(75, 178), goal(18, 12));
  assert.equal(precise.precision, "precise");
  assert.ok(precise.paceOptions);

  const fallback = estimateTimeToGoal(profile(75, 178), goal(undefined, 12));
  assert.equal(fallback.precision, "weight_trend_fallback");
  assert.equal(fallback.paceOptions, undefined);
});

test("目标不低于当前体脂 → 需减 0，时间 0", () => {
  const fat = fatToLoseKg({ weightKg: 75, currentBodyFatPercent: 12, targetBodyFatPercent: 15 });
  assert.equal(fat, 0);
});
