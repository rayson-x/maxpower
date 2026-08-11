import assert from "node:assert/strict";
import test from "node:test";

import type { CoachingMandateData, GoalContractData, UserProfileData } from "../../src/coach/domain";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { GoalCyclePlanner, type PlannerDecision, type PlannerFacts } from "../../src/planning";

/**
 * 人群分档与个体化验收（2026-08-12）。
 *
 * 依据：recomp 可行性按人群分档（Barakat 2020）+ 体型状态影响赤字幅度与冲击选择。
 * 这是"给不同用户不同方案"的那一层——不是所有人套同一个模板。
 */

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const planner = new GoalCyclePlanner(registry);

function planFor(input: {
  experience?: UserProfileData["trainingExperience"];
  returningStatus?: UserProfileData["returningStatus"];
  weightKg?: number;
  heightCm?: number;
  goal?: GoalContractData["primaryGoal"];
  goalType?: GoalContractData["goalType"];
  training?: "minimal" | "standard" | "high";
  emphasisMuscles?: readonly string[];
  dailyStepTarget?: number;
  recentPhase?: "bulk" | "cut" | "maintain";
}): PlannerDecision {
  const profile: UserProfileData = {
    id: "profile-1",
    trainingExperience: input.experience ?? "intermediate",
    locale: "zh-CN",
    ...(input.weightKg && input.heightCm
      ? {
          demographics: {
            ageYears: 30,
            sex: "male",
            height: { value: input.heightCm, unit: "cm" },
            currentWeight: { value: input.weightKg, unit: "kg" },
          },
        }
      : {}),
    ...(input.returningStatus ? { returningStatus: input.returningStatus } : {}),
    schedule: { weeklyFrequency: 4, sessionDurationMinutes: 60 },
    locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    ...(input.recentPhase ? { historyModifiers: { recentPhase: input.recentPhase } } : {}),
  };
  const goalContract: GoalContractData = {
    id: "goal-1",
    primaryGoal: input.goal ?? "fat_loss_preserve_lean_mass",
    ...(input.goalType ? { goalType: input.goalType } : {}),
    successMetrics: ["weekly_training_adherence"],
    horizon: { startDate: "2026-08-03", endDate: "2026-09-13" },
    status: "active",
    ...(input.training ? { commitmentPreferences: { training: input.training } } : {}),
    ...(input.emphasisMuscles ? { emphasisMuscles: input.emphasisMuscles } : {}),
    ...(input.dailyStepTarget !== undefined ? { dailyStepTarget: input.dailyStepTarget } : {}),
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
  return decision.planRevision;
}

// ─── 人群分档：recomp 可行性 ───

test("很瘦的新手增肌 → 不应给赤字（新手窗口期 + 体脂低储备少）", () => {
  const decision = planFor({ experience: "beginner", weightKg: 62, heightCm: 178, goal: "hypertrophy", goalType: "hypertrophy" });
  const plan = couplingOf(decision);
  assert.notEqual(plan.nutritionGuidance?.calorieDirection, "deficit", "瘦的新手增肌不应给赤字");
});

test("很胖的新手减脂 → recomp 高度可行，应明示可同时掉脂增肌", () => {
  const decision = planFor({ experience: "beginner", weightKg: 108, heightCm: 176, goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(
    decision.reasonCodes.some((code) => code.startsWith("recomp_favorable")),
    `高体脂新手应标记 recomp 有利，实际：${decision.reasonCodes.join(", ")}`,
  );
});

test("刚过增肌期转刷脂 → 起步小赤字 + 维持负荷，不同时加有氧又降碳", () => {
  const decision = planFor({ recentPhase: "bulk", goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(
    decision.reasonCodes.some((code) => code.startsWith("post_bulk_cut")),
    `刚增肌完转刷脂应有专门策略，实际：${decision.reasonCodes.join(", ")}`,
  );
  // 起步赤字应该小（不是一上来大缺口）
  const weeklyRate = decision.planRevision.nutritionGuidance?.weeklyRateTarget;
  if (weeklyRate) {
    assert.ok(weeklyRate.max <= 0.6, `post-bulk 起步周降幅应保守，实际上限 ${weeklyRate.max}%`);
  }
});

test("高级 + 低体脂减脂 → 明示增肌会很慢，目标应是保肌而非 recomp", () => {
  const decision = planFor({ experience: "advanced", weightKg: 78, heightCm: 180, goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(
    decision.reasonCodes.some((code) => code.startsWith("recomp_slow") || code.startsWith("preserve_not_recomp")),
    `高级低体脂应明示增肌慢，实际：${decision.reasonCodes.join(", ")}`,
  );
});

// ─── 赤字幅度按体脂分档（%体重/周） ───

test("赤字幅度按体脂状态分档：体脂越高允许的周降幅越大", () => {
  const heavy = couplingOf(planFor({ weightKg: 108, heightCm: 176, goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" }));
  const lean = couplingOf(planFor({ weightKg: 62, heightCm: 178, goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" }));
  const heavyRate = heavy.nutritionGuidance?.weeklyRateTarget;
  const leanRate = lean.nutritionGuidance?.weeklyRateTarget;
  assert.ok(heavyRate, "大基数应有周降幅目标");
  assert.ok(leanRate, "偏瘦应有周降幅目标");
  assert.ok(heavyRate.max > leanRate.max, `大基数允许更快（${heavyRate.max}%）应大于偏瘦（${leanRate.max}%）`);
  assert.ok(leanRate.max <= 0.7, `偏瘦者周降幅应保守，实际 ${leanRate.max}%`);
});

// ─── 局部侧重（emphasis） ───

test("emphasis 肌群周量提升，其余肌群不低于维持线", () => {
  const decision = planFor({ goal: "hypertrophy", goalType: "hypertrophy", emphasisMuscles: ["glutes", "deltoids"] });
  const plan = couplingOf(decision);
  const week = plan.materializedWeeks?.[plan.materializedWeeks.length - 1];
  const ledger = week?.weeklyDirectSets ?? {};
  const glutes = ledger.glutes ?? 0;
  assert.ok(glutes >= 8, `emphasis 的 glutes 周量应提升，实际 ${glutes}`);
  // 其余肌群不能因 emphasis 被挤到 0
  for (const muscle of ["chest", "back", "quadriceps"]) {
    assert.ok((ledger[muscle] ?? 0) >= 2, `${muscle} 不应因 emphasis 被挤掉，实际 ${ledger[muscle]}`);
  }
});

// ─── 步数 / NEAT ───

test("减脂计划应含步数/日常活动目标（NEAT 是掉秤停滞的主因）", () => {
  const decision = planFor({ goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" });
  const plan = couplingOf(decision);
  const stepTarget = plan.nutritionGuidance?.dailyStepTarget ?? plan.recoveryGuidance?.dailyStepTarget;
  assert.ok(stepTarget !== undefined || decision.reasonCodes.some((c) => c.includes("step")), "减脂计划应有步数目标或步数相关说明");
});

// ─── 高体脂人群有氧冲击等级 ───

test("大基数用户的有氧应优先低冲击", () => {
  const decision = planFor({ weightKg: 108, heightCm: 176, goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(
    decision.reasonCodes.some((code) => code.includes("low_impact") || code.includes("high_body_mass")),
    `大基数应有低冲击标记，实际：${decision.reasonCodes.join(", ")}`,
  );
});

test("emphasis 肌群周量提升但不得超过单肌群周量硬上限（防堆量）", () => {
  const decision = planFor({ goal: "hypertrophy", goalType: "hypertrophy", emphasisMuscles: ["glutes", "deltoids"] });
  const plan = couplingOf(decision);
  const week = plan.materializedWeeks?.[plan.materializedWeeks.length - 1];
  const ledger = week?.weeklyDirectSets ?? {};
  for (const muscle of ["glutes", "deltoids"]) {
    const sets = ledger[muscle] ?? 0;
    assert.ok(sets >= 8, `emphasis 肌群 ${muscle} 应提升到上段，实际 ${sets}`);
    assert.ok(sets <= 14, `emphasis 肌群 ${muscle} 不得超过周量硬上限，实际 ${sets}`);
  }
  // 超量时必须有审计记录
  assert.ok(
    decision.kind === "plan_proposal" && decision.reasonCodes.some((code) => code.startsWith("volume_capped")),
    "发生封顶时必须留痕",
  );
});

// ─── 滚动 7 天视图与恢复保护（2026-08-12）───

test("滚动 7 天视图：从当前日起满 7 天，力量日数量与声明频率一致", () => {
  // 周三（2026-08-12）开始规划：日历周只剩 4 天，但用户期待看到完整一周
  const decision = planFor({ goal: "hypertrophy", goalType: "hypertrophy" });
  const plan = couplingOf(decision);
  const seven = plan.upcomingSevenDays ?? [];
  assert.equal(seven.length, 7, `滚动窗口应覆盖 7 天，实际 ${seven.length}`);
  assert.equal(seven[0]?.scheduledFor, "2026-08-03", "应从当前日开始");
  const strengthDays = seven.filter((s) => s.tasks.length > 0 && s.kind !== "cardio").length;
  assert.equal(strengthDays, 4, `力量日应等于声明频率 4，实际 ${strengthDays}`);
});

test("恢复保护：每周至少保留 1 天完全无结构化安排（有氧不得填满所有休息日）", () => {
  // 高频 + 有氧需求的减脂场景最容易被排满
  const decision = planFor({ goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" });
  const plan = couplingOf(decision);
  const seven = plan.upcomingSevenDays ?? [];
  const fullRest = seven.filter((s) => s.tasks.length === 0).length;
  assert.ok(fullRest >= 1, `滚动 7 天内应至少 1 天完全休息，实际 ${fullRest}`);
});

test("有氧被上限截断时必须留审计记录", () => {
  const decision = planFor({ goal: "fat_loss_preserve_lean_mass", goalType: "fat_loss" });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const plan = decision.planRevision;
  const seven = plan.upcomingSevenDays ?? [];
  const aerobic = seven.filter((s) => s.kind === "cardio").length;
  const fullRest = seven.filter((s) => s.tasks.length === 0).length;
  // 如果有氧被截断（休息日恰好只剩 1 天），必须有 reason code
  if (fullRest === 1 && aerobic > 0) {
    assert.ok(
      decision.reasonCodes.some((code) => code.includes("preserve_full_rest_day")),
      `截断有氧必须留痕，实际 codes: ${decision.reasonCodes.filter((c) => c.includes("aerobic")).join(",")}`,
    );
  }
});
