import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let sequence = 0;
  let now = "2026-08-08T08:00:00.000Z";
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => now,
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
  });
  return { app, ledger, setNow: (value: string) => { now = value; } };
}

async function bootstrapAndPlan(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "stability-user",
      actor: { kind: "user", id: "stability-user" },
      deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "stability-bootstrap",
    },
    profile: {
      id: "stability-profile",
      trainingExperience: "beginner",
      locale: "zh-CN",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{
        id: "stability-home",
        kind: "home",
        environment: { space: "medium", noise: "quiet" },
        availableEquipment: ["bodyweight", "floor_space"],
      }],
    },
    goalContract: {
      id: "stability-goal",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08", endDate: "2026-10-30" },
      status: "active",
    },
    mandate: { id: "stability-mandate", mode: "collaborative" },
  });
  await app.materializeGoalCycle({
    userId: "stability-user",
    currentDate: "2026-08-08",
    trigger: "initial_plan",
    idempotencyKey: "stability-plan",
  });
}

test("Facade 将历史本地评估交给稳定性策略：日程抖动只留下 deferred 评估，不重复产生 Proposal", async () => {
  const { app, ledger, setNow } = fixture();
  await bootstrapAndPlan(app);
  const availability = [{ weekday: 1, availableMinutes: 35, locationId: "stability-home" }];
  const first = await app.evaluateLocalReplan({
    userId: "stability-user",
    currentDate: "2026-08-08",
    schedule: availability,
    trigger: {
      id: "stability-schedule-1",
      kind: "schedule_changed",
      actor: "rule_engine",
      occurredAt: "2026-08-08T08:00:00.000Z",
      causationId: "schedule-r1",
      idempotencyKey: "stability-schedule-1",
    },
    window: { start: "2026-08-03", end: "2026-08-09" },
  });
  assert.equal(first.outcome, "proposal_required");

  setNow("2026-08-08T12:00:00.000Z");
  const second = await app.evaluateLocalReplan({
    userId: "stability-user",
    currentDate: "2026-08-08",
    schedule: availability,
    trigger: {
      id: "stability-schedule-2",
      kind: "schedule_changed",
      actor: "rule_engine",
      occurredAt: "2026-08-08T12:00:00.000Z",
      causationId: "schedule-r2",
      idempotencyKey: "stability-schedule-2",
    },
    window: { start: "2026-08-03", end: "2026-08-09" },
  });
  assert.equal(second.outcome, "proposal_deferred");
  assert.equal(second.stability.status, "cooldown_deferred");
  assert.deepEqual(second.stability.basedOnEvaluationIds, [first.id]);
  assert.equal(
    (await ledger.read()).artifacts.filter((artifact) => artifact.kind === "replan_evaluation").length,
    2,
  );
});
