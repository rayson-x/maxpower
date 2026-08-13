import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = {
    now: () => "2026-08-14T09:30:00.000+08:00",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  return { ledger, app: new CoachApplication({ ledger, runtime }) };
}

const completePatch = {
  profile: {
    adultConfirmed: true,
    trainingExperience: "beginner" as const,
    returningStatus: "new" as const,
    schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
    locations: [{ id: "gym", kind: "gym" as const, environment: { space: "large" as const, noise: "moderate" as const }, availableEquipment: ["barbell"] }],
    bodyDirection: "decrease_body_fat" as const,
  },
  goal: {
    primaryGoal: "fat_loss_preserve_lean_mass" as const,
    horizon: { startDate: "2026-08-14", endDate: "2026-11-14" },
    successMetrics: ["waist_and_weight_trend"],
  },
  mandate: {
    mode: "collaborative" as const,
    scopes: { loadReps: "confirm" as const, volume: "confirm" as const, substitution: "confirm" as const, schedule: "confirm" as const, deload: "confirm" as const, nutrition: "advice_only" as const },
  },
  permissions: { camera: "not_configured" as const, health: "not_configured" as const, notifications: "not_configured" as const, remoteLlm: "not_configured" as const, cloudSync: "not_configured" as const, mediaUpload: "not_configured" as const },
  safety: { adultConfirmed: true, professionalRestriction: false, recentSurgeryOrAcuteInjury: false, pregnancyOrPostpartumSpecialConsideration: false, eatingDisorderOrLowEnergyRiskDeclared: false, stopSignals: [] },
};

async function completedDraft(app: CoachApplication, userId = "dossier-user") {
  const draft = await app.startOnboarding({ userId, depth: "basic" });
  return app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "conversation",
    patch: completePatch,
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
    idempotencyKey: `${userId}:progress`,
  });
}

test("档案摘要按所有者与可信状态展示草稿，不把评估、unknown 或 Timeline 基线伪装成 Profile 事实", async () => {
  const { app } = fixture();
  const draft = await completedDraft(app);
  const summary = await app.readOnboardingDossierSummary({ draftId: draft.id });

  assert.equal(summary.draftRevision, draft.revision);
  assert.equal(summary.userFacts.profile?.trainingExperience, "beginner");
  assert.equal(summary.goalContract?.primaryGoal, "fat_loss_preserve_lean_mass");
  assert.deepEqual(summary.timelineMeasurements, []);
  assert.equal(summary.coachingLevelAssessment, undefined);
  assert.equal(summary.workingMemory.authority, "non_authoritative");
  assert.equal(summary.unknowns.includes("body_measurements"), true);
  assert.equal(summary.confirmation.factFrontier.length, 0);
});

test("确认绑定摘要 revision 与 fact frontier；仅 ACK 后发布，stale 或重试不会重复写入", async () => {
  const { app } = fixture();
  const draft = await completedDraft(app);
  const summary = await app.readOnboardingDossierSummary({ draftId: draft.id });
  await app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "conversation",
    patch: { profile: { nutritionPreferences: ["high_protein"] } },
    confirmedSections: [],
    idempotencyKey: "post-summary-correction",
  });
  await assert.rejects(
    app.stageOnboardingDossierConfirmation({
      userId: draft.userId,
      draftId: draft.id,
      expectedDraftRevision: summary.draftRevision,
      expectedFactFrontier: summary.confirmation.factFrontier,
      idempotencyKey: "stale-confirmation",
    }),
    { message: /stale_dossier_confirmation/ },
  );

  const refreshed = await app.readOnboardingDossierSummary({ draftId: draft.id });
  await assert.rejects(
    app.stageOnboardingDossierConfirmation({
      userId: "another-account",
      draftId: draft.id,
      expectedDraftRevision: refreshed.draftRevision,
      expectedFactFrontier: refreshed.confirmation.factFrontier,
      idempotencyKey: "cross-account",
    }),
    { message: /draft_user_mismatch/ },
  );
  const staged = await app.stageOnboardingDossierConfirmation({
    userId: draft.userId,
    draftId: draft.id,
    expectedDraftRevision: refreshed.draftRevision,
    expectedFactFrontier: refreshed.confirmation.factFrontier,
    idempotencyKey: "confirmed-dossier",
  });
  assert.equal((await app.readDomainProjection({ userId: draft.userId })).profile, undefined);
  await staged.commitAcknowledged();
  assert.equal((await app.readDomainProjection({ userId: draft.userId })).profile?.value.id, `profile:${draft.userId}`);
  assert.equal((await app.readOnboardingEntryState({ userId: draft.userId })).status, "dossier_complete");

  const retry = await app.stageOnboardingDossierConfirmation({
    userId: draft.userId,
    draftId: draft.id,
    expectedDraftRevision: refreshed.draftRevision,
    expectedFactFrontier: refreshed.confirmation.factFrontier,
    idempotencyKey: "confirmed-dossier",
  });
  await retry.commitAcknowledged();
  assert.equal((await app.readDomainProjection({ userId: draft.userId })).safetyConstraints.length, 1);
});
