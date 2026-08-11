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
    trainingExperience: "intermediate",
    locale: "zh-CN",
    schedule: { weeklyFrequency: 3, sessionDurationMinutes: 75 },
    locations: [
      {
        id: "gym-main",
        kind: "gym",
        environment: { space: "large", noise: "any" },
        availableEquipment: ["full_gym"],
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

const bench = registry
  .search({ movementPattern: "horizontal_push", loadModes: ["barbell"] })
  .find((exercise) => exercise.identity.movement === "bench_press")!;

const benchHistory = {
  exerciseVariantId: bench.id,
  occurredAt: "2026-08-01T10:00:00.000Z",
  load: { value: 60, unit: "kg" as const },
  reps: 8,
  rir: 3,
  confidence: "confirmed" as const,
  evidenceRef: "workout:w-1:set:s-1",
};

function request(overrides: Partial<PlannerRequest> = {}, factsOverrides: Partial<PlannerFacts> = {}): PlannerRequest {
  return {
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    facts: facts(factsOverrides),
    ...overrides,
  };
}

test("过期恢复约束不再压低训练量（1970 比较修复）", () => {
  const expiredRecovery = {
    revision: 1,
    value: {
      id: "recovery-1",
      level: "recovery_priority" as const,
      validUntil: "2026-08-01",
      evaluation: {
        rulePackId: "recovery.default",
        ruleVersion: "1.0.0",
        evaluatedAt: "2026-07-31T08:00:00.000Z",
        triggeringFactRefs: [],
        corroboratingFactRefs: [],
        contradictingFactRefs: [],
        missingOrStale: [],
        reasonCodes: [],
        confirmationRequired: false,
      },
    },
  };
  const decision = planner.plan(
    request({}, { recoveryConstraints: [expiredRecovery] }),
  );
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const kinds = decision.planRevision.sessions.map((session) => session.kind);
  assert.ok(!kinds.includes("recovery"), "过期约束不应把训练替换为恢复安排");

  const activeRecovery = {
    revision: 2,
    value: { ...expiredRecovery.value, validUntil: "2026-08-10" },
  };
  const active = planner.plan(request({}, { recoveryConstraints: [activeRecovery] }));
  assert.equal(active.kind, "plan_proposal");
  if (active.kind !== "plan_proposal") return;
  assert.ok(
    active.planRevision.sessions.some((session) => session.kind === "recovery"),
    "有效约束应生效",
  );
});

test("session_completed：历史更新后重算，diff 非空则出新 revision", () => {
  const base = planner.plan(request());
  assert.equal(base.kind, "plan_proposal");
  if (base.kind !== "plan_proposal") return;
  const priorPlan = { revision: 1, value: base.planRevision };

  // 同样的输入但没有历史变化 → no_change
  const same = planner.plan(
    request({ trigger: "session_completed" }, { priorPlan }),
  );
  assert.equal(same.kind, "no_change");

  // 新的确认历史 → 处方变化 → diff 非空 → 新 revision
  const withHistory = planner.plan(
    request(
      { trigger: "session_completed", historicalPerformance: [benchHistory] },
      { priorPlan },
    ),
  );
  assert.equal(withHistory.kind, "plan_proposal");
  if (withHistory.kind !== "plan_proposal") return;
  const anchored = withHistory.planRevision.sessions
    .flatMap((session) => session.tasks)
    .find((task) => task.exerciseVariantId === bench.id);
  assert.equal(anchored?.sets[0]?.targetLoadStatus, "predicted_target");
  assert.deepEqual(anchored?.sets[0]?.targetRirRange, { min: 2, max: 4 });
});
