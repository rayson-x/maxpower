import type { GoalPathAssessment } from "../goal-path";
import type { PlanExecutionEvidence } from "../goal-path/PlanEvidence";

/** One explicit, inspectable link between a proposed Plan and what actually happened. */
export interface PlanOutcome {
  id: string;
  userId: string;
  planId: string;
  planRevision: number;
  candidateId?: string;
  candidateDecision: "accepted" | "rejected" | "not_recorded";
  observedFrom: string;
  observedThrough: string;
  durationDays: number;
  execution: PlanExecutionEvidence["confirmedExecution"] & { coverageRatio?: number };
  burden: "acceptable" | "high" | "unknown";
  bodyResponse: "expected" | "insufficient" | "adverse" | "unknown";
  feedback?: string;
  preferenceSignals: readonly {
    behaviorId: string;
    result: "repeated_and_acceptable" | "avoided" | "conflicted_with_stated_preference";
    source: "confirmed_behavior_and_feedback";
  }[];
  sourceAssessment?: GoalPathAssessment;
  createdAt: string;
}

export interface PlanningOutcomeContext {
  outcomes: readonly PlanOutcome[];
  preferredBehaviorIds: readonly string[];
  avoidedBehaviorIds: readonly string[];
  profileConflictBehaviorIds: readonly string[];
}

export function buildPlanningOutcomeContext(outcomes: readonly PlanOutcome[]): PlanningOutcomeContext {
  const recent = [...outcomes].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const signals = recent.flatMap((outcome) => outcome.preferenceSignals);
  return {
    outcomes: recent,
    preferredBehaviorIds: unique(signals.filter((signal) => signal.result === "repeated_and_acceptable").map((signal) => signal.behaviorId)),
    avoidedBehaviorIds: unique(signals.filter((signal) => signal.result === "avoided").map((signal) => signal.behaviorId)),
    profileConflictBehaviorIds: unique(signals.filter((signal) => signal.result === "conflicted_with_stated_preference").map((signal) => signal.behaviorId)),
  };
}

function unique(values: readonly string[]): readonly string[] { return [...new Set(values)]; }
