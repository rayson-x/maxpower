import assert from "node:assert/strict";
import test from "node:test";

import type { SetOutcomeData } from "../../src/coach/domain";
import { createInstalledKnowledgePack } from "../../src/knowledge";
import { assessRecoveryContext, RECOVERY_WINDOW_POLICY } from "../../src/planning/recoveryWindows";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

const pack = createInstalledKnowledgePack();
const variants = new Map(pack.exerciseCatalog.variants.map((variant) => [variant.id, variant]));
const BENCH = "bench_press.barbell.decline.close.bilateral.full_rom";

function outcome(exerciseVariantId: string, rir?: number): SetOutcomeData {
  return { id: `o-${Math.random().toString(36).slice(2, 8)}`, prescriptionSetId: "p1", exerciseVariantId, source: "user_confirmed", ...(rir === undefined ? {} : { actualRir: rir }) } as SetOutcomeData;
}

test("无训练历史时显式返回 insufficient_history，不静默省略", () => {
  const context = assessRecoveryContext({ evaluationDate: "2026-08-16", completedSets: [], exerciseById: (id) => variants.get(id) });
  assert.equal(context.status, "insufficient_history");
  assert.equal(context.muscles.length, 0);
  assert.equal(context.policy.version, RECOVERY_WINDOW_POLICY.version);
});

test("昨天的高剂量确认组产生残差负荷、恢复窗档位与叠加提示", () => {
  const report = assessRecoveryContext({
    evaluationDate: "2026-08-16",
    completedSets: [{
      completedAt: "2026-08-15T10:00:00.000+08:00",
      outcomes: Array.from({ length: 6 }, () => outcome(BENCH, 1)),
    }],
    exerciseById: (id) => variants.get(id),
  });
  assert.equal(report.status, "ok");
  const chest = report.muscles.find((entry) => entry.muscleId === "chest");
  assert.ok(chest);
  assert.ok(chest!.residualLoad > 50, "6 组高努力卧推次日残差必须显著");
  assert.equal(chest!.directSetsThisWeek, 6);
  assert.equal(chest!.windowTier, "high_dose");
  assert.deepEqual(chest!.windowHours, [72, 96]);
  const triceps = report.muscles.find((entry) => entry.muscleId === "triceps");
  assert.ok(triceps, "协同肌群也出现在恢复上下文中");
});

test("残差随 0.62/天衰减；新手暴露不足时档位更长", () => {
  const recent = assessRecoveryContext({
    evaluationDate: "2026-08-16",
    completedSets: [{ completedAt: "2026-08-15T10:00:00.000+08:00", outcomes: [outcome(BENCH, 2), outcome(BENCH, 2), outcome(BENCH, 2)] }],
    exerciseById: (id) => variants.get(id),
  });
  const aged = assessRecoveryContext({
    evaluationDate: "2026-08-16",
    completedSets: [{ completedAt: "2026-08-11T10:00:00.000+08:00", outcomes: [outcome(BENCH, 2), outcome(BENCH, 2), outcome(BENCH, 2)] }],
    exerciseById: (id) => variants.get(id),
  });
  const recentChest = recent.muscles.find((entry) => entry.muscleId === "chest")!;
  const agedChest = aged.muscles.find((entry) => entry.muscleId === "chest")!;
  assert.ok(agedChest.residualLoad < recentChest.residualLoad * 0.2, "5 天后残差应大幅衰减");
  assert.equal(recentChest.windowTier, "novice_or_new", "暴露次数少按新手/新动作档");
});

test("固定计划信封必然携带 recoveryContext（确定性注入）", async () => {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "test", occurredAt: "2026-08-01T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile", locale: "zh-CN", dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: "goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-01", endDate: "2026-12-01" } },
    mandate: { id: "mandate", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const empty = await app.readPlanningInput({ userId: "u1", mode: "first_plan" });
  assert.equal(empty.recoveryContext.status, "insufficient_history");

  await app.prepareFreestyleWorkoutSession({
    userId: "u1",
    workoutId: "w1",
    idempotencyKey: "w1-prepare",
    session: { id: "w1-session", title: "自由训练", scheduledFor: "2026-08-15", knowledgePins: app.getInstalledKnowledgeVersionPins(), tasks: [{ id: "w1-task", exerciseVariantId: BENCH, sets: [{ id: "w1-set", targetReps: { min: 8, max: 12 }, targetRir: 2 }] }] },
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "w1", mode: "record_only", idempotencyKey: "w1-activate" });
  await app.confirmCurrentSet({ userId: "u1", workoutId: "w1", confirmAsPlanned: true, idempotencyKey: "w1-set" });
  await app.completeWorkoutSession({ userId: "u1", workoutId: "w1", idempotencyKey: "w1-complete" });

  const withHistory = await app.readPlanningInput({ userId: "u1", mode: "first_plan" });
  assert.equal(withHistory.recoveryContext.status, "ok");
  assert.ok(withHistory.recoveryContext.muscles.some((entry) => entry.muscleId === "chest" && entry.directSetsThisWeek === 1));
});
