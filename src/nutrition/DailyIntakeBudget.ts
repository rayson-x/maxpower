import type { NutritionDayLedger, NutritionDayPlan } from "./NutritionDayLedger";

export type DailyIntakeStatus =
  | "unknown"
  | "far_below"
  | "below"
  | "on_track"
  | "slightly_over"
  | "high";

export interface DailyIntakeActivity {
  durationMinutes?: number;
  intensity?: "easy" | "moderate" | "hard" | "unknown";
  /** A value the person reported or explicitly accepted after an estimate. */
  energyExpenditureKcal?: number;
}

export interface DailyIntakeBudget {
  date: string;
  dayKind: NutritionDayPlan["dayKind"];
  baseTargetKcal?: number;
  dayTypeAdjustmentKcal: number;
  activityAdjustmentKcal: number;
  /** Energy directly recorded on activity facts, separate from fallback minute rules. */
  recordedActivityExpenditureKcal: number;
  /** Conservative allowance only for activities without a calorie value. */
  estimatedActivityExpenditureKcal: number;
  recommendedKcal?: number;
  recommendedRange?: { min: number; max: number };
  consumedKcal?: number;
  remainingKcal?: number;
  progressRatio?: number;
  variancePercent?: number;
  status: DailyIntakeStatus;
  trainingCompleted: boolean;
  activityMinutes: number;
  reasonCodes: readonly string[];
  missing: readonly string[];
}

/**
 * Builds a conservative daily fuel budget from the active nutrition strategy,
 * the materialized training week and confirmed Timeline observations.
 *
 * The day-type distribution keeps the weekly average approximately stable.
 * Activities without an explicitly confirmed calorie value receive only a
 * small, capped fallback allowance. A user-confirmed expenditure is retained
 * separately and can fully inform that day's available intake.
 */
export function deriveDailyIntakeBudget(input: {
  plan: NutritionDayPlan;
  ledger: NutritionDayLedger;
  weeklyTrainingDays: number;
  weeklyPlannedDays?: number;
  trainingCompleted?: boolean;
  activities?: readonly DailyIntakeActivity[];
}): DailyIntakeBudget {
  const baseTargetKcal = input.plan.targets.energy.value;
  const activities = input.activities ?? [];
  const activityMinutes = Math.round(activities.reduce(
    (total, activity) => total + Math.max(0, activity.durationMinutes ?? 0),
    0,
  ));
  const recordedActivityExpenditureKcal = Math.round(activities.reduce(
    (total, activity) => total + Math.max(0, activity.energyExpenditureKcal ?? 0),
    0,
  ));
  const baseResult = {
    date: input.plan.date,
    dayKind: input.plan.dayKind,
    dayTypeAdjustmentKcal: 0,
    activityAdjustmentKcal: 0,
    recordedActivityExpenditureKcal,
    estimatedActivityExpenditureKcal: 0,
    status: "unknown" as const,
    trainingCompleted: Boolean(input.trainingCompleted),
    activityMinutes,
    reasonCodes: [] as string[],
    missing: [] as string[],
  };

  if (baseTargetKcal === undefined || !Number.isFinite(baseTargetKcal) || baseTargetKcal <= 0) {
    return {
      ...baseResult,
      missing: ["daily_energy_target_unknown"],
    };
  }

  const plannedDays = Math.max(1, Math.round(input.weeklyPlannedDays ?? 7));
  const trainingDays = clamp(Math.round(input.weeklyTrainingDays), 0, plannedDays);
  const restDays = Math.max(1, plannedDays - trainingDays);
  const explicitDayTarget = input.plan.targets.energy.basis === "day_type";
  const trainingAdjustment = roundToTen(baseTargetKcal * 0.08);
  const restAdjustment = -roundToTen((trainingAdjustment * trainingDays) / restDays);
  const dayTypeAdjustmentKcal = explicitDayTarget
    ? 0
    : input.plan.dayKind === "training"
      ? trainingAdjustment
      : input.plan.dayKind === "deload"
        ? roundToTen(trainingAdjustment / 2)
        : input.plan.dayKind === "rest"
          ? restAdjustment
          : 0;
  const rawEstimatedActivityExpenditure = activities.reduce((total, activity) => {
    if (activity.energyExpenditureKcal !== undefined) return total;
    const minutes = Math.max(0, activity.durationMinutes ?? 0);
    const factor = activity.intensity === "hard"
      ? 3
      : activity.intensity === "moderate"
        ? 2
        : 1;
    return total + minutes * factor;
  }, 0);
  const estimatedActivityExpenditureKcal = Math.min(200, roundToTen(rawEstimatedActivityExpenditure));
  const activityAdjustmentKcal = roundToTen(recordedActivityExpenditureKcal + estimatedActivityExpenditureKcal);
  const recommendedKcal = Math.max(
    0,
    Math.round(baseTargetKcal + dayTypeAdjustmentKcal + activityAdjustmentKcal),
  );
  const recommendedRange = {
    min: Math.round(recommendedKcal * 0.9),
    max: Math.round(recommendedKcal * 1.1),
  };
  const intakeKnown = input.ledger.nutrients.energy.intakeKnown;
  const consumedKcal = intakeKnown
    ? Math.round(input.ledger.nutrients.energy.consumedLogged)
    : undefined;
  const progressRatio = consumedKcal === undefined || recommendedKcal <= 0
    ? undefined
    : consumedKcal / recommendedKcal;
  const variancePercent = progressRatio === undefined
    ? undefined
    : Math.round((progressRatio - 1) * 1_000) / 10;

  return {
    ...baseResult,
    baseTargetKcal: Math.round(baseTargetKcal),
    dayTypeAdjustmentKcal,
    activityAdjustmentKcal,
    estimatedActivityExpenditureKcal,
    recommendedKcal,
    recommendedRange,
    ...(consumedKcal === undefined ? {} : {
      consumedKcal,
      remainingKcal: recommendedKcal - consumedKcal,
      progressRatio,
      variancePercent,
    }),
    status: intakeStatus(progressRatio),
    reasonCodes: [
      ...(explicitDayTarget ? ["explicit_day_target_preserved"] : []),
      ...(dayTypeAdjustmentKcal > 0 ? ["training_day_fuel_distribution"] : []),
      ...(dayTypeAdjustmentKcal < 0 ? ["rest_day_weekly_distribution"] : []),
      ...(input.trainingCompleted ? ["training_completion_confirmed"] : []),
      ...(recordedActivityExpenditureKcal > 0 ? ["confirmed_activity_expenditure_added"] : []),
      ...(estimatedActivityExpenditureKcal > 0 ? ["estimated_activity_adds_capped_fuel"] : []),
      "weekly_average_preserved_by_day_type_distribution",
    ],
    missing: [
      ...(input.ledger.coverage === "no_log" ? ["no_confirmed_meal"] : []),
      ...(input.ledger.coverage === "partial" ? ["unquantified_meal"] : []),
      ...activities
        .filter((activity) => activity.durationMinutes === undefined)
        .map(() => "activity_duration_unknown"),
    ],
  };
}

function intakeStatus(progressRatio: number | undefined): DailyIntakeStatus {
  if (progressRatio === undefined) return "unknown";
  if (progressRatio < 0.6) return "far_below";
  if (progressRatio < 0.9) return "below";
  if (progressRatio <= 1.1) return "on_track";
  if (progressRatio <= 1.2) return "slightly_over";
  return "high";
}

function roundToTen(value: number): number {
  return Math.round(value / 10) * 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
