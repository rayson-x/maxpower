import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { createExecutionContinuityRiskAssessment, type ExecutionContinuityRiskSnapshot } from "../../src/coach/executionContinuityRisk";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { createFatLossTimelineRiskAssessment } from "../../src/coach/fatLossRiskAssessment";

function createApp(snapshot: ExecutionContinuityRiskSnapshot) {
  let sequence = 0;
  const assessment = createExecutionContinuityRiskAssessment({
    base: createFatLossTimelineRiskAssessment(),
    source: { async load() { return snapshot; } },
  });
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-13T08:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    timelineRiskAssessment: assessment,
  });
  return { app, assessment };
}

async function bootstrap(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1",
      occurredAt: "2026-08-01T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "intermediate", locale: "zh-CN" },
    goalContract: {
      id: "goal-1", primaryGoal: "fat_loss_preserve_lean_mass",
      targetMode: "lean_mass_preserving_fat_loss", executionTier: "protect_deadline",
      horizon: { startDate: "2026-08-01", endDate: "2026-10-01" },
      measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference"] },
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  await app.recordTimelineFact({
    userId: "u1", idempotencyKey: "weight-evidence",
    fact: {
      kind: "body",
      measurement: { metric: "body_weight", quantity: { value: 75, unit: "kg" }, condition: "after_waking" },
      confidence: "confirmed",
    },
    envelope: {
      time: { startedAt: "2026-08-12T07:00:00.000+08:00", timezoneOffsetMinutes: 480 },
      provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "sensitive", causalRefs: ["capture:weight"], evidenceRefs: [], layer: "raw_observation",
    },
  });
  await app.recordTimelineFact({
    userId: "u1", idempotencyKey: "waist-evidence",
    fact: {
      kind: "body",
      measurement: { metric: "circumference", site: "waist", quantity: { value: 86, unit: "cm" }, condition: "after_waking" },
      confidence: "confirmed",
    },
    envelope: {
      time: { startedAt: "2026-08-12T07:05:00.000+08:00", timezoneOffsetMinutes: 480 },
      provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "sensitive", causalRefs: ["capture:waist"], evidenceRefs: [], layer: "raw_observation",
    },
  });
  await app.recordTimelineFact({
    userId: "u1", idempotencyKey: "timeline-trigger",
    fact: {
      kind: "nutrition", observationId: "meal-1", reportedEnergyDeviationKcal: 0, confidence: "confirmed",
    },
    envelope: {
      time: { startedAt: "2026-08-13T07:00:00.000+08:00", timezoneOffsetMinutes: 480 },
      provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "sensitive", causalRefs: ["capture:1"], evidenceRefs: [], layer: "raw_observation",
    },
  });
}

function evidence(overrides: Partial<ExecutionContinuityRiskSnapshot> = {}): ExecutionContinuityRiskSnapshot {
  return {
    execution: {
      coverage: "high",
      energyPath: "on_path",
      diet: [
        { occurredAt: "2026-08-05T20:00:00.000+08:00", status: "within_tolerance" },
        { occurredAt: "2026-08-07T20:00:00.000+08:00", status: "within_tolerance" },
        { occurredAt: "2026-08-09T20:00:00.000+08:00", status: "within_tolerance" },
      ],
      keyTraining: [
        { occurredAt: "2026-08-06T18:00:00.000+08:00", status: "completed" },
        { occurredAt: "2026-08-10T18:00:00.000+08:00", status: "completed" },
      ],
    },
    trend: { measurementQuality: "comparable", bodyWeight: "improving", waist: "improving" },
    recovery: "adequate",
    ...overrides,
  };
}

test("单次偏差不等同执行失败，连续关键失败、恶化趋势和低覆盖分别改变路径判断", async () => {
  const single = createApp(evidence({
    execution: {
      coverage: "high", energyPath: "on_path",
      diet: [{ occurredAt: "2026-08-12T20:00:00.000+08:00", status: "outside_tolerance" }],
      keyTraining: [{ occurredAt: "2026-08-10T18:00:00.000+08:00", status: "completed" }],
    },
  }));
  await bootstrap(single.app);
  const singleResult = await single.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "single" });
  assert.equal(singleResult.achievabilityState, "on_path");
  assert.deepEqual(singleResult.reasonCodes, ["single_execution_deviation_observed"]);

  const energyBehind = createApp(evidence({
    execution: {
      coverage: "high", energyPath: "behind",
      diet: [{ occurredAt: "2026-08-12T20:00:00.000+08:00", status: "within_tolerance" }],
      keyTraining: [{ occurredAt: "2026-08-10T18:00:00.000+08:00", status: "completed" }],
    },
  }));
  await bootstrap(energyBehind.app);
  const energyBehindResult = await energyBehind.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "energy-behind" });
  assert.equal(energyBehindResult.achievabilityState, "at_risk");
  assert.deepEqual(energyBehindResult.reasonCodes, ["execution_energy_path_behind"]);

  const repeated = createApp(evidence({
    execution: {
      coverage: "high", energyPath: "on_path",
      diet: [
        { occurredAt: "2026-08-09T20:00:00.000+08:00", status: "within_tolerance" },
        { occurredAt: "2026-08-11T20:00:00.000+08:00", status: "outside_tolerance" },
        { occurredAt: "2026-08-12T20:00:00.000+08:00", status: "outside_tolerance" },
      ],
      keyTraining: [
        { occurredAt: "2026-08-10T18:00:00.000+08:00", status: "missed" },
        { occurredAt: "2026-08-13T18:00:00.000+08:00", status: "partial" },
      ],
    },
  }));
  await bootstrap(repeated.app);
  const repeatedResult = await repeated.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "repeated" });
  assert.equal(repeatedResult.achievabilityState, "at_risk");
  assert.ok(repeatedResult.reasonCodes.includes("execution_failure_run_detected"));
  assert.ok(repeatedResult.reasonCodes.includes("execution_failure_rate_worsening"));

  const sparse = createApp(evidence({
    execution: { coverage: "low", energyPath: "unknown", diet: [], keyTraining: [] },
  }));
  await bootstrap(sparse.app);
  const sparseResult = await sparse.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "sparse" });
  assert.equal(sparseResult.achievabilityState, "insufficient_evidence");
  assert.deepEqual(sparseResult.reasonCodes, ["execution_record_coverage_low"]);
});

test("体重平但腰围改善不是平台；高质量双指标停滞才形成一个未来、待确认的单变量实验", async () => {
  const improvingWaist = createApp(evidence({
    trend: { measurementQuality: "comparable", bodyWeight: "flat", waist: "improving" },
  }));
  await bootstrap(improvingWaist.app);
  const improvedResult = await improvingWaist.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "waist-improving" });
  assert.equal(improvedResult.achievabilityState, "on_path");
  assert.deepEqual(improvedResult.reasonCodes, ["waist_trend_improving_weight_flat"]);

  const plateau = createApp(evidence({
    trend: { measurementQuality: "comparable", bodyWeight: "flat", waist: "flat" },
  }));
  await bootstrap(plateau.app);
  const plateauResult = await plateau.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "plateau" });
  assert.equal(plateauResult.achievabilityState, "at_risk");
  assert.deepEqual(plateauResult.reasonCodes, ["candidate_response_plateau"]);

  const decision = await plateau.assessment.assessState({
    userId: "u1", timelineRevision: 1, factFrontier: [], sourceFactRefs: [], causationIds: [],
    evaluatedAt: "2026-08-13T08:00:00.000+08:00",
  });
  assert.equal(decision.adjustment?.confirmationRequired, true);
  assert.equal(decision.adjustment?.effectiveTiming, "future_only");
  assert.equal(decision.adjustment?.variables.length, 1);
  assert.deepEqual(decision.adjustment?.variables, ["daily_activity"]);
});

test("恢复下降时，停滞不会自动强化计划", async () => {
  const decliningRecovery = createApp(evidence({
    trend: { measurementQuality: "comparable", bodyWeight: "flat", waist: "flat" },
    recovery: "degraded",
  }));
  await bootstrap(decliningRecovery.app);
  const result = await decliningRecovery.app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "recovery" });
  assert.equal(result.achievabilityState, "at_risk");
  assert.deepEqual(result.reasonCodes, ["recovery_degraded_blocks_plateau_adjustment"]);
  const decision = await decliningRecovery.assessment.assessState({
    userId: "u1", timelineRevision: 1, factFrontier: [], sourceFactRefs: [], causationIds: [],
    evaluatedAt: "2026-08-13T08:00:00.000+08:00",
  });
  assert.equal(decision.adjustment, undefined);
});
