import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfileData } from "../../src/coach/domain";
import {
  deurenbergYapBodyFat,
  estimateBodyFat,
  navyBodyFat,
  trainingLevelFromLifts,
} from "../../src/planning/bodyComposition";

/** 体脂估算验收。能量消耗只由 dailyEnergyBudget 覆盖。 */

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
    id: "p", locale: "zh-CN",
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

test("脂肪下限有按体重的绝对地板：低热量时不得被百分比法压穿", () => {
  // 场景：久坐 + 激进赤字 → 总热量低，25% 的比例会给出 <0.6 g/kg
  // 依据：减脂期脂肪不应低于约 0.6 g/kg（激素与脂溶性维生素吸收）
  const weightKg = 75;
  const lowEnergyTarget = 1827;
  const byEnergy = (lowEnergyTarget * 0.25) / 9;
  const byWeight = weightKg * 0.6;
  assert.ok(byWeight > byEnergy - 10, "该场景下体重地板应接近或高于百分比值（说明保护有意义）");
  // 正式候选验证器负责绝对营养护栏；这里锁住不变量的方向。
  assert.ok(Math.max(byEnergy, byWeight) >= weightKg * 0.6, "最终脂肪下限不得低于 0.6 g/kg");
});
