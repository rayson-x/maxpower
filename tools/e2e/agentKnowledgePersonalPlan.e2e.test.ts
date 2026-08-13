import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { AgentKnowledgeBackend, AgentKnowledgePlanningModule } from "../../src/agent-knowledge";
import {
  PERSONAL_PLANNER_CURRENT_DATE,
  PERSONAL_PLANNER_GOAL,
  PERSONAL_PLANNER_PROFILE,
} from "./personalPlannerFixture";

function createPlanner(): AgentKnowledgePlanningModule {
  const release = JSON.parse(readFileSync(resolve(
    process.cwd(),
    "../wiki/records/releases/generated.knowledge_release.maxpower.existing-knowledge.json",
  ), "utf8"));
  return new AgentKnowledgePlanningModule(AgentKnowledgeBackend.load(release, {
    mode: "offline_evaluation",
  }));
}

test("Agent Knowledge 使用同一档案生成四分化、恢复联动和动态能量计划", () => {
  const plan = createPlanner().createInitialPlan({
    profile: PERSONAL_PLANNER_PROFILE,
    goalContract: PERSONAL_PLANNER_GOAL,
    currentDate: PERSONAL_PLANNER_CURRENT_DATE,
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.strategy.methodRef, "method.legacy.split.chest-back-shoulders-legs");
  assert.deepEqual(plan.week.sessions.map((session) => session.id), ["chest", "back", "legs", "shoulders"]);
  assert.deepEqual(plan.week.sessions.map((session) => session.dayOffset), [0, 1, 3, 5]);
  assert.ok(plan.week.sessions.some((session) => session.id === "legs" && session.exercises.length >= 4));
  assert.ok(plan.week.sessions.every((session) => session.majorRegionFocus.length <= 2));
  assert.ok(plan.week.sessions.flatMap((session) => session.exercises)
    .every((exercise) => exercise.catalogRef.startsWith("agent-domain-catalog/v1:")));
  const bench = plan.week.sessions.find((session) => session.id === "chest")?.exercises[0];
  const deadlift = plan.week.sessions.find((session) => session.id === "legs")?.exercises
    .find((exercise) => exercise.movementPattern === "hip_hinge");
  assert.equal(bench?.fatigueImpact.chest, 100);
  assert.equal(bench?.fatigueImpact.triceps, 45);
  assert.equal(deadlift?.fatigueImpact.back, 45);
  const lateralRaise = plan.week.sessions.find((session) => session.id === "shoulders")?.exercises
    .find((exercise) => exercise.movementPattern === "shoulder_abduction");
  const plank = plan.week.sessions.find((session) => session.id === "shoulders")?.exercises
    .find((exercise) => exercise.movementPattern === "core_anti_extension");
  assert.deepEqual(lateralRaise?.reps, [10, 15]);
  assert.equal(plank?.reps, undefined);
  assert.deepEqual(plank?.durationSeconds, [30, 45]);

  const cardio = plan.week.sessions.flatMap((session) => session.aerobic ? [session.aerobic] : []);
  assert.equal(cardio.length, 2);
  assert.ok(cardio.every((block) => block.placement === "after_strength" && block.minutes === 20));

  assert.equal(plan.nutrition.thermicEffectAssumptionPercent, 10);
  assert.ok(plan.nutrition.restDayTargetKcal < plan.nutrition.strengthDayTargetKcal);
  assert.ok(plan.nutrition.strengthDayTargetKcal < plan.nutrition.strengthPlusAerobicDayTargetKcal);
  assert.equal(plan.nutrition.dailyDeficitTargetKcal, 344);
  assert.equal(plan.nutrition.restDayTargetKcal, 1908);
  assert.equal(plan.nutrition.strengthDayTargetKcal, 2345);
  assert.equal(plan.nutrition.currentBodyFatEvidence, "user_estimate");

  assert.ok(plan.validationResults.length >= 6);
  assert.ok(plan.validationResults.every((result) => result.status === "passed"));
  const fatigueValidation = plan.validationResults.find((result) =>
    result.validatorRef === "validator.initial-plan.fatigue-adjacency");
  const comparisons = fatigueValidation?.details?.comparisons;
  assert.ok(Array.isArray(comparisons));
  assert.equal(comparisons.length, 4, "连续计划必须检查肩日到下一轮胸日的跨周恢复");
  assert.deepEqual(comparisons.at(-1)?.from, "shoulders");
  assert.deepEqual(comparisons.at(-1)?.to, "chest");
  assert.ok(plan.reasons.some((reason) => reason.code === "split.four_day_evidence_supported"));
  assert.ok(plan.reasons.some((reason) => reason.code === "schedule.coupled_fatigue_separated"));
});
