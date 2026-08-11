import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { RuntimeServices } from "../../src/coach/model";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { GoalCyclePlanner, type PlannerFacts, type PlannerRequest } from "../../src/planning";

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const planner = new GoalCyclePlanner(registry);
const bench = registry
  .search({ movementPattern: "horizontal_push", loadModes: ["barbell"] })
  .find((exercise) => exercise.identity.movement === "bench_press")!;

function runtime(): RuntimeServices {
  let id = 0;
  return {
    now: () => "2026-08-03T10:00:00.000Z",
    nextId: (prefix) => `${prefix}-${++id}`,
  };
}

function facts(): PlannerFacts {
  return {
    userId: "user-1",
    profile: {
      revision: 1,
      value: {
        id: "profile-1",
        trainingExperience: "advanced",
        locale: "zh-CN",
        schedule: { weeklyFrequency: 3, sessionDurationMinutes: 75 },
        locations: [{ id: "gym-main", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
      },
    },
    goalContract: {
      revision: 1,
      value: {
        id: "goal-1",
        primaryGoal: "hypertrophy",
        modifiers: ["conditioning"],
        successMetrics: ["weekly_training_adherence"],
        horizon: { startDate: "2026-08-03", endDate: "2026-09-13" },
        maintenanceFloors: [],
        status: "active",
      },
    },
    mandate: { revision: 1, value: { id: "mandate-1", mode: "collaborative" } },
    safetyConstraints: [],
    equipmentProfiles: [],
    recoveryConstraints: [],
    nutritionStrategies: [],
    timeline: [],
  };
}

function meta(key: string) {
  return {
    userId: "user-1",
    actor: { kind: "rule_engine" as const, id: "test" },
    deviceId: "fixture-device",
    occurredAt: "2026-08-03T10:00:00.000Z",
    timezoneOffsetMinutes: 0,
    idempotencyKey: key,
  };
}

test("完成的训练组写成 historicalSet，后续计划从 workout 聚合获得历史并锚定负荷", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), runtime());
  const base = facts();
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: base.profile.value,
    goalContract: base.goalContract.value,
    mandate: base.mandate.value,
    meta: meta("bootstrap"),
  });

  // 初始计划带卧推历史（60kg）→ 负荷锚定
  const request: PlannerRequest = {
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    facts: base,
    historicalPerformance: [{
      exerciseVariantId: bench.id,
      occurredAt: "2026-08-01T10:00:00.000Z",
      load: { value: 60, unit: "kg" },
      reps: 8,
      rir: 3,
      confidence: "confirmed",
      evidenceRef: "workout:seed:set:1",
    }],
  };
  const initial = planner.plan(request);
  assert.equal(initial.kind, "plan_proposal");
  if (initial.kind !== "plan_proposal") return;
  await app.executeDomainCommand({
    type: "goal_cycle.revise",
    goalCycleId: initial.goalCycle.id,
    expectedRevision: 0,
    goalCycle: initial.goalCycle,
    meta: meta("store-cycle"),
  });
  await app.executeDomainCommand({
    type: "plan.revise",
    planId: initial.planRevision.id,
    expectedRevision: 0,
    revision: initial.planRevision,
    meta: meta("store-plan"),
  });

  const benchSession = initial.planRevision.sessions.find((session) =>
    session.tasks.some((task) => task.exerciseVariantId === bench.id),
  )!;
  await app.prepareWorkoutSession({
    userId: "user-1",
    workoutId: "workout-1",
    prescriptionRef: {
      planId: initial.planRevision.id,
      planRevision: 1,
      sessionPrescriptionId: benchSession.id,
    },
    idempotencyKey: "prepare-1",
  });
  await app.activateWorkoutSession({ userId: "user-1", workoutId: "workout-1", idempotencyKey: "activate-1" });
  const setCount = benchSession.tasks
    .filter((task) => task.exerciseVariantId === bench.id)
    .reduce((sum, task) => sum + task.sets.length, 0);
  for (let index = 0; index < benchSession.tasks.reduce((sum, task) => sum + task.sets.length, 0); index += 1) {
    await app.confirmCurrentSet({ userId: "user-1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: `set-${index}` });
  }
  await app.completeWorkoutSession({ userId: "user-1", workoutId: "workout-1", idempotencyKey: "complete-1" });

  // ① historicalSet 写入 timeline
  const projection = await app.readDomainProjection({ userId: "user-1" });
  const historicalSets = projection.timeline.current.filter(
    (event) => event.fact.kind === "training" && event.fact.historicalSet,
  );
  assert.ok(historicalSets.length >= setCount, `应至少写入 ${setCount} 条 historicalSet`);
  assert.ok(
    historicalSets.some((event) =>
      event.fact.kind === "training" &&
      event.fact.historicalSet?.exerciseVariantId === bench.id &&
      event.fact.historicalSet.load.value === 60
    ),
    "卧推 60kg 应写入 historicalSet",
  );

  // ② 后续计划（不传 request 历史）从 workout 聚合获得历史：锚定 60kg + 工作 RIR 区间
  const replanned = await app.previewGoalCycle({
    userId: "user-1",
    trigger: "initial_plan",
    currentDate: "2026-08-03",
  });
  assert.equal(replanned.kind, "plan_proposal");
  if (replanned.kind !== "plan_proposal") return;
  const benchTask = replanned.planRevision.sessions
    .flatMap((session) => session.tasks)
    .find((task) => task.exerciseVariantId === bench.id);
  assert.equal(benchTask?.sets[0]?.targetLoadStatus, "predicted_target");
  assert.equal(benchTask?.sets[0]?.targetLoad?.value, 60);
  assert.deepEqual(benchTask?.sets[0]?.targetRirRange, { min: 2, max: 4 });
});
