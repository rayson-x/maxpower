import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import {
  createGoalSpecificRiskAssessmentPort,
  type GoalSpecificRiskSnapshot,
} from "../../src/coach/goalSpecificRisk";

function createApp(snapshot: GoalSpecificRiskSnapshot) {
  let sequence = 0;
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-13T08:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    timelineRiskAssessment: createGoalSpecificRiskAssessmentPort({
      async load() { return snapshot; },
    }),
  });
  return app;
}

async function bootstrapAndRecordWeight(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1",
      occurredAt: "2026-08-13T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "intermediate", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-13" } },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  await app.recordTimelineFact({
    userId: "u1", idempotencyKey: "scale-reading",
    fact: {
      kind: "body",
      measurement: { metric: "body_weight", quantity: { value: 76, unit: "kg" }, condition: "after_waking" },
      confidence: "confirmed",
    },
    envelope: {
      time: { startedAt: "2026-08-13T07:00:00.000+08:00", timezoneOffsetMinutes: 480 },
      provenance: { origin: "smart_scale", recordingMethod: "device_measurement", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "sensitive", causalRefs: ["scale:1"], evidenceRefs: [], layer: "raw_observation",
    },
  });
  return app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "scheduled" });
}

const comparableShoulderMeasurements = [
  { protocolId: "tape:morning", metric: "circumference" as const, site: "shoulder", observedAt: "2026-07-01", value: 112, unit: "cm" as const, confidence: "confirmed" as const },
  { protocolId: "tape:morning", metric: "circumference" as const, site: "shoulder", observedAt: "2026-08-12", value: 113, unit: "cm" as const, confidence: "confirmed" as const },
];

test("增肌模式不把一次体重或 BIA 读数当作肌肉成果，缺少可比目标肌群测量时要求证据", async () => {
  const result = await bootstrapAndRecordWeight(createApp({
    mode: "hypertrophy",
    contract: {
      targetMuscles: ["shoulder"],
      measurements: [{ protocolId: "tape:morning", metric: "circumference", site: "shoulder", required: true }],
      protection: { recovery: "required", targetMuscleMinimumDose: "required" },
    },
    observations: {
      measurements: [{ protocolId: "bia:scale", metric: "body_fat_percentage", observedAt: "2026-08-13", value: 16, unit: "percent", confidence: "estimated" }],
      targetMuscleDose: "met", recovery: "adequate",
    },
  }));

  assert.equal(result.outcome, "insufficient_evidence");
  assert.deepEqual(result.reasonCodes, ["hypertrophy_required_measurement_missing:shoulder"]);
});

test("同一体重 Timeline 事实进入不同目标谓词：减脂偏离需复查，增肌与塑形不以体重本身判定失败", async () => {
  const fatLoss = await bootstrapAndRecordWeight(createApp({
    mode: "fat_loss",
    observations: { energyPath: "behind" },
  }));
  const hypertrophy = await bootstrapAndRecordWeight(createApp({
    mode: "hypertrophy",
    contract: {
      targetMuscles: ["shoulder"],
      measurements: [{ protocolId: "tape:morning", metric: "circumference", site: "shoulder", required: true }],
      protection: { recovery: "required", targetMuscleMinimumDose: "required" },
    },
    observations: { measurements: comparableShoulderMeasurements, targetMuscleDose: "met", recovery: "adequate" },
  }));
  const physique = await bootstrapAndRecordWeight(createApp({
    mode: "physique",
    contract: {
      appearancePreference: "shoulder_to_waist",
      measurements: [
        { protocolId: "tape:morning", metric: "circumference", site: "shoulder", required: true },
        { protocolId: "tape:morning", metric: "circumference", site: "waist", required: true },
      ],
      protection: { recovery: "required", targetMuscleMinimumDose: "required" },
    },
    observations: {
      measurements: [
        ...comparableShoulderMeasurements,
        { protocolId: "tape:morning", metric: "circumference", site: "waist", observedAt: "2026-07-01", value: 86, unit: "cm" as const, confidence: "confirmed" },
        { protocolId: "tape:morning", metric: "circumference", site: "waist", observedAt: "2026-08-12", value: 85, unit: "cm" as const, confidence: "confirmed" },
      ],
      targetMuscleDose: "met", recovery: "adequate",
    },
  }));

  assert.equal(fatLoss.outcome, "review_due");
  assert.deepEqual(fatLoss.reasonCodes, ["fat_loss_energy_path_behind"]);
  assert.equal(hypertrophy.outcome, "no_review");
  assert.deepEqual(hypertrophy.reasonCodes, ["hypertrophy_predicates_on_path"]);
  assert.equal(physique.outcome, "no_review");
  assert.deepEqual(physique.reasonCodes, ["physique_predicates_on_path"]);
});

test("塑形模式在可比围度恶化或恢复护栏失守时复查，不承诺审美结果", async () => {
  const result = await bootstrapAndRecordWeight(createApp({
    mode: "physique",
    contract: {
      appearancePreference: "shoulder_to_waist",
      measurements: [
        { protocolId: "tape:morning", metric: "circumference", site: "shoulder", required: true },
        { protocolId: "tape:morning", metric: "circumference", site: "waist", required: true },
      ],
      protection: { recovery: "required", targetMuscleMinimumDose: "required" },
    },
    observations: {
      measurements: [
        ...comparableShoulderMeasurements,
        { protocolId: "tape:morning", metric: "circumference", site: "waist", observedAt: "2026-07-01", value: 86, unit: "cm" as const, confidence: "confirmed" },
        { protocolId: "tape:morning", metric: "circumference", site: "waist", observedAt: "2026-08-12", value: 88, unit: "cm" as const, confidence: "confirmed" },
      ],
      targetMuscleDose: "met", recovery: "degraded",
    },
  }));

  assert.equal(result.outcome, "review_due");
  assert.deepEqual(result.reasonCodes, ["physique_recovery_guardrail_breached", "physique_waist_trend_regressed"]);
});
