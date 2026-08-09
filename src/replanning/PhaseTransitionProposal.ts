import type { MetricEnvelope } from "./metrics";
import type { PlannerDecision } from "../planning";

export interface PhaseTransitionProposal {
  id: string;
  status: "eligible" | "blocked";
  currentPhaseId?: string;
  nextPhaseId?: string;
  decisionFamily: "energy" | "activity" | "resistance_volume" | "resistance_load" | "macro_distribution" | "schedule" | "phase_goal";
  reasons: readonly string[];
  metrics: readonly MetricEnvelope[];
  currentPlanRevision?: number;
  candidatePlanId?: string;
  requiresConfirmation: true;
  reviewAt: string;
  missing: readonly string[];
  candidate?: PlannerDecision;
}

/** Formal phase-review gate; it never treats a one-day anomaly as a switch. */
export function derivePhaseTransitionProposal(input: {
  id: string;
  metrics: readonly MetricEnvelope[];
  currentPhaseId?: string;
  currentPlanRevision?: number;
  candidate: PlannerDecision;
  trigger: "goal_reached" | "plateau" | "recovery_decline" | "deadline_infeasible" | "user_requested";
  reviewAt: string;
}): PhaseTransitionProposal {
  const body = input.metrics.find((metric) => metric.name === "body_trend");
  const training = input.metrics.find((metric) => metric.name === "training_trend");
  const recovery = input.metrics.find((metric) => metric.name === "recovery_trend");
  const phase = input.metrics.find((metric) => metric.name === "phase_progress");
  const missing = input.metrics.flatMap((metric) => metric.missing);
  const eligible = input.trigger === "user_requested" || Boolean(
    (phase?.value.score !== undefined && phase.value.score >= 1) ||
    (body?.value.direction === "declining" && training?.value.direction === "declining") ||
    (recovery?.value.direction === "declining" && recovery.comparableDays >= 3),
  );
  const candidatePlan = input.candidate.kind === "plan_proposal" ? input.candidate : undefined;
  const reasons = [
    `trigger:${input.trigger}`,
    ...(phase?.value.score !== undefined && phase.value.score >= 1 ? ["phase_window_complete"] : []),
    ...(body?.value.direction === "declining" ? ["body_trend_declining"] : []),
    ...(training?.value.direction === "declining" ? ["training_trend_declining"] : []),
    ...(recovery?.value.direction === "declining" ? ["recovery_trend_declining"] : []),
    ...(eligible ? [] : ["minimum_comparable_window_not_met"]),
  ];
  return {
    id: input.id,
    status: eligible && candidatePlan ? "eligible" : "blocked",
    ...(input.currentPhaseId ? { currentPhaseId: input.currentPhaseId } : {}),
    ...(candidatePlan?.appliedPhaseStrategy?.id ? { nextPhaseId: candidatePlan.appliedPhaseStrategy.id } : {}),
    decisionFamily: "phase_goal",
    reasons,
    metrics: input.metrics,
    ...(input.currentPlanRevision !== undefined ? { currentPlanRevision: input.currentPlanRevision } : {}),
    ...(candidatePlan ? { candidatePlanId: candidatePlan.planRevision.id } : {}),
    requiresConfirmation: true,
    reviewAt: input.reviewAt,
    missing,
    candidate: input.candidate,
  };
}
