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

function facts(overrides: Partial<PlannerFacts> = {}, goalOverrides: Partial<GoalContractData> = {}): PlannerFacts {
  const profile: UserProfileData = {
    id: "profile-1",
    trainingExperience: "intermediate",
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
    ...goalOverrides,
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

function request(overrides: Partial<PlannerRequest> = {}, factsOverrides: Partial<PlannerFacts> = {}, goalOverrides: Partial<GoalContractData> = {}): PlannerRequest {
  return {
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    facts: facts(factsOverrides, goalOverrides),
    ...overrides,
  };
}

test("默认不按日历排 deload：无恢复窗口、无恢复意图周", () => {
  const decision = planner.plan(request());
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const mesocycle = decision.goalCycle.phasePath?.[0];
  assert.equal(mesocycle?.plannedRecoveryWindow, undefined);
  assert.ok(
    mesocycle?.weeklyIntents.every((week) => week.intent === "accumulate_goal_aligned_stimulus"),
  );
});

test("周期长度由 horizon 推导并夹在 4-12 周", () => {
  const short = planner.plan(request({}, {}, { horizon: { startDate: "2026-08-03", endDate: "2026-08-20" } }));
  assert.equal(short.kind, "plan_proposal");
  if (short.kind !== "plan_proposal") return;
  assert.equal(short.goalCycle.phasePath?.[0]?.weeklyIntents.length, 4);

  const long = planner.plan(request({}, {}, { horizon: { startDate: "2026-08-03", endDate: "2027-06-01" } }));
  assert.equal(long.kind, "plan_proposal");
  if (long.kind !== "plan_proposal") return;
  assert.equal(long.goalCycle.phasePath?.[0]?.weeklyIntents.length, 12);
});

test("显式选择的恢复窗口落在物化范围内时，deload 周减组、远离力竭、删可选刺激", () => {
  const decision = planner.plan(request({}, {}, { plannedRecoveryEveryWeeks: 2 }));
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const mesocycle = decision.goalCycle.phasePath?.[0];
  assert.equal(mesocycle?.plannedRecoveryWindow?.weekOrdinal, 2);

  const [week1, week2] = decision.planRevision.materializedWeeks ?? [];
  assert.ok(week1 && week2);
  const week1Sets = week1.sessions.flatMap((s) => s.tasks).flatMap((t) => t.sets);
  const week2Sets = week2.sessions.flatMap((s) => s.tasks).flatMap((t) => t.sets);
  assert.ok(week1Sets.length > 0 && week2Sets.length > 0);
  // 减组：deload 周总组数明显更少
  assert.ok(week2Sets.length < week1Sets.length);
  // 远离力竭：deload 周 RIR 区间整体上移
  const week1Rir = week1.sessions.flatMap((s) => s.stimulusSlots ?? [])
    .map((slot) => slot.prescription.targetRirRange?.min)
    .filter((value): value is number => value !== undefined);
  const week2Rir = week2.sessions.flatMap((s) => s.stimulusSlots ?? [])
    .map((slot) => slot.prescription.targetRirRange?.min)
    .filter((value): value is number => value !== undefined);
  assert.ok(week1Rir.length > 0 && week2Rir.length > 0);
  assert.ok(Math.min(...week2Rir) > Math.min(...week1Rir));
  // 删可选刺激：deload 周无 optional 优先级 slot
  const week2Slots = week2.sessions.flatMap((s) => s.stimulusSlots ?? []);
  assert.ok(week2Slots.every((slot) => slot.intent.priority !== "optional"));
});
