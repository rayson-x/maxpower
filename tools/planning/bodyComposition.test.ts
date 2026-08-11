import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfileData } from "../../src/coach/domain";
import {
  activityFactorFor,
  deurenbergYapBodyFat,
  estimateBodyFat,
  navyBodyFat,
  trainingLevelFromLifts,
} from "../../src/planning/bodyComposition";

/** 体脂估算与活动系数验收（2026-08-12）。 */

function profileOf(over: {
  sex?: "male" | "female";
  h?: number;
  w?: number;
  age?: number;
  waist?: number;
  neck?: number;
  hip?: number;
  lifts?: { squat: number; bench: number; deadlift: number };
} = {}): UserProfileData {
  const circ: Record<string, { value: number; unit: "cm" }> = {};
  if (over.waist) circ.waist = { value: over.waist, unit: "cm" };
  if (over.neck) circ.neck = { value: over.neck, unit: "cm" };
  if (over.hip) circ.hip = { value: over.hip, unit: "cm" };
  return {
    id: "p", trainingExperience: "intermediate", locale: "zh-CN",
    demographics: {
      ageYears: over.age ?? 30,
      sex: over.sex ?? "male",
      height: { value: over.h ?? 178, unit: "cm" },
      currentWeight: { value: over.w ?? 75, unit: "kg" },
      ...(Object.keys(circ).length ? { currentCircumferences: circ } : {}),
    },
    ...(over.lifts
      ? {
          strengthBaseline: {
            squat: { value: over.lifts.squat, unit: "kg" },
            benchPress: { value: over.lifts.bench, unit: "kg" },
            deadlift: { value: over.lifts.deadlift, unit: "kg" },
            measuredAt: "2026-08-12", source: "user_confirmed",
          },
        }
      : {}),
  };
}

test("活动系数按标准分档：一周 5 天属中度（1.55），不是高强度（1.725）", () => {
  // 修复记录：此前 freq<=4 用 1.55、5 天就跳 1.725，导致维持热量高估约 300 kcal
  assert.equal(activityFactorFor(1), 1.2);
  assert.equal(activityFactorFor(2), 1.375);
  assert.equal(activityFactorFor(3), 1.55);
  assert.equal(activityFactorFor(5), 1.55, "一周 5 天应为中度档");
  assert.equal(activityFactorFor(6), 1.725);
  assert.equal(activityFactorFor(7), 1.9);
});

test("海军围度法：男性用腰围−颈围，女性必须有臀围（缺则不估）", () => {
  const male = navyBodyFat({ sex: "male", waistCm: 86, neckCm: 39, heightCm: 178 });
  assert.ok(male !== undefined && male > 12 && male < 22, `178cm/腰86 应约 16%，实际 ${male}`);
  // 女性缺臀围不能凑
  assert.equal(navyBodyFat({ sex: "female", waistCm: 70, neckCm: 32, heightCm: 163 }), undefined);
  const female = navyBodyFat({ sex: "female", waistCm: 70, neckCm: 32, heightCm: 163, hipCm: 95 });
  assert.ok(female !== undefined && female > 15 && female < 40, `女性估算应在合理区间，实际 ${female}`);
});

test("腰围越大体脂估算越高（单调性）", () => {
  const lean = navyBodyFat({ sex: "male", waistCm: 76, neckCm: 39, heightCm: 178 })!;
  const heavier = navyBodyFat({ sex: "male", waistCm: 96, neckCm: 39, heightCm: 178 })!;
  assert.ok(heavier > lean, `腰96(${heavier}) 应高于腰76(${lean})`);
});

test("Deurenberg-Yap：同 BMI 下女性体脂高于男性", () => {
  const male = deurenbergYapBodyFat({ sex: "male", heightCm: 178, weightKg: 75, ageYears: 30 })!;
  const female = deurenbergYapBodyFat({ sex: "female", heightCm: 178, weightKg: 75, ageYears: 30 })!;
  assert.ok(female > male, `同 BMI 女性(${female}) 应高于男性(${male})`);
});

test("综合估算：有腰围走 Navy 混合，无围度退 BMI 法", () => {
  const withWaist = estimateBodyFat({ profile: profileOf({ waist: 86 }) });
  assert.ok(withWaist);
  assert.equal(withWaist.method, "navy_bmi_blend");
  assert.ok(withWaist.breakdown.navy !== undefined && withWaist.breakdown.deurenbergYap !== undefined);

  const noWaist = estimateBodyFat({ profile: profileOf({}) });
  assert.ok(noWaist);
  assert.equal(noWaist.method, "deurenberg_yap");
  assert.equal(noWaist.confidence, "medium");
});

test("系统训练者修正：相对力量高时下调体脂（BMI 法对高肌肉量高估）", () => {
  const plain = estimateBodyFat({ profile: profileOf({ waist: 86 }) })!;
  const trained = estimateBodyFat({ profile: profileOf({ waist: 86, lifts: { squat: 100, bench: 80, deadlift: 110 } }) })!;
  assert.equal(trained.trainedAdjustment, true, "三项均值 1.29 应判为系统训练者");
  assert.ok(trained.percent < plain.percent, `训练者应下调（${trained.percent} < ${plain.percent}）`);
});

test("相对力量分级：1.29 为 trained，0.9 为 recreational，0.6 为 untrained", () => {
  const base = { measuredAt: "2026-08-12", source: "user_confirmed" as const };
  const at = (squat: number, bench: number, deadlift: number) =>
    trainingLevelFromLifts(
      { squat: { value: squat, unit: "kg" }, benchPress: { value: bench, unit: "kg" }, deadlift: { value: deadlift, unit: "kg" }, ...base },
      75,
    );
  assert.equal(at(100, 80, 110), "trained");
  assert.equal(at(70, 55, 78), "recreational");
  assert.equal(at(50, 35, 55), "untrained");
});

test("性别缺失不估算（两公式性别项差异大，猜会误导）", () => {
  const profile = profileOf({ waist: 86 });
  delete (profile.demographics as { sex?: unknown }).sex;
  assert.equal(estimateBodyFat({ profile }), undefined);
});

test("估算结果始终标记为估算（不能冒充测量）", () => {
  const estimate = estimateBodyFat({ profile: profileOf({ waist: 86 }) })!;
  assert.ok(["high", "medium", "low"].includes(estimate.confidence));
  // 颈围是身高常模近似时置信度不得为 high
  assert.equal(estimate.neckApproximated, true);
  assert.notEqual(estimate.confidence, "high", "颈围为近似值时不能给高置信");
});
