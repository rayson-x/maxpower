import type { GoalContractData, UserProfileData } from "../coach/domain";

/**
 * 人群分层（2026-08-12）：把"不同人不同方案"集中到一处可测试的推导。
 *
 * 依据：
 * - recomp 可行性按人群分档（Barakat 2020, NSCA S&C Journal）
 * - 赤字幅度按体脂状态分档（用 %体重/周表达，不用固定千卡——500 kcal 对 108kg 和 58kg 是两回事）
 * - 大基数有氧优先低冲击（知识包有结构化 impact 标签）
 *
 * 所有数值是产品规则（D），方向有文献支撑；具体幅度见 cannotSupport 纪律。
 */

export type BodyMassState = "low" | "normal" | "high" | "very_high";

export interface PersonaTiering {
  /** 体型状态（按 BMI 粗分档；只是排序信号，不是健康诊断）。 */
  bodyMassState: BodyMassState;
  bmi?: number;
  /** recomp（同时增肌减脂）可行性。 */
  recomp: "favorable" | "possible" | "slow";
  /** recomp 的用户可读说明（前因后果）。 */
  recompNoteZh: string;
  /** 赤字期周降幅目标（%体重/周）。 */
  weeklyRateTarget?: { min: number; max: number };
  /** 是否应优先低冲击有氧。 */
  preferLowImpact: boolean;
  /** 产后/特殊阶段的额外提示。 */
  phaseNoteZh?: string;
  /** 进 reasonCodes 的标记。 */
  reasonCodes: readonly string[];
}

/** 按 BMI 粗分档（只是排序信号）。 */
export function bodyMassStateOf(profile: UserProfileData): { state: BodyMassState; bmi?: number } {
  const h = profile.demographics?.height?.value;
  const w = profile.demographics?.currentWeight?.value;
  if (!h || !w) return { state: "normal" };
  const bmi = w / (h / 100) ** 2;
  const state: BodyMassState = bmi < 19 ? "low" : bmi < 25 ? "normal" : bmi < 30 ? "high" : "very_high";
  return { state, bmi: Math.round(bmi * 10) / 10 };
}

/** 赤字期周降幅目标（%体重/周）：体脂越高允许的周降幅越大。 */
export function weeklyRateTargetFor(state: BodyMassState, recentPhase?: "bulk" | "cut" | "maintain"): { min: number; max: number } {
  // 刚过增肌期转刷脂：起步保守（避免同时加有氧又降碳的双打击）
  if (recentPhase === "bulk") return { min: 0.25, max: 0.6 };
  switch (state) {
    case "very_high": return { min: 0.5, max: 1.0 };
    case "high": return { min: 0.4, max: 0.8 };
    case "normal": return { min: 0.3, max: 0.6 };
    case "low": return { min: 0.2, max: 0.4 };
  }
}

/**
 * 人群分层主推导。
 * recomp 可行性（Barakat 2020）：新手/复训/高体脂可行，高级+低体脂很慢。
 */
export function tierPersona(
  profile: UserProfileData,
  goal: GoalContractData,
): PersonaTiering {
  const { state, bmi } = bodyMassStateOf(profile);
  const experience = profile.trainingExperience;
  const returning = profile.returningStatus;
  const recentPhase = profile.historyModifiers?.recentPhase;
  const isFatLoss = goal.goalType === "fat_loss" || goal.primaryGoal === "fat_loss_preserve_lean_mass";
  const isHypertrophy = goal.goalType === "hypertrophy" || goal.primaryGoal === "hypertrophy";

  const reasonCodes: string[] = [];
  let recomp: PersonaTiering["recomp"];
  let recompNoteZh: string;

  const noviceOrReturning = experience === "beginner" || returning === "returning";
  const highFat = state === "high" || state === "very_high";

  if (isHypertrophy) {
    if (state === "low" && experience === "beginner") {
      recomp = "favorable";
      recompNoteZh = "你偏瘦且刚开始系统训练，正处于增肌的「新手窗口期」——这个阶段进步最快，所以用小幅热量盈余而非赤字来保住它，不用急着减脂。";
      reasonCodes.push("recomp_favorable_lean_beginner");
    } else if (highFat) {
      recomp = "favorable";
      recompNoteZh = "你有较多能量储备，抗阻训练配合足量蛋白时，这个阶段常常可以一边增肌一边改善体型。";
      reasonCodes.push("recomp_favorable_high_body_mass");
    } else if (experience === "advanced") {
      recomp = "slow";
      recompNoteZh = "以你的训练年限，增肌速度会自然放慢；我们把目标定在稳步渐进，而不是短期变大。";
      reasonCodes.push("recomp_slow_advanced");
    } else {
      recomp = "possible";
      recompNoteZh = "以你的情况，增肌与维持体成分可以并行。";
      reasonCodes.push("recomp_possible");
    }
  } else if (isFatLoss) {
    if (recentPhase === "bulk") {
      recomp = "possible";
      recompNoteZh = "你刚结束增肌期——起步用小赤字、保住训练负荷，不同时加大量有氧又猛降碳，避免双重打击。";
      reasonCodes.push("post_bulk_cut_conservative_start");
    } else if (noviceOrReturning && highFat) {
      recomp = "favorable";
      recompNoteZh = "以你的训练阶段和体型，这个阶段完全可以一边减脂一边增肌——饮食 + 抗阻 + 足量蛋白就是组合。";
      reasonCodes.push("recomp_favorable_novice_high_mass");
    } else if (experience === "advanced" && (state === "low" || state === "normal")) {
      recomp = "slow";
      recompNoteZh = "以你的训练年限，减脂期的目标应是保住肌肉与力量，增肌会很慢——我们把重点放在「保」。 ";
      reasonCodes.push("recomp_slow_preserve_focus");
    } else {
      recomp = "possible";
      recompNoteZh = "减脂以保住肌肉为先：足量蛋白 + 维持训练负荷。";
      reasonCodes.push("recomp_possible");
    }
  } else {
    recomp = "possible";
    recompNoteZh = "以你的目标，训练以维持与渐进为主。";
    reasonCodes.push("recomp_possible");
  }

  const preferLowImpact = state === "very_high" || state === "high";
  if (preferLowImpact) reasonCodes.push("aerobic_prefer_low_impact_high_body_mass");

  return {
    bodyMassState: state,
    ...(bmi !== undefined ? { bmi } : {}),
    recomp,
    recompNoteZh,
    ...(isFatLoss ? { weeklyRateTarget: weeklyRateTargetFor(state, recentPhase) } : {}),
    preferLowImpact,
    reasonCodes,
  };
}
