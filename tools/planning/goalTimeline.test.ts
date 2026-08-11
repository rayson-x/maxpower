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

// 语义修正（2026-08-12）：接入体脂估算后，用户不必自报体脂率——
// 有身高/体重/年龄/性别即可用 Deurenberg-Yap 估算，进入精确模式并标注为估算。
// 只有连估算都做不到（缺性别/身高）才退回体重趋势兜底。
test("用户未自报体脂率但档案够 → 自动估算并进精确模式，且标明是估算", () => {
  const estimate = estimateTimeToGoal(profile(75, 178), goal(undefined, 12));
  assert.equal(estimate.precision, "precise", "能估算就不该退兜底");
  assert.equal(estimate.bodyFatSource?.estimated, true, "必须标明是估算而非测量");
  assert.ok(estimate.bodyFatSource?.method !== "user_reported");
  assert.ok(["medium", "low"].includes(estimate.bodyFatSource?.confidence ?? ""), "估算不得给 high 置信");
  assert.ok(estimate.paceOptions?.length === 3);
});

test("连体脂都无法估算（缺性别）→ 退回体重趋势兜底，不编造精确周数", () => {
  const p = profile(75, 178);
  delete (p.demographics as { sex?: unknown }).sex;
  const estimate = estimateTimeToGoal(p, goal(undefined, 12));
  assert.equal(estimate.precision, "weight_trend_fallback");
  assert.ok(estimate.weeklyWeightChangeTarget, "兜底应给周降幅区间");
  assert.ok(estimate.fallbackNote?.zh.includes("取决于执行"), "兜底说明要诚实");
  assert.ok((estimate.fallbackNote?.en.length ?? 0) > 20, "兜底说明应有英文");
  assert.ok(estimate.upgradableWith?.zh.includes("体脂率"), "要说明补什么能升级");
});

test("缺体重 → 兜底，但周降幅只能给百分比（无公斤换算）", () => {
  const p = profile(75, 178);
  delete (p.demographics as { currentWeight?: unknown }).currentWeight;
  const estimate = estimateTimeToGoal(p, goal(18, 12));
  assert.equal(estimate.precision, "weight_trend_fallback");
  assert.ok(estimate.weeklyWeightChangeTarget);
  assert.ok(!estimate.fallbackNote?.zh.includes("kg）"), "无体重时不给公斤换算");
});

test("自报体脂 vs 估算体脂：都进精确模式，但来源标记不同", () => {
  const reported = estimateTimeToGoal(profile(75, 178), goal(18, 12));
  assert.equal(reported.precision, "precise");
  assert.equal(reported.bodyFatSource?.method, "user_reported");
  assert.equal(reported.bodyFatSource?.estimated, false);

  const derived = estimateTimeToGoal(profile(75, 178), goal(undefined, 12));
  assert.equal(derived.precision, "precise");
  assert.equal(derived.bodyFatSource?.estimated, true);
  // 自报与估算的体脂不同 → 所需时间不同，两者不应巧合相等
  assert.notEqual(reported.fatToLoseKg, derived.fatToLoseKg);
});

test("目标不低于当前体脂 → 需减 0，时间 0", () => {
  const fat = fatToLoseKg({ weightKg: 75, currentBodyFatPercent: 12, targetBodyFatPercent: 15 });
  assert.equal(fat, 0);
});
