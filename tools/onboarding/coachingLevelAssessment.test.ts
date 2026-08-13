import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  return {
    app: new CoachApplication({
      ledger,
      runtime: {
        now: () => "2026-08-14T10:00:00.000+08:00",
        nextId: (prefix: string) => `${prefix}-${++sequence}`,
      },
    }),
  };
}

const source = { kind: "conversation_message", messageId: "training-history-message" } as const;

test("教练等级评估从可复核的训练背景生成，不要求用户自选等级", async () => {
  const { app } = fixture();
  const draft = await app.startOnboarding({ userId: "experienced-user", depth: "basic" });
  const background = await app.captureTrainingBackground({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    inputMode: "conversation",
    idempotencyKey: "experienced-background",
    background: {
      capturedAt: "2026-08-14T10:00:00.000+08:00",
      source,
      cumulativeTrainingMonths: { minimum: 12, maximum: 36 },
      recentContinuity: { consecutiveWeeks: 16, usualSessionsPerWeek: 4 },
      recentSplit: ["legs", "chest", "back", "shoulders"],
      exactExerciseFamiliarity: ["barbell_back_squat", "barbell_bench_press", "conventional_deadlift"],
      comparableSets: [
        { exerciseVariantId: "barbell_back_squat", load: { value: 100, unit: "kg" }, reps: 3, performedOn: "2026-08-12" },
        { exerciseVariantId: "barbell_bench_press", load: { value: 80, unit: "kg" }, reps: 5, performedOn: "2026-08-12" },
        { exerciseVariantId: "conventional_deadlift", load: { value: 110, unit: "kg" }, reps: 4, performedOn: "2026-08-12" },
      ],
      environments: ["gym"],
      availableEquipment: ["barbell", "rack", "bench"],
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      executionStability: "reported_consistent",
    },
  });

  const assessment = await app.assessCoachingLevel({
    draftId: draft.id,
    expectedDraftRevision: background.revision,
    idempotencyKey: "experienced-assessment",
  });

  assert.equal(assessment.revision, 1);
  assert.equal(assessment.dimensions.trainingContinuity.status, "supported");
  assert.equal(assessment.dimensions.currentComparablePerformance.status, "supported");
  assert.equal(assessment.dimensions.exactExerciseFamiliarity.status, "supported");
  assert.equal(assessment.dimensions.trainingProgrammingUnderstanding.status, "provisional");
  assert.equal(assessment.dimensions.selfRegulation.status, "unknown");
  assert.equal(assessment.dimensions.executionStability.status, "provisional");
  assert.deepEqual(assessment.dimensions.exactExerciseFamiliarity.applicableExerciseVariantIds, [
    "barbell_back_squat",
    "barbell_bench_press",
    "conventional_deadlift",
  ]);
  assert.equal(
    assessment.dimensions.currentComparablePerformance.supportingEvidence[0]?.source?.kind,
    "conversation_message",
  );
  assert.equal(assessment.legacyTrainingExperience, undefined);
});

test("训练年限或术语本身不把未知维度升级成新手以外的等级", async () => {
  const { app } = fixture();
  const draft = await app.startOnboarding({ userId: "limited-evidence-user", depth: "basic" });
  const saved = await app.captureTrainingBackground({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    inputMode: "conversation",
    idempotencyKey: "limited-evidence-background",
    background: {
      capturedAt: "2026-08-14T10:00:00.000+08:00",
      source,
      cumulativeTrainingMonths: { minimum: 24, maximum: 36 },
      reportedTerminology: ["RIR", "four-day split"],
    },
  });

  const assessment = await app.assessCoachingLevel({
    draftId: draft.id,
    expectedDraftRevision: saved.revision,
    idempotencyKey: "limited-evidence-assessment",
  });

  assert.equal(assessment.dimensions.trainingProgrammingUnderstanding.status, "unknown");
  assert.equal(assessment.dimensions.currentComparablePerformance.status, "unknown");
  assert.equal(assessment.dimensions.exactExerciseFamiliarity.status, "unknown");
  assert.equal(assessment.dimensions.trainingContinuity.status, "unknown");
  assert.equal(assessment.dimensions.selfRegulation.status, "unknown");
  assert.equal(assessment.dimensions.executionStability.status, "unknown");
  assert.ok(assessment.dimensions.trainingProgrammingUnderstanding.unknowns.includes("programming_evidence_not_provided"));
  assert.ok(assessment.dimensions.trainingProgrammingUnderstanding.refutingEvidence.some((evidence) => evidence.code === "duration_and_vocabulary_not_sufficient"));
});

test("用户更正训练背景会保留旧评估并生成新的 assessment revision", async () => {
  const { app } = fixture();
  const draft = await app.startOnboarding({ userId: "corrected-user", depth: "basic" });
  const initial = await app.captureTrainingBackground({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    inputMode: "conversation",
    idempotencyKey: "initial-background",
    background: {
      capturedAt: "2026-08-14T10:00:00.000+08:00",
      source,
      recentContinuity: { consecutiveWeeks: 10, usualSessionsPerWeek: 4 },
    },
  });
  const first = await app.assessCoachingLevel({
    draftId: draft.id,
    expectedDraftRevision: initial.revision,
    idempotencyKey: "first-assessment",
  });
  const corrected = await app.captureTrainingBackground({
    draftId: draft.id,
    expectedDraftRevision: first.sourceDraft.revision + 1,
    inputMode: "conversation",
    idempotencyKey: "corrected-background",
    background: {
      capturedAt: "2026-08-14T10:05:00.000+08:00",
      source: { kind: "conversation_message", messageId: "correction-message" },
      recentContinuity: { consecutiveWeeks: 2, usualSessionsPerWeek: 2, timeAwayWeeks: 12 },
    },
  });
  const revised = await app.assessCoachingLevel({
    draftId: draft.id,
    expectedDraftRevision: corrected.revision,
    idempotencyKey: "revised-assessment",
  });

  assert.equal(revised.revision, 2);
  assert.equal(revised.dimensions.trainingContinuity.status, "contradicted");
  assert.equal(revised.sourceDraft.revision, corrected.revision);
  const progress = await app.readOnboardingProgress(draft.id);
  assert.deepEqual(progress.coachingLevelAssessments?.map((item) => item.revision), [1, 2]);
  assert.equal(progress.coachingLevelAssessments?.[0]?.dimensions.trainingContinuity.status, "supported");
});

test("不同轮次采集的训练字段保留各自来源，评估不会全部指向最后一条消息", async () => {
  const { app } = fixture();
  const draft = await app.startOnboarding({ userId: "field-provenance-user", depth: "basic" });
  const first = await app.captureOnboardingDynamicFields({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    inputMode: "conversation",
    idempotencyKey: "continuity-message",
    captures: [{
      fieldId: "training.recent_continuity",
      state: "captured_explicit",
      value: { consecutive_weeks: 12, usual_sessions_per_week: 4, time_away_weeks: 0 },
      observedAt: "2026-08-14T10:00:00.000+08:00",
      source: { kind: "conversation_message", messageId: "continuity-message" },
    }],
  });
  const second = await app.captureOnboardingDynamicFields({
    draftId: draft.id,
    expectedDraftRevision: first.revision,
    inputMode: "conversation",
    idempotencyKey: "split-message",
    captures: [{
      fieldId: "training.recent_split",
      state: "captured_explicit",
      value: "胸、背、腿、肩",
      observedAt: "2026-08-14T10:05:00.000+08:00",
      source: { kind: "conversation_message", messageId: "split-message" },
    }],
  });

  const assessment = second.coachingLevelAssessments?.at(-1);
  assert.equal(assessment?.dimensions.trainingContinuity.supportingEvidence[0]?.source?.kind, "conversation_message");
  assert.equal((assessment?.dimensions.trainingContinuity.supportingEvidence[0]?.source as { messageId?: string })?.messageId, "continuity-message");
  assert.equal((assessment?.dimensions.trainingProgrammingUnderstanding.supportingEvidence[0]?.source as { messageId?: string })?.messageId, "split-message");
});
