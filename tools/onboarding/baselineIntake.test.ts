import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { ONBOARDING_DRAFT_SCHEMA_VERSION } from "../../src/onboarding/model";

function fixture() {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = {
    now: () => "2026-08-14T09:30:00.000+08:00",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  return { ledger, runtime, app: new CoachApplication({ ledger, runtime }) };
}

test("四项 baseline 从同一草稿开始和恢复，不注入任何档案或目标默认值", async () => {
  const state = fixture();

  const started = await state.app.startOrResumeBaselineIntake({ userId: "baseline-user" });
  const resumed = await state.app.startOrResumeBaselineIntake({ userId: "baseline-user" });

  assert.equal(resumed.id, started.id);
  assert.deepEqual(started.baselineMissingFields, ["age", "height", "current_weight", "goal_narrative"]);
  assert.equal(started.patch.baseline, undefined);
  assert.equal(started.patch.profile, undefined);
  assert.equal(started.patch.goal, undefined);
});

test("并发进入 baseline 也只会创建一份可恢复草稿", async () => {
  const state = fixture();
  const [first, second] = await Promise.all([
    state.app.startOrResumeBaselineIntake({ userId: "baseline-concurrent" }),
    state.app.startOrResumeBaselineIntake({ userId: "baseline-concurrent" }),
  ]);

  assert.equal(first.id, second.id);
  assert.equal(
    (await state.ledger.read()).onboardingDraftEvents.filter((event) => event.type === "onboarding.started").length,
    1,
  );
});

test("保存表单 baseline 会保留观测时间、原始目标和每个字段的来源", async () => {
  const state = fixture();
  const draft = await state.app.startOrResumeBaselineIntake({ userId: "baseline-user" });

  const progress = await state.app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    values: {
      age: {
        ageYears: 30,
        observedAt: "2026-08-14T09:30:00.000+08:00",
        source: { kind: "form_submission", submissionId: "initial-baseline-card" },
      },
      height: {
        value: { value: 179, unit: "cm" },
        observedAt: "2026-08-14T09:30:00.000+08:00",
        source: { kind: "form_submission", submissionId: "initial-baseline-card" },
      },
      currentWeight: {
        value: { value: 75, unit: "kg" },
        observedAt: "2026-08-14T09:30:00.000+08:00",
        source: { kind: "form_submission", submissionId: "initial-baseline-card" },
      },
      goalNarrative: {
        text: "想把体脂率降到12%，目前16%",
        observedAt: "2026-08-14T09:30:00.000+08:00",
        source: { kind: "form_submission", submissionId: "initial-baseline-card" },
      },
    },
    idempotencyKey: "baseline-card-1",
  });

  assert.deepEqual(progress.baselineMissingFields, []);
  assert.deepEqual(progress.patch.baseline, {
    age: {
      ageYears: 30,
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "form_submission", submissionId: "initial-baseline-card" },
    },
    height: {
      value: { value: 179, unit: "cm" },
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "form_submission", submissionId: "initial-baseline-card" },
    },
    currentWeight: {
      value: { value: 75, unit: "kg" },
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "form_submission", submissionId: "initial-baseline-card" },
    },
    goalNarrative: {
      text: "想把体脂率降到12%，目前16%",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "form_submission", submissionId: "initial-baseline-card" },
    },
  });
  assert.equal(progress.patch.profile, undefined);
  assert.equal(progress.patch.goal, undefined);
});

test("自然语言补充不会覆盖已有 baseline，并且来源模式必须匹配输入模式", async () => {
  const state = fixture();
  const draft = await state.app.startOrResumeBaselineIntake({ userId: "baseline-user" });
  await state.app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    values: {
      age: {
        ageYears: 30,
        observedAt: "2026-08-14T09:30:00.000+08:00",
        source: { kind: "form_submission", submissionId: "initial-baseline-card" },
      },
    },
    idempotencyKey: "baseline-age",
  });

  const progress = await state.app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "conversation",
    values: {
      goalNarrative: {
        text: "我现在体脂大约16%，想练出清晰腹肌",
        observedAt: "2026-08-14T09:35:00.000+08:00",
        source: { kind: "conversation_message", messageId: "message-42" },
      },
    },
    idempotencyKey: "baseline-goal-message",
  });
  assert.equal(progress.patch.baseline?.age?.ageYears, 30);
  assert.equal(progress.patch.baseline?.goalNarrative?.source.kind, "conversation_message");
  assert.deepEqual(progress.baselineMissingFields, ["height", "current_weight"]);

  await assert.rejects(
    state.app.saveBaselineIntake({
      draftId: draft.id,
      inputMode: "conversation",
      values: {
        height: {
          value: { value: 179, unit: "cm" },
          observedAt: "2026-08-14T09:35:00.000+08:00",
          source: { kind: "form_submission", submissionId: "wrong-mode" },
        },
      },
      idempotencyKey: "baseline-wrong-mode",
    }),
    { message: /invalid_baseline_intake/ },
  );
});

test("baseline 将允许的英制单位规范化为公制，并在应用边界拒绝不合理范围和未知单位", async () => {
  const state = fixture();
  const draft = await state.app.startOrResumeBaselineIntake({ userId: "baseline-units" });
  const source = { kind: "form_submission" as const, submissionId: "imperial-card" };
  const observedAt = "2026-08-14T09:30:00.000+08:00";

  const normalized = await state.app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    values: {
      age: { ageYears: 30, observedAt, source },
      height: { value: { value: 70, unit: "in" }, observedAt, source },
      currentWeight: { value: { value: 165, unit: "lb" }, observedAt, source },
      goalNarrative: { text: "减脂", observedAt, source },
    },
    idempotencyKey: "imperial-baseline",
  });

  assert.deepEqual(normalized.patch.baseline?.height?.value, { value: 177.8, unit: "cm" });
  assert.deepEqual(normalized.patch.baseline?.currentWeight?.value, { value: 74.84, unit: "kg" });

  const impossible = await state.app.startOrResumeBaselineIntake({ userId: "baseline-ranges" });
  for (const values of [
    { age: { ageYears: 12, observedAt, source } },
    { height: { value: { value: 99, unit: "cm" as const }, observedAt, source } },
    { currentWeight: { value: { value: 24, unit: "kg" as const }, observedAt, source } },
    { height: { value: { value: 179, unit: "m" as "cm" }, observedAt, source } },
  ]) {
    await assert.rejects(
      state.app.saveBaselineIntake({
        draftId: impossible.id,
        inputMode: "form",
        values,
        idempotencyKey: `invalid-${JSON.stringify(values)}`,
      }),
      { message: /invalid_baseline_intake/ },
    );
  }
});

test("baseline 重试不会追加等价事件，且 commit_pending 会恢复同一草稿", async () => {
  const state = fixture();
  const draft = await state.app.startOrResumeBaselineIntake({ userId: "baseline-retry" });
  const source = { kind: "form_submission" as const, submissionId: "retry-card" };
  const input = {
    draftId: draft.id,
    inputMode: "form" as const,
    values: {
      age: { ageYears: 30, observedAt: "2026-08-14T09:30:00.000+08:00", source },
    },
    idempotencyKey: "baseline-retry-save",
  };

  const first = await state.app.saveBaselineIntake(input);
  const retried = await state.app.saveBaselineIntake(input);
  assert.equal(retried.revision, first.revision);
  assert.equal(
    (await state.ledger.read()).onboardingDraftEvents.filter((event) => event.draftId === draft.id).length,
    2,
  );

  await state.ledger.commit({
    kind: "domain",
    userId: "baseline-retry",
    actorId: "baseline-retry",
    intent: "test.commit_pending",
    expectedRevisions: [],
    domainEvents: [],
    draftEvents: [{
      id: "commit-pending-event",
      schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
      type: "onboarding.completed",
      userId: "baseline-retry",
      draftId: draft.id,
      recordedAt: "2026-08-14T09:31:00.000+08:00",
      payload: { domainEventIds: [] },
    }],
    idempotencyKey: "test.commit_pending",
    recordedAt: "2026-08-14T09:31:00.000+08:00",
  });

  const resumed = await state.app.startOrResumeBaselineIntake({ userId: "baseline-retry" });
  assert.equal(resumed.id, draft.id);
  assert.equal(resumed.status, "completed");
  assert.equal((await state.app.readOnboardingEntryState({ userId: "baseline-retry" })).status, "commit_pending");
});
