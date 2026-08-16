import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfileData } from "../../src/coach/domain";
import {
  activityNetKcal,
  basalMetabolicRate,
  dailyEnergyBudget,
  dayActivityFromPlan,
} from "../../src/planning/dailyEnergyBudget";

/**
 * 每日能量预算验收（2026-08-12）：严格按天分解
 * TDEE = 基础代谢 + 日常代谢 + 运动代谢 + 食物热效应，不给平摊的平均值。
 */

function profile(level: UserProfileData["dailyActivityLevel"] = "sedentary"): UserProfileData {
  return {
    id: "p", locale: "zh-CN",
    demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } },
    schedule: { weeklyFrequency: 5, sessionDurationMinutes: 75 },
    ...(level ? { dailyActivityLevel: level } : {}),
  };
}

test("基础代谢：Mifflin-St Jeor，男女性别项不同", () => {
  const male = basalMetabolicRate(profile())!;
  assert.equal(Math.round(male), 1718);
  const female = { ...profile() };
  (female.demographics as { sex: string }).sex = "female";
  assert.ok(basalMetabolicRate(female)! < male, "同身高体重女性 BMR 更低");
});

test("英制档案先归一化，未知性别不会偷偷按男性计算", () => {
  const metric = profile();
  const imperial: UserProfileData = { ...metric, demographics: { ...metric.demographics, height: { value: 178 / 2.54, unit: "in" }, currentWeight: { value: 75 / 0.45359237, unit: "lb" } } };
  assert.ok(Math.abs(basalMetabolicRate(metric)! - basalMetabolicRate(imperial)!) < 0.01);
  const unknown: UserProfileData = { ...metric, demographics: { ...metric.demographics, sex: "unknown" } };
  assert.equal(basalMetabolicRate(unknown), undefined);
  assert.equal(dailyEnergyBudget({ profile: unknown, day: dayActivityFromPlan({ kind: "rest" }) }), undefined);
});

test("运动净消耗扣掉同期静息（用 MET−1），避免与 BMR 重复计算", () => {
  // 75kg 力量训练 75min：(3.5−1) × 75 × 1.25 = 234
  const net = activityNetKcal({ kind: "resistance_moderate", minutes: 75, weightKg: 75 });
  assert.equal(net, 234);
  // 若不扣静息会是 3.5×75×1.25 = 328，明显高估
  assert.ok(net < 328);
});

test("训练日 TDEE 显著高于休息日（这就是不能给平均值的原因）", () => {
  const rest = dailyEnergyBudget({ profile: profile(), day: dayActivityFromPlan({ kind: "rest" }) })!;
  const training = dailyEnergyBudget({ profile: profile(), day: dayActivityFromPlan({ kind: "strength", minutes: 75 }) })!;
  const gap = training.tdeeKcal - rest.tdeeKcal;
  assert.ok(gap > 200, `训练日应比休息日多 >200 kcal，实际 ${gap}`);
  assert.equal(rest.eatKcal, 0, "休息日无运动代谢");
  assert.ok(training.eatKcal > 200);
});

test("四项分解之和等于 TDEE（账目自洽）", () => {
  const b = dailyEnergyBudget({ profile: profile(), day: dayActivityFromPlan({ kind: "strength", minutes: 75 }) })!;
  assert.equal(b.bmrKcal + b.neatKcal + b.eatKcal + b.tefKcal, b.tdeeKcal);
});

test("实际步数替代档案估算，超基准部分计入日常代谢", () => {
  const byLevel = dailyEnergyBudget({ profile: profile("sedentary"), day: dayActivityFromPlan({ kind: "rest" }) })!;
  const bySteps = dailyEnergyBudget({ profile: profile("sedentary"), day: dayActivityFromPlan({ kind: "rest", actualSteps: 10000 }) })!;
  assert.equal(byLevel.neatSource, "profile_level");
  assert.equal(bySteps.neatSource, "actual_steps");
  // 久坐基准 3500 步，超出 6500 × 75 × 0.0004 = 195
  assert.equal(bySteps.neatKcal - byLevel.neatKcal, 195);
  assert.ok(bySteps.uncertaintyKcal < byLevel.uncertaintyKcal, "有实测数据不确定度应更低");
});

test("摄入目标 = 当日 TDEE − 当日赤字（按天算，不是按周平均）", () => {
  const deficit = 371;
  const rest = dailyEnergyBudget({ profile: profile(), day: dayActivityFromPlan({ kind: "rest" }), dailyDeficitKcal: deficit })!;
  const training = dailyEnergyBudget({ profile: profile(), day: dayActivityFromPlan({ kind: "strength", minutes: 75 }), dailyDeficitKcal: deficit })!;
  assert.equal(rest.intakeTargetKcal, rest.tdeeKcal - deficit);
  assert.equal(training.intakeTargetKcal, training.tdeeKcal - deficit);
  assert.ok(training.intakeTargetKcal! > rest.intakeTargetKcal!, "训练日应比休息日吃更多");
});

test("设备填报的活动消耗作为有误差证据校准模型，而不是直接替换消耗", () => {
  const b = dailyEnergyBudget({
    profile: profile(),
    day: { sessions: [{ kind: "resistance_moderate", minutes: 75 }], actualSteps: 10000, reportedActivityKcal: 520 },
  })!;
  assert.equal(b.neatSource, "reported_evidence");
  assert.notEqual(b.neatKcal, 520, "用户或设备报告值不能直接成为正式消耗");
  assert.ok(b.eatKcal > 0, "正式训练结构仍保留，填报值只校准活动总量");
  const estimated = dailyEnergyBudget({ profile: profile(), day: dayActivityFromPlan({ kind: "strength", minutes: 75 }) })!;
  assert.ok(b.uncertaintyKcal > estimated.uncertaintyKcal, "单次设备证据有额外测量误差");
});

test("大重量腿日的 MET 低于中等强度（长休息拉低平均强度），但不为零", () => {
  const moderate = dailyEnergyBudget({ profile: profile(), day: dayActivityFromPlan({ kind: "strength", minutes: 75 }) })!;
  const heavy = dailyEnergyBudget({ profile: profile(), day: dayActivityFromPlan({ kind: "strength", minutes: 75, intensity: "heavy" }) })!;
  assert.ok(heavy.eatKcal < moderate.eatKcal, "大重量长休息的平均 MET 更低");
  assert.ok(heavy.eatKcal > 100);
});

test("缺体重/身高/年龄 → 不估算（不猜）", () => {
  const p = profile();
  delete (p.demographics as { currentWeight?: unknown }).currentWeight;
  assert.equal(dailyEnergyBudget({ profile: p, day: dayActivityFromPlan({ kind: "rest" }) }), undefined);
});

test("一周按天累加的赤字与周降体重目标一致", () => {
  const deficit = 371;
  const week = [
    dayActivityFromPlan({ kind: "strength", minutes: 75 }),
    dayActivityFromPlan({ kind: "strength", minutes: 75 }),
    dayActivityFromPlan({ kind: "strength", minutes: 75, intensity: "heavy" }),
    dayActivityFromPlan({ kind: "strength", minutes: 75 }),
    dayActivityFromPlan({ kind: "strength", minutes: 75 }),
    dayActivityFromPlan({ kind: "cardio", minutes: 30 }),
    dayActivityFromPlan({ kind: "rest" }),
  ];
  const budgets = week.map((day) => dailyEnergyBudget({ profile: profile(), day, dailyDeficitKcal: deficit })!);
  const weeklyDeficit = budgets.reduce((sum, b) => sum + (b.tdeeKcal - b.intakeTargetKcal!), 0);
  assert.equal(weeklyDeficit, deficit * 7, "每天赤字恒定时周赤字应为 7 倍");
  // 周降体重 ≈ 周赤字 / 7700
  const kgPerWeek = weeklyDeficit / 7700;
  assert.ok(kgPerWeek > 0.3 && kgPerWeek < 0.45, `周降应约 0.34kg，实际 ${kgPerWeek.toFixed(2)}`);
});
