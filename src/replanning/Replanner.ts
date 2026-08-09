import type { DomainAggregateRef, DomainProjection, PlanRevisionData, WorkoutProjection } from "../coach/domain";
import type { FactRef } from "../coach/model";
import type { PlannerDecision } from "../planning";
import { stableHash } from "../coach/stable";

export type ReplanTriggerKind =
  | "session_completed"
  | "recovery_constraint_changed"
  | "repeated_missed_sessions"
  | "schedule_changed"
  | "equipment_changed"
  | "goal_contract_revised"
  | "deload_ended"
  | "weekly_review_due"
  | "user_requested";

export interface ReplanTrigger {
  id: string;
  kind: ReplanTriggerKind;
  actor: "user" | "rule_engine" | "system";
  occurredAt: string;
  causationId: string;
  idempotencyKey: string;
}

export interface GoalForecast {
  scenario: "conservative" | "base" | "aggressive";
  assumptions: readonly string[];
  requiredBehaviors: readonly string[];
  milestones: readonly { date: string; description: string }[];
  dataWindow: { start: string; end: string };
  missingness: readonly string[];
  confidence: "low" | "moderate";
  factRefs: readonly string[];
  ruleVersion: string;
  disclaimer: "directional_not_guaranteed";
}

export interface PlanSemanticDiff {
  changed: boolean;
  entries: readonly { path: string; before: unknown; after: unknown }[];
  semanticHash: string;
}

/**
 * Replanning remains responsive to safety, recovery and an explicit user
 * request. Routine inputs, however, can arrive in bursts (for example a
 * calendar sync followed by an equipment correction).  This policy prevents
 * that burst from repeatedly surfacing the same class of plan Proposal while
 * preserving every deterministic evaluation and forecast in the local log.
 */
export interface ReplanStabilityPolicy {
  id: string;
  semanticVersion: string;
  proposalCooldownHours: number;
  cooldownManagedKinds: readonly ReplanTriggerKind[];
  priorityKinds: readonly ReplanTriggerKind[];
}

export interface ReplanStabilityDecision {
  policyId: string;
  policyVersion: string;
  status: "eligible" | "cooldown_deferred";
  reasonCodes: readonly string[];
  basedOnEvaluationIds: readonly string[];
  nextEligibleAt?: string;
}

export const DEFAULT_REPLAN_STABILITY_POLICY: ReplanStabilityPolicy = {
  id: "maxpower.replan-stability",
  semanticVersion: "1.0.0",
  proposalCooldownHours: 24,
  // These are routine availability/progress signals. The evaluation itself is
  // still persisted, so the most recent local facts remain visible to a later
  // explicit review rather than being silently discarded.
  cooldownManagedKinds: [
    "session_completed",
    "schedule_changed",
    "equipment_changed",
    "weekly_review_due",
  ],
  // Safety-adjacent recovery, formal escalation and a user request must not
  // wait behind a convenience cooldown.
  priorityKinds: [
    "recovery_constraint_changed",
    "repeated_missed_sessions",
    "goal_contract_revised",
    "deload_ended",
    "user_requested",
  ],
};

export interface ReplanEvaluation {
  id: string;
  trigger: ReplanTrigger;
  evaluatedAt: string;
  factFrontier: readonly DomainAggregateRef[];
  plannerDecision: PlannerDecision;
  diff: PlanSemanticDiff;
  forecasts: readonly GoalForecast[];
  /** A deferred outcome keeps the candidate/diff auditable but creates no new Proposal. */
  outcome: "no_change" | "proposal_required" | "proposal_deferred" | "infeasible";
  stability: ReplanStabilityDecision;
}

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

const REGISTERED = new Set<ReplanTriggerKind>([
  "session_completed", "recovery_constraint_changed", "repeated_missed_sessions", "schedule_changed", "equipment_changed", "goal_contract_revised", "deload_ended", "weekly_review_due", "user_requested",
]);

export function assertRegisteredReplanTrigger(trigger: ReplanTrigger): void {
  if (!REGISTERED.has(trigger.kind)) throw new Error("unregistered_replan_trigger");
}

export function evaluateReplan(input: {
  id: string;
  trigger: ReplanTrigger;
  evaluatedAt: string;
  currentPlan?: PlanRevisionData;
  candidate: PlannerDecision;
  frontier: readonly DomainAggregateRef[];
  window: { start: string; end: string };
  ruleVersion: string;
  priorEvaluations?: readonly ReplanEvaluation[];
  stabilityPolicy?: ReplanStabilityPolicy;
}): ReplanEvaluation {
  assertRegisteredReplanTrigger(input.trigger);
  const diff = input.candidate.kind === "no_change"
    ? noSemanticPlanDiff(input.currentPlan)
    : semanticPlanDiff(
      input.currentPlan,
      input.candidate.kind === "plan_proposal" ? input.candidate.planRevision : undefined,
    );
  const baseOutcome = input.candidate.kind === "infeasible_plan"
    ? "infeasible"
    : diff.changed ? "proposal_required" : "no_change";
  const stability = evaluateReplanStability({
    trigger: input.trigger,
    evaluatedAt: input.evaluatedAt,
    candidateHasSemanticDiff: diff.changed,
    priorEvaluations: input.priorEvaluations ?? [],
    policy: input.stabilityPolicy ?? DEFAULT_REPLAN_STABILITY_POLICY,
  });
  const outcome = baseOutcome === "proposal_required" && stability.status === "cooldown_deferred"
    ? "proposal_deferred" as const
    : baseOutcome;
  return {
    id: input.id,
    trigger: input.trigger,
    evaluatedAt: input.evaluatedAt,
    factFrontier: input.frontier,
    plannerDecision: input.candidate,
    diff,
    forecasts: buildGoalForecasts({ window: input.window, frontier: input.frontier, ruleVersion: input.ruleVersion, missing: candidateMissing(input.candidate) }),
    outcome,
    stability,
  };
}

export function evaluateReplanStability(input: {
  trigger: ReplanTrigger;
  evaluatedAt: string;
  candidateHasSemanticDiff: boolean;
  priorEvaluations: readonly ReplanEvaluation[];
  policy: ReplanStabilityPolicy;
}): ReplanStabilityDecision {
  const base = {
    policyId: input.policy.id,
    policyVersion: input.policy.semanticVersion,
  };
  if (!input.candidateHasSemanticDiff) {
    return { ...base, status: "eligible", reasonCodes: ["no_semantic_plan_diff"], basedOnEvaluationIds: [] };
  }
  if (input.policy.priorityKinds.includes(input.trigger.kind)) {
    return { ...base, status: "eligible", reasonCodes: ["priority_trigger_bypasses_cooldown"], basedOnEvaluationIds: [] };
  }
  if (!input.policy.cooldownManagedKinds.includes(input.trigger.kind)) {
    return { ...base, status: "eligible", reasonCodes: ["trigger_not_cooldown_managed"], basedOnEvaluationIds: [] };
  }
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) {
    throw new Error("invalid_replan_evaluated_at");
  }
  const cooldownMs = input.policy.proposalCooldownHours * 60 * 60 * 1_000;
  const channel = stabilityChannel(input.trigger.kind);
  const anchors = input.priorEvaluations
    .filter((evaluation) => evaluation.outcome === "proposal_required")
    .filter((evaluation) => stabilityChannel(evaluation.trigger.kind) === channel)
    .filter((evaluation) => {
      const priorAt = Date.parse(evaluation.evaluatedAt);
      return Number.isFinite(priorAt) && priorAt <= evaluatedAt && evaluatedAt - priorAt < cooldownMs;
    })
    .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt) || right.id.localeCompare(left.id));
  const anchor = anchors[0];
  if (!anchor) {
    return { ...base, status: "eligible", reasonCodes: ["minimum_evidence_window_satisfied"], basedOnEvaluationIds: [] };
  }
  const anchorAt = Date.parse(anchor.evaluatedAt);
  return {
    ...base,
    status: "cooldown_deferred",
    reasonCodes: ["proposal_cooldown_active", "minimum_evidence_window_not_elapsed"],
    basedOnEvaluationIds: [anchor.id],
    nextEligibleAt: new Date(anchorAt + cooldownMs).toISOString(),
  };
}

function stabilityChannel(kind: ReplanTriggerKind): "routine_plan_adjustment" | ReplanTriggerKind {
  return kind === "session_completed" || kind === "schedule_changed" || kind === "equipment_changed" || kind === "weekly_review_due"
    ? "routine_plan_adjustment"
    : kind;
}

function noSemanticPlanDiff(current: PlanRevisionData | undefined): PlanSemanticDiff {
  return {
    changed: false,
    entries: [],
    semanticHash: stableHash({ current: current && semanticPlanForHash(current) }),
  };
}

export function semanticPlanDiff(
  current: PlanRevisionData | undefined,
  candidate: PlanRevisionData | undefined,
): PlanSemanticDiff {
  const normalized = (plan: PlanRevisionData | undefined) => plan && semanticPlanForHash(plan);
  const before = normalized(current);
  const after = normalized(candidate);
  return {
    changed: JSON.stringify(before) !== JSON.stringify(after),
    entries: JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path: "plan", before, after }],
    semanticHash: stableHash({ before, after }),
  };
}

function semanticPlanForHash(plan: PlanRevisionData) {
  return {
    goalContractRef: plan.goalContractRef,
    ...(plan.goalCycleRef ? { goalCycleRef: plan.goalCycleRef } : {}),
    effectiveFrom: plan.effectiveFrom,
    sessions: plan.sessions.map((session) => ({
      scheduledFor: session.scheduledFor,
      kind: session.kind,
      ...(session.locationId ? { locationId: session.locationId } : {}),
      ...(session.durationBudget ? { durationBudget: session.durationBudget } : {}),
      ...(session.status ? { status: session.status } : {}),
      ...(session.stimulusSlots
        ? {
            stimulusSlots: session.stimulusSlots.map((slot) => ({
              intent: slot.intent,
              prescription: slot.prescription,
              exerciseSlot: slot.exerciseSlot,
              lockedFields: slot.lockedFields,
            })),
          }
        : {}),
      tasks: session.tasks.map((task) => ({
        exerciseVariantId: task.exerciseVariantId,
        ...(task.stimulusSlotId ? { stimulusSlotId: task.stimulusSlotId } : {}),
        mode: task.mode,
        sets: task.sets.map((set) => ({
          targetReps: set.targetReps,
          targetLoad: set.targetLoad,
          targetLoadStatus: set.targetLoadStatus,
          targetLoadBasis: set.targetLoadBasis,
          calibrationIntent: set.calibrationIntent,
          targetDuration: set.targetDuration,
          targetDistance: set.targetDistance,
          targetRir: set.targetRir,
          rest: set.rest,
        })),
      })),
    })),
    knowledgePins: plan.knowledgePins,
  };
}

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

function buildGoalForecasts(input: {
  window: { start: string; end: string };
  frontier: readonly DomainAggregateRef[];
  ruleVersion: string;
  missing: readonly string[];
}): GoalForecast[] {
  return ([
    ["conservative", "优先稳定执行与恢复", "保留余量，按复核节奏调整"],
    ["base", "按当前计划完成大部分训练", "保持记录与复核"],
    ["aggressive", "需要稳定执行且没有新的约束", "在不牺牲恢复的前提下完成高优先级内容"],
  ] as const).map(([scenario, assumption, behavior]) => ({
    scenario,
    assumptions: [assumption],
    requiredBehaviors: [behavior],
    milestones: [{ date: input.window.end, description: "复核当前周期的方向与覆盖" }],
    dataWindow: input.window,
    missingness: input.missing,
    confidence: input.missing.length ? "low" : "moderate",
    factRefs: input.frontier.map((ref) => `${ref.kind}:${ref.id}@${ref.revision}`),
    ruleVersion: input.ruleVersion,
    disclaimer: "directional_not_guaranteed",
  }));
}

function candidateMissing(candidate: PlannerDecision): readonly string[] {
  if (candidate.kind === "plan_proposal") return candidate.missing;
  return candidate.kind === "infeasible_plan" ? candidate.reasonCodes : [];
}
