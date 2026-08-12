import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { GoalCyclePlanner, type PlannerFacts } from "../../src/planning";

/**
 * 从训练历史推断轮转位置（2026-08-12）。
 * 用户周一练了腿、周二休息，周三打开应用时 planner 必须自己接着排推/拉，
 * 而不是从轮转第一课重来（那会导致一周腿练两次、背一次没练）。
 */

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const planner = new GoalCyclePlanner(registry);

function factsWith(timeline: PlannerFacts["timeline"]): PlannerFacts {
  return {
    userId: "u",
    profile: {
      revision: 1,
      value: {
        id: "p", trainingExperience: "intermediate", locale: "zh-CN", adultConfirmed: true,
        demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } },
        schedule: { weeklyFrequency: 5, sessionDurationMinutes: 75 },
        locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
      },
    },
    goalContract: {
      revision: 1,
      value: {
        id: "g", primaryGoal: "hypertrophy", goalType: "hypertrophy",
        successMetrics: ["a"], horizon: { startDate: "2026-08-12" }, status: "active",
      },
    },
    mandate: { revision: 1, value: { id: "m", mode: "collaborative" } },
    safetyConstraints: [], equipmentProfiles: [], recoveryConstraints: [], nutritionStrategies: [],
    timeline,
  };
}

function trainingEvent(date: string, summary: string): PlannerFacts["timeline"][number] {
  return {
    eventId: `e-${date}`, revision: 1, occurredAt: `${date}T19:00:00.000Z`,
    recordedAt: `${date}T19:05:00.000Z`, timezoneOffsetMinutes: 0,
    fact: { kind: "training", confidence: "user_confirmed", reportedSession: { summary, duration: { value: 75, unit: "minutes" } } },
  } as unknown as PlannerFacts["timeline"][number];
}

function firstTrainingKind(decision: ReturnType<GoalCyclePlanner["plan"]>): string | undefined {
  if (decision.kind !== "plan_proposal") return undefined;
  const first = (decision.planRevision.upcomingSevenDays ?? []).find(
    (session) => session.tasks.length > 0 && session.kind !== "cardio",
  );
  if (!first) return undefined;
  const patterns = (first.stimulusSlots ?? []).map((slot) => slot.intent.movementPattern).join(",");
  if (/squat|hinge/.test(patterns)) return "legs";
  if (/pull/.test(patterns)) return "pull";
  return "push";
}

test("周一练了腿 → 下一次训练接着排推，不重头开始", () => {
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12",
    facts: factsWith([trainingEvent("2026-08-10", "腿日：深蹲 硬拉 弓步")]),
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(
    decision.reasonCodes.some((code) => code.startsWith("rotation_resumed_from_history:2026-08-10")),
    `应识别到 08-10 的训练：${decision.reasonCodes.filter((c) => c.includes("rotation")).join(", ")}`,
  );
  assert.equal(firstTrainingKind(decision), "push", "腿之后应接推");
});

test("上次练的是推 → 下一次接拉", () => {
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12",
    facts: factsWith([trainingEvent("2026-08-11", "卧推 肩推 三头")]),
  });
  assert.equal(firstTrainingKind(decision), "pull", "推之后应接拉");
});

test("无训练历史 → 从轮转第一课开始（保守回落，不报错）", () => {
  const decision = planner.plan({ trigger: "initial_plan", currentDate: "2026-08-12", facts: factsWith([]) });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(!decision.reasonCodes.some((code) => code.startsWith("rotation_resumed_from_history")));
  assert.ok(firstTrainingKind(decision) !== undefined, "仍应产出可执行计划");
});

test("训练记录太旧（超过回溯窗口）→ 视为新一轮，不据此推断", () => {
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12",
    facts: factsWith([trainingEvent("2026-07-01", "腿日：深蹲 硬拉")]),
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(!decision.reasonCodes.some((code) => code.startsWith("rotation_resumed_from_history")));
});

test("无法识别肌群的模糊记录 → 不猜，回落默认排序", () => {
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12",
    facts: factsWith([trainingEvent("2026-08-11", "去健身房转了转")]),
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(!decision.reasonCodes.some((code) => code.startsWith("rotation_resumed_from_history")));
});

test("每日能量预算按日型分解：训练日高于休息日，且四项之和自洽", () => {
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12",
    facts: factsWith([trainingEvent("2026-08-10", "腿日：深蹲 硬拉")]),
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const budgets = decision.planRevision.dailyEnergyBudgets ?? {};
  const entries = Object.entries(budgets);
  assert.ok(entries.length >= 5, `应为滚动 7 天逐日给预算，实际 ${entries.length} 天`);
  for (const [, b] of entries) {
    assert.equal(b.bmrKcal + b.neatKcal + b.eatKcal + b.tefKcal, b.tdeeKcal, "四项之和须等于 TDEE");
  }
  const restDays = (decision.planRevision.upcomingSevenDays ?? []).filter((s) => s.tasks.length === 0);
  const workDays = (decision.planRevision.upcomingSevenDays ?? []).filter((s) => s.tasks.length > 0 && s.kind !== "cardio");
  if (restDays.length && workDays.length) {
    const rest = budgets[restDays[0]!.scheduledFor]!;
    const work = budgets[workDays[0]!.scheduledFor]!;
    assert.ok(work.tdeeKcal > rest.tdeeKcal, `训练日(${work.tdeeKcal}) 应高于休息日(${rest.tdeeKcal})`);
    assert.equal(rest.eatKcal, 0, "休息日运动代谢应为 0");
  }
});
