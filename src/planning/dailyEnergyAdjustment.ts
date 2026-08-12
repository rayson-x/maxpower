import type { UserProfileData } from "../coach/domain";

/**
 * 每日热量动态调整（2026-08-12 用户拍板：这是纯计算，不需要 agent 判断）。
 *
 * 逻辑：档案里的日常活动水平给出**基准**消耗，实际活动（步数或设备记录）
 * 高于基准时按公式折算额外消耗，据此调整当日可摄入量。
 *
 * 两种策略（用户选，不是我们替他决定）：
 *   - eat_back（默认）：赤字恒定，多动就多吃。可持续性更好，训练表现有保障。
 *   - accelerate：赤字扩大，多动不吃回去。更快但瘦体重风险更高。
 *
 * 数据优先级：设备/用户填报的活动消耗 > 步数折算 > 无调整。
 * 所有系数是产品规则（D 级）；结果始终标注来源与是否估算。
 */

/** 各日常活动档位隐含的基准步数（超出部分才算额外消耗）。 */
const BASELINE_STEPS: Record<NonNullable<UserProfileData["dailyActivityLevel"]>, number> = {
  sedentary: 3500,
  lightly_active: 6000,
  active: 9000,
  very_active: 12000,
};

/**
 * 每步净额外消耗（kcal/kg/步）。
 * 走路净能耗约 0.0004 kcal/kg/步（已扣除同期静息代谢），
 * 即 75kg 走 1000 步净增约 30 kcal。
 */
const NET_KCAL_PER_KG_PER_STEP = 0.0004;

export type EnergyAdjustmentStrategy = "eat_back" | "accelerate";

export interface DailyEnergyAdjustment {
  /** 相对基准的额外活动消耗（kcal，≥0）。 */
  extraActivityKcal: number;
  /** 数据来源。 */
  source: "device_or_user_reported" | "steps_estimate" | "no_data";
  /** 步数相关明细（来源是步数时）。 */
  steps?: { actual: number; baseline: number; surplus: number };
  /** 按策略调整后的当日摄入建议（kcal）。 */
  adjustedIntakeKcal?: { min: number; max: number };
  /** 当日实际赤字（kcal，用于让用户看清代价）。 */
  effectiveDeficitKcal?: number;
  strategy: EnergyAdjustmentStrategy;
  /** 是否为估算（步数折算是估算；设备/用户填报视为报告值）。 */
  estimated: boolean;
}

/**
 * 计算当日热量调整。
 *
 * @param baseIntakeKcal 计划里的基准摄入区间（已含赤字）
 * @param actualSteps 当日实际步数
 * @param reportedActivityKcal 设备或用户填报的活动消耗（优先于步数）
 * @param strategy 多动了怎么处理（默认多动多吃）
 */
export function dailyEnergyAdjustment(input: {
  profile: UserProfileData;
  baseIntakeKcal?: { min: number; max: number };
  baseDeficitKcal?: number;
  actualSteps?: number;
  reportedActivityKcal?: number;
  strategy?: EnergyAdjustmentStrategy;
}): DailyEnergyAdjustment {
  const strategy = input.strategy ?? "eat_back";
  const weightKg = input.profile.demographics?.currentWeight?.value;
  const level = input.profile.dailyActivityLevel ?? "sedentary";

  let extraActivityKcal = 0;
  let source: DailyEnergyAdjustment["source"] = "no_data";
  let steps: DailyEnergyAdjustment["steps"];
  let estimated = true;

  if (input.reportedActivityKcal !== undefined && input.reportedActivityKcal >= 0) {
    // 设备/用户填报优先：这是报告值，不是我们的估算
    extraActivityKcal = Math.round(input.reportedActivityKcal);
    source = "device_or_user_reported";
    estimated = false;
  } else if (input.actualSteps !== undefined && weightKg) {
    const baseline = BASELINE_STEPS[level];
    const surplus = Math.max(0, input.actualSteps - baseline);
    extraActivityKcal = Math.round(surplus * weightKg * NET_KCAL_PER_KG_PER_STEP);
    source = "steps_estimate";
    steps = { actual: input.actualSteps, baseline, surplus };
  }

  const result: DailyEnergyAdjustment = {
    extraActivityKcal,
    source,
    ...(steps ? { steps } : {}),
    strategy,
    estimated,
  };

  if (!input.baseIntakeKcal) return result;

  if (strategy === "eat_back") {
    // 赤字恒定：额外消耗全部加回摄入
    result.adjustedIntakeKcal = {
      min: input.baseIntakeKcal.min + extraActivityKcal,
      max: input.baseIntakeKcal.max + extraActivityKcal,
    };
    if (input.baseDeficitKcal !== undefined) result.effectiveDeficitKcal = input.baseDeficitKcal;
  } else {
    // 加速：摄入不变，赤字扩大
    result.adjustedIntakeKcal = { ...input.baseIntakeKcal };
    if (input.baseDeficitKcal !== undefined) {
      result.effectiveDeficitKcal = input.baseDeficitKcal + extraActivityKcal;
    }
  }
  return result;
}

/**
 * 安全检查：加速策略下的实际赤字是否超过该体型的安全上限。
 * 返回超出量（kcal），未超出返回 0——超出时应提示用户改回 eat_back。
 */
export function deficitOverSafeLimit(input: {
  effectiveDeficitKcal: number;
  maxSafeDailyDeficitKcal: number;
}): number {
  return Math.max(0, input.effectiveDeficitKcal - input.maxSafeDailyDeficitKcal);
}
