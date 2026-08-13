import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let now = "2026-08-08T00:00:00.000Z";
  const notifications: string[] = [];
  const platformJobs: string[] = [];
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => now, nextId: (prefix) => `${prefix}-${notifications.length + platformJobs.length + 1}` },
    notifications: {
      async schedule(input) { notifications.push(input.id); },
      async cancel(id) { notifications.push(`cancel:${id}`); },
    },
    backgroundScheduler: {
      async upsert(input) { platformJobs.push(input.id); },
      async cancel(id) { platformJobs.push(`cancel:${id}`); },
      async list() { return []; },
    },
  });
  return { app, ledger, notifications, platformJobs, setNow: (value: string) => { now = value; } };
}

test("固定提醒经本地 Ledger 持久化；到期 catch-up 只产生一个隐私安全通知", async () => {
  const state = fixture();
  const { job } = await state.app.upsertFixedReminder({
    userId: "user-1", recipeId: "water-reminder", localDate: "2026-08-08", localTime: "09:00", timezoneOffsetMinutes: 480,
  });
  assert.equal(state.platformJobs[0], job.id);
  assert.equal((await state.app.catchUpRecipes("user-1")).attempted.length, 0);

  state.setNow("2026-08-08T01:00:00.000Z");
  const due = await state.app.catchUpRecipes("user-1");
  assert.deepEqual(due.attempted, [job.id]);
  assert.equal(due.scheduledNotificationIds.length, 1);
  assert.equal(state.notifications.length, 1);
  assert.equal((await state.app.listScheduledJobs("user-1"))[0]?.status, "notification_scheduled");
  assert.equal((await state.ledger.read()).jobAttempts[0]?.outcome, "scheduled");
  const replay = await state.app.catchUpRecipes("user-1");
  assert.equal(replay.attempted.length, 0);
  assert.equal(state.notifications.length, 1);
});

test("支持 native upsert 的端口在确认提醒时直接排程；后台任务只作为恢复路径", async () => {
  let now = "2026-08-08T00:00:00.000Z";
  const upserts: { id: string; at: string }[] = [];
  const cancellations: string[] = [];
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => now, nextId: (prefix) => prefix },
    notifications: {
      async schedule() { throw new Error("legacy_schedule_should_not_run"); },
      async upsert(input) { upserts.push({ id: input.id, at: input.at }); },
      async cancel(id) { cancellations.push(id); },
    },
    backgroundScheduler: {
      async upsert() {}, async cancel() {}, async list() { return []; },
    },
  });
  const first = await app.upsertFixedReminder({
    userId: "user-1", recipeId: "native-reminder", localDate: "2026-08-08", localTime: "09:00", timezoneOffsetMinutes: 480,
  });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.at, first.job.earliestAt);
  now = "2026-08-08T01:00:00.000Z";
  assert.equal((await app.catchUpRecipes("user-1")).attempted.length, 0);

  const changed = await app.upsertFixedReminder({
    userId: "user-1", recipeId: "native-reminder", localDate: "2026-08-08", localTime: "10:00", timezoneOffsetMinutes: 480,
  });
  assert.equal(upserts.length, 2);
  assert.equal(upserts[1]?.at, changed.job.earliestAt);
  assert.equal(cancellations.length, 1);
  assert.notEqual(upserts[0]?.id, upserts[1]?.id);
});

test("过期或安静时段的任务不补发旧通知，关闭 Recipe 会取消本地和原生作业", async () => {
  const state = fixture();
  const { job: expired } = await state.app.upsertFixedReminder({
    userId: "user-1", recipeId: "expired-reminder", localDate: "2026-08-06", localTime: "09:00", timezoneOffsetMinutes: 480,
  });
  const { job: quiet } = await state.app.upsertFixedReminder({
    userId: "user-1", recipeId: "quiet-reminder", localDate: "2026-08-08", localTime: "09:00", timezoneOffsetMinutes: 480,
    quietHours: { start: "09:00", end: "10:00" },
  });
  state.setNow("2026-08-08T01:05:00.000Z");
  const result = await state.app.catchUpRecipes("user-1");
  assert.ok(result.expiredJobIds.includes(expired.id));
  assert.ok(result.skippedJobIds.includes(quiet.id));
  assert.equal(state.notifications.length, 0);

  await state.app.cancelRecipe("user-1", "quiet-reminder");
  assert.ok(state.platformJobs.includes(`cancel:${quiet.id}`));
});

test("没有原生通知适配器时，到期任务明确跳过，不伪造已送达状态", async () => {
  let now = "2026-08-08T00:00:00.000Z";
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => now, nextId: (prefix) => prefix },
  });
  const { job } = await app.upsertFixedReminder({
    userId: "user-1", recipeId: "adapter-missing", localDate: "2026-08-08", localTime: "09:00", timezoneOffsetMinutes: 480,
  });
  now = "2026-08-08T01:00:00.000Z";
  const outcome = await app.catchUpRecipes("user-1");
  assert.deepEqual(outcome.scheduledNotificationIds, []);
  assert.deepEqual(outcome.skippedJobIds, [job.id]);
  assert.equal((await app.listScheduledJobs("user-1"))[0]?.status, "skipped");
});

test("事件型 Recipe 使用闭合本地模板；同一日期的同类触发会合并，且不会写入计划", async () => {
  const state = fixture();
  await state.app.upsertEventRecipe({
    userId: "user-1",
    recipeId: "today-plan-events",
    kind: "today_plan_changed",
    notificationSettings: { maxPerLocalDate: 1 },
  });

  const first = await state.app.triggerRecipe({
    userId: "user-1",
    recipeId: "today-plan-events",
    occurredAt: "2026-08-08T00:00:00.000Z",
    causationId: "plan-revision-2",
    idempotencyKey: "plan-revision-2:today-plan-changed",
    timezoneOffsetMinutes: 480,
    localDateIntent: "2026-08-08",
    factFrontier: [{ aggregate: "plan", id: "plan-1", revision: 2 }],
  });
  const coalesced = await state.app.triggerRecipe({
    userId: "user-1",
    recipeId: "today-plan-events",
    occurredAt: "2026-08-08T00:05:00.000Z",
    causationId: "plan-revision-3",
    idempotencyKey: "plan-revision-3:today-plan-changed",
    timezoneOffsetMinutes: 480,
    localDateIntent: "2026-08-08",
    factFrontier: [{ aggregate: "plan", id: "plan-1", revision: 3 }],
  });
  assert.equal(coalesced.id, first.id);
  assert.equal(coalesced.trigger.causationId, "plan-revision-3");
  assert.equal(coalesced.trigger.idempotencyKey, "plan-revision-3:today-plan-changed");
  assert.deepEqual(coalesced.lastEvaluatedFrontier, [{ aggregate: "plan", id: "plan-1", revision: 3 }]);

  state.setNow("2026-08-08T00:05:00.000Z");
  const due = await state.app.catchUpRecipes("user-1");
  assert.deepEqual(due.scheduledNotificationIds.length, 1);
  assert.equal(state.notifications.length, 1);
  const snapshot = await state.ledger.read();
  assert.equal(snapshot.actionEvents.length, 0);
  assert.equal(snapshot.notificationIntents[0]?.kind, "today_plan_changed");
  assert.equal(snapshot.notificationIntents[0]?.body.includes("62.5"), false);
  assert.equal(snapshot.scheduledJobs[0]?.trigger.ruleVersions.recipe_registry, "v1");
});

test("晨间 Recipe 在没有可用健康证据时降级成 check-in，且尊重通知类型偏好", async () => {
  const state = fixture();
  await state.app.upsertEventRecipe({
    userId: "user-1",
    recipeId: "morning-recovery",
    kind: "morning_check_in",
    notificationSettings: { enabledNotificationKinds: ["record_reminder"] },
  });
  await state.app.triggerRecipe({
    userId: "user-1",
    recipeId: "morning-recovery",
    occurredAt: "2026-08-08T00:00:00.000Z",
    causationId: "morning-2026-08-08",
    idempotencyKey: "morning-2026-08-08",
    timezoneOffsetMinutes: 480,
    localDateIntent: "2026-08-08",
    factFrontier: [],
    recoveryEvidence: "unavailable",
  });
  const due = await state.app.catchUpRecipes("user-1");
  assert.equal(due.scheduledNotificationIds.length, 1);
  const snapshot = await state.ledger.read();
  const intent = snapshot.notificationIntents[0];
  assert.equal(intent?.kind, "record_reminder");
  assert.match(intent?.body ?? "", /恢复感受/);
  assert.doesNotMatch(intent?.body ?? "", /睡眠|HRV|恢复评分/);

  await state.app.upsertEventRecipe({
    userId: "user-1",
    recipeId: "weekly-disabled",
    kind: "weekly_review",
    notificationSettings: { enabledNotificationKinds: ["record_reminder"] },
  });
  await state.app.triggerRecipe({
    userId: "user-1",
    recipeId: "weekly-disabled",
    occurredAt: "2026-08-08T00:10:00.000Z",
    causationId: "week-32",
    idempotencyKey: "week-32:weekly-review",
    timezoneOffsetMinutes: 480,
    localDateIntent: "2026-08-08",
    factFrontier: [],
  });
  state.setNow("2026-08-08T00:10:00.000Z");
  const afterDisabled = await state.app.catchUpRecipes("user-1");
  assert.ok(afterDisabled.skippedJobIds.length >= 1);
  assert.equal(state.notifications.length, 1);
});

test("通知端口只把已验证的标识写成最小 receipt，并对重复点击幂等", async () => {
  const state = fixture();
  await state.app.upsertFixedReminder({
    userId: "user-1", recipeId: "tap-receipt", localDate: "2026-08-08", localTime: "09:00", timezoneOffsetMinutes: 480,
  });
  state.setNow("2026-08-08T01:00:00.000Z");
  await state.app.catchUpRecipes("user-1");
  const intentId = (await state.ledger.read()).notificationIntents[0]!.id;
  assert.deepEqual(
    await state.app.recordNotificationReceipt({ userId: "user-1", notificationIntentId: intentId, event: "tap" }),
    { status: "recorded" },
  );
  assert.deepEqual(
    await state.app.recordNotificationReceipt({ userId: "user-1", notificationIntentId: intentId, event: "tap" }),
    { status: "idempotent" },
  );
  assert.deepEqual(
    await state.app.recordNotificationReceipt({ userId: "user-1", notificationIntentId: "untrusted-id", event: "tap" }),
    { status: "ignored" },
  );
  const receipts = (await state.ledger.read()).notificationReceipts;
  assert.equal(receipts.filter((receipt) => receipt.event === "tap").length, 1);
  assert.deepEqual(
    await state.app.recordNotificationReceipt({ userId: "user-1", notificationIntentId: intentId, event: "delivered" }),
    { status: "recorded" },
  );
  assert.equal((await state.app.listScheduledJobs("user-1"))[0]?.status, "delivered");
  assert.deepEqual(
    await state.app.recordNotificationReceipt({ userId: "user-1", notificationIntentId: intentId, event: "dismissed" }),
    { status: "recorded" },
  );
  assert.equal((await state.ledger.read()).notificationReceipts.filter((receipt) => receipt.event === "dismissed").length, 1);
  assert.equal((await state.app.listScheduledJobs("user-1"))[0]?.status, "delivered");
});

test("建档后可安装完整的闭合事件 Recipe 注册表，不会立即请求通知或触发作业", async () => {
  const state = fixture();
  const first = await state.app.ensureDefaultEventRecipes("user-1");
  const second = await state.app.ensureDefaultEventRecipes("user-1");
  assert.equal(first.length, 8);
  assert.equal(second.length, 8);
  assert.deepEqual(
    (await state.ledger.read()).coachRecipes.map((recipe) => recipe.kind).sort(),
    [
      "deload_ended",
      "missed_session_review",
      "morning_check_in",
      "recovery_changed",
      "schedule_or_equipment_changed",
      "session_completed_assessment",
      "today_plan_changed",
      "weekly_review",
    ],
  );
  assert.equal(state.notifications.length, 0);
  assert.equal((await state.app.listScheduledJobs("user-1")).length, 0);
  await assert.rejects(
    state.app.upsertEventRecipe({ userId: "user-1", recipeId: "untrusted", kind: "arbitrary_background_script" as "morning_check_in" }),
    /unknown_recipe_kind/,
  );
});

test("用户只能调整既有事件 Recipe 的开关与通知偏好，不能借此改变其后台语义", async () => {
  const state = fixture();
  await state.app.ensureDefaultEventRecipes("user-1");
  const initial = (await state.app.listCoachRecipes("user-1")).find((recipe) => recipe.kind === "weekly_review")!;
  const updated = await state.app.updateEventRecipe({
    userId: "user-1",
    recipeId: initial.id,
    enabled: false,
    notificationSettings: { doNotDisturb: true, maxPerLocalDate: 0 },
  });
  assert.equal(updated?.kind, "weekly_review");
  assert.equal(updated?.enabled, false);
  assert.equal(updated?.notificationSettings?.doNotDisturb, true);
  assert.equal(updated?.version, initial.version + 1);
  assert.equal(await state.app.updateEventRecipe({ userId: "user-1", recipeId: "not-a-recipe", enabled: true }), undefined);
});

test("训练完成提醒的 deep link 指向持久化 WorkoutSession，而不是无上下文聊天页", async () => {
  const state = fixture();
  await state.app.upsertEventRecipe({ userId: "user-1", recipeId: "session-finished", kind: "session_completed_assessment" });
  await state.app.triggerRecipe({
    userId: "user-1", recipeId: "session-finished", occurredAt: "2026-08-08T00:00:00.000Z",
    causationId: "workout-42", idempotencyKey: "workout-42:complete", timezoneOffsetMinutes: 480,
    localDateIntent: "2026-08-08", factFrontier: [],
  });
  await state.app.catchUpRecipes("user-1");
  const intent = (await state.ledger.read()).notificationIntents[0]!;
  assert.deepEqual(intent.deepLink, { kind: "workout", ref: "workout-42" });
});

test("已交给系统的同类提醒遇到新事实会取消旧请求，并用最新 Recipe 重新排程", async () => {
  const state = fixture();
  await state.app.upsertEventRecipe({ userId: "user-1", recipeId: "session-done", kind: "session_completed_assessment" });
  await state.app.upsertEventRecipe({ userId: "user-1", recipeId: "equipment-change", kind: "schedule_or_equipment_changed" });
  const first = await state.app.triggerRecipe({
    userId: "user-1", recipeId: "session-done", occurredAt: "2026-08-08T00:00:00.000Z",
    causationId: "workout-42", idempotencyKey: "workout-42:complete", timezoneOffsetMinutes: 480,
    localDateIntent: "2026-08-08", factFrontier: [{ aggregate: "workout", id: "workout-42", revision: 1 }],
  });
  await state.app.catchUpRecipes("user-1");
  const firstIntentId = (await state.ledger.read()).notificationIntents[0]!.id;

  state.setNow("2026-08-08T00:05:00.000Z");
  const replacement = await state.app.triggerRecipe({
    userId: "user-1", recipeId: "equipment-change", occurredAt: "2026-08-08T00:05:00.000Z",
    causationId: "equipment:home-gym:2", idempotencyKey: "equipment:home-gym:2", timezoneOffsetMinutes: 480,
    localDateIntent: "2026-08-08", factFrontier: [{ aggregate: "equipment", id: "home-gym", revision: 2 }],
  });
  assert.equal(replacement.id, first.id);
  assert.equal(replacement.recipeId, "equipment-change");
  assert.ok(state.notifications.includes(`cancel:${firstIntentId}`));

  await state.app.catchUpRecipes("user-1");
  const intent = (await state.ledger.read()).notificationIntents.find((item) => item.id === firstIntentId);
  assert.equal(intent?.status, "scheduled");
  assert.deepEqual(intent?.deepLink, { kind: "workout", ref: "2026-08-08" });
});
