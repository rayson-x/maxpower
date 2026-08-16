import type { DomainProjection, GoalContractData, MassQuantity } from "../coach/domain";

export type StrengthLift = "squat" | "benchPress" | "deadlift";

export interface StrengthObservation {
  occurredAt: string;
  estimatedOneRepMaxKg: number;
}

export interface StrengthTargetProgress {
  lift: StrengthLift | "combinedTotal";
  targetKg: number;
  observations: readonly StrengthObservation[];
  latestKg?: number;
  reached: boolean;
}

/** Fixed, comparable e1RM evidence for the explicit strength targets. */
export function strengthTargetProgress(
  domain: DomainProjection,
  targets: NonNullable<GoalContractData["targets"]>["strength"],
  startDate?: string,
): readonly StrengthTargetProgress[] {
  if (!targets) return [];
  const byLift = new Map<StrengthLift, Map<string, number>>([
    ["squat", new Map()],
    ["benchPress", new Map()],
    ["deadlift", new Map()],
  ]);
  for (const workout of domain.workouts) {
    for (const outcome of workout.setOutcomes) {
      if (!outcome.actualLoad || outcome.actualReps === undefined) continue;
      const occurredAt = outcome.recordedAt ?? workout.outcome?.completedAt;
      if (!occurredAt || (startDate && occurredAt.slice(0, 10) < startDate)) continue;
      const lift = strengthLiftForVariant(outcome.exerciseVariantId);
      if (!lift) continue;
      const kg = toKg(outcome.actualLoad);
      const e1rm = kg * (1 + outcome.actualReps / 30);
      const date = occurredAt.slice(0, 10);
      const values = byLift.get(lift)!;
      values.set(date, Math.max(values.get(date) ?? 0, e1rm));
    }
  }
  const series = (lift: StrengthLift): readonly StrengthObservation[] => [...byLift.get(lift)!.entries()]
    .map(([date, estimatedOneRepMaxKg]) => ({ occurredAt: `${date}T00:00:00.000Z`, estimatedOneRepMaxKg }))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const progress: StrengthTargetProgress[] = [];
  for (const lift of ["squat", "benchPress", "deadlift"] as const) {
    const target = targets[lift];
    if (!target) continue;
    const observations = series(lift);
    const latestKg = observations.at(-1)?.estimatedOneRepMaxKg;
    const targetKg = toKg(target);
    progress.push({ lift, targetKg, observations, ...(latestKg === undefined ? {} : { latestKg }), reached: latestKg !== undefined && latestKg + 0.5 >= targetKg });
  }
  if (targets.combinedTotal) {
    const individual = (["squat", "benchPress", "deadlift"] as const).map((lift) => series(lift));
    const observations = individual.every((items) => items.length)
      ? [
          {
            occurredAt: individual.map((items) => items[0]!.occurredAt).sort().at(-1)!,
            estimatedOneRepMaxKg: individual.reduce((total, items) => total + items[0]!.estimatedOneRepMaxKg, 0),
          },
          {
            occurredAt: individual.map((items) => items.at(-1)!.occurredAt).sort().at(-1)!,
            estimatedOneRepMaxKg: individual.reduce((total, items) => total + items.at(-1)!.estimatedOneRepMaxKg, 0),
          },
        ]
      : [];
    const latestKg = observations.at(-1)?.estimatedOneRepMaxKg;
    const targetKg = toKg(targets.combinedTotal);
    progress.push({ lift: "combinedTotal", targetKg, observations, ...(latestKg === undefined ? {} : { latestKg }), reached: latestKg !== undefined && latestKg + 1.5 >= targetKg });
  }
  return progress;
}

function strengthLiftForVariant(exerciseVariantId: string): StrengthLift | undefined {
  const id = exerciseVariantId.trim().toLowerCase();
  if (id.includes("deadlift")) return "deadlift";
  if (id.includes("bench") && id.includes("press")) return "benchPress";
  if (id.includes("squat")) return "squat";
  return undefined;
}

function toKg(quantity: MassQuantity): number {
  return quantity.unit === "kg" ? quantity.value : quantity.value * 0.45359237;
}
