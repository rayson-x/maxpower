import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let sequence = 0;
  let now = "2026-08-08T08:00:00.000+08:00";
  const ledger = new InMemoryCoachLedger();
  const app = new LocalProductKernel({
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

async function bootstrapAndPlan(app: LocalProductKernel) {
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
    mandate: { id: "mandate-1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
}







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
