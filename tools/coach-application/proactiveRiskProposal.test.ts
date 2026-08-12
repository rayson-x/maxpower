import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { createFatLossTimelineRiskAssessment } from "../../src/coach/fatLossRiskAssessment";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

test("at-risk Timeline 评估会主动提供仅未来的待确认计划；拒绝或事实前沿变化均不改写当前计划", async () => {
  let sequence = 0;
  let now = "2026-08-08T08:00:00.000+08:00";
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => now, nextId: (prefix) => `${prefix}-${++sequence}` },
    timelineRiskAssessment: createFatLossTimelineRiskAssessment(),
  });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1",
      occurredAt: now, timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap",
    },
    profile: {
      id: "profile-1", trainingExperience: "intermediate", locale: "zh-CN",
      demographics: {
        ageYears: 30, sex: "male",
        height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" },
      },
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: "goal-1", primaryGoal: "fat_loss_preserve_lean_mass", goalType: "fat_loss",
      targetMode: "lean_mass_preserving_fat_loss", executionTier: "protect_deadline",
      horizon: { startDate: "2026-08-08", endDate: "2026-09-05" }, status: "active",
      aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength" },
      measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference", "key_lift"] },
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  const initial = await app.createPlanningPreview({
    userId: "u1", currentDate: "2026-08-08", trigger: "initial_plan", idempotencyKey: "initial-preview",
  });
  assert.equal(initial.planningPreview?.status, "awaiting_confirmation");
  await app.confirmPlanningPreview({ userId: "u1", previewId: initial.id, idempotencyKey: "initial-confirm" });
  const initialPlanRevision = (await app.readDomainProjection({ userId: "u1" })).plan?.revision;
  assert.ok(initialPlanRevision);

  await recordDeviation(app, now, "first-deviation", 700);
  const risk = await app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "first-risk" });
  assert.equal(risk.achievabilityState, "at_risk");

  const firstProposal = await latestAutoRiskPreview(ledger);
  assert.equal(firstProposal.planningPreview?.status, "awaiting_confirmation");
  assert.equal(firstProposal.planningPreview?.sourceRiskEvaluationId, risk.id);
  assert.equal(firstProposal.planningPreview?.request.requestedScope, "future_plan");
  assert.equal((await ledger.read()).artifacts.some(
    (artifact) => artifact.kind === "planner_progress" && artifact.stage === "proposal_ready",
  ), true);
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan?.revision, initialPlanRevision);
  const product = await app.readProductProjection({
    userId: "u1", date: "2026-08-08", timezoneOffsetMinutes: 480, calendarMode: "week", calendarAnchorDate: "2026-08-08",
  });
  assert.equal(product.plan.latestPlanningPreview?.id, firstProposal.id);

  await app.rejectPlanningPreview({ userId: "u1", previewId: firstProposal.id, idempotencyKey: "first-reject" });
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan?.revision, initialPlanRevision);

  now = "2026-08-09T08:00:00.000+08:00";
  await recordDeviation(app, now, "second-deviation", 700);
  const secondRisk = await app.runScheduledTimelineRiskEvaluation({ userId: "u1", idempotencyKey: "second-risk" });
  const secondProposal = await latestAutoRiskPreview(ledger);
  assert.notEqual(secondProposal.id, firstProposal.id);
  assert.equal(secondProposal.planningPreview?.sourceRiskEvaluationId, secondRisk.id);

  now = "2026-08-09T09:00:00.000+08:00";
  await recordDeviation(app, now, "newer-fact", 100);
  await assert.rejects(
    app.confirmPlanningPreview({ userId: "u1", previewId: secondProposal.id, idempotencyKey: "stale-confirm" }),
    /planning_preview_stale/,
  );
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan?.revision, initialPlanRevision);
});

async function recordDeviation(app: CoachApplication, occurredAt: string, idempotencyKey: string, kcal: number) {
  return app.recordTimelineFact({
    userId: "u1", idempotencyKey,
    fact: { kind: "nutrition", observationId: idempotencyKey, reportedEnergyDeviationKcal: kcal, confidence: "confirmed" },
    envelope: {
      time: { startedAt: occurredAt, timezoneOffsetMinutes: 480 },
      provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "sensitive", causalRefs: [`capture:${idempotencyKey}`], evidenceRefs: [], layer: "raw_observation",
    },
  });
}

async function latestAutoRiskPreview(ledger: InMemoryCoachLedger) {
  const snapshots = await ledger.read();
  const artifact = [...snapshots.artifacts].reverse().find(
    (item) => item.kind === "evidence_brief" && Boolean(item.planningPreview?.sourceRiskEvaluationId),
  );
  assert.ok(artifact && artifact.kind === "evidence_brief", "at risk 应产生可确认的未来计划预览");
  return artifact;
}
