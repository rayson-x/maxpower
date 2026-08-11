import assert from "node:assert/strict";
import test from "node:test";

import { buildPlanningReportSummary, planningPhrase, strategyName } from "../../src/mobile/ui/planningReport";
import type { PlanProposal } from "../../src/planning";

const pins = {
  knowledgePack: { id: "knowledge", semanticVersion: "1.0.0", schemaVersion: 1, contentHash: "hash" },
  exerciseCatalog: { id: "catalog", semanticVersion: "1.0.0", schemaVersion: 1, contentHash: "hash" },
  rulePacks: [],
} as const;

function proposal(): PlanProposal {
  return {
    kind: "plan_proposal",
  trace: {
    inputFingerprint: "fixture",
    historySummary: { count: 0, exerciseIds: [] },
    slots: [],
    constraintEvents: [],
    weeklyVolume: {},
    outcome: { kind: "plan_proposal" as const, reasonCodes: [] },
  },
    id: "proposal-1",
    baseRevisions: [],
    goalCycle: {
      id: "cycle-1",
      goalContractRef: { kind: "goal_contract", id: "goal-1", revision: 1 },
      intent: "hypertrophy",
      allocations: [],
      phasePath: [],
      successMetrics: [],
      forecastAssumptions: [],
      reviewCadence: { weekly: true, mesocycleEnd: true, midCycleRequiresConsecutiveDeviation: 2 },
      knowledgePins: pins,
      createdFromFactFrontier: [],
    },
    planRevision: {
      id: "plan-1",
      goalContractRef: { kind: "goal_contract", id: "goal-1", revision: 1 },
      effectiveFrom: "2026-08-10",
      knowledgePins: pins,
      sessions: [],
      materializedWeeks: [{
        id: "week-1",
        ordinal: 1,
        startDate: "2026-08-10",
        endDate: "2026-08-16",
        materializedAt: "2026-08-10",
        stimulusBudget: [],
        sessions: [
          {
            id: "training-1",
            title: "hypertrophy · 训练 1",
            scheduledFor: "2026-08-10",
            kind: "bodyweight_reps",
            durationBudget: { value: 60, unit: "minutes" },
            knowledgePins: pins,
            tasks: [{
              id: "task-1",
              exerciseVariantId: "push_up.bodyweight.floor.standard.bilateral.full_rom",
              sets: [
                { id: "set-1", targetReps: { min: 6, max: 12 } },
                { id: "set-2", targetReps: { min: 6, max: 12 } },
              ],
            }],
          },
          {
            id: "rest-1",
            title: "休息与记录",
            scheduledFor: "2026-08-11",
            kind: "rest",
            durationBudget: { value: 0, unit: "minutes" },
            knowledgePins: pins,
            tasks: [],
          },
        ],
      }],
    },
    diff: [],
    scope: "future_plan",
    reasonCodes: ["trigger:initial_plan"],
    evidenceRefs: [],
    missing: ["timeline_history", "exact_variant_load_history"],
    conflicts: [],
    knowledgePins: pins,
    confidence: 0.35,
    requiresConfirmation: true,
    executionClass: "confirmation_required",
    expectedReviewAt: "2026-08-17",
    forecasts: [],
    strategySelection: {
      catalogVersion: "1.0.0",
      primary: "conservative_gain",
      overlays: [],
      historyModifiers: [],
      currentStateModifiers: [],
      riskGuardrails: [],
    },
    appliedPhaseStrategy: {
      id: "phase-1",
      phase: "conservative_gain",
      objective: "build lean mass with a small, observable surplus",
      expectedDurationWeeks: { min: 6, max: 12 },
      entryCriteria: [],
      exitCriteria: [],
      reviewAt: "2026-09-21",
    },
  };
}

test("计划报告投影展示真实首周训练量，并把缺失事实翻译成人话", () => {
  const report = buildPlanningReportSummary(proposal());
  assert.equal(report.trainingDays, 1);
  assert.equal(report.sessionDurationMinutes, 60);
  assert.equal(report.totalWorkSets, 2);
  assert.equal(report.sessions[0]?.title, "增肌 · 训练 1");
  assert.deepEqual(report.missingFacts, [
    "近期训练记录，用于校准真实起点",
    "同一动作的重量、次数与余力记录",
  ]);
});

test("计划报告不会把内部策略与规则码直接暴露给用户", () => {
  assert.equal(strategyName("conservative_gain"), "保守增肌");
  assert.equal(planningPhrase("record_comparable_trends"), "持续记录可比较的训练与身体趋势");
  assert.equal(planningPhrase("general fitness planning"), "一般健身训练人群");
  assert.equal(planningPhrase("constraint_priority:hash"), "先满足安全、恢复与时间约束，再分配训练量");
});
