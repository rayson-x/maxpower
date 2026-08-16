import type { UserProfileData } from "../coach/domain";

/**
 * 每日能量预算（2026-08-12 用户拍板：要严格的按天分解，不要平摊平均值）。
 *
 * 严格分解：
 *   当日 TDEE = 基础代谢(BMR) + 日常代谢(NEAT) + 运动代谢(EAT) + 食物热效应(TEF)
 *
 * 为什么必须按天算而不是给一个平均数：
 * - 力量训练日比休息日多消耗 250-350 kcal（75kg / 75 分钟）
 * - 给一个"每天 1951"的平均值，会让训练日吃不够（影响表现与恢复）、
 *   休息日吃过量（吃掉赤字）
 * - 按天算天然与碳水循环对齐：高消耗日=高碳日，低消耗日=低碳日
 *
 * 所有 MET 值取自 Compendium of Physical Activities 的常用条目；
 * 系数为产品规则（D 级），结果始终带不确定度。
 */

/** MET 值（代谢当量，1 MET = 静息代谢）。 */
const MET = {
  /** 中等强度抗阻训练（含组间休息的平均值）。 */
  resistance_moderate: 3.5,
  /** 大重量抗阻训练（低次数、长休息，平均 MET 反而不高）。 */
  resistance_heavy: 3.0,
  /** 快走（约 5-5.5 km/h）。 */
  walk_brisk: 4.3,
  /** 慢走。 */
  walk_easy: 3.0,
  /** 中等强度骑行/椭圆。 */
  cardio_moderate: 6.0,
  /** 高强度间歇。 */
  cardio_vigorous: 8.0,
} as const;

export type ActivityKind = keyof typeof MET;

/** 各日常活动档位隐含的基准步数。 */
const BASELINE_STEPS: Record<NonNullable<UserProfileData["dailyActivityLevel"]>, number> = {
  sedentary: 3500,
  lightly_active: 6000,
  active: 9000,
  very_active: 12000,
};

/** 日常活动（NEAT）对 BMR 的乘数——不含运动与食物热效应。 */
const NEAT_MULTIPLIER: Record<NonNullable<UserProfileData["dailyActivityLevel"]>, number> = {
  sedentary: 1.10,
  lightly_active: 1.20,
  active: 1.32,
  very_active: 1.48,
};

/** 每步净额外消耗（kcal/kg/步，已扣同期静息）。 */
const NET_KCAL_PER_KG_PER_STEP = 0.0004;

export interface DayActivity {
  /** 结构化运动（可多项：力量 + 练后有氧）。 */
  sessions?: readonly { kind: ActivityKind; minutes: number }[];
  /** 当日实际步数（有则用它替代档案基准估 NEAT）。 */
  actualSteps?: number;
  /** 计划中的额外步数，只用于未来计划预算；不能冒充已完成的健康数据。 */
  plannedExtraSteps?: number;
  /** 设备/用户填报的当日活动总消耗；只作为带误差证据与模型估算稳健融合。 */
  reportedActivityKcal?: number;
}

export interface DailyEnergyBudget {
  /** 基础代谢。 */
  bmrKcal: number;
  /** 日常代谢（NEAT，不含结构化运动）。 */
  neatKcal: number;
  /** 运动代谢（EAT，结构化训练净消耗）。 */
  eatKcal: number;
  /** 食物热效应。 */
  tefKcal: number;
  /** 当日总消耗。 */
  tdeeKcal: number;
  /** 当日摄入目标（TDEE − 赤字）。 */
  intakeTargetKcal?: number;
  /** 不确定度（±kcal）。 */
  uncertaintyKcal: number;
  /** NEAT 的来源：实际步数 / 档案档位。 */
  neatSource: "actual_steps" | "profile_level" | "reported_evidence";
  /** 计划额外步数带来的预估消耗，与用户实际记录分开。 */
  plannedExtraActivityKcal?: number;
  /** EAT 明细（可解释）。 */
  eatBreakdown: readonly { kind: ActivityKind; minutes: number; kcal: number }[];
}

/** Mifflin-St Jeor 基础代谢。 */
export function basalMetabolicRate(profile: UserProfileData): number | undefined {
  const demo = profile.demographics;
  const h = demo?.height?.unit === "cm"
    ? demo.height.value
    : demo?.height?.unit === "in"
      ? demo.height.value * 2.54
      : undefined;
  const w = demo?.currentWeight?.unit === "kg"
    ? demo.currentWeight.value
    : demo?.currentWeight?.unit === "lb"
      ? demo.currentWeight.value * 0.45359237
      : undefined;
  const age = demo?.ageYears;
  if (!h || !w || age === undefined || (demo?.sex !== "female" && demo?.sex !== "male")) return undefined;
  const sexTerm = demo?.sex === "female" ? -161 : 5;
  return 10 * w + 6.25 * h - 5 * age + sexTerm;
}

/**
 * 单次运动的净消耗（kcal）。
 * 净 = (MET − 1) × 体重kg × 小时数 —— 扣掉同期本来就会发生的静息代谢，
 * 避免与 BMR 重复计算。
 */
export function activityNetKcal(input: { kind: ActivityKind; minutes: number; weightKg: number }): number {
  const hours = input.minutes / 60;
  return Math.round((MET[input.kind] - 1) * input.weightKg * hours);
}

/**
 * 计算某一天的能量预算。
 *
 * @param dailyDeficitKcal 该日目标赤字（减脂期；增肌期传负数即盈余）
 */
export function dailyEnergyBudget(input: {
  profile: UserProfileData;
  day: DayActivity;
  dailyDeficitKcal?: number;
}): DailyEnergyBudget | undefined {
  const bmr = basalMetabolicRate(input.profile);
  const rawWeight = input.profile.demographics?.currentWeight;
  const weightKg = rawWeight?.unit === "kg"
    ? rawWeight.value
    : rawWeight?.unit === "lb"
      ? rawWeight.value * 0.45359237
      : undefined;
  if (bmr === undefined || !weightKg) return undefined;
  const level = input.profile.dailyActivityLevel ?? "sedentary";

  // ── 日常代谢 NEAT ──
  let neatKcal: number;
  let neatSource: DailyEnergyBudget["neatSource"];
  let plannedExtraActivityKcal = 0;
  if (input.day.actualSteps !== undefined) {
    // 有实际步数：基准 NEAT + 超出基准部分的净消耗
    const baseNeat = bmr * (NEAT_MULTIPLIER[level] - 1);
    const surplus = Math.max(0, input.day.actualSteps - BASELINE_STEPS[level]);
    neatKcal = Math.round(baseNeat + surplus * weightKg * NET_KCAL_PER_KG_PER_STEP);
    neatSource = "actual_steps";
  } else {
    neatKcal = Math.round(bmr * (NEAT_MULTIPLIER[level] - 1));
    neatSource = "profile_level";
    if (input.day.plannedExtraSteps !== undefined) {
      plannedExtraActivityKcal = Math.round(Math.max(0, input.day.plannedExtraSteps) * weightKg * NET_KCAL_PER_KG_PER_STEP);
      neatKcal += plannedExtraActivityKcal;
    }
  }

  // ── 运动代谢 EAT ──
  const eatBreakdown = (input.day.sessions ?? []).map((session) => ({
    kind: session.kind,
    minutes: session.minutes,
    kcal: activityNetKcal({ kind: session.kind, minutes: session.minutes, weightKg }),
  }));
  let eatKcal = eatBreakdown.reduce((sum, item) => sum + item.kcal, 0);

  // 用户/设备活动值是观测证据，不是真值。限制单次观测的影响后与
  // 结构化活动模型融合，避免穿戴设备误差直接改写整日 TDEE。
  if (input.day.reportedActivityKcal !== undefined) {
    const reported = Math.max(0, Math.round(input.day.reportedActivityKcal));
    const modeledActivity = neatKcal + eatKcal;
    const boundedReport = Math.max(modeledActivity * 0.5, Math.min(modeledActivity * 1.5, reported));
    const blendedActivity = Math.round(modeledActivity * 0.5 + boundedReport * 0.5);
    neatKcal = Math.max(0, blendedActivity - eatKcal);
    neatSource = "reported_evidence";
  }

  // ── 食物热效应 TEF（约占摄入 10%；维持状态下用消耗近似） ──
  const beforeTef = bmr + neatKcal + eatKcal;
  const tefKcal = Math.round(beforeTef * 0.1);
  const tdeeKcal = Math.round(beforeTef + tefKcal);

  return {
    bmrKcal: Math.round(bmr),
    neatKcal,
    eatKcal,
    tefKcal,
    tdeeKcal,
    ...(input.dailyDeficitKcal !== undefined
      ? { intakeTargetKcal: Math.round(tdeeKcal - input.dailyDeficitKcal) }
      : {}),
    uncertaintyKcal: Math.round(tdeeKcal * (neatSource === "reported_evidence" ? 0.12 : neatSource === "actual_steps" ? 0.08 : 0.1)),
    neatSource,
    ...(plannedExtraActivityKcal ? { plannedExtraActivityKcal } : {}),
    eatBreakdown,
  };
}

/**
 * 把计划里的一天映射成 DayActivity（力量/有氧/休息）。
 * 力量训练按时长与强度取 MET；有氧按类型取。
 */
export function dayActivityFromPlan(input: {
  kind: "strength" | "cardio" | "rest";
  minutes?: number;
  intensity?: "moderate" | "heavy" | "vigorous";
  actualSteps?: number;
}): DayActivity {
  const sessions: { kind: ActivityKind; minutes: number }[] = [];
  if (input.kind === "strength" && input.minutes) {
    sessions.push({
      kind: input.intensity === "heavy" ? "resistance_heavy" : "resistance_moderate",
      minutes: input.minutes,
    });
  } else if (input.kind === "cardio" && input.minutes) {
    sessions.push({
      kind: input.intensity === "vigorous" ? "cardio_vigorous" : "walk_brisk",
      minutes: input.minutes,
    });
  }
  return {
    ...(sessions.length ? { sessions } : {}),
    ...(input.actualSteps !== undefined ? { actualSteps: input.actualSteps } : {}),
  };
}
