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

function facts(overrides: Partial<PlannerFacts> = {}, experience: UserProfileData["trainingExperience"] = "beginner"): PlannerFacts {
  const profile: UserProfileData = {
    id: "profile-1",
    trainingExperience: experience,
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
    successMetrics: ["weekly_training_adherence"],
    horizon: { startDate: "2026-08-03", endDate: "2026-09-13" },
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

function request(overrides: Partial<PlannerRequest> = {}, factsOverrides: Partial<PlannerFacts> = {}, experience: UserProfileData["trainingExperience"] = "beginner"): PlannerRequest {
  return {
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    facts: facts(factsOverrides, experience),
    ...overrides,
  };
}

test("3 天/周 → 全身分化，每肌群每周 ≥2 次暴露、周量达起步区间", () => {
  const decision = planner.plan(request());
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(decision.reasonCodes.some((code) => code.startsWith("split_")));

  const week1 = decision.planRevision.materializedWeeks?.[0];
  assert.ok(week1?.weeklyDirectSets);
  const ledger = week1.weeklyDirectSets!;
  // 主要肌群都被覆盖
  for (const muscle of ["chest", "back", "quadriceps"]) {
    assert.ok((ledger[muscle] ?? 0) >= 2, `${muscle} 周量应 ≥2，实际 ${ledger[muscle]}`);
  }
  // 新手起步区间：主要肌群周量在 2-8 组之间（TP-VOL-BASE 保守起点）
  assert.ok((ledger.chest ?? 0) <= 8 && (ledger.quadriceps ?? 0) <= 8);
});

test("75 分钟完整推荐不被静默裁剪，超预算只标记", () => {
  const decision = planner.plan(
    request({ schedule: [{ weekday: 1, availableMinutes: 75, locationId: "gym-main" }, { weekday: 3, availableMinutes: 75, locationId: "gym-main" }, { weekday: 5, availableMinutes: 75, locationId: "gym-main" }] }),
  );
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const trainingSessions = decision.planRevision.materializedWeeks?.[0]?.sessions.filter(
    (session) => session.tasks.length > 0,
  ) ?? [];
  assert.ok(trainingSessions.length > 0);
  // 每课应有 4-6 个动作（全身架构），不是 3 动作
  for (const session of trainingSessions) {
    assert.ok(session.tasks.length >= 4, `${session.scheduledFor} 只有 ${session.tasks.length} 个动作`);
  }
  assert.ok(!decision.reasonCodes.includes("time_capacity_removed_optional_stimulus"));
});

test("偏好三分化轮转时采用 胸+三头/背+二头/肩+腿 结构", () => {
  const decision = planner.plan(request({ preferredSplitId: "three_way_rotation" }));
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(decision.reasonCodes.includes("split_user_preference_honored"));
  const sessions = decision.planRevision.materializedWeeks?.[0]?.sessions.filter(
    (session) => session.tasks.length > 0,
  ) ?? [];
  const patterns = sessions.map((session) =>
    (session.stimulusSlots ?? []).map((slot) => slot.intent.movementPattern),
  );
  // 第一天胸+三头：水平推 + 伸肘；不含蹲
  assert.ok(patterns[0]?.includes("horizontal_push"));
  assert.ok(patterns[0]?.includes("elbow_extension"));
  assert.ok(!patterns[0]?.includes("squat"));
});

test("居家徒手自动剔除无变式的 slot 且不崩（水平拉无徒手变式）", () => {
  const homeFacts = facts({
    profile: {
      revision: 2,
      value: {
        ...facts().profile.value,
        locations: [{ id: "home", kind: "home", environment: { space: "medium", noise: "quiet" }, availableEquipment: ["bodyweight", "floor_space"] }],
      },
    },
  });
  const decision = planner.plan(request({ facts: homeFacts }));
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(decision.reasonCodes.some((code) => code.startsWith("slot_dropped_no_feasible_variant")));
});
