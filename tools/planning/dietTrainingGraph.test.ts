import assert from "node:assert/strict";
import test from "node:test";

import type { CoachingMandateData, GoalContractData, UserProfileData } from "../../src/coach/domain";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { GoalCyclePlanner, type PlannerDecision, type PlannerFacts } from "../../src/planning";

/**
 * 饮食 × 训练供需图验收（架构决策 2026-08-12）。
 *
 * 验证三个最小实验假设：
 * ① 新增饮食策略只需一条声明，训练侧代码零修改 → 冲突仍被正确检出并解释
 * ② 优先级正确：锁定饮食时调训练，不擅自要求用户放弃饮食策略
 * ③ 碳水日型自动跟随训练结构（改分化不需手工重配）
 */

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const planner = new GoalCyclePlanner(registry);

function plan(overrides: {
  goal?: GoalContractData["primaryGoal"];
  dietStrategyId?: string;
  dietStrategyLocked?: boolean;
  weeklyFrequency?: number;
  experience?: UserProfileData["trainingExperience"];
}): PlannerDecision {
  const profile: UserProfileData = {
    id: "profile-1",
    trainingExperience: overrides.experience ?? "intermediate",
    locale: "zh-CN",
    demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 80, unit: "kg" } },
    schedule: { weeklyFrequency: overrides.weeklyFrequency ?? 4, sessionDurationMinutes: 75 },
    locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
  };
  const goalContract: GoalContractData = {
    id: "goal-1",
    primaryGoal: overrides.goal ?? "hypertrophy",
    successMetrics: ["weekly_training_adherence"],
    horizon: { startDate: "2026-08-03", endDate: "2026-09-13" },
    status: "active",
    ...(overrides.dietStrategyId ? { dietStrategyId: overrides.dietStrategyId } : {}),
    ...(overrides.dietStrategyLocked !== undefined ? { dietStrategyLocked: overrides.dietStrategyLocked } : {}),
  };
  const mandate: CoachingMandateData = { id: "mandate-1", mode: "collaborative" };
  const facts: PlannerFacts = {
    userId: "user-1",
    profile: { revision: 1, value: profile },
    goalContract: { revision: 1, value: goalContract },
    mandate: { revision: 1, value: mandate },
    safetyConstraints: [],
    equipmentProfiles: [],
    recoveryConstraints: [],
    nutritionStrategies: [],
    timeline: [],
  };
  return planner.plan({ trigger: "initial_plan", currentDate: "2026-08-03", facts });
}

function couplingOf(decision: PlannerDecision) {
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") throw new Error("not a proposal");
  const coupling = decision.planRevision.dietTrainingCoupling;
  assert.ok(coupling, "计划必须带饮食×训练耦合结果");
  return { coupling, decision };
}

test("策略库已声明，且每条声明含四维供给与目标适配度", () => {
  const strategies = registry.programStrategies()?.dietStrategies;
  assert.ok(strategies?.length && strategies.length >= 5, "至少 5 种饮食策略");
  for (const strategy of strategies) {
    assert.ok(strategy.carbAvailability.pattern);
    assert.ok(strategy.proteinPolicy.perKgMin > 0 && strategy.proteinPolicy.perKgMax >= strategy.proteinPolicy.perKgMin);
    assert.ok(strategy.fatFloorPercentOfEnergy > 0);
    assert.ok(strategy.supports.lowIntensityAerobic === "full", "低强度有氧不依赖糖原，所有策略都应支持");
    assert.ok(strategy.goalFit.hypertrophy && strategy.goalFit.strength && strategy.goalFit.fatLoss);
    assert.ok(strategy.sourceRefs.length > 0, `${strategy.id} 缺证据引用`);
  }
});

test("默认策略按目标给出，用户显式选择优先", () => {
  const cut = couplingOf(plan({ goal: "fat_loss_preserve_lean_mass" }));
  assert.equal(cut.coupling.strategyId, "carb_cycling", "减脂默认碳循环");

  const explicit = couplingOf(plan({ goal: "fat_loss_preserve_lean_mass", dietStrategyId: "low_carb" }));
  assert.equal(explicit.coupling.strategyId, "low_carb", "用户显式选择必须优先");
});

test("① 生酮只加一条声明就被正确处理：增肌适配度低且冲突可解释", () => {
  const { coupling, decision } = couplingOf(plan({ goal: "hypertrophy", dietStrategyId: "ketogenic" }));
  assert.equal(coupling.strategyId, "ketogenic");
  assert.equal(coupling.goalFit, "poor", "生酮+增肌应评为低适配");

  // 必须给出可读解释（不是只有一个错误码）
  const fitConflict = coupling.conflicts.find((conflict) => conflict.ruleId === "F1_strategy_goal_fit");
  assert.ok(fitConflict, "低适配必须产生显式冲突");
  assert.ok(fitConflict.explanation.includes("生酮"), "解释要点名策略");
  assert.ok(fitConflict.explanation.length > 30, "解释要说清前因后果");

  // 冲突进 reasonCodes 与 trace（可观测）
  if (decision.kind !== "plan_proposal") return;
  assert.ok(decision.reasonCodes.includes("diet_goal_fit:poor"));
  assert.ok(decision.reasonCodes.some((code) => code.startsWith("diet_training_conflict:")));
  assert.ok(
    decision.trace.constraintEvents.some((event) => event.startsWith("coupling:")),
    "耦合边的触发必须写进 PlannerTrace",
  );
});

test("① 生酮的碳水日型不出现高碳日（very_low 模式）", () => {
  const { coupling } = couplingOf(plan({ dietStrategyId: "ketogenic" }));
  const types = new Set(Object.values(coupling.carbDayTypes));
  assert.ok(!types.has("high"), "极低碳策略不应产生高碳日");
});

test("② 锁定饮食策略时默认解法是调训练，而不是要求换策略", () => {
  const locked = couplingOf(plan({ goal: "hypertrophy", dietStrategyId: "ketogenic", dietStrategyLocked: true }));
  const c1 = locked.coupling.conflicts.find((conflict) => conflict.ruleId === "C1_glycogen_demand_vs_carb_availability");
  assert.ok(c1, "生酮 + 高强度工作应触发 C1");
  assert.ok(
    c1.defaultResolution.includes("次数") || c1.defaultResolution.includes("负荷"),
    `锁定时默认解法应是调训练形式，实际：${c1.defaultResolution}`,
  );
  assert.ok(c1.explanation.includes("保留你的饮食策略"), "锁定时必须明确不动用户的饮食选择");

  const unlocked = couplingOf(plan({ goal: "hypertrophy", dietStrategyId: "ketogenic", dietStrategyLocked: false }));
  const unlockedC1 = unlocked.coupling.conflicts.find(
    (conflict) => conflict.ruleId === "C1_glycogen_demand_vs_carb_availability",
  );
  // 未锁定时仍先调训练，但允许把"换策略"作为后备选项呈现
  assert.ok(unlockedC1);
});

test("③ 碳水日型自动跟随训练结构（改分化不需手工重配）", () => {
  const fourDay = couplingOf(plan({ goal: "fat_loss_preserve_lean_mass", weeklyFrequency: 4 }));
  const sixDay = couplingOf(plan({ goal: "fat_loss_preserve_lean_mass", weeklyFrequency: 6 }));

  const countHigh = (types: Readonly<Record<string, string>>) =>
    Object.values(types).filter((type) => type === "high").length;
  const countLow = (types: Readonly<Record<string, string>>) =>
    Object.values(types).filter((type) => type === "low").length;

  // 训练天数增加 → 低碳日（休息/纯有氧日）应减少
  assert.ok(
    countLow(sixDay.coupling.carbDayTypes) <= countLow(fourDay.coupling.carbDayTypes),
    `6 天的低碳日(${countLow(sixDay.coupling.carbDayTypes)})不应多于 4 天(${countLow(fourDay.coupling.carbDayTypes)})`,
  );
  // 两种排程都应产生非空分档
  assert.ok(Object.keys(fourDay.coupling.carbDayTypes).length === 7);
  assert.ok(countHigh(fourDay.coupling.carbDayTypes) + countLow(fourDay.coupling.carbDayTypes) > 0);
});

test("均衡碳水策略不产生日间分档（constant 模式）", () => {
  const { coupling } = couplingOf(plan({ goal: "strength", dietStrategyId: "even_carbs" }));
  const types = new Set(Object.values(coupling.carbDayTypes));
  assert.deepEqual([...types], ["moderate"], "constant 模式应全部为中碳");
});

test("高适配组合不产生 tradeoff 级冲突", () => {
  const { coupling } = couplingOf(plan({ goal: "hypertrophy", dietStrategyId: "higher_carb_surplus" }));
  assert.equal(coupling.goalFit, "good");
  const blocking = coupling.conflicts.filter((conflict) => conflict.severity !== "advisory");
  assert.deepEqual(blocking, [], `高碳+增肌不应有取舍级冲突：${JSON.stringify(blocking)}`);
});
