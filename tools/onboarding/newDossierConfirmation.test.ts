import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = {
    now: () => "2026-08-14T11:00:00.000+08:00",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  return { app: new CoachApplication({ ledger, runtime }) };
}

test("新档案确认只编译已采集的 baseline、目标与训练背景，不要求旧固定 section 或训练等级", async () => {
  const { app } = fixture();
  const draft = await app.startOrResumeBaselineIntake({ userId: "new-dossier-user" });
  const source = { kind: "form_submission" as const, submissionId: "baseline-card" };
  const filled = await app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      goalNarrative: { text: "想把体脂率降到 12%，目前约 16%，同时保持力量", observedAt: "2026-08-14T11:00:00.000+08:00", source },
    },
  });
  const scheduled = await app.captureOnboardingDynamicFields({
    draftId: draft.id,
    expectedDraftRevision: filled.revision,
    inputMode: "form",
    idempotencyKey: "schedule",
    captures: [{
      fieldId: "profile.training_schedule",
      state: "captured_explicit",
      value: { days_per_week: 4, minutes_per_session: 75 },
      observedAt: "2026-08-14T11:00:00.000+08:00",
      source,
    }],
  });
  const background = await app.captureTrainingBackground({
    draftId: draft.id,
    expectedDraftRevision: scheduled.revision,
    inputMode: "form",
    idempotencyKey: "background",
    background: {
      capturedAt: "2026-08-14T11:00:00.000+08:00",
      source,
      recentContinuity: { consecutiveWeeks: 12, usualSessionsPerWeek: 4 },
      recentSplit: ["chest", "back", "legs", "shoulders"],
    },
  });
  const summary = await app.readOnboardingDossierSummary({ draftId: draft.id });
  const staged = await app.stageOnboardingDossierConfirmation({
    userId: draft.userId,
    draftId: draft.id,
    expectedDraftRevision: background.revision,
    expectedFactFrontier: summary.confirmation.factFrontier,
    idempotencyKey: "confirm-new-dossier",
  });
  await staged.commitAcknowledged();

  const domain = await app.readDomainProjection({ userId: draft.userId });
  assert.equal(domain.profile?.value.trainingExperience, "unknown");
  assert.deepEqual(domain.profile?.value.schedule, { weeklyFrequency: 4, sessionDurationMinutes: 75 });
  assert.deepEqual(domain.profile?.value.locations, undefined);
  assert.equal(domain.profile?.value.returningStatus, undefined);
  assert.equal(domain.goalContract?.value.primaryGoal, "fat_loss_preserve_lean_mass");
  assert.deepEqual(domain.goalContract?.value.horizon, { startDate: "2026-08-14" });
  assert.equal(domain.mandate?.value.mode, "manual");
  assert.equal(domain.permissions?.value.remoteLlm, "not_configured");
  assert.equal(domain.safetyConstraints[0]?.value.reasons.includes("pregnancy_or_postpartum_special_consideration"), false);
  assert.equal(domain.safetyConstraints[0]?.value.reasons.includes("eating_disorder_or_low_energy_risk_declared"), false);
  assert.equal((await app.readOnboardingEntryState({ userId: draft.userId })).status, "dossier_complete");

  const handoff = await app.createFirstPlannerHandoff({
    userId: draft.userId,
    draftId: draft.id,
    currentDate: "2026-08-14",
    idempotencyKey: "new-dossier-first-plan",
  });
  assert.equal(handoff.status, "needs_input");
  assert.ok(handoff.needsInput.includes("coaching_level_assessment_or_first_session_calibration"));
  assert.equal(handoff.plan, undefined);
});

test("新档案不会把模糊目标或未成年年龄伪装成可确认档案", async () => {
  const { app } = fixture();
  const draft = await app.startOrResumeBaselineIntake({ userId: "new-dossier-incomplete" });
  const source = { kind: "form_submission" as const, submissionId: "baseline-card" };
  const filled = await app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    idempotencyKey: "baseline",
    values: {
      age: { ageYears: 17, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      goalNarrative: { text: "状态变得更好", observedAt: "2026-08-14T11:00:00.000+08:00", source },
    },
  });
  const summary = await app.readOnboardingDossierSummary({ draftId: draft.id });
  await assert.rejects(
    app.stageOnboardingDossierConfirmation({
      userId: draft.userId,
      draftId: draft.id,
      expectedDraftRevision: filled.revision,
      expectedFactFrontier: summary.confirmation.factFrontier,
      idempotencyKey: "confirm-incomplete",
    }),
    /adult_confirmation_required/,
  );
});

test("训练背景校准会写入独立评估，并让新档案生成待确认的首个计划", async () => {
  const { app } = fixture();
  const draft = await app.startOrResumeBaselineIntake({ userId: "calibrated-new-dossier-user" });
  const source = { kind: "form_submission" as const, submissionId: "calibration-card" };
  const filled = await app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-14T11:00:00.000+08:00", source },
      goalNarrative: { text: "减脂并尽量保持力量", observedAt: "2026-08-14T11:00:00.000+08:00", source },
    },
  });
  const energyContext = await app.captureOnboardingDynamicFields({
    draftId: draft.id,
    expectedDraftRevision: filled.revision,
    inputMode: "form",
    idempotencyKey: "energy-context",
    captures: [
      { fieldId: "profile.sex", state: "captured_explicit", value: "male", observedAt: "2026-08-14T11:00:00.000+08:00", source },
      { fieldId: "timeline.daily_activity", state: "captured_explicit", value: "sedentary_remote_work", observedAt: "2026-08-14T11:00:00.000+08:00", source },
    ],
  });
  const background = await app.captureTrainingBackground({
    draftId: draft.id,
    expectedDraftRevision: energyContext.revision,
    inputMode: "form",
    idempotencyKey: "training-calibration",
    background: {
      capturedAt: "2026-08-14T11:00:00.000+08:00",
      source,
      recentContinuity: { consecutiveWeeks: 12, usualSessionsPerWeek: 4 },
      recentSplit: ["胸", "背", "腿", "肩"],
      environments: ["gym"],
      availableEquipment: ["full_gym"],
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
    },
  });
  const assessment = await app.assessCoachingLevel({
    draftId: draft.id,
    expectedDraftRevision: background.revision,
    idempotencyKey: "training-calibration-assessment",
  });
  assert.equal(assessment.priority, "multi_dimensional_assessment");

  const summary = await app.readOnboardingDossierSummary({ draftId: draft.id });
  const staged = await app.stageOnboardingDossierConfirmation({
    userId: draft.userId,
    draftId: draft.id,
    expectedDraftRevision: summary.draftRevision,
    expectedFactFrontier: summary.confirmation.factFrontier,
    idempotencyKey: "confirm-calibrated-new-dossier",
  });
  await staged.commitAcknowledged();

  const profile = (await app.readDomainProjection({ userId: draft.userId })).profile?.value;
  assert.equal(profile?.trainingExperience, "unknown");
  assert.equal(profile?.demographics?.sex, "male");
  assert.equal(profile?.dailyActivityLevel, "sedentary");
  assert.deepEqual(profile?.locations, [{
    id: "onboarding:full_gym",
    kind: "gym",
    environment: { space: "large", noise: "any" },
    availableEquipment: ["full_gym"],
  }]);

  const handoff = await app.createFirstPlannerHandoff({
    userId: draft.userId,
    draftId: draft.id,
    currentDate: "2026-08-14",
    idempotencyKey: "calibrated-new-dossier-first-plan",
  });
  assert.equal(handoff.status, "awaiting_confirmation");
  assert.equal(handoff.needsInput.length, 0);
  assert.ok(handoff.plan);
});
