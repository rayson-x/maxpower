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
  return { app: new CoachApplication({ ledger, runtime }) };
}

test("目标原话会保留来源，并将明确的目标体脂与当前自报体脂写入不同的草稿所有者", async () => {
  const state = fixture();
  const draft = await state.app.startOrResumeBaselineIntake({ userId: "goal-user" });

  const progress = await state.app.captureGoalNarrative({
    draftId: draft.id,
    inputMode: "conversation",
    narrative: {
      text: "想把体脂率降到12%，目前16%",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-1" },
    },
    idempotencyKey: "capture-goal-1",
  });

  assert.deepEqual(progress.patch.goalCapture?.narratives, [
    {
      text: "想把体脂率降到12%，目前16%",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-1" },
    },
  ]);
  assert.deepEqual(progress.patch.goalCapture?.goalTargets, [
    {
      id: "goal-target-body-fat:goal-message-1",
      kind: "target_body_fat",
      status: "captured_explicit",
      value: { value: 12, unit: "percent" },
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-1" },
    },
  ]);
  assert.deepEqual(progress.patch.goalCapture?.timelineBaselineMeasurements, [
    {
      id: "timeline-body-fat:goal-message-1",
      kind: "body_fat_percentage",
      owner: "timeline_baseline",
      status: "captured_explicit",
      value: { value: 16, unit: "percent" },
      measurementMethod: "unknown",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-1" },
    },
  ]);
  assert.equal(progress.patch.goal, undefined);
});

test("初始四项表单中的自由目标也会进入同一份结构化目标草稿", async () => {
  const state = fixture();
  const draft = await state.app.startOrResumeBaselineIntake({ userId: "goal-user" });

  const progress = await state.app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    values: {
      goalNarrative: {
        text: "目标体脂 12%，目前体脂 16%",
        observedAt: "2026-08-14T09:30:00.000+08:00",
        source: { kind: "form_submission", submissionId: "baseline-card" },
      },
    },
    idempotencyKey: "baseline-goal-capture",
  });

  assert.equal(progress.patch.baseline?.goalNarrative?.text, "目标体脂 12%，目前体脂 16%");
  assert.equal(progress.patch.goalCapture?.goalTargets[0]?.value.value, 12);
  assert.equal(progress.patch.goalCapture?.timelineBaselineMeasurements[0]?.value.value, 16);
  assert.equal(progress.patch.goalCapture?.timelineBaselineMeasurements[0]?.measurementMethod, "unknown");
});

test("视觉、保护和进度取舍是可复核的规范化理解，而不是伪装成用户数值事实", async () => {
  const state = fixture();
  const draft = await state.app.startOrResumeBaselineIntake({ userId: "goal-user" });

  const progress = await state.app.captureGoalNarrative({
    draftId: draft.id,
    inputMode: "conversation",
    narrative: {
      text: "想要宽肩窄腰，减脂时保持卧推，可以慢一点。",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-2" },
    },
    idempotencyKey: "capture-goal-2",
  });

  assert.deepEqual(progress.patch.goalCapture?.visualIntents, [
    {
      id: "visual-wide-shoulders-narrow-waist:goal-message-2",
      kind: "wide_shoulders_narrow_waist",
      status: "normalized_needs_review",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-2" },
      normalizerVersion: "goal-narrative-v1",
    },
  ]);
  assert.deepEqual(progress.patch.goalCapture?.protectionIntents, [
    {
      id: "protection-bench-press:goal-message-2",
      kind: "bench_press_performance",
      status: "normalized_needs_review",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-2" },
      normalizerVersion: "goal-narrative-v1",
    },
  ]);
  assert.deepEqual(progress.patch.goalCapture?.tradeoffs, [
    {
      id: "tradeoff-slower-progress:goal-message-2",
      kind: "slower_progress_accepted",
      status: "normalized_needs_review",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-2" },
      normalizerVersion: "goal-narrative-v1",
    },
  ]);
});

test("语序不同但语义相同的体脂目标形成相同的领域草稿，而审计仍保留各自原话", async () => {
  const state = fixture();
  const first = await state.app.startOrResumeBaselineIntake({ userId: "goal-user-a" });
  const second = await state.app.startOrResumeBaselineIntake({ userId: "goal-user-b" });
  const capture = (draftId: string, text: string, messageId: string) => state.app.captureGoalNarrative({
    draftId,
    inputMode: "conversation",
    narrative: {
      text,
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId },
    },
    idempotencyKey: `capture-${messageId}`,
  });

  const [firstProgress, secondProgress] = await Promise.all([
    capture(first.id, "目标体脂 12%，目前体脂 16%", "goal-message-variant-a"),
    capture(second.id, "想把体脂率降到12%，目前16%", "goal-message-variant-b"),
  ]);

  assert.deepEqual(
    firstProgress.patch.goalCapture?.goalTargets.map(({ id: _id, source: _source, observedAt: _observedAt, ...value }) => value),
    secondProgress.patch.goalCapture?.goalTargets.map(({ id: _id, source: _source, observedAt: _observedAt, ...value }) => value),
  );
  assert.deepEqual(
    firstProgress.patch.goalCapture?.timelineBaselineMeasurements.map(({ id: _id, source: _source, observedAt: _observedAt, ...value }) => value),
    secondProgress.patch.goalCapture?.timelineBaselineMeasurements.map(({ id: _id, source: _source, observedAt: _observedAt, ...value }) => value),
  );
  assert.equal(firstProgress.patch.goalCapture?.narratives[0]?.text, "目标体脂 12%，目前体脂 16%");
  assert.equal(secondProgress.patch.goalCapture?.narratives[0]?.text, "想把体脂率降到12%，目前16%");
});

test("相冲突的目标值保留两条来源并进入冲突解决，不让后一条静默覆盖", async () => {
  const state = fixture();
  const draft = await state.app.startOrResumeBaselineIntake({ userId: "goal-user" });
  await state.app.captureGoalNarrative({
    draftId: draft.id,
    inputMode: "conversation",
    narrative: {
      text: "目标体脂 12%",
      observedAt: "2026-08-14T09:30:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-3a" },
    },
    idempotencyKey: "capture-goal-3a",
  });

  const progress = await state.app.captureGoalNarrative({
    draftId: draft.id,
    inputMode: "conversation",
    narrative: {
      text: "我改成目标体脂 10%",
      observedAt: "2026-08-14T09:35:00.000+08:00",
      source: { kind: "conversation_message", messageId: "goal-message-3b" },
    },
    idempotencyKey: "capture-goal-3b",
  });

  assert.equal(progress.patch.goalCapture?.goalTargets.length, 2);
  assert.deepEqual(progress.patch.goalCapture?.conflicts, [
    {
      id: "goal-target-body-fat:goal-message-3a::goal-target-body-fat:goal-message-3b",
      subject: "target_body_fat",
      state: "unresolved",
      captureIds: [
        "goal-target-body-fat:goal-message-3a",
        "goal-target-body-fat:goal-message-3b",
      ],
    },
  ]);
});
