import type { UserProfileData } from "../coach/domain";

/**
 * 体脂率估算（2026-08-12）：从围度/身高体重推算，不要求用户自报。
 *
 * 为什么需要：用户报不准体脂率、也不一定愿意测。但腰围、身高、体重是低门槛数据，
 * 用公开验证过的公式就能给出可用估算，从而让目标时间线进入"精确模式"。
 * 方法参考同作者 BetterMeet 项目的实现思路。
 *
 * 方法优先级：
 *   1. 美国海军围度法（Navy）——有腰围时首选，误差最小
 *   2. Deurenberg-Yap（亚洲人群 BMI→体脂）——只有身高体重年龄时的兜底
 *   两者都有时加权（Navy 0.7 / BMI 法 0.3）
 *
 * 训练者修正：BMI 类方法对高肌肉量者系统性高估体脂（文献约 2-5%），
 * 用相对力量判断训练水平后下调，并降低置信度。
 *
 * 纪律：结果**始终标为估算**（不是测量），置信度随方法与数据完整度分级；
 * 缺关键数据时返回 undefined，绝不猜。
 */

export type BodyFatMethod = "navy" | "deurenberg_yap" | "navy_bmi_blend";
export type BodyFatConfidence = "high" | "medium" | "low";

export interface BodyFatEstimate {
  /** 估算体脂率（%）。 */
  percent: number;
  method: BodyFatMethod;
  confidence: BodyFatConfidence;
  /** 各方法的中间结果（可解释性）。 */
  breakdown: { navy?: number; deurenbergYap?: number };
  /** 是否应用了训练者修正（高肌肉量导致 BMI 法高估）。 */
  trainedAdjustment: boolean;
  /** 颈围是否为身高常模近似（影响 Navy 精度）。 */
  neckApproximated: boolean;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 美国海军围度法。
 * 男：腰围 − 颈围；女：腰围 + 臀围 − 颈围。
 */
export function navyBodyFat(input: {
  sex: "male" | "female";
  waistCm: number;
  neckCm: number;
  heightCm: number;
  hipCm?: number;
}): number | undefined {
  if (input.heightCm <= 0) return undefined;
  if (input.sex === "female") {
    if (input.hipCm === undefined) return undefined; // 女性公式必须有臀围，不能凑
    const sum = input.waistCm + input.hipCm - input.neckCm;
    if (sum <= 0) return undefined;
    const density = 1.29579 - 0.35004 * Math.log10(sum) + 0.221 * Math.log10(input.heightCm);
    if (density <= 0) return undefined;
    return round1(clamp(495 / density - 450, 8, 60));
  }
  const diff = input.waistCm - input.neckCm;
  if (diff <= 0) return undefined;
  const density = 1.0324 - 0.19077 * Math.log10(diff) + 0.15456 * Math.log10(input.heightCm);
  if (density <= 0) return undefined;
  return round1(clamp(495 / density - 450, 3, 55));
}

/** Deurenberg-Yap（亚洲人群 BMI → 体脂）。 */
export function deurenbergYapBodyFat(input: {
  sex: "male" | "female";
  heightCm: number;
  weightKg: number;
  ageYears: number;
}): number | undefined {
  if (input.heightCm <= 0 || input.weightKg <= 0) return undefined;
  const bmi = input.weightKg / (input.heightCm / 100) ** 2;
  const sexTerm = input.sex === "male" ? 10.9 : 0;
  const bf = 1.034 * bmi - sexTerm + 0.1 * input.ageYears + 6.5;
  return round1(clamp(bf, 4, 55));
}

/**
 * 由相对力量判断训练水平（用于 BMI 法的肌肉量修正）。
 * 常模：三项平均相对重量 ≥1.15 视为系统训练者。
 */
export function trainingLevelFromLifts(
  baseline: UserProfileData["strengthBaseline"],
  weightKg: number,
): "untrained" | "recreational" | "trained" | undefined {
  if (!baseline || weightKg <= 0) return undefined;
  const ratios = [baseline.squat?.value, baseline.benchPress?.value, baseline.deadlift?.value]
    .filter((value): value is number => typeof value === "number" && value > 0)
    .map((value) => value / weightKg);
  if (!ratios.length) return undefined;
  const average = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  if (average >= 1.15) return "trained";
  if (average >= 0.85) return "recreational";
  return "untrained";
}

/**
 * 综合体脂率估算。缺关键数据时返回 undefined（不猜）。
 *
 * 围度默认从 profile.demographics.currentCircumferences 读；measurements 参数可覆盖。
 * @param measurements 可选覆盖（腰围最关键；颈围缺失时男性用身高常模近似并降置信）
 */
export function estimateBodyFat(input: {
  profile: UserProfileData;
  measurements?: { waistCm?: number; neckCm?: number; hipCm?: number };
}): BodyFatEstimate | undefined {
  const demo = input.profile.demographics;
  const heightCm = demo?.height?.value;
  const weightKg = demo?.currentWeight?.value;
  const ageYears = demo?.ageYears;
  // 性别缺失时不估算：两个公式的性别项差异很大，猜会给出误导性数字
  const sex = demo?.sex === "male" || demo?.sex === "female" ? demo.sex : undefined;
  if (!heightCm || !sex) return undefined;

  const breakdown: BodyFatEstimate["breakdown"] = {};
  let neckApproximated = false;

  // 围度默认从档案读（currentCircumferences），measurements 参数用于覆盖/测试。
  // 内聚在这里，避免每个调用点重复提取逻辑而漏掉腰围。
  const circ = input.profile.demographics?.currentCircumferences;
  const measured = {
    waistCm: input.measurements?.waistCm ?? circ?.waist?.value,
    neckCm: input.measurements?.neckCm ?? circ?.neck?.value,
    hipCm: input.measurements?.hipCm ?? circ?.hip?.value,
  };

  let navy: number | undefined;
  const waistCm = measured.waistCm;
  if (waistCm) {
    let neckCm = measured.neckCm;
    if (neckCm === undefined && sex === "male") {
      // 颈围未采集：用身高常模近似（≈身高×0.22），置信度相应下调
      neckCm = heightCm * 0.22;
      neckApproximated = true;
    }
    if (neckCm !== undefined) {
      navy = navyBodyFat({ sex, waistCm, neckCm, heightCm, ...(measured.hipCm ? { hipCm: measured.hipCm } : {}) });
      if (navy !== undefined) breakdown.navy = navy;
    }
  }

  let dy: number | undefined;
  if (weightKg && ageYears !== undefined) {
    dy = deurenbergYapBodyFat({ sex, heightCm, weightKg, ageYears });
    if (dy !== undefined) breakdown.deurenbergYap = dy;
  }

  if (navy === undefined && dy === undefined) return undefined;

  const level = trainingLevelFromLifts(input.profile.strengthBaseline, weightKg ?? 0);
  const trained = level === "trained";

  let percent: number;
  let method: BodyFatMethod;
  let confidence: BodyFatConfidence;
  if (navy !== undefined) {
    if (dy !== undefined) {
      percent = round1(navy * 0.7 + dy * 0.3);
      method = "navy_bmi_blend";
    } else {
      percent = navy;
      method = "navy";
    }
    confidence = neckApproximated ? "medium" : "high";
  } else {
    percent = dy!;
    method = "deurenberg_yap";
    confidence = "medium";
  }

  let trainedAdjustment = false;
  if (trained) {
    // 高肌肉量：BMI 类方法系统性高估，下调后降置信
    percent = round1(clamp(percent - 2.5, 3, 55));
    trainedAdjustment = true;
    if (method === "deurenberg_yap") confidence = "low";
  }

  return { percent, method, confidence, breakdown, trainedAdjustment, neckApproximated };
}
