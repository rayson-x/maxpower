import assert from "node:assert/strict";
import test from "node:test";

import { FixtureMotionRuntime } from "../../src/coach/adapters/motion";
import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { createExecutionContinuityRiskAssessment, type ExecutionContinuityRiskSnapshot } from "../../src/coach/executionContinuityRisk";
import { createFatLossTimelineRiskAssessment } from "../../src/coach/fatLossRiskAssessment";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { KnowledgeVersionPins } from "../../src/knowledge";
import type { EvidenceBriefArtifact } from "../../src/coach/model";
import {
  BehaviorDecisionTraceRecorder,
  TraceRecorder,
  type TraceEnvelope,
} from "../../src/observability";

const USER_ID = "replay-e2e-user";
const NOW = "2026-08-08T21:00:00.000+08:00";

interface AcceptanceReport {
  goalContractRevision: number;
  knowledgePins: KnowledgeVersionPins;
  normalizedFact: "nutrition:confirmed:deviation_700";
  timeline: {
    revision: number;
    dispositions: readonly string[];
    triggerLatency: "same_local_turn";
    coalescedOrSkippedReasons: readonly string[];
  };
  risk: {
    outcome: string;
    state?: string;
    reasonCodes: readonly string[];
    hash: string;
  };
  toolSelection: readonly string[];
  proposal: {
    status?: string;
    requestedScope?: string;
    sourceRiskEvaluationId?: string;
    currentPlanChangedBeforeConfirmation: boolean;
    acceptanceBoundary: "explicit_confirmation_required";
  };
  notifications: {
    deliveredOrScheduledBeforeConfirmation: number;
    suppressionReason: "proposal_not_confirmed";
  };
  observedDecisionBoundaries: readonly string[];
}

interface ReplayScenario {
  app: CoachApplication;
  ledger: InMemoryCoachLedger;
  report: AcceptanceReport;
  proposal: EvidenceBriefArtifact;
  initialPlanRevision: number;
}

/**
 * Deliberately exercises only the public application seams.  The sentence is
 * supplied by a hypothetical conversation extractor, but the coordinator
 * receives the same user-confirmed Timeline fact in both phrasings.  This is
 * the boundary that makes replay meaningful without retaining a model's
 * private reasoning or requiring a real provider/key.
 */
async function replayConfirmedDinnerScenario(userWording: string): Promise<ReplayScenario> {
  let sequence = 0;
  const traces: TraceEnvelope[] = [];
  const provider = new ScriptedLLMProvider(
    [
      {
        type: "tool-call",
        toolCallId: "show-today",
        toolName: "plan.show_today",
        input: { date: "2026-08-08" },
      },
      { type: "completed" },
    ],
    [],
    [[{ type: "text-delta", delta: "已读取今日计划。" }, { type: "completed" }]],
  );
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => NOW, nextId: (prefix) => `${prefix}-${++sequence}` },
    llmProvider: provider,
    timelineRiskAssessment: createFatLossTimelineRiskAssessment(),
    behaviorDecisionRecorder: new BehaviorDecisionTraceRecorder(new TraceRecorder([{
      name: "acceptance-memory",
      async write(envelope) { traces.push(envelope); },
    }])),
  });

  await bootstrapFatLossUser(app, USER_ID, {
    targetMode: "lean_mass_preserving_fat_loss",
    executionTier: "protect_deadline",
    horizon: { startDate: "2026-08-08", endDate: "2026-09-05" },
    measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference", "key_lift"] },
  });
  const initialPreview = await app.createPlanningPreview({
    userId: USER_ID,
    currentDate: "2026-08-08",
    trigger: "initial_plan",
    idempotencyKey: "acceptance:initial-preview",
  });
  assert.equal(initialPreview.planningPreview?.status, "awaiting_confirmation");
  await app.confirmPlanningPreview({
    userId: USER_ID,
    previewId: initialPreview.id,
    idempotencyKey: "acceptance:initial-confirm",
  });
  const initialPlanRevision = (await app.readDomainProjection({ userId: USER_ID })).plan?.revision;
  assert.ok(initialPlanRevision, "acceptance fixture needs a confirmed active plan");

  const session = await app.startSession({ userId: USER_ID, context: { kind: "today", ref: "2026-08-08" } });
  await app.sendCoachTurn({ sessionId: session.id, text: userWording });

  await app.recordTimelineFact({
    userId: USER_ID,
    idempotencyKey: "acceptance:confirmed-dinner-deviation",
    fact: {
      kind: "nutrition",
      observationId: "confirmed-dinner-deviation",
      reportedEnergyDeviationKcal: 700,
      confidence: "confirmed",
    },
    envelope: manualEnvelope("2026-08-08T20:00:00.000+08:00", "conversation:confirmed-dinner-deviation"),
  });
  const risk = await app.runScheduledTimelineRiskEvaluation({
    userId: USER_ID,
    idempotencyKey: "acceptance:scheduled-risk",
  });
  const snapshot = await ledger.read();
  const proposal = latestRiskProposal(snapshot.artifacts);
  const currentPlanRevision = (await app.readDomainProjection({ userId: USER_ID })).plan?.revision;
  const evaluations = await app.readTimelineRiskEvaluations({ userId: USER_ID });
  const toolAudit = await app.listToolAudit(USER_ID);
  const goalContractRevision = (await app.readDomainProjection({ userId: USER_ID })).goalContract?.revision;
  assert.ok(goalContractRevision);
  const knowledgePins = risk.knowledgePins;
  assert.ok(knowledgePins, "risk replay must pin its local knowledge/rule version");

  const report: AcceptanceReport = {
    goalContractRevision,
    knowledgePins,
    normalizedFact: "nutrition:confirmed:deviation_700",
    timeline: {
      revision: risk.timelineRevision,
      dispositions: evaluations.map((item) => item.disposition),
      triggerLatency: "same_local_turn",
      coalescedOrSkippedReasons: evaluations
        .filter((item) => item.disposition === "coalesced" || item.disposition === "skipped")
        .flatMap((item) => item.reasonCodes),
    },
    risk: {
      outcome: risk.outcome,
      state: risk.achievabilityState,
      reasonCodes: risk.reasonCodes,
      hash: risk.hash,
    },
    toolSelection: toolAudit
      .filter((entry) => entry.phase === "tool_execution" && entry.outcome === "passed")
      .flatMap((entry) => entry.toolName ? [entry.toolName] : []),
    proposal: {
      status: proposal.planningPreview?.status,
      requestedScope: proposal.planningPreview?.request.requestedScope,
      sourceRiskEvaluationId: proposal.planningPreview?.sourceRiskEvaluationId,
      currentPlanChangedBeforeConfirmation: currentPlanRevision !== initialPlanRevision,
      acceptanceBoundary: "explicit_confirmation_required",
    },
    notifications: {
      deliveredOrScheduledBeforeConfirmation: snapshot.notificationIntents.filter(
        (intent) => intent.status === "scheduled" || intent.status === "pending",
      ).length,
      suppressionReason: "proposal_not_confirmed",
    },
    observedDecisionBoundaries: [...new Set(traces.map((trace) => String(trace.metadata?.decisionBoundary)))].sort(),
  };
  return { app, ledger, report, proposal, initialPlanRevision };
}

test("可回放验收：不同说法在同一确认事实、目标合同与知识版本下得到完全一致的风险和提案边界", async () => {
  const first = await replayConfirmedDinnerScenario("今天出去聚餐吃多了，已经确认比计划多 700 千卡。");
  const second = await replayConfirmedDinnerScenario("晚餐放纵了，确认今天多摄入 700 千卡。");

  assert.deepEqual(first.report, second.report);
  assert.equal(first.report.risk.state, "at_risk");
  assert.deepEqual(first.report.risk.reasonCodes, ["excess_energy_erodes_lean_cut_buffer"]);
  assert.deepEqual(first.report.timeline.dispositions, ["material", "material"]);
  assert.deepEqual(first.report.toolSelection, ["plan.show_today"]);
  assert.equal(first.report.proposal.requestedScope, "future_plan");
  assert.equal(first.report.proposal.currentPlanChangedBeforeConfirmation, false);
  assert.equal(first.report.notifications.deliveredOrScheduledBeforeConfirmation, 0);
  assert.deepEqual(first.report.observedDecisionBoundaries, [
    "capability_visibility",
    "materiality",
    "planner_candidate",
    "risk_evaluation",
    "tool_selection",
    "tool_validation",
  ]);
  assert.ok(Object.keys(first.report.knowledgePins).length > 0, "risk replay must pin its local knowledge/rule version");
});

test("可回放验收：聚餐、睡眠差、连续失败与平台期按目标/证据模式进入不同而稳定的处理分支", async () => {
  const higherBodyMass = await runGoalRiskScenario({
    id: "higher-body-mass",
    contract: {
      targetMode: "higher_body_mass_fat_loss",
      executionTier: "balanced",
      horizon: { startDate: "2026-08-08", endDate: "2026-12-08" },
      measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference"] },
    },
    facts: [nutritionDeviation(700)],
  });
  assert.deepEqual(higherBodyMass.reasonCodes, ["excess_energy_within_higher_body_mass_buffer"]);
  assert.equal(higherBodyMass.achievabilityState, "on_path");

  const poorSleepStrengthCut = await runGoalRiskScenario({
    id: "strength-sleep",
    contract: {
      targetMode: "strength_priority_cut",
      executionTier: "protect_deadline",
      horizon: { startDate: "2026-08-08", endDate: "2026-09-05" },
      guardrails: { minimumRecovery: 4, requiredTrainingCompletion: "key_sessions" },
      measurementPlan: { requiredMeasurements: ["body_weight", "key_lift"] },
    },
    facts: [
      { kind: "training", reportedSession: { executionStatus: "missed" }, confidence: "confirmed" },
      { kind: "recovery", perceivedRecovery: 2, confidence: "confirmed" },
    ],
  });
  assert.equal(poorSleepStrengthCut.achievabilityState, "infeasible_under_guardrails");
  assert.deepEqual(poorSleepStrengthCut.reasonCodes, ["recovery_below_goal_guardrail"]);

  const repeatedFailure = await runContinuityScenario("repeated-failure", {
    execution: {
      coverage: "high",
      energyPath: "on_path",
      diet: [
        { occurredAt: "2026-08-06T20:00:00.000+08:00", status: "within_tolerance" },
        { occurredAt: "2026-08-07T20:00:00.000+08:00", status: "outside_tolerance" },
        { occurredAt: "2026-08-08T20:00:00.000+08:00", status: "outside_tolerance" },
      ],
      keyTraining: [
        { occurredAt: "2026-08-06T18:00:00.000+08:00", status: "missed" },
        { occurredAt: "2026-08-08T18:00:00.000+08:00", status: "partial" },
      ],
    },
    trend: { measurementQuality: "comparable", bodyWeight: "flat", waist: "flat" },
    recovery: "adequate",
  });
  assert.equal(repeatedFailure.risk.achievabilityState, "at_risk");
  assert.ok(repeatedFailure.risk.reasonCodes.includes("execution_failure_run_detected"));

  const plateau = await runContinuityScenario("plateau", {
    execution: {
      coverage: "high", energyPath: "on_path",
      diet: [{ occurredAt: "2026-08-07T20:00:00.000+08:00", status: "within_tolerance" }],
      keyTraining: [{ occurredAt: "2026-08-07T18:00:00.000+08:00", status: "completed" }],
    },
    trend: { measurementQuality: "comparable", bodyWeight: "flat", waist: "flat" },
    recovery: "adequate",
  });
  assert.deepEqual(plateau.risk.reasonCodes, ["candidate_response_plateau"]);
  assert.deepEqual(plateau.decision.adjustment?.variables, ["daily_activity"]);
  assert.equal(plateau.decision.adjustment?.confirmationRequired, true);
  assert.equal(plateau.decision.adjustment?.effectiveTiming, "future_only");
});

test("可回放验收：实时封存结果写入同一 Timeline；过期提案不能确认，也不会提前发通知", async () => {
  const dinner = await replayConfirmedDinnerScenario("我确认晚餐比计划多 700 千卡。");
  await dinner.app.recordTimelineFact({
    userId: USER_ID,
    idempotencyKey: "acceptance:newer-fact",
    fact: nutritionDeviation(100),
    envelope: manualEnvelope("2026-08-08T20:30:00.000+08:00", "conversation:newer-fact"),
  });
  await assert.rejects(
    dinner.app.confirmPlanningPreview({
      userId: USER_ID,
      previewId: dinner.proposal.id,
      idempotencyKey: "acceptance:stale-confirm",
    }),
    /planning_preview_stale/,
  );
  assert.equal((await dinner.app.readDomainProjection({ userId: USER_ID })).plan?.revision, dinner.initialPlanRevision);

  let sequence = 0;
  const motionApp = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => NOW, nextId: (prefix) => `motion-${prefix}-${++sequence}` },
    motionRuntime: new FixtureMotionRuntime([{
      source: "rust_canonical_packet",
      packetRef: { id: "acceptance-sealed-packet", version: 1, hash: "packet-hash" },
      profileCode: 1,
      profileIdentity: "lat_pulldown/rear/v1",
      exactExecutableProfile: true,
      exerciseId: "lat_pulldown",
      sealed: true,
      reps: [
        { id: "rep-1", disposition: "confirmed", findings: [] },
        { id: "rep-2", disposition: "needs_review", findings: ["primary_range_below_expectation"] },
      ],
    }]),
  });
  const motionSession = await motionApp.startSession({
    userId: "motion-replay-user",
    context: { kind: "workout", ref: "acceptance-workout" },
  });
  const [sealed] = await motionApp.replayMotionRuntime({
    sessionId: motionSession.id,
    setId: "acceptance-set",
    userReported: { loadKg: 42.5, rir: 2 },
  });
  assert.equal(sealed?.status, "sealed");
  assert.equal(sealed?.status === "sealed" && sealed.timelineFinalization, "recorded");
  const projection = await motionApp.readDomainProjection({ userId: "motion-replay-user" });
  assert.equal(projection.timeline.current.length, 1);
  assert.equal(projection.timeline.current[0]?.fact.kind, "training");
  assert.equal(
    projection.timeline.current[0]?.fact.kind === "training" && projection.timeline.current[0].fact.reportedSession?.exercises?.[0]?.sets?.[0]?.reps,
    1,
  );
  assert.equal((await motionApp.readTimelineRiskEvaluations({ userId: "motion-replay-user" }))[0]?.outcome, "queued");
});

async function bootstrapFatLossUser(
  app: CoachApplication,
  userId: string,
  contract: {
    targetMode: "higher_body_mass_fat_loss" | "lean_mass_preserving_fat_loss" | "strength_priority_cut";
    executionTier: "protect_deadline" | "balanced" | "protect_sustainability";
    horizon: { startDate: string; endDate: string };
    guardrails?: { minimumRecovery?: number; requiredTrainingCompletion?: "key_sessions" };
    measurementPlan: { requiredMeasurements: readonly ("body_weight" | "waist_circumference" | "key_lift")[] };
  },
): Promise<void> {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId,
      actor: { kind: "user", id: userId },
      deviceId: "acceptance-device",
      occurredAt: "2026-08-08T08:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: `bootstrap:${userId}`,
    },
    profile: {
      id: `profile:${userId}`,
      trainingExperience: "intermediate",
      locale: "zh-CN",
      demographics: {
        ageYears: 30,
        sex: "male",
        height: { value: 178, unit: "cm" },
        currentWeight: { value: 75, unit: "kg" },
      },
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: `goal:${userId}`,
      primaryGoal: "fat_loss_preserve_lean_mass",
      goalType: "fat_loss",
      status: "active",
      aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength" },
      ...contract,
    },
    mandate: { id: `mandate:${userId}`, mode: "collaborative" },
  });
}

async function runGoalRiskScenario(input: {
  id: string;
  contract: Parameters<typeof bootstrapFatLossUser>[2];
  facts: readonly import("../../src/coach/domain").TimelineFact[];
}) {
  let sequence = 0;
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => NOW, nextId: (prefix) => `${input.id}-${prefix}-${++sequence}` },
    timelineRiskAssessment: createFatLossTimelineRiskAssessment(),
  });
  await bootstrapFatLossUser(app, input.id, input.contract);
  for (const [index, fact] of input.facts.entries()) {
    await app.recordTimelineFact({
      userId: input.id,
      idempotencyKey: `${input.id}:fact:${index}`,
      fact,
      envelope: manualEnvelope(`2026-08-08T${String(18 + index).padStart(2, "0")}:00:00.000+08:00`, `${input.id}:fact:${index}`),
    });
  }
  return app.runScheduledTimelineRiskEvaluation({ userId: input.id, idempotencyKey: `${input.id}:risk` });
}

async function runContinuityScenario(id: string, evidence: ExecutionContinuityRiskSnapshot) {
  let sequence = 0;
  const assessment = createExecutionContinuityRiskAssessment({
    base: createFatLossTimelineRiskAssessment(),
    source: { async load() { return evidence; } },
  });
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => NOW, nextId: (prefix) => `${id}-${prefix}-${++sequence}` },
    timelineRiskAssessment: assessment,
  });
  await bootstrapFatLossUser(app, id, {
    targetMode: "lean_mass_preserving_fat_loss",
    executionTier: "protect_deadline",
    horizon: { startDate: "2026-08-08", endDate: "2026-09-05" },
    measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference"] },
  });
  await app.recordTimelineFact({
    userId: id,
    idempotencyKey: `${id}:trigger`,
    fact: nutritionDeviation(0),
    envelope: manualEnvelope("2026-08-08T20:00:00.000+08:00", `${id}:trigger`),
  });
  const risk = await app.runScheduledTimelineRiskEvaluation({ userId: id, idempotencyKey: `${id}:risk` });
  const decision = await assessment.assessState({
    userId: id,
    timelineRevision: risk.timelineRevision,
    factFrontier: risk.sourceFactRefs,
    sourceFactRefs: risk.sourceFactRefs,
    causationIds: risk.causationIds,
    evaluatedAt: NOW,
    riskSnapshot: {
      goalContract: (await app.readDomainProjection({ userId: id })).goalContract,
      timeline: (await app.readDomainProjection({ userId: id })).timeline.current,
    },
  });
  return { risk, decision };
}

function nutritionDeviation(kcal: number): Extract<import("../../src/coach/domain").TimelineFact, { kind: "nutrition" }> {
  return { kind: "nutrition", observationId: `deviation-${kcal}`, reportedEnergyDeviationKcal: kcal, confidence: "confirmed" };
}

function latestRiskProposal(artifacts: readonly import("../../src/coach/model").Artifact[]): EvidenceBriefArtifact {
  const proposal = [...artifacts].reverse().find(
    (artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief" && Boolean(artifact.planningPreview?.sourceRiskEvaluationId),
  );
  assert.ok(proposal, "at-risk acceptance scenario must produce a confirmable future-plan preview");
  return proposal;
}

function manualEnvelope(at: string, causationId: string) {
  return {
    time: { startedAt: at, timezoneOffsetMinutes: 480 },
    provenance: {
      origin: "manual" as const,
      recordingMethod: "manual_entry" as const,
      dataStatus: "available" as const,
      confidence: "confirmed" as const,
    },
    privacyClass: "sensitive" as const,
    causalRefs: [causationId],
    evidenceRefs: [],
    layer: "raw_observation" as const,
  };
}
