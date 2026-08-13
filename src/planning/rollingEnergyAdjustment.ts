import type { TimelineProjectionEvent, UserProfileData } from "../coach/domain";
import { estimateThermicEffect } from "../nutrition/thermicEffect";
import { activityNetKcal } from "./dailyEnergyBudget";

export interface RollingEnergyAdjustment {
  lookbackDays: number;
  loggedDays: number;
  /** 只有描述、没有热量的「吃多/聚餐」记录数量；绝不伪装成精确日志。 */
  estimatedDays: number;
  /** 相对计划缺口仍未回收的能量；来自量化日志，或明确「吃多」描述的低置信度估算。 */
  unrecoveredSurplusKcal: number;
  loggedThermicEffectKcal: number;
  /** 差额来自哪里；供客户端说明可核实程度。 */
  surplusSource: "logged_intake" | "description_estimate" | "mixed" | "none";
  /** 仅描述触发时的保守估算区间，用户补录热量后会被真实记录替代。 */
  estimatedSurplusRangeKcal?: { min: number; max: number };
  status: "no_quantified_intake" | "on_track" | "gentle_rebalance";
  horizonDays?: number;
  dailyAdditionalDeficitCapKcal?: number;
  /** 当前可用时段内实际能安排的额外活动总量。 */
  plannedAdditionalExpenditureKcal?: number;
  /** 受恢复与单日上限约束后，仍留给后续周趋势复核的差额。 */
  remainingSurplusKcal?: number;
  actions: readonly {
    date: string;
    extraSteps: number;
    extraLowImpactCardioMinutes: number;
    estimatedExtraExpenditureKcal: number;
    gate: "only_if_recovery_normal";
  }[];
  reasonCodes: readonly string[];
}

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 7;
const MAX_DAILY_EXTRA_DEFICIT_KCAL = 120;
const STEP_KCAL_PER_KG = 0.0004;

/**
 * 用户只说「聚餐/吃多」却没有热量时的保守起点，而非营养数据库的伪精确换算。
 * 范围比单点更诚实；计划只用中点分摊，而且仍受单日与恢复上限限制。
 */
function surplusEstimateForDescription(description?: string): { min: number; max: number } | undefined {
  if (!description || !/(聚餐|吃多|大餐|超量|放纵|吃撑|暴食)/.test(description)) return undefined;
  return /(很多|严重|非常|吃撑|暴食)/.test(description)
    ? { min: 450, max: 800 }
    : { min: 250, max: 550 };
}

export function rollingEnergyAdjustmentFor(input: {
  currentDate: string;
  profile: UserProfileData;
  timeline: readonly TimelineProjectionEvent[];
  targetDailyDeficitKcal?: number;
  futureDates: readonly string[];
  /** Remaining minutes in an existing after-strength low-impact block. */
  futureCardioCapacityMinutes?: Readonly<Record<string, number>>;
}): RollingEnergyAdjustment {
  const weightKg = input.profile.demographics?.currentWeight?.value;
  const targetDeficit = input.targetDailyDeficitKcal;
  if (!weightKg || targetDeficit === undefined || targetDeficit <= 0) {
    return {
      lookbackDays: LOOKBACK_DAYS, loggedDays: 0, estimatedDays: 0, unrecoveredSurplusKcal: 0, loggedThermicEffectKcal: 0, surplusSource: "none",
      status: "no_quantified_intake", actions: [], reasonCodes: ["rolling_energy_adjustment_requires_weight_and_target_deficit"],
    };
  }
  const currentMs = Date.parse(`${input.currentDate}T12:00:00.000Z`);
  const byDate = new Map<string, { energy: number; protein: number; carbohydrate: number; fat: number; reportedSurplus: number }>();
  const descriptionEstimates: { date: string; range: { min: number; max: number } }[] = [];
  for (const event of input.timeline) {
    if ((event.lifecycle === "superseded" || event.lifecycle === "tombstoned") || event.fact.kind !== "nutrition" || event.fact.confidence !== "confirmed") continue;
    const date = localDate(event.occurredAt, event.timezoneOffsetMinutes);
    const dateMs = Date.parse(`${date}T12:00:00.000Z`);
    const reportedSurplus = Math.max(0, event.fact.reportedEnergyDeviationKcal ?? 0);
    const descriptionEstimate = surplusEstimateForDescription(event.fact.mealDescription);
    if (!Number.isFinite(dateMs) || dateMs > currentMs || currentMs - dateMs > LOOKBACK_DAYS * DAY_MS) continue;
    // 当天仍在进行，单餐/不完整日总热量不能被当作全天结算；只有用户明确说
    // 「已超过计划 X kcal」时才允许当天即时触发未来回调。
    if (dateMs === currentMs && !reportedSurplus && !descriptionEstimate) continue;
    if (!event.fact.energy && event.fact.proteinGrams === undefined && event.fact.carbohydrateGrams === undefined && event.fact.fatGrams === undefined && !reportedSurplus) {
      if (descriptionEstimate) descriptionEstimates.push({ date, range: descriptionEstimate });
      continue;
    }
    const entry = byDate.get(date) ?? { energy: 0, protein: 0, carbohydrate: 0, fat: 0, reportedSurplus: 0 };
    entry.energy += event.fact.energy?.unit === "kJ"
      ? event.fact.energy.value / 4.184
      : event.fact.energy?.value ?? 0;
    entry.protein += event.fact.proteinGrams ?? 0;
    entry.carbohydrate += event.fact.carbohydrateGrams ?? 0;
    entry.fat += event.fact.fatGrams ?? 0;
    // 同一日若既有总摄入又有用户明确的差额，明确差额优先，避免双重计算。
    entry.reportedSurplus += reportedSurplus;
    byDate.set(date, entry);
  }
  if (!byDate.size && !descriptionEstimates.length) {
    return {
      lookbackDays: LOOKBACK_DAYS, loggedDays: 0, estimatedDays: 0, unrecoveredSurplusKcal: 0, loggedThermicEffectKcal: 0, surplusSource: "none",
      status: "no_quantified_intake", actions: [], reasonCodes: ["rolling_energy_adjustment_not_inferred_without_quantified_intake"],
    };
  }
  // 在缺少历史日训练消耗时，宁可只比较目标摄入与实际摄入；不把未记录运动编进去。
  const targetIntake = estimatedSedentaryTargetIntake(input.profile, targetDeficit);
  const loggedThermicEffectKcal = [...byDate.values()].reduce(
    (sum, day) => sum + estimateThermicEffect({ energyKcal: day.energy, proteinGrams: day.protein, carbohydrateGrams: day.carbohydrate, fatGrams: day.fat }).kcal,
    0,
  );
  const loggedSurplusKcal = [...byDate.values()].reduce(
    (sum, day) => sum + (day.reportedSurplus > 0 ? day.reportedSurplus : Math.max(0, Math.round(day.energy - targetIntake))),
    0,
  );
  const estimatedRange = descriptionEstimates.length
    ? descriptionEstimates.reduce((total, item) => ({ min: total.min + item.range.min, max: total.max + item.range.max }), { min: 0, max: 0 })
    : undefined;
  const estimatedSurplusKcal = estimatedRange ? Math.round((estimatedRange.min + estimatedRange.max) / 2) : 0;
  const unrecoveredSurplusKcal = loggedSurplusKcal + estimatedSurplusKcal;
  const surplusSource = byDate.size && descriptionEstimates.length
    ? "mixed" as const
    : byDate.size
      ? "logged_intake" as const
      : descriptionEstimates.length
        ? "description_estimate" as const
        : "none" as const;
  if (unrecoveredSurplusKcal < 80) {
    return {
      lookbackDays: LOOKBACK_DAYS, loggedDays: byDate.size, estimatedDays: descriptionEstimates.length, unrecoveredSurplusKcal, loggedThermicEffectKcal, surplusSource,
      ...(estimatedRange ? { estimatedSurplusRangeKcal: estimatedRange } : {}),
      status: "on_track", actions: [], reasonCodes: ["rolling_energy_balance_within_normal_variation"],
    };
  }
  const horizonDays = Math.min(7, Math.max(3, Math.ceil(unrecoveredSurplusKcal / MAX_DAILY_EXTRA_DEFICIT_KCAL)));
  const dailyCap = Math.min(MAX_DAILY_EXTRA_DEFICIT_KCAL, Math.round(targetDeficit * 0.35));
  const dates = [...new Set(input.futureDates)].slice(0, horizonDays);
  const scheduledHorizonDays = dates.length;
  const perDay = Math.min(dailyCap, Math.ceil(unrecoveredSurplusKcal / Math.max(1, scheduledHorizonDays)));
  const cardioMinutesFor = (date: string) => Math.min(
    15,
    Math.max(0, input.futureCardioCapacityMinutes
      ? input.futureCardioCapacityMinutes[date] ?? 0
      : 15),
    Math.floor(perDay / Math.max(1, activityNetKcal({ kind: "walk_brisk", minutes: 1, weightKg }))),
  );
  const actions = dates.map((date) => {
    const cardioMinutes = cardioMinutesFor(date);
    const cardioKcal = activityNetKcal({ kind: "walk_brisk", minutes: cardioMinutes, weightKg });
    const remainingKcal = Math.max(0, perDay - cardioKcal);
    const extraSteps = Math.min(2_000, Math.ceil(remainingKcal / (weightKg * STEP_KCAL_PER_KG) / 100) * 100);
    const stepKcal = Math.round(extraSteps * weightKg * STEP_KCAL_PER_KG);
    return {
      date,
      extraSteps,
      extraLowImpactCardioMinutes: cardioMinutes,
      estimatedExtraExpenditureKcal: cardioKcal + stepKcal,
      gate: "only_if_recovery_normal" as const,
    };
  });
  const plannedAdditionalExpenditureKcal = actions.reduce((sum, action) => sum + action.estimatedExtraExpenditureKcal, 0);
  return {
    lookbackDays: LOOKBACK_DAYS, loggedDays: byDate.size, estimatedDays: descriptionEstimates.length, unrecoveredSurplusKcal, loggedThermicEffectKcal, surplusSource,
    ...(estimatedRange ? { estimatedSurplusRangeKcal: estimatedRange } : {}),
    status: "gentle_rebalance", horizonDays: scheduledHorizonDays, dailyAdditionalDeficitCapKcal: dailyCap,
    plannedAdditionalExpenditureKcal,
    remainingSurplusKcal: Math.max(0, unrecoveredSurplusKcal - plannedAdditionalExpenditureKcal),
    actions,
    reasonCodes: [
      surplusSource === "description_estimate"
        ? "rolling_energy_rebalance_from_description_estimate_requires_confirmation"
        : "rolling_energy_rebalance_after_logged_intake_surplus",
      "no_punitive_training_or_unbounded_deficit",
      "extra_activity_requires_normal_recovery_check_in",
    ],
  };
}

function estimatedSedentaryTargetIntake(profile: UserProfileData, targetDeficit: number): number {
  const weight = profile.demographics?.currentWeight?.value ?? 0;
  const height = profile.demographics?.height?.value ?? 0;
  const age = profile.demographics?.ageYears ?? 0;
  const sexTerm = profile.demographics?.sex === "female" ? -161 : 5;
  const bmr = 10 * weight + 6.25 * height - 5 * age + sexTerm;
  const baseWithoutTef = bmr * 1.1;
  // TEF 对计划摄入按 10% 回退，解方程而不是把 TEF 和 BMR 重复相加。
  return Math.round((baseWithoutTef - targetDeficit) / 0.9);
}

function localDate(iso: string, offsetMinutes: number): string {
  return new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}
