import type { PlanRevisionData, WorkoutProjection } from "../coach/domain";
import type { FactRef } from "../coach/model";

export interface WeeklyCoachReport {
  weekStart: string;
  weekEnd: string;
  plannedSetCount: number;
  performedSetCount: number;
  incompletePrescriptionSetIds: readonly string[];
  unplannedTimelineEvents: number;
  recoveryLevels: readonly string[];
  nutritionStatus?: string;
  dataCoverage: "low" | "partial" | "complete";
  confidence: "low" | "moderate";
  factRefs: readonly FactRef[];
}

/** Builds a read-only weekly execution report; it never proposes or commits a Plan. */
export function weeklyCoachReport(input: {
  weekStart: string;
  weekEnd: string;
  plan?: PlanRevisionData;
  workouts: readonly WorkoutProjection[];
  performedSetOutcomeIds?: readonly string[];
  timelineEventCount: number;
  recoveryLevels: readonly string[];
  nutritionStatus?: string;
  factRefs?: readonly FactRef[];
}): WeeklyCoachReport {
  const planned = input.plan?.sessions
    .filter((session) => session.scheduledFor >= input.weekStart && session.scheduledFor <= input.weekEnd)
    .flatMap((session) => session.tasks.flatMap((task) => task.sets)) ?? [];
  const allowedOutcomes = input.performedSetOutcomeIds && new Set(input.performedSetOutcomeIds);
  const performedOutcomes = input.workouts.flatMap((workout) => workout.setOutcomes)
    .filter((outcome) => !allowedOutcomes || allowedOutcomes.has(outcome.id));
  const completedIds = new Set(performedOutcomes.map((outcome) => outcome.prescriptionSetId));
  const incomplete = planned.filter((set) => !completedIds.has(set.id)).map((set) => set.id);
  const performed = performedOutcomes.length;
  const coverage = performed === 0 ? "low" : incomplete.length ? "partial" : "complete";
  return {
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    plannedSetCount: planned.length,
    performedSetCount: performed,
    incompletePrescriptionSetIds: incomplete,
    unplannedTimelineEvents: Math.max(0, input.timelineEventCount - performed),
    recoveryLevels: input.recoveryLevels,
    ...(input.nutritionStatus ? { nutritionStatus: input.nutritionStatus } : {}),
    dataCoverage: coverage,
    confidence: coverage === "complete" ? "moderate" : "low",
    factRefs: input.factRefs ?? [],
  };
}
