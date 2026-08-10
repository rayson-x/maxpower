import assert from "node:assert/strict";
import test from "node:test";

import type {
  CoachingMandateData,
  GoalContractData,
  UserProfileData,
} from "../../src/coach/domain";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { GoalCyclePlanner, type PlannerFacts, type PlannerRequest } from "../../src/planning";

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const planner = new GoalCyclePlanner(registry);

function facts(overrides: Partial<PlannerFacts> = {}): PlannerFacts {
  const profile: UserProfileData = {
    id: "profile-1",
    trainingExperience: "beginner",
    locale: "zh-CN",
    schedule: { weeklyFrequency: 3, sessionDurationMinutes: 50 },
    locations: [
      {
        id: "home-main",
        kind: "home",
        environment: { space: "medium", noise: "quiet" },
        availableEquipment: ["bodyweight", "floor_space"],
      },
    ],
  };
  const goal: GoalContractData = {
    id: "goal-1",
    primaryGoal: "hypertrophy",
    modifiers: ["conditioning"],
    successMetrics: ["weekly_training_adherence", "confirmed_performance_trend"],
    horizon: { startDate: "2026-08-03", endDate: "2026-09-13" },
    maintenanceFloors: ["retain_lower_body_exposure"],
    status: "active",
  };
  const mandate: CoachingMandateData = { id: "mandate-1", mode: "collaborative" };
  return {
    userId: "user-1",
    profile: { revision: 1, value: profile },
    goalContract: { revision: 1, value: goal },
    mandate: { revision: 1, value: mandate },
    safetyConstraints: [],
    equipmentProfiles: [],
    recoveryConstraints: [],
    nutritionStrategies: [],
    timeline: [],
    ...overrides,
  };
}

function request(overrides: Partial<PlannerRequest> = {}): PlannerRequest {
  return {
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    facts: facts(),
    ...overrides,
  };
}

test("无历史：处方带校准 RIR 区间 4-5，标量兼容中点", () => {
  const decision = planner.plan(request());
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const sets = decision.planRevision.sessions
    .flatMap((session) => session.tasks)
    .flatMap((task) => task.sets)
    .filter((set) => set.targetReps !== undefined);
  assert.ok(sets.length > 0);
  for (const set of sets) {
    assert.deepEqual(set.targetRirRange, { min: 4, max: 5 });
    assert.equal(set.targetRir, 5);
  }
});

test("有历史：处方带工作 RIR 区间 2-4，不塌缩为标量", () => {
  const bench = registry
    .search({ movementPattern: "horizontal_push", loadModes: ["barbell"] })
    .find((exercise) => exercise.identity.movement === "bench_press")!;
  const gymFacts = facts({
    profile: {
      revision: 2,
      value: {
        ...facts().profile.value,
        trainingExperience: "advanced",
        locations: [
          {
            id: "gym-main",
            kind: "gym",
            environment: { space: "large", noise: "any" },
            availableEquipment: ["full_gym"],
          },
        ],
      },
    },
  });
  const history = {
    exerciseVariantId: bench.id,
    occurredAt: "2026-08-06T10:00:00.000Z",
    load: { value: 80, unit: "kg" as const },
    reps: 6,
    rir: 2,
    confidence: "confirmed" as const,
    evidenceRef: "timeline:set-bench:r4",
  };
  const decision = planner.plan(
    request({ facts: gymFacts, historicalPerformance: [history] }),
  );
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const tasks = decision.planRevision.sessions.flatMap((session) => session.tasks);
  const benchSets = tasks
    .filter((task) => task.exerciseVariantId === bench.id)
    .flatMap((task) => task.sets)
    .filter((set) => set.targetReps !== undefined);
  assert.ok(benchSets.length > 0);
  for (const set of benchSets) {
    assert.deepEqual(set.targetRirRange, { min: 2, max: 4 });
    assert.equal(set.targetRir, 3);
  }
  // 无该动作精确历史的其他动作仍走校准区间
  const otherSets = tasks
    .filter((task) => task.exerciseVariantId !== bench.id)
    .flatMap((task) => task.sets)
    .filter((set) => set.targetReps !== undefined);
  assert.ok(otherSets.length > 0);
  for (const set of otherSets) {
    assert.deepEqual(set.targetRirRange, { min: 4, max: 5 });
  }
});
