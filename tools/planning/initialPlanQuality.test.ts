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
  const resistanceSessions = activeSessions.filter((session) => session.kind !== "cardio");
  // 力量日节奏必须均匀分散（有氧日单独安排在非训练日，不参与力量节奏断言）
  assert.deepEqual(
    resistanceSessions.map((session) => session.scheduledFor),
    ["2026-08-03", "2026-08-05", "2026-08-07", "2026-08-09"],
    "默认 4 天节奏应均匀分散，不能自动排成周一、周二、周三连续训练",
  );
  assert.equal(resistanceSessions.length, 4, "4 天排程应产出 4 个力量日（有氧不占用力量日）");
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
    // 语义修正（2026-08-11）：不用"每课总组数"当质量指标（验收标准 §1.1：总组数混合不同肌群后意义有限）。
    // 防退化的真实判据是：动作数够、每课有实质内容、且每肌群周量在目标区间内（下方断言）。
    assert.ok(session.tasks.length >= 4, `${session.scheduledFor} 只有 ${session.tasks.length} 个动作`);
    assert.ok(workingSets >= 8, `${session.scheduledFor} 只有 ${workingSets} 个工作组`);
    // 语义修正（2026-08-11）：周量目标已满足时不硬塞组数去填时间；
    // 但时长利用不足必须显式标记，让用户决定是否加内容（不静默留白）。
    if (plannedMinutes < 45) {
      assert.ok(
        decision.reasonCodes.includes("session_time_under_utilized_volume_target_met"),
        `${session.scheduledFor} 仅 ${plannedMinutes} 分钟且未标记时长利用不足`,
      );
    }
    assert.equal(session.estimatedDuration?.value, Math.min(75, plannedMinutes));
  }

  // 每肌群周量必须落在该经验/目标的目标区间内（这才是防"静态模板"的实质判据）
  const ledger = week.weeklyDirectSets ?? {};
  for (const muscle of ["chest", "back", "quadriceps"]) {
    const sets = ledger[muscle] ?? 0;
    assert.ok(sets >= 6, `${muscle} 周量仅 ${sets} 组，低于减脂保肌的维持下限`);
    assert.ok(sets <= 16, `${muscle} 周量 ${sets} 组过高`);
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
