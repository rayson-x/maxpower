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
  assert.deepEqual(afterUnknown.limitedActions, ["dated_session_schedule"]);
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

test("不同目标的推荐表单选择不同字段，训练记录保持产品定义的复合字段", async () => {
  const { app } = fixture();
  const draft = await baseline(app, "strength-user");
  const fatLoss = app.recommendOnboardingDynamicForm({
    draft,
    goalKind: "fat_loss",
  });
  const strength = app.recommendOnboardingDynamicForm({
    draft,
    goalKind: "strength",
  });
  assert.deepEqual(fatLoss.fieldIds, ["profile.sex", "timeline.daily_activity", "nutrition.usual_intake"]);
  assert.deepEqual(strength.fieldIds, ["training.comparable_set"]);

  const card = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    idempotencyKey: "strength-card",
    proposal: strength,
  });
  assert.equal(card.fields[0]?.control.kind, "field_group");
  assert.deepEqual(card.fields[0]?.control.fields, ["exercise_variant", "load", "reps", "rir_or_rpe", "performed_on", "conditions"]);

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
          rir_or_rpe: 2,
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
