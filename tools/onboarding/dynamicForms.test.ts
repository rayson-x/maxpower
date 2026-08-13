import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  return {
    ledger,
    app: new CoachApplication({
      ledger,
      runtime: {
        now: () => "2026-08-14T09:30:00.000+08:00",
        nextId: (prefix: string) => `${prefix}-${++sequence}`,
      },
    }),
  };
}

async function baseline(app: CoachApplication, userId = "dynamic-user") {
  const draft = await app.startOrResumeBaselineIntake({ userId });
  return app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-14T09:30:00.000+08:00", source: { kind: "form_submission", submissionId: "baseline-card" } },
      height: { value: { value: 179, unit: "cm" }, observedAt: "2026-08-14T09:30:00.000+08:00", source: { kind: "form_submission", submissionId: "baseline-card" } },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-14T09:30:00.000+08:00", source: { kind: "form_submission", submissionId: "baseline-card" } },
      goalNarrative: { text: "想把体脂率降到12%，目前16%", observedAt: "2026-08-14T09:30:00.000+08:00", source: { kind: "form_submission", submissionId: "baseline-card" } },
    },
  });
}

test("动态表单只能引用版本化目录字段，并钉住原因、行动门槛和草稿版本", async () => {
  const { app } = fixture();
  const draft = await baseline(app);
  const card = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    idempotencyKey: "fat-loss-energy-card",
    proposal: {
      topic: "energy_planning",
      fieldIds: ["profile.sex", "timeline.daily_activity", "nutrition.usual_intake"],
      reasonCode: "planning_gate",
      requiredFor: "reliable_energy_target",
    },
  });

  assert.equal(card.catalogVersion, "onboarding-field-catalog/v1");
  assert.equal(card.reasonCode, "planning_gate");
  assert.equal(card.requiredFor, "reliable_energy_target");
  assert.deepEqual(card.fields.map((field) => field.id), ["profile.sex", "timeline.daily_activity", "nutrition.usual_intake"]);
  assert.equal(card.fields[0]?.control.kind, "single_select");
  assert.equal(card.fields[1]?.control.kind, "single_select");
  assert.equal(card.fields[2]?.control.kind, "numeric_with_unit");
  assert.equal(card.draftRevision, draft.revision + 1);

  const replayedCard = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    idempotencyKey: "fat-loss-energy-card",
    proposal: {
      topic: "this-is-ignored-by-idempotency",
      fieldIds: ["agent.invented_calorie_confidence"],
      reasonCode: "planning_gate",
      requiredFor: "reliable_energy_target",
    },
  });
  assert.equal(replayedCard.cardId, card.cardId);
  assert.deepEqual(replayedCard.fieldIds, card.fieldIds);

  await assert.rejects(
    app.requestOnboardingDynamicForm({
      draftId: draft.id,
      expectedDraftRevision: card.draftRevision,
      idempotencyKey: "invented-field",
      proposal: {
        topic: "energy_planning",
        fieldIds: ["agent.invented_calorie_confidence"],
        reasonCode: "planning_gate",
        requiredFor: "reliable_energy_target",
      },
    }),
    { message: /dynamic_form_rejected/ },
  );
  await assert.rejects(
    app.requestOnboardingDynamicForm({
      draftId: draft.id,
      expectedDraftRevision: card.draftRevision,
      idempotencyKey: "mismatched-gate",
      proposal: {
        topic: "energy_planning",
        fieldIds: ["timeline.daily_activity"],
        reasonCode: "planning_gate",
        requiredFor: "dated_session_schedule",
      },
    }),
    { message: /dynamic_form_rejected/ },
  );
});

test("旧卡片不能覆盖较新的草稿；明确不知道会留下受限行动并抑制重复追问", async () => {
  const { app } = fixture();
  const draft = await baseline(app);
  const firstCard = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    idempotencyKey: "activity-card",
    proposal: {
      topic: "energy_planning",
      fieldIds: ["timeline.daily_activity"],
      reasonCode: "planning_gate",
      requiredFor: "reliable_energy_target",
    },
  });

  const fresh = await app.captureOnboardingDynamicFields({
    draftId: draft.id,
    expectedDraftRevision: firstCard.draftRevision,
    inputMode: "conversation",
    idempotencyKey: "activity-message",
    captures: [{
      fieldId: "timeline.daily_activity",
      state: "captured_explicit",
      value: "sedentary_remote_work",
      observedAt: "2026-08-14T09:35:00.000+08:00",
      source: { kind: "conversation_message", messageId: "message-1" },
    }],
  });

  await assert.rejects(
    app.submitOnboardingDynamicForm({
      draftId: draft.id,
      cardId: firstCard.cardId,
      expectedDraftRevision: firstCard.draftRevision,
      idempotencyKey: "stale-card-submit",
      answers: [{ fieldId: "timeline.daily_activity", state: "captured_explicit", value: "active_job" }],
    }),
    { message: /stale_dynamic_form/ },
  );

  const unknownCard = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: fresh.revision,
    idempotencyKey: "schedule-card",
    proposal: {
      topic: "schedule_feasibility",
      fieldIds: ["profile.training_schedule"],
      reasonCode: "schedule_feasibility",
      requiredFor: "dated_session_schedule",
    },
  });
  const afterUnknown = await app.submitOnboardingDynamicForm({
    draftId: draft.id,
    cardId: unknownCard.cardId,
    expectedDraftRevision: unknownCard.draftRevision,
    idempotencyKey: "schedule-unknown",
    answers: [{ fieldId: "profile.training_schedule", state: "explicit_unknown" }],
  });

  assert.equal(afterUnknown.patch.dynamicFields?.["profile.training_schedule"]?.state, "explicit_unknown");
  assert.deepEqual(afterUnknown.limitedActions, ["dated_session_schedule", "initial_plan"]);
  await assert.rejects(
    app.requestOnboardingDynamicForm({
      draftId: draft.id,
      expectedDraftRevision: afterUnknown.revision,
      idempotencyKey: "repeat-unknown",
      proposal: {
        topic: "schedule_feasibility",
        fieldIds: ["profile.training_schedule"],
        reasonCode: "schedule_feasibility",
        requiredFor: "dated_session_schedule",
      },
    }),
    { message: /dynamic_form_rejected/ },
  );
});

test("知识需求只能选择产品目录字段，训练记录保持产品定义的复合字段", async () => {
  const { app } = fixture();
  const draft = await baseline(app, "strength-user");

  const card = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    idempotencyKey: "strength-card",
    proposal: {
      topic: "goal_based_intake",
      fieldIds: ["training.comparable_set"],
      reasonCode: "planning_gate",
      requiredFor: "initial_plan",
    },
  });
  const comparableSet = card.fields.find((field) => field.id === "training.comparable_set");
  assert.equal(comparableSet?.control.kind, "field_group");
  assert.deepEqual(comparableSet?.control.kind === "field_group" ? comparableSet.control.fields : [], ["exercise_variant", "load", "reps", "effort_metric", "effort_value", "performed_on", "conditions"]);

  await assert.rejects(
    app.captureOnboardingDynamicFields({
      draftId: draft.id,
      expectedDraftRevision: card.draftRevision,
      inputMode: "conversation",
      idempotencyKey: "invented-unit",
      captures: [{
        fieldId: "training.comparable_set",
        state: "captured_explicit",
        value: {
          exercise_variant: "barbell_bench_press",
          load: { value: 80, unit: "lb" },
          reps: 5,
          effort_metric: "rir",
          effort_value: 2,
          performed_on: "2026-08-13",
          conditions: "normal",
        },
        observedAt: "2026-08-14T09:30:00.000+08:00",
        source: { kind: "conversation_message", messageId: "message-invalid-unit" },
      }],
    }),
    { message: /dynamic_form_rejected/ },
  );
});

test("知识前沿返回不限三项的可选需求，提交后形成训练背景与多维评估", async () => {
  const { app } = fixture();
  const draft = await baseline(app, "goal-frontier-user");
  const frontier = await app.readOnboardingKnowledgeFrontier({ draftId: draft.id });
  assert.equal(frontier.kind, "knowledge_requirements");
  if (frontier.kind !== "knowledge_requirements") return;
  const fieldIds = [...new Set(frontier.requirements.flatMap((requirement) => requirement.fieldIds))];
  assert.ok(fieldIds.length > 3);
  assert.equal(fieldIds.includes("training.cumulative_months"), true);
  assert.equal(fieldIds.includes("training.recent_continuity"), true);
  assert.equal(fieldIds.includes("training.environment"), true);

  const card = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    proposal: {
      topic: "goal_based_intake",
      fieldIds,
      reasonCode: "planning_gate",
      requiredFor: "initial_plan",
      knowledgeArtifactIds: frontier.requirements.map((requirement) => requirement.artifactRef.id),
      knowledgeArtifactRefs: frontier.requirements.map((requirement) => requirement.artifactRef),
      knowledgeReleasePin: frontier.knowledgeReleasePin,
    },
    idempotencyKey: "goal-frontier-card",
  });
  const answer = (fieldId: string, value: unknown) => ({ fieldId, state: "captured_explicit" as const, value });
  const progress = await app.submitOnboardingDynamicForm({
    draftId: draft.id,
    cardId: card.cardId,
    expectedDraftRevision: card.draftRevision,
    idempotencyKey: "goal-frontier-submit",
    answers: card.fieldIds.map((fieldId) => {
      if (fieldId === "training.cumulative_months") return answer(fieldId, { value: 24, unit: "month" });
      if (fieldId === "training.recent_continuity") return answer(fieldId, { consecutive_weeks: 16, usual_sessions_per_week: 4, time_away_weeks: 0 });
      if (fieldId === "training.recent_split") return answer(fieldId, "胸、背、腿、肩");
      if (fieldId === "training.environment") return answer(fieldId, ["gym"]);
      if (fieldId === "training.equipment") return answer(fieldId, ["full_gym"]);
      if (fieldId === "training.execution_stability") return answer(fieldId, "reported_consistent");
      if (fieldId === "profile.training_schedule") return answer(fieldId, { days_per_week: 4, minutes_per_session: 75 });
      return { fieldId, state: "explicit_unknown" as const };
    }),
  });
  assert.equal(progress.patch.trainingBackground?.cumulativeTrainingMonths?.minimum, 24);
  assert.deepEqual(progress.patch.trainingBackground?.recentSplit, ["胸", "背", "腿", "肩"]);
  assert.equal(progress.coachingLevelAssessments?.at(-1)?.priority, "multi_dimensional_assessment");
});

test("建档问题来自已安装 Agent Knowledge 的决策需求，而不是目标关键词问卷", async () => {
  const { app } = fixture();
  const draft = await baseline(app, "knowledge-frontier-user");

  const frontier = await app.readOnboardingKnowledgeFrontier({ draftId: draft.id });

  assert.equal(frontier.kind, "knowledge_requirements");
  if (frontier.kind !== "knowledge_requirements") return;
  assert.equal(frontier.knowledgeReleasePin.id, "knowledge_release.maxpower.planner.v2");
  const energy = frontier.requirements.find((requirement) =>
    requirement.artifactRef.id === "calculator.initial-plan.energy-budget");
  assert.ok(energy);
  assert.deepEqual(energy.fieldIds, [
    "profile.sex",
    "timeline.daily_activity",
    "nutrition.usual_intake",
    "goal.target_horizon",
  ]);
  assert.ok(energy.sourceClaimRefs.includes("claim.weight.niddk-realistic-initial-goal"));
  assert.equal("goalKind" in frontier, false);
});

test("空多选不能伪装成已回答；训练强度必须区分 RIR 与 RPE", async () => {
  const { app } = fixture();
  const draft = await baseline(app, "field-semantics-user");
  await assert.rejects(
    app.captureOnboardingDynamicFields({
      draftId: draft.id,
      expectedDraftRevision: draft.revision,
      inputMode: "form",
      idempotencyKey: "empty-environment",
      captures: [{
        fieldId: "training.environment",
        state: "captured_explicit",
        value: [],
        observedAt: "2026-08-14T09:30:00.000+08:00",
        source: { kind: "form_submission", submissionId: "empty-environment" },
      }],
    }),
    /dynamic_form_rejected/,
  );

  const saved = await app.captureOnboardingDynamicFields({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    inputMode: "form",
    idempotencyKey: "rir-set",
    captures: [{
      fieldId: "training.comparable_set",
      state: "captured_explicit",
      value: {
        exercise_variant: "barbell_bench_press",
        load: { value: 80, unit: "kg" },
        reps: 5,
        effort_metric: "rir",
        effort_value: 2,
        performed_on: "2026-08-13",
        conditions: "normal",
      },
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "form_submission", submissionId: "rir-set" },
    }],
  });
  assert.equal(saved.patch.trainingBackground?.comparableSets?.[0]?.rir, 2);
  assert.equal(saved.patch.trainingBackground?.comparableSets?.[0]?.rpe, undefined);
});
