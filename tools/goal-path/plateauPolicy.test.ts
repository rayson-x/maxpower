import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { GoalContractData } from "../../src/coach/domain";
import { assessPlateau, weeklyMeanWeights, PLATEAU_POLICY } from "../../src/goal-path/plateauPolicy";
import { defaultSuccessMetrics } from "../../src/goal-path/successMetrics";

/** S4 固定引擎缝：平台判定决策树 + success measures 默认值。 */

test("平台判定单元：窗口/信号/真伪四分支", () => {
  const weeks = (start: string, means: number[]) => means.map((meanKg, i) => ({ weekStart: addDays(start, i * 7), meanKg }));
  // 仅体重、窗太短 → 不判
  assert.equal(assessPlateau({ weeklyMeans: weeks("2026-07-20", [75.0, 75.05]), circumferenceTrend: "unknown", performanceTrend: "unknown", evaluatedAt: "2026-08-02" }).verdict, "window_too_short");
  // 仅体重、恰好 3 个周均点（21 天窗）走平 → 不判平台（≈自然波动 1 个 SD，issue #5 验收）
  assert.equal(assessPlateau({ weeklyMeans: weeks("2026-07-20", [75.0, 75.05, 74.98]), circumferenceTrend: "unknown", performanceTrend: "unknown", evaluatedAt: "2026-08-05" }).verdict, "window_too_short");
  // 仅体重、4 个周均点（28 天窗）走平 → 判平台
  const flat = assessPlateau({ weeklyMeans: weeks("2026-07-06", [75.0, 75.05, 74.98, 75.02]), circumferenceTrend: "unknown", performanceTrend: "unknown", evaluatedAt: "2026-08-05" });
  assert.equal(flat.verdict, "plateau_suspected");
  assert.equal(flat.reasonCode, "plateau_check_multi_week_flat");
  // 体重走平但围度在改善 → 不是平台（判据体系：为围度庆祝）
  assert.equal(assessPlateau({ weeklyMeans: weeks("2026-07-06", [75.0, 75.05, 74.98, 75.02]), circumferenceTrend: "improving", performanceTrend: "unknown", evaluatedAt: "2026-08-05" }).verdict, "not_a_plateau");
  // 多信号窗更短（2 周可判）
  assert.equal(assessPlateau({ weeklyMeans: weeks("2026-07-20", [75.0, 75.04, 75.01]), circumferenceTrend: "stable", performanceTrend: "unknown", evaluatedAt: "2026-08-05" }).verdict, "plateau_suspected");
  // 力量下降 = 真信号，不等窗
  const decline = assessPlateau({ weeklyMeans: weeks("2026-07-20", [75.0, 75.05]), circumferenceTrend: "unknown", performanceTrend: "declining", evaluatedAt: "2026-08-02" });
  assert.equal(decline.verdict, "performance_decline_material");
  // 还在降 → 不是平台
  assert.equal(assessPlateau({ weeklyMeans: weeks("2026-07-06", [76.0, 75.4, 74.9, 74.4]), circumferenceTrend: "unknown", performanceTrend: "unknown", evaluatedAt: "2026-08-05" }).verdict, "not_a_plateau");
  // 周均聚合：同一 ISO 周多次称重取均值
  const means = weeklyMeanWeights([
    { occurredAt: "2026-08-03T08:00:00.000+08:00", valueKg: 75.2 },
    { occurredAt: "2026-08-05T08:00:00.000+08:00", valueKg: 74.8 },
    { occurredAt: "2026-08-10T08:00:00.000+08:00", valueKg: 75.0 },
  ]);
  assert.deepEqual(means.map((week) => week.meanKg), [75.0, 75.0]);
  assert.ok(PLATEAU_POLICY.version.includes("plateau.v1"));
});

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

async function fatLossFixture(options: { planFrom: string; now: string; weightDays: readonly [string, number][] }) {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), { now: () => `${options.now}T20:00:00.000+08:00`, nextId: (prefix) => `${prefix}-${++sequence}` });
  const goal: Partial<GoalContractData> = { primaryGoal: "fat_loss_preserve_lean_mass", targets: { targetWeight: { value: 70, unit: "kg" } } };
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: `${options.planFrom}T08:00:00.000+08:00`, timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile", locale: "zh-CN", dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: "goal", primaryGoal: goal.primaryGoal!, targets: goal.targets, horizon: { startDate: options.planFrom, endDate: "2026-12-01" }, measurementPlan: { requiredMeasurements: [] } },
    mandate: { id: "mandate", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const pins = app.getInstalledKnowledgeVersionPins();
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: `${options.planFrom}T08:10:00.000+08:00`, timezoneOffsetMinutes: 480, idempotencyKey: "plan" },
    planId: "plan",
    expectedRevision: 0,
    revision: {
      id: "plan", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, effectiveFrom: options.planFrom, knowledgePins: pins,
      sessions: [{ id: "s1", title: "短课", scheduledFor: `${options.planFrom}T10:00:00.000+08:00`, knowledgePins: pins, estimatedDuration: { value: 45, unit: "minutes" as const }, tasks: [{ id: "task-1", exerciseVariantId: "bench_press.dumbbell.flat.standard.bilateral.full_rom", sets: [{ id: "set-1", targetReps: { min: 8, max: 12 }, targetRir: 3 }] }] }],
      observationContract: { requiredSignals: ["confirmed_numeric_intake"], minimumObservationDays: 7, trackingSilenceReviewDays: 30, reviewCadenceDays: 7, successConditions: ["a"], progressionConditions: ["b"], holdConditions: ["c"], fallbackConditions: ["d"], stopConditions: ["e"] },
    },
  });
  for (const [date, kg] of options.weightDays) {
    await app.recordTimelineFact({
      userId: "u1",
      idempotencyKey: `w:${date}`,
      fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: kg, unit: "kg" }, condition: "after_waking" }, confidence: "confirmed" },
      envelope: { time: { startedAt: `${date}T07:00:00.000+08:00`, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
    });
  }
  return app;
}

test("仅体重 10 天不动 → 不判平台（窗太短，监控而非改方案）", async () => {
  const app = await fatLossFixture({
    planFrom: "2026-07-25",
    now: "2026-08-15",
    weightDays: [["2026-08-05", 75.0], ["2026-08-08", 75.1], ["2026-08-12", 75.0], ["2026-08-15", 75.05]],
  });
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.notEqual(assessment.diagnosis, "plan_response_review", "窗太短不得判 plan_response_review");
  assert.ok(assessment.reasonCodes.some((code) => code.startsWith("plateau_check_window_short")), JSON.stringify(assessment.reasonCodes));
  assert.equal(assessment.materialSignal, "monitor");
});

test("仅体重 4 个周均点（28 天窗）走平 → 判平台（进响应复核）", async () => {
  const app = await fatLossFixture({
    planFrom: "2026-07-10",
    now: "2026-08-15",
    weightDays: [["2026-07-20", 75.0], ["2026-07-27", 75.06], ["2026-08-03", 74.98], ["2026-08-10", 75.02], ["2026-08-14", 75.0]],
  });
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.state, "at_risk");
  assert.equal(assessment.diagnosis, "plan_response_review");
  assert.ok(assessment.reasonCodes.includes("plateau_check_multi_week_flat"), JSON.stringify(assessment.reasonCodes));
});

test("success measures 默认值按判据体系（围度/表现优先，体重降级周均趋势）", () => {
  const fatLoss = defaultSuccessMetrics({ primaryGoal: "fat_loss_preserve_lean_mass" });
  assert.equal(fatLoss[0], "waist_circumference_trend");
  assert.ok(fatLoss.includes("weekly_weight_trend"));
  assert.ok(!fatLoss.some((metric) => /target.?weight|减到/.test(metric)), "默认判据不得是裸体重目标");
  assert.equal(defaultSuccessMetrics({ primaryGoal: "hypertrophy" })[0], "target_muscle_circumference_trend");
});
