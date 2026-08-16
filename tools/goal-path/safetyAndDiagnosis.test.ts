import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";
import type { GoalContractData } from "../../src/coach/domain";

/** Fixed-engine safety and diagnosis evidence, driven through the real kernel. */

async function fixture(options?: { goal?: Partial<GoalContractData>; sessionMinutes?: number }) {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), { now: () => "2026-08-15T20:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-01T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile", locale: "zh-CN", dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: "goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-01", endDate: "2026-12-01" }, measurementPlan: { requiredMeasurements: [] }, guardrails: { minimumRecovery: 2 }, ...options?.goal },
    mandate: { id: "mandate", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const pins = app.getInstalledKnowledgeVersionPins();
  const minutes = options?.sessionMinutes ?? 45;
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-01T08:10:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "plan" },
    planId: "plan",
    expectedRevision: 0,
    revision: {
      id: "plan", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, effectiveFrom: "2026-08-01", knowledgePins: pins,
      sessions: ["s1", "s2"].map((id, index) => ({
        id,
        title: `短课 ${id}`,
        scheduledFor: `2026-08-1${index + 4}T10:00:00.000+08:00`,
        knowledgePins: pins,
        estimatedDuration: { value: minutes, unit: "minutes" as const },
        tasks: [{ id: `task-${id}`, exerciseVariantId: "dumbbell_bench_press.flat.standard", sets: [{ id: `set-${id}`, targetReps: { min: 8, max: 12 }, targetRir: 3 }] }],
      })),
      observationContract: { requiredSignals: ["confirmed_numeric_intake", "planned_training_outcome"], minimumObservationDays: 7, trackingSilenceReviewDays: 7, reviewCadenceDays: 7, successConditions: ["goal_path_supported"], progressionConditions: ["response_supported"], holdConditions: ["observation_window_incomplete"], fallbackConditions: ["execution_friction"], stopConditions: ["safety_hold"] },
    },
  });
  return app;
}

async function recordFact(app: LocalProductKernel, idempotencyKey: string, fact: Parameters<LocalProductKernel["recordTimelineFact"]>[0]["fact"], occurredAt = "2026-08-15T19:00:00.000+08:00") {
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey,
    fact,
    envelope: { time: { startedAt: occurredAt, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
  });
}

test("a confirmed clinical boundary produces a hard-safety assessment", async () => {
  const app = await fixture();
  // The record drawer's admission path: RecordModule draft + confirm.
  const records = new RecordModule({
    createTimelineDraft: (input) => app.createTimelineRecordDraft(input),
    confirmTimelineDraft: (input) => app.confirmTimelineRecordDraft(input),
    createNutritionDraft: (input) => app.createNutritionObservationDraft(input),
    confirmNutritionDraft: (input) => app.confirmNutritionObservationDraft(input),
    correctTimelineFact: (input) => app.correctTimelineFact(input),
  });
  await records.recordFact({
    userId: "u1", idempotencyKey: "clinical", occurredAt: "2026-08-15T19:00:00.000+08:00", source: "manual_form",
    fact: { kind: "clinical_context", context: "recent_surgery_or_acute_injury", note: "用户确认上周肩部手术", confidence: "confirmed" },
  });
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.state, "infeasible_under_guardrails");
  assert.equal(assessment.diagnosis, "recovery_limited");
  assert.equal(assessment.materialSignal, "hard_safety");
  assert.ok(assessment.reasonCodes.some((code) => code === "clinical_boundary:recent_surgery_or_acute_injury"));
});

test("repeated extreme energy restriction produces a hard-safety assessment", async () => {
  const app = await fixture();
  for (const day of [12, 13, 14]) {
    await app.confirmMealObservation({
      userId: "u1",
      idempotencyKey: `tiny-meal-${day}`,
      observation: { id: `tiny-meal-${day}`, occurredAt: `2026-08-${day}T12:00:00.000+08:00`, mode: "structured", description: "用户确认的当日总摄入", nutrients: [{ nutrientId: "energy", amount: 500, unit: "kcal", source: { kind: "manual_form", ref: `tiny-meal-${day}` } }], provenance: "manual_form", dayCoverage: "complete" },
    });
  }
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.state, "infeasible_under_guardrails");
  assert.equal(assessment.materialSignal, "hard_safety");
  assert.ok(assessment.reasonCodes.includes("repeated_extreme_energy_restriction"));
});

test("a confirmed training dose above the hard boundary produces a hard-safety assessment", async () => {
  const app = await fixture();
  for (let index = 0; index < 8; index += 1) {
    const workoutId = `dose-workout-${index}`;
    const pins = app.getInstalledKnowledgeVersionPins();
    await app.prepareFreestyleWorkoutSession({
      userId: "u1",
      workoutId,
      idempotencyKey: `${workoutId}-prepare`,
      session: { id: `${workoutId}-session`, title: "自由训练", scheduledFor: "2026-08-15", knowledgePins: pins, tasks: [{ id: `${workoutId}-task`, exerciseVariantId: "dumbbell_bench_press.flat.standard", sets: [{ id: `${workoutId}-set`, targetReps: { min: 8, max: 12 }, targetRir: 3 }] }] },
    });
    await app.activateWorkoutSession({ userId: "u1", workoutId, mode: "record_only", idempotencyKey: `${workoutId}-activate` });
    await app.confirmCurrentSet({ userId: "u1", workoutId, confirmAsPlanned: true, idempotencyKey: `${workoutId}-set` });
    await app.completeWorkoutSession({ userId: "u1", workoutId, idempotencyKey: `${workoutId}-complete` });
  }
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.state, "infeasible_under_guardrails");
  assert.equal(assessment.materialSignal, "hard_safety");
  assert.ok(assessment.reasonCodes.includes("confirmed_training_dose_above_hard_safety_boundary"));
});

test("repeated missed sessions against a low-friction plan are an execution shortfall, not a plan failure", async () => {
  const app = await fixture({ sessionMinutes: 45 });
  for (const id of ["s1", "s2"]) {
    await recordFact(app, `miss:${id}`, { kind: "training", confidence: "confirmed", reportedSession: { executionStatus: "missed", plannedSessionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: id }, summary: "用户确认没有完成" } });
  }
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.state, "at_risk");
  assert.equal(assessment.diagnosis, "execution_failure");
  assert.ok(assessment.reasonCodes.includes("confirmed_execution_failure_rate_high"));
});

test("degraded confirmed recovery limits the path before any performance judgement", async () => {
  const app = await fixture();
  for (const [index, score] of [[0, 1], [1, 2], [2, 2]] as const) {
    await recordFact(app, `recovery-${index}`, { kind: "recovery", perceivedRecovery: score, confidence: "confirmed" }, `2026-08-1${3 + index}T08:00:00.000+08:00`);
  }
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.state, "at_risk");
  assert.equal(assessment.diagnosis, "recovery_limited");
  assert.ok(assessment.reasonCodes.includes("recovery_guardrail_degraded"));
  assert.equal(assessment.materialSignal, "review_recommended");
});

test("a deadline that only fits an unsafe remaining pace enters the bottleneck state", async () => {
  const app = await fixture({
    goal: { horizon: { startDate: "2026-08-01", endDate: "2026-08-29" }, targets: { targetWeight: { value: 75.6, unit: "kg" } } },
  });
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.state, "at_risk");
  assert.equal(assessment.diagnosis, "goal_plan_mismatch");
  assert.ok(assessment.reasonCodes.includes("deadline_bottleneck_entered"));
});
