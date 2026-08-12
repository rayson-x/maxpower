import assert from "node:assert/strict";
import test from "node:test";

import {
  CoachApplication,
} from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { TimelineRiskAssessmentPort } from "../../src/coach/timelineRiskEvaluation";
import { createFatLossTimelineRiskAssessment } from "../../src/coach/fatLossRiskAssessment";

function createApp(input: { assessment?: TimelineRiskAssessmentPort } = {}) {
  let sequence = 0;
  let now = "2026-08-08T08:00:00.000+08:00";
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => now,
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    ...(input.assessment ? { timelineRiskAssessment: input.assessment } : {}),
  });
  return {
    app,
    setNow(value: string) { now = value; },
  };
}

async function bootstrap(
  app: CoachApplication,
  goalOverrides: Partial<import("../../src/coach/domain").GoalContractData> = {},
) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1",
      actor: { kind: "user", id: "u1" },
      deviceId: "phone-1",
      occurredAt: "2026-08-08T08:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "intermediate", locale: "zh-CN" },
    goalContract: {
      id: "goal-1",
      primaryGoal: "fat_loss_preserve_lean_mass",
      horizon: { startDate: "2026-08-08", endDate: "2026-12-08" },
      ...goalOverrides,
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
}

test("相同聚餐偏差按减脂目标模式给出不同的原路径判断，不显示未经校准的概率", async () => {
  const higherBodyMass = createApp({ assessment: createFatLossTimelineRiskAssessment() });
  await bootstrap(higherBodyMass.app, {
    targetMode: "higher_body_mass_fat_loss",
    executionTier: "balanced",
    measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference"] },
  });
  await higherBodyMass.app.recordTimelineFact({
    userId: "u1", idempotencyKey: "higher-body-mass-meal",
    fact: { kind: "nutrition", observationId: "meal-1", reportedEnergyDeviationKcal: 700, confidence: "confirmed" },
    envelope: manualEnvelope("2026-08-12T20:00:00.000+08:00", "capture:meal:1"),
  });
  higherBodyMass.setNow("2026-08-12T21:00:00.000+08:00");
  const higherBodyMassResult = await higherBodyMass.app.runScheduledTimelineRiskEvaluation({
    userId: "u1", idempotencyKey: "higher-body-mass-risk",
  });
  assert.equal(higherBodyMassResult.outcome, "no_review");
  assert.equal(higherBodyMassResult.achievabilityState, "on_path");
  assert.deepEqual(higherBodyMassResult.reasonCodes, ["excess_energy_within_higher_body_mass_buffer"]);

  const leanCut = createApp({ assessment: createFatLossTimelineRiskAssessment() });
  await bootstrap(leanCut.app, {
    horizon: { startDate: "2026-08-08", endDate: "2026-09-05" },
    targetMode: "lean_mass_preserving_fat_loss",
    executionTier: "protect_deadline",
    measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference", "key_lift"] },
  });
  await leanCut.app.recordTimelineFact({
    userId: "u1", idempotencyKey: "lean-cut-meal",
    fact: { kind: "nutrition", observationId: "meal-1", reportedEnergyDeviationKcal: 700, confidence: "confirmed" },
    envelope: manualEnvelope("2026-08-12T20:00:00.000+08:00", "capture:meal:1"),
  });
  leanCut.setNow("2026-08-12T21:00:00.000+08:00");
  const leanCutResult = await leanCut.app.runScheduledTimelineRiskEvaluation({
    userId: "u1", idempotencyKey: "lean-cut-risk",
  });
  assert.equal(leanCutResult.outcome, "review_due");
  assert.equal(leanCutResult.achievabilityState, "at_risk");
  assert.deepEqual(leanCutResult.reasonCodes, ["excess_energy_erodes_lean_cut_buffer"]);
});

test("力量优先减脂的关键缺训与恢复护栏会阻止系统假装仍可守住原路径", async () => {
  const strengthCut = createApp({ assessment: createFatLossTimelineRiskAssessment() });
  await bootstrap(strengthCut.app, {
    targetMode: "strength_priority_cut",
    executionTier: "protect_deadline",
    guardrails: { requiredTrainingCompletion: "key_sessions", minimumRecovery: 4 },
    measurementPlan: { requiredMeasurements: ["body_weight", "key_lift"] },
  });
  await strengthCut.app.recordTimelineFact({
    userId: "u1", idempotencyKey: "missed-key-session",
    fact: { kind: "training", reportedSession: { executionStatus: "missed" }, confidence: "confirmed" },
    envelope: manualEnvelope("2026-08-12T18:00:00.000+08:00", "capture:missed:1"),
  });
  strengthCut.setNow("2026-08-12T19:00:00.000+08:00");
  const missedSession = await strengthCut.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "missed-risk" });
  assert.equal(missedSession.outcome, "review_due");
  assert.equal(missedSession.achievabilityState, "at_risk");
  assert.deepEqual(missedSession.reasonCodes, ["critical_training_miss_strength_guardrail"]);

  await strengthCut.app.recordTimelineFact({
    userId: "u1", idempotencyKey: "recovery-floor",
    fact: { kind: "recovery", perceivedRecovery: 2, confidence: "confirmed" },
    envelope: manualEnvelope("2026-08-13T08:00:00.000+08:00", "capture:recovery:1"),
  });
  strengthCut.setNow("2026-08-13T09:00:00.000+08:00");
  const recoveryFloor = await strengthCut.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "recovery-risk" });
  assert.equal(recoveryFloor.outcome, "review_due");
  assert.equal(recoveryFloor.achievabilityState, "infeasible_under_guardrails");
  assert.deepEqual(recoveryFloor.reasonCodes, ["recovery_below_goal_guardrail"]);
});

test("目标合同默认保护原路径，只有显式 slowdown consent 才可放慢日期、目标或执行负担", async () => {
  const { app } = createApp();
  await bootstrap(app, {
    targetMode: "lean_mass_preserving_fat_loss",
    executionTier: "protect_deadline",
    targets: { targetWeight: { value: 70, unit: "kg" } },
  });
  const current = (await app.readDomainProjection({ userId: "u1" })).goalContract;
  assert.ok(current);
  if (!current) return;
  await assert.rejects(
    app.executeDomainCommand({
      type: "goal_contract.revise", goalContractId: "goal-1", expectedRevision: 1,
      goalContract: { ...current.value, horizon: { startDate: "2026-08-08", endDate: "2027-01-08" } },
      meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1", occurredAt: "2026-08-12T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "silent-slowdown" },
    }),
    /explicit_slowdown_consent_required/,
  );
  const accepted = await app.executeDomainCommand({
    type: "goal_contract.revise", goalContractId: "goal-1", expectedRevision: 1,
    goalContract: {
      ...current.value,
      horizon: { startDate: "2026-08-08", endDate: "2027-01-08" },
      slowdownConsent: { grantedAt: "2026-08-12T08:00:00.000+08:00", allowedChanges: ["deadline"] },
    },
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1", occurredAt: "2026-08-12T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "explicit-slowdown" },
  });
  assert.equal(accepted.status, "committed");
});

function manualEnvelope(at: string, causalRef: string) {
  return {
    time: { startedAt: at, timezoneOffsetMinutes: 480 },
    provenance: {
      origin: "manual" as const,
      recordingMethod: "manual_entry" as const,
      dataStatus: "available" as const,
      confidence: "confirmed" as const,
    },
    privacyClass: "sensitive" as const,
    causalRefs: [causalRef],
    evidenceRefs: [],
    layer: "raw_observation" as const,
  };
}

test("Timeline fact 的连续变动合并为一次最新快照检查，且保留每个来源事实", async () => {
  const assessedRevisions: number[] = [];
  const { app } = createApp({
    assessment: {
      async assess(input) {
        assessedRevisions.push(input.timelineRevision);
        return { status: "review_due", reasonCodes: ["test_review_due"] };
      },
    },
  });
  await bootstrap(app);

  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "chat-reported-meal",
    fact: { kind: "nutrition", observationId: "meal-chat", energy: { value: 1200, unit: "kcal" }, confidence: "confirmed" },
    envelope: manualEnvelope("2026-08-08T12:00:00.000+08:00", "capture:chat:1"),
  });
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "manual-reported-sleep",
    fact: { kind: "sleep", duration: { value: 5, unit: "hours" }, confidence: "confirmed" },
    envelope: manualEnvelope("2026-08-08T23:00:00.000+08:00", "capture:manual:1"),
  });

  const queued = await app.readTimelineRiskEvaluations({ userId: "u1" });
  assert.deepEqual(queued.map((item) => item.disposition), ["material", "coalesced"]);
  assert.deepEqual(queued.map((item) => item.timelineRevision), [1, 2]);
  assert.deepEqual(queued.map((item) => item.sourceFactRefs.length), [1, 2]);

  const checked = await app.runScheduledTimelineRiskEvaluation({
    userId: "u1",
    idempotencyKey: "risk-check:latest",
  });
  assert.equal(checked.disposition, "material");
  assert.equal(checked.outcome, "review_due");
  assert.equal(checked.timelineRevision, 2);
  assert.equal(checked.sourceFactRefs.length, 2);
  assert.deepEqual(assessedRevisions, [2]);
});

test("定时检查只读取最新 Timeline 快照；过期快照和空 Timeline 都不制造失败事实", async () => {
  const { app } = createApp();
  await bootstrap(app);

  const noFacts = await app.runScheduledTimelineRiskEvaluation({
    userId: "u1",
    idempotencyKey: "risk-check:empty",
  });
  assert.equal(noFacts.disposition, "skipped");
  assert.equal(noFacts.outcome, "not_evaluated");
  assert.deepEqual(noFacts.reasonCodes, ["no_timeline_facts"]);

  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "body-1",
    fact: {
      kind: "body",
      measurement: { metric: "body_weight", quantity: { value: 75, unit: "kg" }, condition: "after_waking" },
      confidence: "confirmed",
    },
    envelope: manualEnvelope("2026-08-09T07:00:00.000+08:00", "capture:manual:weight"),
  });
  const stale = await app.runScheduledTimelineRiskEvaluation({
    userId: "u1",
    idempotencyKey: "risk-check:stale",
    expectedTimelineRevision: 0,
  });
  assert.equal(stale.disposition, "stale");
  assert.equal(stale.outcome, "not_evaluated");
  assert.deepEqual(stale.reasonCodes, ["timeline_frontier_advanced"]);
});
