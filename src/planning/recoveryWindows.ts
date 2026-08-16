import type { SetOutcomeData } from "../coach/domain";
import type { ExerciseVariant } from "../knowledge/model";
import { fatigueContributionsForExercise, MUSCLE_FATIGUE_POLICY } from "./muscleFatigue";

/**
 * 恢复窗政策（v1）：文献调研分档（剂量 × 熟悉度 × 动作类型），废除按肌群
 * 大小二分。所有时长是组均值，不是个体阈值；每条带证据标注。
 * 依据：docs/research/muscle-recovery-windows-2026-08-16.md。
 */
export const RECOVERY_WINDOW_POLICY = {
  id: "maxpower.recovery-windows",
  version: "1.0.0",
  tiers: {
    low_dose: { hours: [24, 48], evidence: "inference" as const, when: "低剂量或孤立动作为主" },
    moderate_familiar: { hours: [48, 72], evidence: "literature_group_mean" as const, when: "中等剂量、熟悉的多关节动作（组均值）" },
    high_dose: { hours: [72, 96], evidence: "inference" as const, when: "高剂量或力竭为主" },
    novice_or_new: { hours: [72, 96], evidence: "product_assumption" as const, when: "新手、新动作或停训恢复初期" },
  },
  /** 残差叠加提示阈值（RU）：产品假设初值，随校准演化，钉在政策版本里。 */
  elevatedResidualThreshold: 60,
} as const;

export type RecoveryWindowTierId = keyof typeof RECOVERY_WINDOW_POLICY.tiers;

export interface RecoveryMuscleContext {
  readonly muscleId: string;
  /** 本周（评估日所在周）直接组。 */
  readonly directSetsThisWeek: number;
  /** 0.62/天残差衰减后的当前残差负荷（RU）。 */
  readonly residualLoad: number;
  readonly windowTier: RecoveryWindowTierId;
  readonly windowHours: readonly [number, number];
  readonly evidence: "literature_group_mean" | "inference" | "product_assumption";
  /** 该肌群最近一次直接训练日期（用于间隔提示）。 */
  readonly lastTrainedDate?: string;
  /** 昨日残差超过阈值且今日仍被排为主目标/协同时的叠加提示。 */
  readonly overlapHint?: "elevated";
}

export interface RecoveryContext {
  readonly status: "ok" | "insufficient_history";
  readonly policy: { readonly id: string; readonly version: string };
  readonly evaluatedAt: string;
  readonly muscles: readonly RecoveryMuscleContext[];
  readonly disclaimer: "group_mean_with_individual_signal_adjustment";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

function mondayOf(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - weekday + 1);
  return value.toISOString().slice(0, 10);
}

/**
 * 由确认完成组 + 疲劳政策确定性计算恢复上下文。只读；无训练历史时返回显式
 * insufficient_history，不静默省略。
 */
export function assessRecoveryContext(input: {
  readonly evaluationDate: string;
  readonly completedSets: readonly { readonly completedAt: string; readonly outcomes: readonly SetOutcomeData[] }[];
  readonly exerciseById: (id: string) => ExerciseVariant | undefined;
}): RecoveryContext {
  const perMuscleWeekSets = new Map<string, number>();
  const perMuscleResidual = new Map<string, number>();
  const perMuscleLastDose = new Map<string, { date: string; directSets: number; compound: boolean }>();
  const perMuscleExposures = new Map<string, number>();
  const weekStart = mondayOf(input.evaluationDate);
  let confirmedSets = 0;

  const days = [...input.completedSets]
    .map((day) => ({ ...day, date: day.completedAt.slice(0, 10) }))
    .filter((day) => day.date <= input.evaluationDate)
    .sort((left, right) => left.date.localeCompare(right.date));

  for (const day of days) {
    const dayDose = new Map<string, { sets: number; compound: boolean }>();
    for (const outcome of day.outcomes) {
      if (outcome.source !== "user_confirmed" && outcome.source !== "imported") continue;
      const exercise = input.exerciseById(outcome.exerciseVariantId);
      if (!exercise) continue;
      if (exercise.dataEligibility.expectedMuscleMetadata !== "reviewed") continue;
      confirmedSets += 1;
      const elapsed = daysBetween(day.date, input.evaluationDate);
      const contributions = fatigueContributionsForExercise({ exercise, setCount: 1, rir: outcome.actualRir });
      for (const contribution of contributions) {
        perMuscleResidual.set(contribution.muscleId, round1((perMuscleResidual.get(contribution.muscleId) ?? 0) + contribution.relativeLoad * (MUSCLE_FATIGUE_POLICY.dailyResidualMultiplier ** elapsed)));
        perMuscleExposures.set(contribution.muscleId, (perMuscleExposures.get(contribution.muscleId) ?? 0) + 1);
        if (contribution.role === "primary_intent") {
          if (day.date >= weekStart) perMuscleWeekSets.set(contribution.muscleId, (perMuscleWeekSets.get(contribution.muscleId) ?? 0) + 1);
          const dose = dayDose.get(contribution.muscleId) ?? { sets: 0, compound: false };
          dose.sets += 1;
          dose.compound = dose.compound || exercise.mechanic !== "isolation";
          dayDose.set(contribution.muscleId, dose);
        }
      }
    }
    for (const [muscleId, dose] of dayDose) {
      perMuscleLastDose.set(muscleId, { date: day.date, directSets: dose.sets, compound: dose.compound });
    }
  }

  if (confirmedSets === 0) {
    return {
      status: "insufficient_history",
      policy: { id: RECOVERY_WINDOW_POLICY.id, version: RECOVERY_WINDOW_POLICY.version },
      evaluatedAt: input.evaluationDate,
      muscles: [],
      disclaimer: "group_mean_with_individual_signal_adjustment",
    };
  }

  const muscles: RecoveryMuscleContext[] = [...perMuscleResidual.entries()]
    .map(([muscleId, residualLoad]) => {
      const lastDose = perMuscleLastDose.get(muscleId);
      const exposures = perMuscleExposures.get(muscleId) ?? 0;
      const tier: RecoveryWindowTierId = exposures < 4
        ? "novice_or_new"
        : lastDose && lastDose.directSets >= 5
          ? "high_dose"
          : lastDose && (!lastDose.compound || lastDose.directSets <= 2)
            ? "low_dose"
            : "moderate_familiar";
      const spec = RECOVERY_WINDOW_POLICY.tiers[tier];
      return {
        muscleId,
        directSetsThisWeek: perMuscleWeekSets.get(muscleId) ?? 0,
        residualLoad: round1(residualLoad),
        windowTier: tier,
        windowHours: spec.hours,
        evidence: spec.evidence,
        ...(lastDose ? { lastTrainedDate: lastDose.date } : {}),
        ...(residualLoad >= RECOVERY_WINDOW_POLICY.elevatedResidualThreshold ? { overlapHint: "elevated" as const } : {}),
      };
    })
    .sort((left, right) => right.residualLoad - left.residualLoad);

  return {
    status: "ok",
    policy: { id: RECOVERY_WINDOW_POLICY.id, version: RECOVERY_WINDOW_POLICY.version },
    evaluatedAt: input.evaluationDate,
    muscles,
    disclaimer: "group_mean_with_individual_signal_adjustment",
  };
}
