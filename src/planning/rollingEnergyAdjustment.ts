import type { TimelineProjectionEvent, UserProfileData } from "../coach/domain";
import { estimateThermicEffect } from "../nutrition/thermicEffect";
import { activityNetKcal } from "./dailyEnergyBudget";

export interface RollingEnergyAdjustment {
  lookbackDays: number;
  loggedDays: number;
  /** 相对计划缺口仍未回收的能量；只来自确认数值或用户明确报告的差额。 */
  unrecoveredSurplusKcal: number;
  loggedThermicEffectKcal: number;
  /** 差额来自哪里；供客户端说明可核实程度。 */
  surplusSource: "logged_intake" | "user_reported_deviation" | "mixed" | "none";
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
      lookbackDays: LOOKBACK_DAYS, loggedDays: 0, unrecoveredSurplusKcal: 0, loggedThermicEffectKcal: 0, surplusSource: "none",
      status: "no_quantified_intake", actions: [], reasonCodes: ["rolling_energy_adjustment_requires_weight_and_target_deficit"],
    };
  }
  const currentMs = Date.parse(`${input.currentDate}T12:00:00.000Z`);
  const byDate = new Map<string, { energy: number; protein: number; carbohydrate: number; fat: number; reportedSurplus: number }>();
  let hasLoggedIntake = false;
  let hasReportedDeviation = false;
  for (const event of input.timeline) {
    if ((event.lifecycle === "superseded" || event.lifecycle === "tombstoned") || event.fact.kind !== "nutrition" || event.fact.confidence !== "confirmed") continue;
    const date = localDate(event.occurredAt, event.timezoneOffsetMinutes);
    const dateMs = Date.parse(`${date}T12:00:00.000Z`);
    const reportedSurplus = Math.max(0, event.fact.reportedEnergyDeviationKcal ?? 0);
    if (!Number.isFinite(dateMs) || dateMs > currentMs || currentMs - dateMs > LOOKBACK_DAYS * DAY_MS) continue;
    // 当天仍在进行，单餐/不完整日总热量不能被当作全天结算；只有用户明确说
    // 「已超过计划 X kcal」时才允许当天即时触发未来回调。
    if (dateMs === currentMs && !reportedSurplus) continue;
    const energy = nutrientAmount(event.fact.nutrients, "energy");
    const protein = nutrientAmount(event.fact.nutrients, "protein");
    const carbohydrate = nutrientAmount(event.fact.nutrients, "carbohydrate");
    const fat = nutrientAmount(event.fact.nutrients, "fat");
    if (energy === undefined && protein === undefined && carbohydrate === undefined && fat === undefined && !reportedSurplus) continue;
    const entry = byDate.get(date) ?? { energy: 0, protein: 0, carbohydrate: 0, fat: 0, reportedSurplus: 0 };
    entry.energy += energy ?? 0;
    entry.protein += protein ?? 0;
    entry.carbohydrate += carbohydrate ?? 0;
    entry.fat += fat ?? 0;
    hasLoggedIntake ||= energy !== undefined;
    hasReportedDeviation ||= reportedSurplus > 0;
    // 同一日若既有总摄入又有用户明确的差额，明确差额优先，避免双重计算。
    entry.reportedSurplus += reportedSurplus;
    byDate.set(date, entry);
  }
  if (!byDate.size) {
    return {
      lookbackDays: LOOKBACK_DAYS, loggedDays: 0, unrecoveredSurplusKcal: 0, loggedThermicEffectKcal: 0, surplusSource: "none",
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
  const unrecoveredSurplusKcal = loggedSurplusKcal;
  const surplusSource = hasLoggedIntake && hasReportedDeviation
    ? "mixed" as const
    : hasLoggedIntake
      ? "logged_intake" as const
      : hasReportedDeviation
        ? "user_reported_deviation" as const
        : "none" as const;
  if (unrecoveredSurplusKcal < 80) {
    return {
      lookbackDays: LOOKBACK_DAYS, loggedDays: byDate.size, unrecoveredSurplusKcal, loggedThermicEffectKcal, surplusSource,
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
    lookbackDays: LOOKBACK_DAYS, loggedDays: byDate.size, unrecoveredSurplusKcal, loggedThermicEffectKcal, surplusSource,
    status: "gentle_rebalance", horizonDays: scheduledHorizonDays, dailyAdditionalDeficitCapKcal: dailyCap,
    plannedAdditionalExpenditureKcal,
    remainingSurplusKcal: Math.max(0, unrecoveredSurplusKcal - plannedAdditionalExpenditureKcal),
    actions,
    reasonCodes: [
      surplusSource === "user_reported_deviation"
        ? "rolling_energy_rebalance_from_user_reported_deviation"
        : "rolling_energy_rebalance_after_logged_intake_surplus",
      "no_punitive_training_or_unbounded_deficit",
      "extra_activity_requires_normal_recovery_check_in",
    ],
  };
}

function nutrientAmount(
  values: readonly import("../nutrition").NutrientValueData[] | undefined,
  nutrientId: "energy" | "protein" | "carbohydrate" | "fat",
): number | undefined {
  const value = values?.find((candidate) => candidate.nutrientId === nutrientId);
  if (!value) return undefined;
  if (nutrientId === "energy") return value.unit === "kJ" ? value.amount / 4.184 : value.unit === "kcal" ? value.amount : undefined;
  if (value.unit === "g") return value.amount;
  if (value.unit === "mg") return value.amount / 1000;
  if (value.unit === "mcg") return value.amount / 1_000_000;
  return undefined;
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
