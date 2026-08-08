import type {
  AdjustTaskChange,
  ContextRef,
  FactRef,
  PlanChangeProposalArtifact,
  TodayPlanArtifact,
  UserState,
} from "./model";
import { stableHash } from "./stable";

export interface TodayPlanDecisionInput {
  artifactId: string;
  createdAt: string;
  date: string;
  context: ContextRef;
  user: UserState;
}

/** Pure, deterministic domain decision. Store, UI, time and LLM access are forbidden here. */
export function decideTodayPlan(input: TodayPlanDecisionInput): TodayPlanArtifact {
  const evidenceRefs: FactRef[] = [
    { aggregate: "profile", id: input.user.userId, revision: input.user.profileRevision },
    { aggregate: "plan", id: input.user.userId, revision: input.user.plan.revision },
    { aggregate: "timeline", id: input.user.userId, revision: input.user.timelineRevision },
  ];
  const missingness = input.user.timeline.length === 0 ? ["today_timeline"] : [];
  const payload = {
    kind: "today_plan" as const,
    schemaVersion: 1 as const,
    renderVersion: 1 as const,
    date: input.date,
    title: input.user.plan.title,
    planRevision: input.user.plan.revision,
    tasks: input.user.plan.tasks,
    contextRefs: [input.context],
    evidenceRefs,
    missingness,
    capabilityBoundary: [
      "负重与 RIR 来自计划或用户记录，不由骨架推断",
      "这里只展示计划，不代表已完成训练",
    ],
  };
  return Object.freeze({
    id: input.artifactId,
    createdAt: input.createdAt,
    ...payload,
    hash: stableHash(payload),
  });
}

export interface PlanChangeDecisionInput {
  artifactId: string;
  createdAt: string;
  context: ContextRef;
  user: UserState;
  change: AdjustTaskChange;
  reason: string;
  executionPolicy: PlanChangeProposalArtifact["executionPolicy"];
  supersedesArtifactId?: string;
}

export function decidePlanChangeProposal(
  input: PlanChangeDecisionInput,
): PlanChangeProposalArtifact {
  const task = input.user.plan.tasks.find((candidate) => candidate.id === input.change.taskId);
  if (!task) throw new Error(`Plan task not found: ${input.change.taskId}`);
  const fields = ["sets", "reps", "loadKg", "targetRir", "restSeconds"] as const;
  const changedFields = fields.filter((field) => input.change[field] !== undefined);
  const before = Object.fromEntries(changedFields.map((field) => [field, task[field]]));
  const after = Object.fromEntries(changedFields.map((field) => [field, input.change[field]]));
  const semantic = {
    kind: "plan_change_proposal" as const,
    schemaVersion: 1 as const,
    renderVersion: 1 as const,
    basePlanRevision: input.user.plan.revision,
    mandateRevision: input.user.mandate.revision,
    change: input.change,
    before,
    after,
    reason: input.reason,
    risk: "low" as const,
    executionPolicy: input.executionPolicy,
    ...(input.supersedesArtifactId
      ? { supersedesArtifactId: input.supersedesArtifactId }
      : {}),
    contextRefs: [input.context],
    evidenceRefs: [
      { aggregate: "plan" as const, id: input.user.userId, revision: input.user.plan.revision },
      { aggregate: "timeline" as const, id: input.user.userId, revision: input.user.timelineRevision },
    ],
    missingness: input.user.timeline.length === 0 ? ["recent_performance_evidence"] : [],
    capabilityBoundary: [
      "这是待确认的计划差异，不代表已经执行",
      "负重与 RIR 不由骨架自动推断",
    ],
  };
  return Object.freeze({
    id: input.artifactId,
    createdAt: input.createdAt,
    ...semantic,
    hash: stableHash(semantic),
  });
}
