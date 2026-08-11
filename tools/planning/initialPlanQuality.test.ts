import assert from "node:assert/strict";
import test from "node:test";

import type { CoachingMandateData, GoalContractData, UserProfileData } from "../../src/coach/domain";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { buildPlanningReportSummary } from "../../src/mobile/ui/planningReport";
import { GoalCyclePlanner, type PlannerFacts } from "../../src/planning";

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const planner = new GoalCyclePlanner(registry);

function advancedFourDayFacts(): PlannerFacts {
  const profile: UserProfileData = {
    id: "profile-plan-quality",
    trainingExperience: "advanced",
    locale: "zh-CN",
    schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
    locations: [{
      id: "location:gym",
      kind: "gym",
      environment: { space: "large", noise: "any" },
      availableEquipment: ["full_gym"],
    }],
    strengthBaseline: {
      squat: { value: 120, unit: "kg" },
      benchPress: { value: 90, unit: "kg" },
      deadlift: { value: 150, unit: "kg" },
      measuredAt: "2026-08-01T08:00:00.000Z",
      source: "user_confirmed",
    },
  };
  const goal: GoalContractData = {
    id: "goal-plan-quality",
    primaryGoal: "fat_loss_preserve_lean_mass",
    modifiers: [],
    successMetrics: ["training_performance_maintained"],
    horizon: { startDate: "2026-08-03", endDate: "2026-10-26" },
    status: "active",
  };
  const mandate: CoachingMandateData = { id: "mandate-plan-quality", mode: "collaborative" };
  return {
    userId: "user-plan-quality",
    profile: { revision: 1, value: profile },
    goalContract: { revision: 1, value: goal },
    mandate: { revision: 1, value: mandate },
    safetyConstraints: [],
    equipmentProfiles: [],
    recoveryConstraints: [],
    nutritionStrategies: [],
    timeline: [],
  };
}

test("4 天×75 分钟的进阶健身房计划不会退化成连续三天、每次 7 组的静态模板", () => {
  const decision = planner.plan({
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    facts: advancedFourDayFacts(),
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;

  const week = decision.planRevision.materializedWeeks?.[0];
  assert.ok(week);
  const activeSessions = week.sessions.filter((session) => session.tasks.length > 0);
  assert.deepEqual(
    activeSessions.map((session) => session.scheduledFor),
    ["2026-08-03", "2026-08-05", "2026-08-07", "2026-08-09"],
    "默认 4 天节奏应均匀分散，不能自动排成周一、周二、周三连续训练",
  );

  const resistanceSessions = activeSessions.filter((session) => session.kind !== "cardio");
  assert.equal(resistanceSessions.length, 3);
  const report = buildPlanningReportSummary(decision);
  const resistanceSetCount = resistanceSessions.reduce(
    (sum, session) => sum + session.tasks.reduce((taskSum, task) => taskSum + task.sets.length, 0),
    0,
  );
  assert.equal(report.totalWorkSets, resistanceSetCount, "有氧分钟不能伪装成力量训练工作组");
  for (const session of resistanceSessions) {
    const workingSets = session.tasks.reduce((sum, task) => sum + task.sets.length, 0);
    const plannedMinutes = (session.stimulusSlots ?? []).reduce(
      (sum, slot) => sum + slot.exerciseSlot.sessionTimeImpactMinutes,
      10 + Math.max(0, (session.stimulusSlots?.length ?? 0) - 1) * 2,
    );
    assert.ok(workingSets >= 10, `${session.scheduledFor} 只有 ${workingSets} 个工作组`);
    assert.ok(plannedMinutes >= 45, `${session.scheduledFor} 只规划了约 ${plannedMinutes} 分钟内容`);
    assert.equal(session.estimatedDuration?.value, Math.min(75, plannedMinutes));
  }

  const resistanceSets = resistanceSessions.flatMap((session) => session.tasks).flatMap((task) => task.sets);
  assert.ok(resistanceSets.some((set) => set.targetReps?.min === 6 && set.targetReps.max === 10));
  assert.ok(resistanceSets.some((set) => set.targetReps?.min === 10 && set.targetReps.max === 15));
  assert.ok(resistanceSets.some((set) => set.rest?.unit === "seconds" && set.rest.value === 180));

  const benchSlot = resistanceSessions
    .flatMap((session) => session.stimulusSlots ?? [])
    .find((slot) => slot.exerciseSlot.exerciseVariantId?.includes("bench_press"));
  assert.ok(benchSlot?.exerciseSlot.reasonCodes.includes("user_strength_baseline_reference"));
  assert.ok(
    resistanceSessions
      .flatMap((session) => session.tasks)
      .flatMap((task) => task.sets)
      .every((set) => set.targetLoadStatus === "unknown"),
    "只有 kg、没有次数/RIR 的力量基线只能影响计划上下文，不能伪造精确工作重量",
  );
});
