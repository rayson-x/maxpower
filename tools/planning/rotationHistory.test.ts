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

// 语义修正（2026-08-12）：断言"续排"这个不变量本身，不硬编码某个分化的课序
// ——分化方案会增减（新加了四分化），课序不该被测试钉死。
test("练过某部位后 → 下一次不重复同一部位（续排而非重头开始）", () => {
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
  assert.notEqual(firstTrainingKind(decision), "legs", "刚练过腿，下一次不该又是腿");
});

test("练过推之后 → 下一次不重复推", () => {
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12",
    facts: factsWith([trainingEvent("2026-08-11", "卧推 肩推 三头")]),
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(decision.reasonCodes.some((code) => code.startsWith("rotation_resumed_from_history")));
  assert.notEqual(firstTrainingKind(decision), "push", "刚练过推，下一次不该又是推");
});

test("无训练历史 → 从轮转第一课开始（保守回落，不报错）", () => {
  const decision = planner.plan({ trigger: "initial_plan", currentDate: "2026-08-12", facts: factsWith([]) });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(!decision.reasonCodes.some((code) => code.startsWith("rotation_resumed_from_history")));
  assert.ok(firstTrainingKind(decision) !== undefined, "仍应产出可执行计划");
});

test("四分化跨日历周不断档：已排胸背肩后，下一可训练日必须接腿", () => {
  const base = factsWith([]);
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12", preferredSplitId: "chest_back_shoulders_legs",
    schedule: [
      { weekday: 3, availableMinutes: 75, locationId: "gym" },
      { weekday: 5, availableMinutes: 75, locationId: "gym" },
      { weekday: 7, availableMinutes: 75, locationId: "gym" },
      { weekday: 2, availableMinutes: 75, locationId: "gym" },
    ],
    facts: {
      ...base,
      profile: { ...base.profile, value: { ...base.profile.value, schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 } } },
    },
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const resistance = (decision.planRevision.materializedWeeks ?? [])
    .flatMap((week) => week.sessions)
    .filter((session) => session.kind === "weighted_reps" || session.kind === "bodyweight_reps");
  assert.deepEqual(
    resistance.slice(0, 4).map((session) => session.scheduledFor),
    ["2026-08-12", "2026-08-14", "2026-08-16", "2026-08-18"],
  );
  const fourthPatterns = resistance[3]?.stimulusSlots?.map((slot) => slot.intent.movementPattern) ?? [];
  assert.ok(fourthPatterns.includes("squat"), `第四节必须续接腿日，实际：${fourthPatterns.join(",")}`);
  const queue = decision.planRevision.continuousTrainingQueue;
  assert.ok(queue, "计划必须持久化连续训练队列，供未来重规划续接");
  assert.deepEqual(
    queue.entries.slice(0, 4).map((entry) => [entry.earliestDate, entry.focusZh]),
    [["2026-08-12", "胸 + 三头"], ["2026-08-14", "背 + 二头"], ["2026-08-16", "肩（前中后束）"], ["2026-08-18", "腿"]],
  );
  assert.ok(
    queue.entries.some((entry) => entry.status === "conditional" && entry.exerciseVariantIds === undefined),
    "远端必须只保留条件化动作意图，不能在今天锁死未来具体变式",
  );
});

test("恢复优先日不消耗四分化队列：恢复结束后仍从未完成的第一节开始", () => {
  const base = factsWith([]);
  const decision = planner.plan({
    trigger: "recovery_downgraded", currentDate: "2026-08-12", preferredSplitId: "chest_back_shoulders_legs",
    schedule: [
      { weekday: 3, availableMinutes: 75, locationId: "gym" },
      { weekday: 4, availableMinutes: 75, locationId: "gym" },
      { weekday: 5, availableMinutes: 75, locationId: "gym" },
      { weekday: 6, availableMinutes: 75, locationId: "gym" },
    ],
    facts: {
      ...base,
      profile: { ...base.profile, value: { ...base.profile.value, schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 } } },
      recoveryConstraints: [{
        revision: 1,
        value: { id: "recover-now", level: "recovery_priority", validUntil: "2026-08-14", scope: "next_session" },
      }],
    },
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const sessions = decision.planRevision.materializedWeeks?.flatMap((week) => week.sessions) ?? [];
  assert.deepEqual(
    sessions.filter((session) => session.kind === "recovery").map((session) => session.scheduledFor),
    ["2026-08-12", "2026-08-13", "2026-08-14"],
  );
  const firstResistance = sessions.find((session) => session.kind === "weighted_reps" || session.kind === "bodyweight_reps");
  assert.equal(firstResistance?.scheduledFor, "2026-08-15");
  assert.ok(
    firstResistance?.stimulusSlots?.some((slot) => slot.intent.movementPattern === "horizontal_push"),
    "恢复结束后应接着排未完成的第一节，而不是跳到后续课",
  );
});

test("局部恢复约束按动作次级肌群生效：回避三头时不保留卧推/推举，但保留未受影响内容", () => {
  const base = factsWith([]);
  const decision = planner.plan({
    trigger: "recovery_downgraded", currentDate: "2026-08-12", preferredSplitId: "chest_back_shoulders_legs",
    schedule: [
      { weekday: 3, availableMinutes: 75, locationId: "gym" },
      { weekday: 4, availableMinutes: 75, locationId: "gym" },
      { weekday: 5, availableMinutes: 75, locationId: "gym" },
      { weekday: 6, availableMinutes: 75, locationId: "gym" },
    ],
    facts: {
      ...base,
      recoveryConstraints: [{
        revision: 1,
        value: {
          id: "avoid-triceps", level: "slight_reduction", validUntil: "2026-08-12", scope: "next_session",
          intentions: [{ kind: "avoid_area", area: "triceps" }],
        },
      }],
    },
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const first = (decision.planRevision.upcomingSevenDays ?? []).find((session) => session.tasks.length > 0 && session.kind !== "cardio");
  assert.ok(first);
  const affected = first.tasks.some((task) =>
    registry.exerciseVariant(task.exerciseVariantId)?.expectedMuscleAssociation.associations.some((item) => item.muscleId === "triceps"),
  );
  assert.equal(affected, false, "次级参与三头的卧推/推举也必须移除");
  assert.ok(first.tasks.length > 0, "局部回避不应无理由取消整节可执行训练");
  assert.ok(decision.reasonCodes.some((code) => code.startsWith("recovery_avoid_area_slot_removed:triceps")));
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

test("减脂加速有氧优先接在有时间余量的上肢力量后，并把两项消耗一起记入当日预算", () => {
  const base = factsWith([]);
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12", preferredSplitId: "chest_back_shoulders_legs",
    schedule: [
      { weekday: 3, availableMinutes: 90, locationId: "gym" },
      { weekday: 5, availableMinutes: 90, locationId: "gym" },
      { weekday: 7, availableMinutes: 90, locationId: "gym" },
      { weekday: 2, availableMinutes: 90, locationId: "gym" },
    ],
    facts: {
      ...base,
      profile: { ...base.profile, value: { ...base.profile.value, schedule: { weeklyFrequency: 4, sessionDurationMinutes: 90 } } },
      goalContract: {
        ...base.goalContract,
        value: {
          ...base.goalContract.value,
          primaryGoal: "fat_loss_preserve_lean_mass",
          goalType: "fat_loss",
          aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength" },
        },
      },
    },
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const aerobic = (decision.planRevision.upcomingSevenDays ?? []).find((session) => session.aerobicBlock?.placement === "after_strength");
  assert.ok(aerobic, "应在有余量的力量日后出现有氧块，而不是只改标题或塞满休息日");
  assert.notEqual(aerobic?.kind, "cardio", "同节有氧保留为力量课的追加内容");
  assert.ok((aerobic?.tasks.length ?? 0) > 1, "力量任务后必须有可执行的有氧任务");
  const budget = aerobic ? decision.planRevision.dailyEnergyBudgets?.[aerobic.scheduledFor] : undefined;
  assert.ok((budget?.eatKcal ?? 0) > 0, "力量与有氧的运动消耗必须进入同一天预算");
});

test("已量化聚餐会把温和回调同步写入既有力量后有氧和每日能量预算", () => {
  const base = factsWith([]);
  const decision = planner.plan({
    trigger: "user_requested", currentDate: "2026-08-12", preferredSplitId: "chest_back_shoulders_legs",
    schedule: [
      { weekday: 3, availableMinutes: 90, locationId: "gym" },
      { weekday: 5, availableMinutes: 90, locationId: "gym" },
      { weekday: 7, availableMinutes: 90, locationId: "gym" },
      { weekday: 2, availableMinutes: 90, locationId: "gym" },
    ],
    facts: {
      ...base,
      profile: { ...base.profile, value: { ...base.profile.value, schedule: { weeklyFrequency: 4, sessionDurationMinutes: 90 } } },
      goalContract: {
        ...base.goalContract,
        value: {
          ...base.goalContract.value,
          primaryGoal: "fat_loss_preserve_lean_mass",
          goalType: "fat_loss",
          aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength" },
        },
      },
      timeline: [{
        eventId: "party", revision: 1, occurredAt: "2026-08-11T11:00:00.000Z", recordedAt: "2026-08-11T11:05:00.000Z", timezoneOffsetMinutes: 480,
        fact: { kind: "nutrition", observationId: "party-dinner", energy: { value: 2700, unit: "kcal" }, proteinGrams: 120, carbohydrateGrams: 250, fatGrams: 80, reportedEnergyDeviationKcal: 700, confidence: "confirmed" },
      }] as PlannerFacts["timeline"],
      nutritionStrategies: [{
        revision: 1,
        value: {
          id: "nutrition-fat-loss",
          goalContractRef: { kind: "goal_contract", id: "g", revision: 1 },
          status: "active",
          phase: "fat_loss_preserve_lean_mass",
          calorieRange: {
            min: { value: 2011, unit: "kcal" },
            max: { value: 2222, unit: "kcal" },
          },
        },
      }],
    },
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const adjustment = decision.planRevision.rollingEnergyAdjustment;
  assert.equal(adjustment?.status, "gentle_rebalance");
  assert.equal(adjustment?.unrecoveredSurplusKcal, 700, "用户确认的差额优先于训练阶段标签和全天热量反推");
  assert.equal(adjustment?.loggedThermicEffectKcal, 259, "宏量营养素应参与 TEF，而非统一按 10% 猜测");
  const adjusted = (decision.planRevision.upcomingSevenDays ?? []).find((session) =>
    session.aerobicBlock?.reasonCodes.includes("rolling_energy_rebalance"),
  );
  assert.ok(adjusted, "回调必须写进实际后续课表，不能只出现在说明卡");
  assert.equal(adjusted?.aerobicBlock?.minutes, 40, "原有 25 分钟低冲击有氧至多增加 15 分钟");
  const budget = adjusted ? decision.planRevision.dailyEnergyBudgets?.[adjusted.scheduledFor] : undefined;
  assert.ok((budget?.plannedExtraActivityKcal ?? 0) > 0, "增加的步数也必须进入该日能量账本");
  assert.ok(decision.reasonCodes.includes("rolling_energy_adjustment_applied_to_existing_low_impact_cardio"));
});

test("已有计划后上报 700 kcal 差额，future_plan 必须产生可确认 diff 而不是 typed_diff_empty", () => {
  const base = factsWith([]);
  const profile = {
    ...base.profile,
    value: {
      ...base.profile.value,
      trainingExperience: "advanced" as const,
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      bodyDirection: "decrease_body_fat" as const,
      nutritionPreferences: ["饮食严格控制；居家办公，非训练日活动较低"],
      historyModifiers: {
        priorStrategies: ["四分化，每周4天"],
        plateau: {
          durationWeeks: 0,
          priorStrategies: ["四分化，每周4天"],
          executionAdherence: "high" as const,
          recoveryChange: "stable" as const,
          suspectedReasons: [],
        },
      },
      strengthBaseline: {
        squat: { value: 100, unit: "kg" as const },
        benchPress: { value: 80, unit: "kg" as const },
        deadlift: { value: 110, unit: "kg" as const },
        measuredAt: "2026-08-13T12:00:00.000Z",
        source: "user_confirmed" as const,
      },
    },
  };
  const goalContract = {
    ...base.goalContract,
    value: {
      ...base.goalContract.value,
      primaryGoal: "fat_loss_preserve_lean_mass" as const,
      goalType: "fat_loss" as const,
    },
  };
  const nutritionStrategies: PlannerFacts["nutritionStrategies"] = [{
    revision: 1,
    value: {
      id: "nutrition-fat-loss-existing",
      goalContractRef: { kind: "goal_contract", id: "g", revision: 1 },
      status: "active",
      phase: "fat_loss_preserve_lean_mass",
      calorieRange: { min: { value: 2011, unit: "kcal" }, max: { value: 2222, unit: "kcal" } },
    },
  }];
  const initial = planner.plan({
    trigger: "initial_plan",
    currentDate: "2026-08-13",
    facts: { ...base, profile, goalContract, nutritionStrategies },
  });
  assert.equal(initial.kind, "plan_proposal");
  if (initial.kind !== "plan_proposal") return;
  const adjusted = planner.plan({
    trigger: "user_requested",
    requestedScope: "future_plan",
    currentDate: "2026-08-13",
    facts: {
      ...base,
      profile,
      goalContract,
      nutritionStrategies,
      priorPlan: { revision: 1, value: initial.planRevision },
      timeline: [{
        eventId: "party-existing",
        revision: 1,
        occurredAt: "2026-08-12T20:58:00.000Z",
        recordedAt: "2026-08-12T20:58:01.000Z",
        timezoneOffsetMinutes: 480,
        fact: {
          kind: "nutrition",
          observationId: "party-existing",
          mealDescription: "今天聚餐吃多了",
          reportedEnergyDeviationKcal: 700,
          confidence: "confirmed",
        },
      }] as PlannerFacts["timeline"],
    },
  });
  assert.equal(
    adjusted.kind,
    "plan_proposal",
    adjusted.kind === "no_change" ? adjusted.reasonCodes.join(",") : `unexpected_kind:${adjusted.kind}`,
  );
  if (adjusted.kind !== "plan_proposal") return;
  assert.equal(adjusted.planRevision.rollingEnergyAdjustment?.status, "gentle_rebalance");
  assert.equal(adjusted.planRevision.rollingEnergyAdjustment?.unrecoveredSurplusKcal, 700);
  assert.ok(adjusted.planRevision.rollingEnergyAdjustment?.actions.some((action) => action.extraSteps > 0));
  assert.ok(
    adjusted.planRevision.rollingEnergyAdjustment?.actions.every((action) => action.extraLowImpactCardioMinutes === 0),
    "75 分钟课程已占满时不能强塞练后有氧，只保留恢复门控的额外步数",
  );
  assert.ok(adjusted.diff.length > 0);
});

test("昨天完成高冲击高强度有氧后，今天候选腿课先保持并等待恢复确认，且不消耗四分化轮转", () => {
  const base = factsWith([]);
  const decision = planner.plan({
    trigger: "user_requested", currentDate: "2026-08-12", preferredSplitId: "chest_back_shoulders_legs",
    schedule: [
      { weekday: 3, availableMinutes: 75, locationId: "gym" },
      { weekday: 4, availableMinutes: 75, locationId: "gym" },
      { weekday: 5, availableMinutes: 75, locationId: "gym" },
      { weekday: 6, availableMinutes: 75, locationId: "gym" },
    ],
    facts: {
      ...base,
      profile: { ...base.profile, value: { ...base.profile.value, schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 } } },
      timeline: [
        {
          eventId: "shoulder-history", revision: 1, occurredAt: "2026-08-10T18:00:00.000Z", recordedAt: "2026-08-10T18:00:00.000Z", timezoneOffsetMinutes: 480,
          fact: { kind: "training", historicalSet: { exerciseVariantId: "overhead_press.barbell.seated.standard.bilateral.full_rom", load: { value: 50, unit: "kg" }, reps: 8, rir: 2 }, confidence: "confirmed" },
        },
        {
          eventId: "lateral-history", revision: 1, occurredAt: "2026-08-10T18:10:00.000Z", recordedAt: "2026-08-10T18:10:00.000Z", timezoneOffsetMinutes: 480,
          fact: { kind: "training", historicalSet: { exerciseVariantId: "lateral_raise.dumbbell.standing.standard.bilateral.full_rom", load: { value: 10, unit: "kg" }, reps: 12, rir: 2 }, confidence: "confirmed" },
        },
        {
        eventId: "hard-run", revision: 1, occurredAt: "2026-08-11T18:00:00.000Z", recordedAt: "2026-08-11T18:00:00.000Z", timezoneOffsetMinutes: 480,
        fact: { kind: "activity", activityType: "跑步", duration: { value: 30, unit: "minutes" }, intensity: "hard", perceivedExertion: 8, confidence: "confirmed" },
        },
      ],
    },
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const today = decision.planRevision.upcomingSevenDays?.find((session) => session.scheduledFor === "2026-08-12");
  assert.equal(today?.kind, "recovery", JSON.stringify({ title: today?.title, patterns: today?.stimulusSlots?.map((slot) => slot.intent.movementPattern), reasons: decision.reasonCodes }));
  assert.equal(today?.title, "高冲击有氧后 · 恢复确认");
  assert.ok(decision.reasonCodes.includes("lower_body_session_held_after_recent_hard_impact_cardio"));
});

test("四分化把髋铰链保留在腿日，核心等长行动按秒和组数生成，不能出现 45 分钟平板支撑", () => {
  const base = factsWith([]);
  const decision = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12", preferredSplitId: "chest_back_shoulders_legs",
    schedule: [
      { weekday: 3, availableMinutes: 90, locationId: "gym" }, { weekday: 5, availableMinutes: 90, locationId: "gym" },
      { weekday: 7, availableMinutes: 90, locationId: "gym" }, { weekday: 2, availableMinutes: 90, locationId: "gym" },
    ],
    facts: { ...base, profile: { ...base.profile, value: { ...base.profile.value, schedule: { weeklyFrequency: 4, sessionDurationMinutes: 90 } } } },
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const resistance = (decision.planRevision.materializedWeeks ?? []).flatMap((week) => week.sessions)
    .filter((session) => session.kind === "weighted_reps" || session.kind === "bodyweight_reps");
  const back = resistance[1];
  const shoulders = resistance[2];
  const chest = resistance[0];
  assert.ok(!(chest?.stimulusSlots ?? []).some((slot) => slot.intent.movementPattern === "vertical_push"), "胸日卧推后不得再塞肩推；垂直推只留给肩日");
  assert.ok(!(back?.stimulusSlots ?? []).some((slot) => slot.intent.movementPattern === "hip_hinge"), "背日不得偷用腿日髋铰链恢复预算");
  const plank = shoulders?.tasks.find((task) => task.exerciseVariantId.includes("plank"));
  assert.equal(plank?.sets.length, 3);
  assert.deepEqual(plank?.sets[0]?.targetDuration, { value: 30, unit: "seconds" });
});

test("用户给出重量和次数时，首次校准必须利用次数估算，而非把重量误当 1RM", () => {
  const base = factsWith([]);
  const common = {
    ...base,
    profile: {
      ...base.profile,
      value: {
        ...base.profile.value,
        strengthBaseline: {
          benchPress: { value: 80, unit: "kg" as const },
          measuredAt: "2026-08-12",
          source: "user_confirmed" as const,
        },
      },
    },
  };
  const withReps = planner.plan({
    trigger: "initial_plan", currentDate: "2026-08-12", facts: {
      ...common,
      profile: {
        ...common.profile,
        value: {
          ...common.profile.value,
          strengthBaseline: { ...common.profile.value.strengthBaseline!, benchPressReps: 5 },
        },
      },
    },
  });
  const withoutReps = planner.plan({ trigger: "initial_plan", currentDate: "2026-08-12", facts: common });
  assert.equal(withReps.kind, "plan_proposal");
  assert.equal(withoutReps.kind, "plan_proposal");
  if (withReps.kind !== "plan_proposal" || withoutReps.kind !== "plan_proposal") return;
  const startLoad = (decision: typeof withReps) => decision.planRevision.sessions
    .flatMap((session) => session.tasks)
    .find((task) => task.exerciseVariantId.includes("bench_press"))
    ?.sets[0]?.calibrationStartSuggestion?.load.value;
  assert.ok((startLoad(withReps) ?? 0) > (startLoad(withoutReps) ?? Infinity));
});
