import type { GoalContractData, UserProfileData } from "../coach/domain";
import { bodyMassStateOf } from "./personTiering";

/**
 * 目标 → 时间反推（2026-08-12 用户拍板的设计方向）。
 *
 * 正确顺序：
 *   目标（体脂/体重/围度）→ 需要多少变化 → 折算总能量差 →
 *   按安全的每日赤字上限平摊 → 达成目标的最快天数 → 再推导不同速度档
 *
 * 与旧思路相反（先给计划再标时间）。现在是**时间从目标算出来**，不是拍出来的。
 *
 * 所有常数是产品规则（D）；体脂→热量的换算是近似（1kg 体脂 ≈ 7700 kcal），
 * 标注为估算、需用实际体重趋势校准。
 */

/** 1kg 体脂对应的能量（近似，产品规则 D）。 */
export const KCAL_PER_KG_FAT = 7700;

/** 按体型的安全日赤字上限（kcal/天）——赤字上限由体脂保护能力决定。 */
export function maxDailyDeficitKcal(bodyMassState: ReturnType<typeof bodyMassStateOf>["state"]): number {
  switch (bodyMassState) {
    case "very_high": return 900;
    case "high": return 700;
    case "normal": return 500;
    case "low": return 350;
  }
}

/** 由当前与目标体脂率，估算需要减掉的脂肪量（kg）。 */
export function fatToLoseKg(input: {
  weightKg: number;
  currentBodyFatPercent?: number;
  targetBodyFatPercent?: number;
}): number | undefined {
  const { weightKg, currentBodyFatPercent, targetBodyFatPercent } = input;
  if (currentBodyFatPercent === undefined || targetBodyFatPercent === undefined) return undefined;
  if (targetBodyFatPercent >= currentBodyFatPercent) return 0;
  // 当前脂肪量与目标脂肪量（近似假设瘦体重不变）
  const currentFatKg = weightKg * (currentBodyFatPercent / 100);
  const leanKg = weightKg - currentFatKg;
  // 目标体重：保持瘦体重，目标体脂率 → 目标体重 = lean / (1 - targetBF)
  const targetWeight = leanKg / (1 - targetBodyFatPercent / 100);
  return Math.max(0, weightKg - targetWeight);
}

export interface GoalTimeEstimate {
  /** 需要减掉的脂肪量（kg）。 */
  fatToLoseKg?: number;
  /** 所需总能量差（kcal）。 */
  totalDeficitKcal?: number;
  /** 该用户的安全日赤字上限（kcal/天）。 */
  maxDailyDeficitKcal: number;
  /** 理论最快达成天数（用足安全上限）。 */
  fastestDays?: number;
  /** 三个速度档的时间估算。 */
  paceOptions: readonly {
    pace: "aggressive" | "standard" | "gentle";
    dailyDeficitKcal: number;
    days: number;
    weeks: number;
    note: string;
  }[];
  /** 是否能估算（缺当前体脂率则不能）。 */
  estimable: boolean;
  /** 不能估算时要问什么。 */
  missing?: string;
}

/**
 * 目标 → 时间反推主函数。
 * 缺当前体脂率时返回不可估算 + 要问的问题（绝不编造起点）。
 */
export function estimateTimeToGoal(
  profile: UserProfileData,
  goal: GoalContractData,
): GoalTimeEstimate {
  const { state } = bodyMassStateOf(profile);
  const maxDeficit = maxDailyDeficitKcal(state);
  const weightKg = profile.demographics?.currentWeight?.value;

  const targetBf = goal.targets?.targetBodyFat?.value;
  // 当前体脂率：用户测量/估算输入（targets.currentBodyFat），没有就问，不编造起点
  const currentBfValue = goal.targets?.currentBodyFat?.value;

  if (weightKg === undefined || targetBf === undefined || currentBfValue === undefined) {
    return {
      maxDailyDeficitKcal: maxDeficit,
      paceOptions: [],
      estimable: false,
      missing:
        weightKg === undefined
          ? "需要你的当前体重"
          : targetBf === undefined
            ? "需要你的目标体脂率"
            : "需要你的当前体脂率（可以估算，或告诉我大概范围）",
    };
  }

  const fatKg = fatToLoseKg({ weightKg, currentBodyFatPercent: currentBfValue, targetBodyFatPercent: targetBf });
  if (fatKg === undefined) {
    return { maxDailyDeficitKcal: maxDeficit, paceOptions: [], estimable: false, missing: "体脂数据无效" };
  }
  const totalDeficit = fatKg * KCAL_PER_KG_FAT;

  const options = (["aggressive", "standard", "gentle"] as const).map((pace) => {
    const dailyDeficit =
      pace === "aggressive" ? maxDeficit : pace === "standard" ? Math.round(maxDeficit * 0.7) : Math.round(maxDeficit * 0.45);
    const days = Math.ceil(totalDeficit / dailyDeficit);
    return {
      pace,
      dailyDeficitKcal: dailyDeficit,
      days,
      weeks: Math.ceil(days / 7),
      note:
        pace === "aggressive"
          ? "最快路径：每天顶到安全赤字上限，需严格保负荷+高蛋白+熔断机制"
          : pace === "standard"
            ? "平衡路径：赤字适中，瘦体重保护更好，依从性更高"
            : "稳健路径：赤字最小，几乎不影响训练表现，适合不想太克制",
    };
  });

  return {
    fatToLoseKg: Math.round(fatKg * 10) / 10,
    totalDeficitKcal: Math.round(totalDeficit),
    maxDailyDeficitKcal: maxDeficit,
    fastestDays: Math.ceil(totalDeficit / maxDeficit),
    paceOptions: options,
    estimable: true,
  };
}
