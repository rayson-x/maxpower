import type { PlannedSessionData } from "../coach/domain";
import type { ExerciseVariant } from "../knowledge/model";
import type { HistoricalPerformance } from "./model";

/**
 * 肌群恢复负荷策略（v1）。
 *
 * 这不是 EMG、损伤风险或“恢复完成度”的测量；分数是可审计、可替换的相对负荷单位，
 * 用来让 Planner 看见复合动作对主目标以外肌群的占用。训练量账本仍只计算 direct sets。
 *
 * 标度：同一动作 3 个中等努力工作组，主目标约 100 RU；次级肌群约 45 RU；稳定肌约 20 RU。
 * 后续用实际 RIR、完成组数和主观恢复来校准或覆盖它，不能只凭 RU 自动断言“未恢复”。
 */
export const MUSCLE_FATIGUE_POLICY = {
  id: "maxpower.relative-muscle-fatigue",
  version: "1.0.0",
  evidenceTier: "D_product_policy" as const,
  rolePointsPerThreeSets: {
    primary_intent: 100,
    secondary_intent: 45,
    stabilizer: 20,
  },
  fatigueIntentMultiplier: { high: 1.25, medium: 1, low: 0.75 },
  /** 髋铰链对次级背部疲劳更敏感；其余动作按目录关联角色计。 */
  movementRoleMultiplier: {
    hip_hinge: { primary_intent: 1.15, secondary_intent: 1.35, stabilizer: 1.1 },
    horizontal_push: { primary_intent: 1, secondary_intent: 1, stabilizer: 1 },
    vertical_push: { primary_intent: 1, secondary_intent: 1, stabilizer: 1 },
    horizontal_pull: { primary_intent: 1, secondary_intent: 1, stabilizer: 1 },
    vertical_pull: { primary_intent: 1, secondary_intent: 1, stabilizer: 1 },
  },
  /** 每经过一个完整自然日，未被新的完成数据证伪的预测负荷保留比例。 */
  dailyResidualMultiplier: 0.62,
} as const;

type AssociationRole = keyof typeof MUSCLE_FATIGUE_POLICY.rolePointsPerThreeSets;

export interface MuscleFatigueContribution {
  muscleId: string;
  role: AssociationRole;
  relativeLoad: number;
  exerciseVariantId: string;
}

export interface MuscleFatigueDayForecast {
  date: string;
  residualBefore: Readonly<Record<string, number>>;
  addedByMuscle: Readonly<Record<string, number>>;
  residualAfter: Readonly<Record<string, number>>;
  contributions: readonly MuscleFatigueContribution[];
}

export interface MuscleFatigueForecast {
  policy: { id: string; version: string; evidenceTier: "D_product_policy"; unit: "relative_load" };
  days: readonly MuscleFatigueDayForecast[];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function effortMultiplier(rir: number | undefined): number {
  if (rir === undefined) return 0.85;
  if (rir <= 1) return 1.1;
  if (rir <= 3) return 1;
  if (rir <= 5) return 0.75;
  return 0.6;
}

function multiplierFor(
  movementPattern: string | undefined,
  role: AssociationRole,
): number {
  const profile = movementPattern
    ? MUSCLE_FATIGUE_POLICY.movementRoleMultiplier[movementPattern as keyof typeof MUSCLE_FATIGUE_POLICY.movementRoleMultiplier]
    : undefined;
  return profile?.[role] ?? 1;
}

/** 每个目录动作都由其 expectedMuscleAssociation 自动展开为可审计的恢复负荷表行。 */
export function fatigueContributionsForExercise(input: {
  exercise: ExerciseVariant;
  setCount: number;
  fatigueIntent?: "low" | "medium" | "high";
  rir?: number;
}): readonly MuscleFatigueContribution[] {
  const setFactor = Math.max(0, input.setCount) / 3;
  const fatigueMultiplier = input.fatigueIntent
    ? MUSCLE_FATIGUE_POLICY.fatigueIntentMultiplier[input.fatigueIntent]
    : 1;
  return input.exercise.expectedMuscleAssociation.associations.map((association) => {
    const role = association.role as AssociationRole;
    return {
      muscleId: association.muscleId,
      role,
      relativeLoad: round(
        MUSCLE_FATIGUE_POLICY.rolePointsPerThreeSets[role]
          * setFactor
          * fatigueMultiplier
          * multiplierFor(input.exercise.movementPattern, role)
          * effortMultiplier(input.rir),
      ),
      exerciseVariantId: input.exercise.id,
    };
  });
}

function add(target: Record<string, number>, contributions: readonly MuscleFatigueContribution[]): void {
  for (const contribution of contributions) {
    target[contribution.muscleId] = round((target[contribution.muscleId] ?? 0) + contribution.relativeLoad);
  }
}

function decay(previous: Readonly<Record<string, number>>, elapsedDays: number): Record<string, number> {
  const factor = MUSCLE_FATIGUE_POLICY.dailyResidualMultiplier ** Math.max(0, elapsedDays);
  return Object.fromEntries(
    Object.entries(previous)
      .map(([muscle, score]) => [muscle, round(score * factor)] as const)
      .filter(([, score]) => score >= 0.1),
  );
}

function dateOf(value: string): string {
  return value.slice(0, 10);
}

/**
 * 从真实同动作历史打底，再依次推进即将发生的计划课。
 * 历史每条代表一个已完成工作组；计划课按其计划组数与目标 RIR 估算。
 */
export function forecastMuscleFatigue(input: {
  sessions: readonly PlannedSessionData[];
  history: readonly HistoricalPerformance[];
  exerciseById: (id: string) => ExerciseVariant | undefined;
}): MuscleFatigueForecast {
  const seedByDate = new Map<string, MuscleFatigueContribution[]>();
  for (const item of input.history) {
    const exercise = input.exerciseById(item.exerciseVariantId);
    if (!exercise) continue;
    const entries = seedByDate.get(dateOf(item.occurredAt)) ?? [];
    entries.push(...fatigueContributionsForExercise({ exercise, setCount: 1, rir: item.rir }));
    seedByDate.set(dateOf(item.occurredAt), entries);
  }
  const plannedByDate = new Map<string, { contributions: MuscleFatigueContribution[]; sessions: PlannedSessionData[] }>();
  for (const session of input.sessions) {
    const entry = plannedByDate.get(session.scheduledFor) ?? { contributions: [], sessions: [] };
    entry.sessions.push(session);
    for (const task of session.tasks) {
      const exercise = input.exerciseById(task.exerciseVariantId);
      const slot = session.stimulusSlots?.find((candidate) => candidate.id === task.stimulusSlotId);
      if (!exercise || !slot) continue;
      const averageRir = task.sets[0]?.targetRirRange
        ? (task.sets[0].targetRirRange.min + task.sets[0].targetRirRange.max) / 2
        : task.sets[0]?.targetRir;
      entry.contributions.push(...fatigueContributionsForExercise({
        exercise,
        setCount: task.sets.length,
        fatigueIntent: slot.intent.fatigueIntent,
        rir: averageRir,
      }));
    }
    plannedByDate.set(session.scheduledFor, entry);
  }

  const dates = [...new Set([...seedByDate.keys(), ...plannedByDate.keys()])].sort();
  const days: MuscleFatigueDayForecast[] = [];
  let residual: Record<string, number> = {};
  let previousDate: string | undefined;
  for (const date of dates) {
    const elapsed = previousDate ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)) / 86_400_000) : 0;
    const before = decay(residual, elapsed);
    const additions = [...(seedByDate.get(date) ?? []), ...(plannedByDate.get(date)?.contributions ?? [])];
    const addedByMuscle: Record<string, number> = {};
    add(addedByMuscle, additions);
    residual = { ...before };
    add(residual, additions);
    if (plannedByDate.has(date)) {
      days.push({ date, residualBefore: before, addedByMuscle, residualAfter: residual, contributions: additions });
    }
    previousDate = date;
  }
  return {
    policy: { id: MUSCLE_FATIGUE_POLICY.id, version: MUSCLE_FATIGUE_POLICY.version, evidenceTier: "D_product_policy", unit: "relative_load" },
    days,
  };
}
