import assert from "node:assert/strict";
import test from "node:test";

import { assertRegisteredReplanTrigger, evaluateReplan, semanticPlanDiff, weeklyCoachReport } from "../../src/replanning";

const pins = { knowledgePack: { id: "k", semanticVersion: "1", schemaVersion: 1, contentHash: "k" }, exerciseCatalog: { id: "c", semanticVersion: "1", schemaVersion: 1, contentHash: "c" }, rulePacks: [] };
const plan = {
  id: "p", goalContractRef: { kind: "goal_contract" as const, id: "g", revision: 1 }, effectiveFrom: "2026-08-08", knowledgePins: pins,
  sessions: [{ id: "s", title: "Push", scheduledFor: "2026-08-10", knowledgePins: pins, tasks: [{ id: "t", exerciseVariantId: "bench", sets: [{ id: "set", targetReps: { min: 8, max: 8 } }] }] }],
};

test("Replanner 只接受闭合 trigger，相同业务语义不会写空计划变更", () => {
  const candidate = { kind: "plan_proposal" as const, trace: { inputFingerprint: "fixture", historySummary: { count: 0, exerciseIds: [] }, slots: [], constraintEvents: [], weeklyVolume: {}, outcome: { kind: "plan_proposal" as const, reasonCodes: [] } }, id: "candidate", baseRevisions: [], goalCycle: {} as never, planRevision: plan, diff: [], scope: "future_plan" as const, reasonCodes: [], evidenceRefs: [], missing: [], conflicts: [], knowledgePins: pins, confidence: 0.5, requiresConfirmation: true, executionClass: "confirmation_required" as const, expectedReviewAt: "2026-08-15", forecasts: [] };
  const evalA = evaluateReplan({
    id: "r", trigger: { id: "t", kind: "user_requested", actor: "user", occurredAt: "2026-08-08T00:00:00Z", causationId: "c", idempotencyKey: "i" }, evaluatedAt: "2026-08-08T00:00:00Z", currentPlan: plan, candidate, frontier: [], window: { start: "2026-08-08", end: "2026-08-15" }, ruleVersion: "v1",
  });
  assert.equal(evalA.outcome, "no_change");
  assert.equal(evalA.forecasts.length, 3);
  assert.equal(evalA.forecasts.every((item) => item.disclaimer === "directional_not_guaranteed"), true);
  assert.throws(
    () => assertRegisteredReplanTrigger({ id: "bad", kind: "unknown" as never, actor: "user", occurredAt: "", causationId: "", idempotencyKey: "" }),
    /unregistered/,
  );
});

test("语义 diff 忽略 revision/id 噪音，周报以实际 SetOutcome 而不是计划值计数", () => {
  assert.equal(semanticPlanDiff(plan, { ...plan, id: "p2" }).changed, false);
  assert.equal(
    semanticPlanDiff(plan, {
      ...plan,
      sessions: [{
        ...plan.sessions[0]!,
        locationId: "gym-b",
        durationBudget: { value: 35, unit: "minutes" },
        tasks: [{
          ...plan.sessions[0]!.tasks[0]!,
          sets: [{
            ...plan.sessions[0]!.tasks[0]!.sets[0]!,
            targetLoadStatus: "historical_anchor",
            targetLoadBasis: {
              source: "exact_variant_history",
              evidenceRef: "timeline:prior-set",
              confidence: 0.8,
            },
            calibrationIntent: "confirm_conservative_start",
          }],
        }],
      }],
    }).changed,
    true,
  );
  const report = weeklyCoachReport({
    weekStart: "2026-08-10", weekEnd: "2026-08-16", plan,
    workouts: [{ id: "w", revision: 1, prescriptionRef: { planId: "p", planRevision: 1, sessionPrescriptionId: "s" }, frozenPrescription: plan.sessions[0]!, drafts: [], state: { status: "completed", mode: "record_only", policy: { id: "x", version: "1", resumeWindowHours: 24 }, transitions: [] }, status: "completed", setOutcomes: [{ id: "out", prescriptionSetId: "set", exerciseVariantId: "bench", actualReps: 8, source: "user_confirmed", completedAs: "confirmed_as_planned" }] }],
    timelineEventCount: 1, recoveryLevels: ["normal"],
  });
  assert.equal(report.performedSetCount, 1);
  assert.equal(report.incompletePrescriptionSetIds.length, 0);
});

test("同一类普通重规划在稳定窗口内保留评估和预测，但不重复推动 Proposal；恢复降级不受冷却阻塞", () => {
  const candidate = {
    kind: "plan_proposal" as const, trace: { inputFingerprint: "fixture", historySummary: { count: 0, exerciseIds: [] }, slots: [], constraintEvents: [], weeklyVolume: {}, outcome: { kind: "plan_proposal" as const, reasonCodes: [] } },
    id: "candidate-stability",
    baseRevisions: [],
    goalCycle: {} as never,
    planRevision: {
      ...plan,
      sessions: [{
        ...plan.sessions[0]!,
        locationId: "gym-b",
      }],
    },
    diff: [],
    scope: "future_plan" as const,
    reasonCodes: [],
    evidenceRefs: [],
    missing: [],
    conflicts: [],
    knowledgePins: pins,
    confidence: 0.5,
    requiresConfirmation: true,
    executionClass: "confirmation_required" as const,
    expectedReviewAt: "2026-08-15",
    forecasts: [],
  };
  const initial = evaluateReplan({
    id: "schedule-initial",
    trigger: {
      id: "schedule-trigger-1",
      kind: "schedule_changed",
      actor: "rule_engine",
      occurredAt: "2026-08-08T08:00:00.000Z",
      causationId: "schedule-r1",
      idempotencyKey: "schedule-r1",
    },
    evaluatedAt: "2026-08-08T08:00:00.000Z",
    currentPlan: plan,
    candidate,
    frontier: [],
    window: { start: "2026-08-08", end: "2026-08-15" },
    ruleVersion: "v1",
  });
  assert.equal(initial.outcome, "proposal_required");
  assert.equal(initial.stability.status, "eligible");

  const jitter = evaluateReplan({
    id: "schedule-jitter",
    trigger: {
      id: "schedule-trigger-2",
      kind: "schedule_changed",
      actor: "rule_engine",
      occurredAt: "2026-08-08T12:00:00.000Z",
      causationId: "schedule-r2",
      idempotencyKey: "schedule-r2",
    },
    evaluatedAt: "2026-08-08T12:00:00.000Z",
    currentPlan: plan,
    candidate,
    frontier: [],
    window: { start: "2026-08-08", end: "2026-08-15" },
    ruleVersion: "v1",
    priorEvaluations: [initial],
  });
  assert.equal(jitter.diff.changed, true);
  assert.equal(jitter.forecasts.length, 3);
  assert.equal(jitter.outcome, "proposal_deferred");
  assert.equal(jitter.stability.status, "cooldown_deferred");
  assert.deepEqual(jitter.stability.basedOnEvaluationIds, ["schedule-initial"]);
  assert.equal(jitter.stability.nextEligibleAt, "2026-08-09T08:00:00.000Z");

  const recovery = evaluateReplan({
    id: "recovery-urgent",
    trigger: {
      id: "recovery-trigger",
      kind: "recovery_constraint_changed",
      actor: "rule_engine",
      occurredAt: "2026-08-08T12:01:00.000Z",
      causationId: "recovery-r1",
      idempotencyKey: "recovery-r1",
    },
    evaluatedAt: "2026-08-08T12:01:00.000Z",
    currentPlan: plan,
    candidate,
    frontier: [],
    window: { start: "2026-08-08", end: "2026-08-15" },
    ruleVersion: "v1",
    priorEvaluations: [initial, jitter],
  });
  assert.equal(recovery.outcome, "proposal_required");
  assert.equal(recovery.stability.status, "eligible");
  assert.ok(recovery.stability.reasonCodes.includes("priority_trigger_bypasses_cooldown"));
});
