import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCarbDistributionInvariant,
  createNutritionStrategy,
  deriveNutritionReviewEvidence,
  deriveNutritionPlanCoordination,
  proposeNutritionChange,
  proposeNutritionPlanCoordination,
} from "../../src/nutrition";
import type { PlanRevisionData, TimelineProjectionEvent } from "../../src/coach/domain";

const base = {
  id: "nutrition-1",
  goalContractRef: { kind: "goal_contract" as const, id: "goal", revision: 1 },
  bodyMassKg: 80,
  estimatedMaintenanceKcal: 2500,
  reviewWindow: { startsAt: "2026-08-01", endsAt: "2026-08-15", minimumWeightObservations: 3 },
  safety: { adultConfirmed: true },
};

test("Nutrition Strategy 生成保守的增肌、力量与减脂范围，而非观察到的 TDEE", () => {
  const gain = createNutritionStrategy({ ...base, phase: "hypertrophy" });
  const strength = createNutritionStrategy({ ...base, id: "strength", phase: "strength_stable" });
  const loss = createNutritionStrategy({ ...base, id: "loss", phase: "fat_loss_preserve_lean_mass" });
  assert.equal(gain.confidence, "provisional");
  assert.ok(gain.calorieRange && strength.calorieRange && loss.calorieRange);
  assert.equal(gain.calorieRange.min.value < gain.calorieRange.max.value, true);
  assert.equal(strength.calorieRange.min.value < gain.calorieRange.min.value, true);
  assert.equal(loss.calorieRange.max.value < strength.calorieRange.max.value, true);
  assert.equal(loss.macronutrientTargets?.proteinGrams.min, 144);
});

test("趋势不足或简化记录永远不触发伪精确热量调整，可靠趋势也只形成确认 Proposal", () => {
  const strategy = createNutritionStrategy({ ...base, phase: "fat_loss_preserve_lean_mass" });
  const insufficient = proposeNutritionChange({
    id: "p1", strategy, observedDays: 3, comparableWeeks: 0, adherence: "qualitative", trend: "too_high", safety: { adultConfirmed: true },
  });
  assert.equal(insufficient.kind, "no_change");
  const proposal = proposeNutritionChange({
    id: "p2", strategy, observedDays: 14, comparableWeeks: 2, adherence: "reliable", trend: "too_high", safety: { adultConfirmed: true },
  });
  assert.equal(proposal.kind === "nutrition_change_proposal", true);
  if (proposal.kind === "nutrition_change_proposal") {
    assert.equal(proposal.requiresConfirmation, true);
    assert.equal(proposal.after.calorieRange!.max.value < proposal.before.calorieRange!.max.value, true);
  }
});

test("碳水分配不改变七日总能量，安全筛查暂停自动数值处方", () => {
  const strategy = createNutritionStrategy({
    ...base,
    phase: "hypertrophy",
  });
  const cycled = {
    ...strategy,
    dayTypes: [
      { date: "2026-08-10", kind: "training" as const, namedSessionId: "heavy", energy: { value: 2800, unit: "kcal" as const }, carbohydrateGrams: 350 },
      { date: "2026-08-11", kind: "rest" as const, energy: { value: 2200, unit: "kcal" as const }, carbohydrateGrams: 200 },
    ],
  };
  assertCarbDistributionInvariant({ strategy: cycled, weeklyBaselineEnergyKcal: 5000 });
  assert.throws(() => assertCarbDistributionInvariant({ strategy: cycled, weeklyBaselineEnergyKcal: 4900 }), /weekly_energy/);
  const paused = createNutritionStrategy({ ...base, id: "paused", phase: "hypertrophy", safety: { adultConfirmed: false } });
  assert.equal(paused.status, "paused");
});

test("营养复核只从同一窗口的已确认 Timeline 推导覆盖和体重方向，简单记录不伪造成数值依从", () => {
  const strategy = createNutritionStrategy({
    ...base,
    phase: "fat_loss_preserve_lean_mass",
    reviewWindow: { startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-08-15T00:00:00.000Z", minimumWeightObservations: 3 },
  });
  const nutrition = (id: string, date: string): TimelineProjectionEvent => ({
    eventId: id,
    revision: Number(id.slice(1)),
    occurredAt: `${date}T12:00:00.000Z`,
    recordedAt: `${date}T12:00:00.000Z`,
    timezoneOffsetMinutes: 0,
    fact: { kind: "nutrition", observationId: id, observationMode: "precise", energy: { value: 2000, unit: "kcal" }, confidence: "confirmed" },
  });
  const body = (id: string, date: string, kg: number): TimelineProjectionEvent => ({
    eventId: id,
    revision: 100 + Number(id.slice(1)),
    occurredAt: `${date}T07:00:00.000Z`,
    recordedAt: `${date}T07:00:00.000Z`,
    timezoneOffsetMinutes: 0,
    fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: kg, unit: "kg" }, condition: "morning" }, confidence: "confirmed" },
  });
  const evidence = deriveNutritionReviewEvidence({
    strategy,
    now: "2026-08-15T00:00:00.000Z",
    timeline: [
      nutrition("n1", "2026-08-01"), nutrition("n2", "2026-08-03"), nutrition("n3", "2026-08-05"),
      nutrition("n4", "2026-08-08"), nutrition("n5", "2026-08-10"), nutrition("n6", "2026-08-12"),
      body("b1", "2026-08-01", 80), body("b2", "2026-08-08", 80.2), body("b3", "2026-08-14", 80.5),
    ],
  });
  assert.equal(evidence.adherence, "reliable");
  assert.equal(evidence.comparableWeeks, 2);
  assert.equal(evidence.trend, "too_high");
  assert.equal(evidence.weightObservations, 3);

  const qualitative = deriveNutritionReviewEvidence({
    strategy,
    now: "2026-08-15T00:00:00.000Z",
    timeline: [{ ...nutrition("n7", "2026-08-14"), fact: {
      kind: "nutrition", observationId: "n7", observationMode: "simplified", simplified: { proteinCompletion: "met", hunger: "moderate", deviation: "none" }, confidence: "confirmed",
    } }],
  });
  assert.equal(qualitative.adherence, "qualitative");
  assert.equal(qualitative.trend, "unknown");
  assert.ok(qualitative.missingness.includes("nutrition_precise_logging_coverage_insufficient"));
});

test("训练、休息、Deload 与恢复优先只调整已确认计划的 day type，绝不暗中改能量目标", () => {
  const strategy = {
    ...createNutritionStrategy({ ...base, phase: "hypertrophy" }),
    dayTypes: [
      { date: "2026-08-10", kind: "training" as const, namedSessionId: "old-session", energy: { value: 2800, unit: "kcal" as const }, carbohydrateGrams: 350 },
    ],
  };
  const pins = {
    knowledgePack: { id: "knowledge", semanticVersion: "1", schemaVersion: 1, contentHash: "k" },
    exerciseCatalog: { id: "catalog", semanticVersion: "1", schemaVersion: 1, contentHash: "c" },
    rulePacks: [],
  } as const;
  const plan: PlanRevisionData = {
    id: "plan", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, effectiveFrom: "2026-08-10", knowledgePins: pins,
    sessions: [
      { id: "push", title: "上肢推", scheduledFor: "2026-08-10", knowledgePins: pins, kind: "weighted_reps", tasks: [] },
      { id: "rest", title: "休息", scheduledFor: "2026-08-11", knowledgePins: pins, kind: "rest", tasks: [] },
      { id: "pull", title: "上肢拉", scheduledFor: "2026-08-12", knowledgePins: pins, kind: "weighted_reps", tasks: [] },
    ],
  };
  const coordination = deriveNutritionPlanCoordination({
    strategy, plan, currentDate: "2026-08-10",
    recoveryConstraints: [{ level: "recovery_priority", validUntil: "2026-08-13T00:00:00.000Z" }],
  });
  assert.deepEqual(coordination.dayTypes.map((day) => [day.date, day.kind]), [
    ["2026-08-10", "recovery"], ["2026-08-11", "rest"], ["2026-08-12", "recovery"],
  ]);
  assert.equal(coordination.dayTypes[0]?.energy?.value, 2800);
  assert.equal(coordination.dayTypes[0]?.carbohydrateGrams, 350);
  const proposal = proposeNutritionPlanCoordination({
    id: "coordination", strategy, plan, currentDate: "2026-08-10",
    recoveryConstraints: [{ level: "recovery_priority", validUntil: "2026-08-13T00:00:00.000Z" }],
    safety: { adultConfirmed: true },
  });
  assert.equal(proposal.kind, "nutrition_change_proposal");
  if (proposal.kind === "nutrition_change_proposal") {
    assert.equal(proposal.changeKind, "day_type_coordination");
    assert.equal(proposal.expectedDirection, "hold");
    assert.deepEqual(proposal.after.calorieRange, proposal.before.calorieRange);
    assert.equal(proposal.requiresConfirmation, true);
  }
  const missed = proposeNutritionPlanCoordination({
    id: "missed", strategy, plan, currentDate: "2026-08-10", missedSessionDates: ["2026-08-10"], safety: { adultConfirmed: true },
  });
  assert.deepEqual(missed, { kind: "no_change", reasonCodes: ["single_missed_session_keeps_nutrition_targets"] });
  const deload = deriveNutritionPlanCoordination({
    strategy, plan, currentDate: "2026-08-10", deloadWindow: { startDate: "2026-08-10", endDate: "2026-08-12" },
  });
  assert.equal(deload.dayTypes[0]?.kind, "deload");
  assert.equal(deload.dayTypes[2]?.kind, "deload");
});
