import type { DomainProjection, PlanRevisionData, WorkoutProjection } from "../coach/domain";
import { stableHash } from "../coach/stable";
import type { DailyHealthLedger } from "../health";

export interface PlannedPerformedEvidence {
  sessionId: string;
  scheduledFor: string;
  plannedTaskCount: number;
  outcome: "completed" | "partial" | "explicitly_missed" | "unknown";
  workoutId?: string;
  performedSetCount: number;
  skippedSetCount: number;
  replacementCount: number;
}

export interface PlanExecutionEvidence {
  version: string;
  planId: string;
  planRevision: number;
  timelineRevision: number;
  sessions: readonly PlannedPerformedEvidence[];
  freestyleWorkoutIds: readonly string[];
  coverage: { observedPlannedSessions: number; expectedPlannedSessions: number; ratio?: number; numericNutritionDays: number };
  confirmedExecution: { completed: number; partial: number; missed: number; failureDenominator: number };
  observationContract?: PlanRevisionData["observationContract"];
}

/** Keeps planned dose and performed facts separate; unknown never enters the failure denominator. */
export function projectPlanExecutionEvidence(input: { domain: DomainProjection; plan: { revision: number; value: PlanRevisionData }; ledgers: readonly DailyHealthLedger[] }): PlanExecutionEvidence {
  const sessions = input.plan.value.sessions.map((session): PlannedPerformedEvidence => {
    const workout = input.domain.workouts
      .filter((candidate) => candidate.source.kind === "planned" && candidate.source.plannedSessionRef.planId === input.plan.value.id && candidate.source.plannedSessionRef.planRevision === input.plan.revision && candidate.source.plannedSessionRef.sessionPrescriptionId === session.id)
      .sort((left, right) => right.revision - left.revision)[0];
    const explicitlyMissed = input.domain.timeline.current.some((event) => {
      if (event.fact.kind !== "training" || event.fact.confidence !== "confirmed" || event.fact.reportedSession?.executionStatus !== "missed") return false;
      const ref = event.fact.reportedSession.plannedSessionRef;
      return ref?.planId === input.plan.value.id && ref.planRevision === input.plan.revision && ref.sessionPrescriptionId === session.id;
    });
    return {
      sessionId: session.id,
      scheduledFor: session.scheduledFor,
      plannedTaskCount: session.tasks.length,
      outcome: workout ? workoutOutcome(workout) : explicitlyMissed ? "explicitly_missed" : "unknown",
      ...(workout ? { workoutId: workout.id } : {}),
      performedSetCount: workout?.setOutcomes.length ?? 0,
      skippedSetCount: workout?.skippedSets?.length ?? 0,
      replacementCount: workout ? replacementCount(workout) : 0,
    };
  });
  const completed = sessions.filter((session) => session.outcome === "completed").length;
  const partial = sessions.filter((session) => session.outcome === "partial").length;
  const missed = sessions.filter((session) => session.outcome === "explicitly_missed").length;
  const observed = completed + partial + missed;
  const result = {
    planId: input.plan.value.id,
    planRevision: input.plan.revision,
    timelineRevision: input.domain.timeline.revision,
    sessions,
    freestyleWorkoutIds: input.domain.workouts.filter((workout) => workout.source.kind === "freestyle").map((workout) => workout.id),
    coverage: { observedPlannedSessions: observed, expectedPlannedSessions: sessions.length, ...(sessions.length ? { ratio: observed / sessions.length } : {}), numericNutritionDays: input.ledgers.filter((ledger) => ledger.nutrition.nutrients.energy.intakeKnown).length },
    confirmedExecution: { completed, partial, missed, failureDenominator: observed },
    ...(input.plan.value.observationContract ? { observationContract: input.plan.value.observationContract } : {}),
  };
  return { ...result, version: stableHash(result) };
}

function workoutOutcome(workout: WorkoutProjection): PlannedPerformedEvidence["outcome"] {
  if (workout.status === "completed") return "completed";
  if (workout.status === "partial" || workout.status === "abandoned") return "partial";
  return "unknown";
}
function replacementCount(workout: WorkoutProjection): number {
  return workout.setOutcomes.filter((outcome) => outcome.completedAs === "user_edited").length;
}
