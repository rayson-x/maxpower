import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let sequence = 0;
  let now = "2026-08-08T08:00:00.000+08:00";
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => now,
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
  });
  return {
    app,
    ledger,
    setNow: (value: string) => { now = value; },
  };
}

async function bootstrapAndPlan(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1",
      actor: { kind: "user", id: "u1" },
      deviceId: "phone-1",
      occurredAt: "2026-08-08T08:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: {
      id: "profile-1",
      trainingExperience: "beginner",
      locale: "zh-CN",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{
        id: "home-1",
        kind: "home",
        environment: { space: "medium", noise: "quiet" },
        availableEquipment: ["bodyweight", "floor_space"],
      }],
    },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08", endDate: "2026-10-30" },
      plannedRecoveryEveryWeeks: 6,
      status: "active",
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  await app.materializeGoalCycle({
    userId: "u1",
    currentDate: "2026-08-08",
    trigger: "initial_plan",
    idempotencyKey: "initial-plan",
  });
}

test("训练完成后由 CoachApplication 自动入队一次本地评估提醒，重放不重复", async () => {
  const { app, ledger } = fixture();
  await bootstrapAndPlan(app);
  await app.ensureDefaultEventRecipes("u1");

  const domain = await app.readDomainProjection({ userId: "u1" });
  const session = domain.plan?.value.sessions.find(
    (candidate) => candidate.kind === "weighted_reps" || candidate.kind === "bodyweight_reps",
  );
  assert.ok(session, "fixture requires a trainable prescription");
  if (!session || !domain.plan) throw new Error("fixture requires a plan");

  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId: "workout-1",
    prescriptionRef: {
      planId: domain.plan.value.id,
      planRevision: domain.plan.revision,
      sessionPrescriptionId: session.id,
    },
    idempotencyKey: "workout-prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-1", idempotencyKey: "workout-activate" });
  const prescribedSetCount = session.tasks.reduce((total, task) => total + task.sets.length, 0);
  for (let index = 0; index < prescribedSetCount; index += 1) {
    await app.confirmCurrentSet({
      userId: "u1",
      workoutId: "workout-1",
      confirmAsPlanned: true,
      idempotencyKey: `workout-set-${index}`,
    });
  }

  await app.completeWorkoutSession({ userId: "u1", workoutId: "workout-1", idempotencyKey: "workout-complete" });
  await app.completeWorkoutSession({ userId: "u1", workoutId: "workout-1", idempotencyKey: "workout-complete" });

  const jobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:session_completed_assessment",
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.trigger.causationId, "workout-1");
  assert.equal(jobs[0]?.trigger.factFrontier.some((ref) => ref.aggregate === "workout" && ref.id === "workout-1"), true);
  assert.equal((await ledger.read()).notificationIntents.length, 0);
});

test("两次不同日期的部分完成训练达到偏离阈值后，额外入队漏练重排提醒", async () => {
  const { app, setNow } = fixture();
  await bootstrapAndPlan(app);
  await app.ensureDefaultEventRecipes("u1");
  const domain = await app.readDomainProjection({ userId: "u1" });
  const sessions = domain.plan?.value.sessions.filter(
    (candidate) => candidate.kind === "weighted_reps" || candidate.kind === "bodyweight_reps",
  ) ?? [];
  assert.ok(sessions.length >= 2, "fixture requires two trainable prescriptions");
  if (!domain.plan || sessions.length < 2) throw new Error("fixture requires a plan");

  for (const [index, session] of sessions.slice(0, 2).entries()) {
    setNow(index === 0 ? "2026-08-08T08:00:00.000+08:00" : "2026-08-10T08:00:00.000+08:00");
    const workoutId = `partial-workout-${index + 1}`;
    await app.prepareWorkoutSession({
      userId: "u1",
      workoutId,
      prescriptionRef: { planId: domain.plan.value.id, planRevision: domain.plan.revision, sessionPrescriptionId: session.id },
      idempotencyKey: `${workoutId}-prepare`,
    });
    await app.activateWorkoutSession({ userId: "u1", workoutId, idempotencyKey: `${workoutId}-activate` });
    await app.completeWorkoutSession({ userId: "u1", workoutId, status: "partial", idempotencyKey: `${workoutId}-complete` });
  }

  const jobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:missed_session_review",
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.trigger.causationId, "partial-workout-2");
});

test("确认的日程变更自动入队一次本地重排提醒，并带提交后的事实前沿", async () => {
  const { app } = fixture();
  await bootstrapAndPlan(app);
  await app.ensureDefaultEventRecipes("u1");
  const before = await app.readDomainProjection({ userId: "u1" });
  const profile = before.profile;
  assert.ok(profile, "fixture requires a confirmed profile");
  if (!profile) throw new Error("fixture requires a profile");

  await app.executeDomainCommand({
    type: "profile.revise",
    meta: {
      userId: "u1",
      actor: { kind: "user", id: "u1" },
      deviceId: "phone-1",
      occurredAt: "2026-08-08T09:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "schedule-revise",
    },
    profileId: profile.value.id,
    expectedRevision: profile.revision,
    profile: { ...profile.value, schedule: { weeklyFrequency: 4, sessionDurationMinutes: 45 } },
  });

  const jobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:schedule_or_equipment_changed",
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.trigger.causationId, "user_profile:profile-1:2");
  assert.equal(jobs[0]?.trigger.factFrontier.some((ref) => ref.aggregate === "profile" && ref.id === "profile-1" && ref.revision === 2), true);
});

test("已物化的后续计划修订才入队今日计划变化提醒，初始建档计划不打扰用户", async () => {
  const { app } = fixture();
  await bootstrapAndPlan(app);
  await app.ensureDefaultEventRecipes("u1");
  const initialPlanJobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:today_plan_changed",
  );
  assert.equal(initialPlanJobs.length, 0);

  const before = await app.readDomainProjection({ userId: "u1" });
  const profile = before.profile;
  assert.ok(profile);
  if (!profile) throw new Error("fixture requires a profile");
  await app.executeDomainCommand({
    type: "profile.revise",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1",
      occurredAt: "2026-08-08T09:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "plan-change-schedule",
    },
    profileId: profile.value.id,
    expectedRevision: profile.revision,
    profile: { ...profile.value, schedule: { weeklyFrequency: 4, sessionDurationMinutes: 45 } },
  });
  await app.materializeGoalCycle({
    userId: "u1",
    currentDate: "2026-08-08",
    trigger: "schedule_changed",
    idempotencyKey: "materialize-schedule-change",
  });

  const jobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:today_plan_changed",
  );
  const revised = await app.readDomainProjection({ userId: "u1" });
  assert.ok(revised.plan);
  if (!revised.plan) throw new Error("fixture requires a revised plan");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.trigger.causationId, `${revised.plan.value.id}:${revised.plan.revision}`);
  assert.equal(jobs[0]?.trigger.factFrontier.some((ref) => ref.aggregate === "plan" && ref.id === revised.plan!.value.id && ref.revision === revised.plan!.revision), true);
  assert.equal(jobs[0]?.localDateIntent, "2026-08-08");
});

test("生成周报后才入队周报提醒，通知锚定已持久化的报告", async () => {
  const { app } = fixture();
  await bootstrapAndPlan(app);
  await app.ensureDefaultEventRecipes("u1");

  const result = await app.runWeeklyReview({
    userId: "u1",
    weekStart: "2026-08-03",
    weekEnd: "2026-08-09",
    idempotencyKey: "week-32-review",
  });

  const jobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:weekly_review",
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.trigger.causationId, result.report.id);
  assert.equal(jobs[0]?.localDateIntent, "2026-08-09");
  assert.equal(jobs[0]?.trigger.factFrontier.length > 0, true);
});

test("恢复周结束的确定性重排完成后入队 Deload 说明提醒", async () => {
  const { app } = fixture();
  await bootstrapAndPlan(app);
  await app.ensureDefaultEventRecipes("u1");
  const domain = await app.readDomainProjection({ userId: "u1" });
  const cycle = domain.goalCycles.at(-1)?.value;
  const mesocycle = cycle?.phasePath?.find((phase) => phase.plannedRecoveryWindow);
  const recoveryWeek = mesocycle?.weeklyIntents.find(
    (week) => week.ordinal === mesocycle?.plannedRecoveryWindow?.weekOrdinal,
  );
  assert.ok(mesocycle && recoveryWeek, "fixture requires a planned recovery week");
  if (!mesocycle || !recoveryWeek) throw new Error("fixture requires a recovery week");

  await app.evaluateDeloadEndedReplan({
    userId: "u1",
    mesocycleId: mesocycle.id,
    occurredOn: recoveryWeek.endDate,
    idempotencyKey: "deload-ended",
  });

  const jobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:deload_ended",
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.trigger.causationId, `${mesocycle.id}:${recoveryWeek.id}`);
  assert.equal(jobs[0]?.localDateIntent, recoveryWeek.endDate);
});

test("非正常恢复约束在确认后入队隐私安全的恢复变化提醒，正常 check-in 不触发", async () => {
  const { app } = fixture();
  await bootstrapAndPlan(app);
  await app.ensureDefaultEventRecipes("u1");
  await app.submitRecoveryCheckIn({
    userId: "u1",
    idempotencyKey: "low-recovery",
    occurredAt: "2026-08-08T07:00:00.000+08:00",
    validUntil: "2026-08-09T07:00:00.000+08:00",
    checkIn: { perceivedRecovery: 2, fatigue: 8, comparablePerformanceDeclines: 2 },
  });

  const jobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:recovery_changed",
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.trigger.recoveryEvidence, "available");
  assert.equal(jobs[0]?.localDateIntent, "2026-08-08");
});

test("晨间后台入口只读取已提交的本地事实；健康数据不可用时降级为 check-in 提醒", async () => {
  const { app } = fixture();
  await bootstrapAndPlan(app);
  await app.ensureDefaultEventRecipes("u1");

  const result = await app.triggerMorningRecoveryCheckIn({
    userId: "u1",
    occurredAt: "2026-08-08T07:30:00.000+08:00",
    timezoneOffsetMinutes: 480,
  });

  const jobs = (await app.listScheduledJobs("u1")).filter(
    (job) => job.recipeId === "default-recipe:morning_check_in",
  );
  assert.deepEqual(result, { recoveryEvidence: "unavailable" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.trigger.recoveryEvidence, "unavailable");
  assert.equal(jobs[0]?.localDateIntent, "2026-08-08");
  assert.equal(jobs[0]?.trigger.factFrontier.length > 0, true);
});
