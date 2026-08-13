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
  return { ledger, app: new CoachApplication({ ledger, runtime }) };
}

async function completedExperiencedDossier(app: CoachApplication) {
  const draft = await app.startOnboarding({ userId: "first-plan-user", depth: "basic" });
  const background = await app.captureTrainingBackground({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    inputMode: "conversation",
    idempotencyKey: "background",
    background: {
      capturedAt: "2026-08-14T11:00:00.000+08:00",
      source: { kind: "conversation_message", messageId: "background-message" },
      recentContinuity: { consecutiveWeeks: 16, usualSessionsPerWeek: 4 },
      recentSplit: ["chest", "back", "legs", "shoulders"],
      exactExerciseFamiliarity: ["barbell_back_squat", "barbell_bench_press", "conventional_deadlift"],
      comparableSets: [
        { exerciseVariantId: "barbell_back_squat", load: { value: 100, unit: "kg" }, reps: 3, performedOn: "2026-08-12" },
        { exerciseVariantId: "barbell_bench_press", load: { value: 80, unit: "kg" }, reps: 5, performedOn: "2026-08-12" },
        { exerciseVariantId: "conventional_deadlift", load: { value: 110, unit: "kg" }, reps: 4, performedOn: "2026-08-12" },
      ],
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      executionStability: "reported_consistent",
    },
  });
  await app.assessCoachingLevel({
    draftId: draft.id,
    expectedDraftRevision: background.revision,
    idempotencyKey: "assessment",
  });
  const filled = await app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "conversation",
    idempotencyKey: "formal-dossier",
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
    // This deliberately says beginner. The first-plan handoff must use the
    // independently assessed training background, never this legacy label.
    patch: {
      profile: {
        adultConfirmed: true,
        trainingExperience: "beginner",
        returningStatus: "consistent",
        demographics: {
          ageYears: 30,
          sex: "male",
          height: { value: 178, unit: "cm" },
          currentWeight: { value: 75, unit: "kg" },
        },
        schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
        locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
        bodyDirection: "decrease_body_fat",
      },
      goal: {
        primaryGoal: "fat_loss_preserve_lean_mass",
        horizon: { startDate: "2026-08-14", endDate: "2026-11-14" },
        successMetrics: ["waist_and_weight_trend"],
      },
      mandate: { mode: "collaborative", scopes: { loadReps: "confirm", volume: "confirm", substitution: "confirm", schedule: "confirm", deload: "confirm", nutrition: "advice_only" } },
      permissions: { camera: "not_configured", health: "not_configured", notifications: "not_configured", remoteLlm: "not_configured", cloudSync: "not_configured", mediaUpload: "not_configured" },
      safety: { adultConfirmed: true, professionalRestriction: false, recentSurgeryOrAcuteInjury: false, pregnancyOrPostpartumSpecialConsideration: false, eatingDisorderOrLowEnergyRiskDeclared: false, stopSignals: [] },
    },
  });
  const summary = await app.readOnboardingDossierSummary({ draftId: draft.id });
  const staged = await app.stageOnboardingDossierConfirmation({
    userId: draft.userId,
    draftId: draft.id,
    expectedDraftRevision: filled.revision,
    expectedFactFrontier: summary.confirmation.factFrontier,
    idempotencyKey: "dossier-confirm",
  });
  await staged.commitAcknowledged();
  return draft;
}

test("首次 Planner 只消费已确认档案、评估与新版知识；四分化证据不会被 legacy beginner 降级", async () => {
  const { app } = fixture();
  const draft = await completedExperiencedDossier(app);

  const proposal = await app.createFirstPlannerHandoff({
    userId: draft.userId,
    draftId: draft.id,
    currentDate: "2026-08-14",
    idempotencyKey: "first-plan",
  });

  assert.equal(proposal.status, "awaiting_confirmation");
  assert.equal(proposal.assessment?.dimensions.currentComparablePerformance.status, "supported");
  assert.equal(proposal.readiness.status, "unassessed");
  assert.equal(proposal.knowledge.backend, "agent_knowledge");
  assert.equal("legacyPackPin" in proposal.knowledge, false);
  assert.deepEqual(proposal.plan?.week.sessions.map((session) => session.id), ["chest", "back", "legs", "shoulders"]);
  assert.ok(proposal.evidenceRefs.some((ref) => ref.includes("coaching_level_assessment")));
  assert.ok(proposal.rulePins.length > 0);
  assert.equal((await app.readDomainProjection({ userId: draft.userId })).plan, undefined, "计划确认前不能有活动计划");
});

test("首次计划确认独立于档案；Timeline/frontier 改变会令旧 proposal stale，重试不创建第二份计划", async () => {
  const { app } = fixture();
  const draft = await completedExperiencedDossier(app);
  const proposal = await app.createFirstPlannerHandoff({
    userId: draft.userId,
    draftId: draft.id,
    currentDate: "2026-08-14",
    idempotencyKey: "first-plan",
  });
  await app.recordTimelineFact({
    userId: draft.userId,
    idempotencyKey: "new-timeline-fact",
    fact: { kind: "sleep", duration: { value: 420, unit: "minutes" }, confidence: "confirmed" },
    envelope: {
      time: { startedAt: "2026-08-14T08:00:00.000+08:00", timezoneOffsetMinutes: 480 },
      provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "private",
      causalRefs: [],
      evidenceRefs: [],
      layer: "raw_observation",
    },
  });
  await assert.rejects(
    app.confirmFirstPlannerHandoff({ userId: draft.userId, proposalId: proposal.id, idempotencyKey: "confirm-stale" }),
    /first_planner_proposal_stale/,
  );
  assert.equal((await app.readOnboardingEntryState({ userId: draft.userId })).status, "dossier_complete", "拒绝或 stale 计划不撤销已完成档案");

  const refreshed = await app.createFirstPlannerHandoff({
    userId: draft.userId,
    draftId: draft.id,
    currentDate: "2026-08-14",
    idempotencyKey: "first-plan-refreshed",
  });
  const confirmed = await app.confirmFirstPlannerHandoff({ userId: draft.userId, proposalId: refreshed.id, idempotencyKey: "confirm-fresh" });
  assert.equal(confirmed.status, "confirmed");
  assert.ok((await app.readDomainProjection({ userId: draft.userId })).plan, "确认后的首次计划必须成为活动计划");
  const retry = await app.confirmFirstPlannerHandoff({ userId: draft.userId, proposalId: refreshed.id, idempotencyKey: "confirm-fresh" });
  assert.equal(retry.id, confirmed.id);
});
