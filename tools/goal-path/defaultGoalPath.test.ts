import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { DomainAtomicCommit } from "../../src/coach/ledger";
import { projectDomainEvents, type DomainEvent, type GoalContractData } from "../../src/coach/domain";

async function fixture(
  primaryGoal: GoalContractData["primaryGoal"],
  numericMeals = true,
  ledger = new InMemoryCoachLedger(),
  afterFixedGoalPathReview?: (input: { userId: string; causationId: string }) => Promise<void>,
) {
  let sequence = 0;
  const runtime = { now: () => "2026-08-15T20:00:00.000+08:00", nextId: (prefix: string) => `${prefix}-${++sequence}` };
  const app = new LocalProductKernel({ ledger, runtime, ...(afterFixedGoalPathReview ? { afterFixedGoalPathReview } : {}) });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-01T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile", locale: "zh-CN", dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: "goal", primaryGoal, horizon: { startDate: "2026-08-01", endDate: "2026-12-01" }, measurementPlan: { requiredMeasurements: [] }, guardrails: { minimumRecovery: 2 } },
    mandate: { id: "mandate", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const pins = app.getInstalledKnowledgeVersionPins();
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-01T08:10:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "plan" },
    planId: "plan",
    expectedRevision: 0,
    revision: {
      id: "plan", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, effectiveFrom: "2026-08-01", knowledgePins: pins, sessions: [],
      observationContract: { requiredSignals: ["confirmed_numeric_intake", "planned_training_outcome", "comparable_body_measurement"], minimumObservationDays: 7, trackingSilenceReviewDays: 7, reviewCadenceDays: 7, successConditions: ["goal_path_supported"], progressionConditions: ["response_supported"], holdConditions: ["observation_window_incomplete"], fallbackConditions: ["execution_friction"], stopConditions: ["safety_hold"] },
    },
  });
  for (let day = 1; day <= 14; day += 1) {
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    await app.confirmMealObservation({ userId: "u1", idempotencyKey: `meal-${day}`, observation: numericMeals
      ? { id: `meal-${day}`, occurredAt: `${date}T12:00:00.000+08:00`, mode: "structured", description: "用户确认的当日总摄入", nutrients: [{ nutrientId: "energy", amount: 2800, unit: "kcal", source: { kind: "manual_form", ref: `meal-${day}` } }], provenance: "manual_form", dayCoverage: "complete" }
      : { id: `meal-${day}`, occurredAt: `${date}T12:00:00.000+08:00`, mode: "descriptive", description: "吃了很多", provenance: "current_user_statement" },
    });
  }
  for (const [day, value] of [[1, 32], [14, 32.8]] as const) {
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    await app.recordTimelineFact({
      userId: "u1",
      idempotencyKey: `arm-circumference-${day}`,
      fact: { kind: "body", confidence: "confirmed", measurement: { metric: "circumference", site: "upper_arm", quantity: { value, unit: "cm" }, condition: "morning_relaxed" } },
      envelope: { time: { startedAt: `${date}T07:00:00.000+08:00`, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
    });
  }
  return Object.assign(app, { testLedger: ledger });
}

class FrontierAdvancingLedger extends InMemoryCoachLedger {
  private advanceBeforeNextGoalPathCommit = false;

  arm(): void {
    this.advanceBeforeNextGoalPathCommit = true;
  }

  override async commit(input: DomainAtomicCommit) {
    if (this.advanceBeforeNextGoalPathCommit && input.actorId === "goal_path_engine" && input.expectedRevisions.length > 0) {
      this.advanceBeforeNextGoalPathCommit = false;
      const snapshot = await super.read();
      const revision = snapshot.aggregateRevisions.find((item) => item.kind === "timeline" && item.id === "timeline.u1")?.revision ?? 0;
      const occurredAt = "2026-08-15T20:00:01.000+08:00";
      const event: DomainEvent = {
        id: "concurrent-timeline-event",
        schemaVersion: 1,
        userId: "u1",
        actor: { kind: "system", id: "concurrent-frontier" },
        deviceId: "concurrent-test",
        occurredAt,
        recordedAt: occurredAt,
        timezoneOffsetMinutes: 480,
        provenance: { source: "system", confidence: "unknown" },
        evidenceRefs: [],
        causationId: "concurrent-frontier",
        correlationId: "concurrent-frontier",
        name: "timeline.fact_appended",
        aggregate: { kind: "timeline", id: "timeline.u1", revision: revision + 1 },
        payload: {
          fact: { kind: "rest", note: "concurrent frontier", confidence: "confirmed" },
          entry: {
            id: "concurrent-envelope",
            schemaVersion: 1,
            factType: "rest",
            time: { startedAt: occurredAt, timezoneOffsetMinutes: 480 },
            recordedAt: occurredAt,
            actor: { kind: "system", id: "concurrent-frontier" },
            provenance: { origin: "system", recordingMethod: "system_import", dataStatus: "available", confidence: "confirmed" },
            privacyClass: "sensitive",
            causalRefs: [],
            evidenceRefs: [],
            layer: "raw_observation",
          },
        },
      };
      await super.commit({
        kind: "domain",
        userId: "u1",
        actorId: "concurrent-frontier",
        intent: "test.concurrent_frontier",
        expectedRevisions: [{ kind: "timeline", id: "timeline.u1", revision }],
        domainEvents: [event],
        idempotencyKey: "test.concurrent_frontier",
        recordedAt: occurredAt,
      });
    }
    return super.commit(input);
  }
}

class WorkoutFrontierAdvancingLedger extends InMemoryCoachLedger {
  private advanceBeforeNextGoalPathCommit = false;

  arm(): void {
    this.advanceBeforeNextGoalPathCommit = true;
  }

  override async commit(input: DomainAtomicCommit) {
    if (this.advanceBeforeNextGoalPathCommit && input.actorId === "goal_path_engine" && input.expectedRevisions.length > 0) {
      this.advanceBeforeNextGoalPathCommit = false;
      const snapshot = await super.read();
      const workout = projectDomainEvents(snapshot.domainEvents, { userId: "u1" }).workouts[0];
      assert.ok(workout);
      const occurredAt = "2026-08-15T20:00:02.000+08:00";
      const event: DomainEvent = {
        id: "concurrent-workout-event",
        schemaVersion: 1,
        userId: "u1",
        actor: { kind: "system", id: "concurrent-frontier" },
        deviceId: "concurrent-test",
        occurredAt,
        recordedAt: occurredAt,
        timezoneOffsetMinutes: 480,
        provenance: { source: "system", confidence: "unknown" },
        evidenceRefs: [],
        causationId: "concurrent-workout-frontier",
        correlationId: "concurrent-workout-frontier",
        name: "workout.state_changed",
        aggregate: { kind: "workout_session", id: workout.id, revision: workout.revision + 1 },
        payload: { state: workout.state },
      };
      await super.commit({
        kind: "domain",
        userId: "u1",
        actorId: "concurrent-frontier",
        intent: "test.concurrent_workout_frontier",
        expectedRevisions: [{ kind: "workout_session", id: workout.id, revision: workout.revision }],
        domainEvents: [event],
        idempotencyKey: "test.concurrent_workout_frontier",
        recordedAt: occurredAt,
      });
    }
    return super.commit(input);
  }
}

/** The record fixture remains realistic; only its automatic deliveries are
 * withheld so the scheduled delivery below is independently observable. */
class FrontierDeliverySuppressingLedger extends InMemoryCoachLedger {
  override async commit(input: DomainAtomicCommit) {
    if (input.actorId === "goal_path_engine" && input.intent.startsWith("goal_path.frontier_changed.")) {
      return super.commit({ ...input, artifacts: [], presentations: [] });
    }
    return super.commit(input);
  }
}

test("the same confirmed surplus is goal-specific: fat loss at risk, hypertrophy supported", async () => {
  const fatLoss = await fixture("fat_loss_preserve_lean_mass");
  const hypertrophy = await fixture("hypertrophy");
  const fatDecision = await fatLoss.reviewGoalPath({ userId: "u1", evaluatedAt: "2026-08-15T20:00:00.000+08:00", timezoneOffsetMinutes: 480 });
  const growthDecision = await hypertrophy.reviewGoalPath({ userId: "u1", evaluatedAt: "2026-08-15T20:00:00.000+08:00", timezoneOffsetMinutes: 480 });
  assert.equal(fatDecision.state, "at_risk");
  assert.ok(fatDecision.reasonCodes.includes("fat_loss_current_path_not_in_deficit"));
  assert.equal(growthDecision.state, "on_path");
  assert.ok(growthDecision.reasonCodes.includes("current_plan_path_supported"));
  assert.equal(fatDecision.snapshotVersion.aggregateRefs.find((ref) => ref.kind === "plan")?.revision, 1);
  assert.equal(growthDecision.snapshotVersion.ledgerVersions.length, 28);
  const persistedDailyLedgers = (await fatLoss.testLedger.read()).artifacts.filter((artifact) => artifact.kind === "daily_health_ledger");
  assert.equal(persistedDailyLedgers.length, 0, "GoalPath window evaluation must not persist 28 daily artifacts per Timeline revision");
});

test("GoalPath delivery CAS turns a concurrent frontier advance into a stale audit without presentation", async () => {
  const ledger = new FrontierAdvancingLedger();
  const app = await fixture("fat_loss_preserve_lean_mass", true, ledger);
  ledger.arm();
  const result = await app.reviewAndDeliverGoalPath({
    userId: "u1",
    trigger: "explicit_request",
    channel: "manual_home",
    idempotencyKey: "concurrent-goal-path-review",
    timezoneOffsetMinutes: 480,
  });
  assert.equal(result.delivered, false);
  assert.equal(result.artifact.goalPathAudit?.status, "stale");
  assert.equal(result.artifact.goalPathAssessment?.suppressionReason, "stale");
  const snapshot = await ledger.read();
  assert.equal(snapshot.presentations.some((presentation) => presentation.artifactId === result.artifact.id), false);
  assert.equal(snapshot.aggregateRevisions.find((item) => item.kind === "timeline" && item.id === "timeline.u1")?.revision, 17);
});

test("a material daily review enters the same post-fixed Pi ingress exactly once", async () => {
  const causationIds: string[] = [];
  const app = await fixture(
    "fat_loss_preserve_lean_mass",
    true,
    new FrontierDeliverySuppressingLedger(),
    async ({ causationId }) => { causationIds.push(causationId); },
  );
  causationIds.length = 0;

  const decision = await app.runDailyGoalPathReview({
    userId: "u1",
    idempotencyKey: "daily:u1:2026-08-15",
    timezoneOffsetMinutes: 480,
  });

  assert.equal(decision.state, "at_risk");
  assert.equal(causationIds.length, 1);
  assert.notEqual(causationIds[0], "");
});

test("GoalPath delivery CAS also pins WorkoutSession evidence", async () => {
  const ledger = new WorkoutFrontierAdvancingLedger();
  const app = await fixture("fat_loss_preserve_lean_mass", true, ledger);
  await app.prepareFreestyleWorkoutSession({
    userId: "u1",
    workoutId: "freestyle-cas",
    idempotencyKey: "freestyle-cas-prepare",
    session: {
      id: "freestyle-cas-session",
      title: "自由训练",
      scheduledFor: "2026-08-15",
      knowledgePins: app.getInstalledKnowledgeVersionPins(),
      tasks: [{
        id: "freestyle-cas-task",
        exerciseVariantId: "dumbbell_bench_press.flat.standard",
        sets: [{ id: "freestyle-cas-set", targetReps: { min: 10, max: 10 }, targetLoad: { value: 12, unit: "kg" }, targetRir: 2 }],
      }],
    },
  });
  ledger.arm();
  const result = await app.reviewAndDeliverGoalPath({ userId: "u1", trigger: "explicit_request", channel: "manual_home", idempotencyKey: "concurrent-workout-goal-path-review", timezoneOffsetMinutes: 480 });
  assert.equal(result.delivered, false);
  assert.equal(result.artifact.goalPathAudit?.status, "stale");
  assert.ok(result.assessment.snapshotVersion.aggregateRefs.some((ref) => ref.kind === "workout_session" && ref.id === "freestyle-cas" && ref.revision === 1));
  assert.equal((await ledger.read()).presentations.some((presentation) => presentation.artifactId === result.artifact.id), false);
});

test("correcting a Workout result marks an existing GoalPath presentation stale", async () => {
  const app = await fixture("fat_loss_preserve_lean_mass");
  await app.prepareFreestyleWorkoutSession({
    userId: "u1",
    workoutId: "freestyle-correction",
    idempotencyKey: "freestyle-correction-prepare",
    session: {
      id: "freestyle-correction-session",
      title: "自由训练",
      scheduledFor: "2026-08-15",
      knowledgePins: app.getInstalledKnowledgeVersionPins(),
      tasks: [{ id: "freestyle-task", exerciseVariantId: "dumbbell_bench_press.flat.standard", sets: [{ id: "freestyle-set", targetReps: { min: 10, max: 10 }, targetLoad: { value: 12, unit: "kg" }, targetRir: 2 }] }],
    },
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "freestyle-correction", idempotencyKey: "freestyle-correction-start" });
  const outcome = await app.confirmCurrentSet({ userId: "u1", workoutId: "freestyle-correction", confirmAsPlanned: true, idempotencyKey: "freestyle-correction-set" });
  const review = await app.reviewAndDeliverGoalPath({ userId: "u1", trigger: "explicit_request", channel: "manual_home", idempotencyKey: "workout-evidence-review", timezoneOffsetMinutes: 480 });
  assert.ok(review.artifact.evidenceRefs.some((ref) => ref.aggregate === "workout" && ref.id === "freestyle-correction"));
  const presentationId = "presentation:workout-evidence-review";
  await app.testLedger.commit({
    kind: "domain",
    userId: "u1",
    actorId: "test",
    intent: "test.present_goal_path",
    expectedRevisions: [],
    domainEvents: [],
    presentations: [{ id: presentationId, artifactId: review.artifact.id, renderer: "evidence_brief/1", status: "ready" }],
    idempotencyKey: "test.present_goal_path",
    recordedAt: "2026-08-15T20:00:03.000+08:00",
  });
  await app.correctRecordedSet({ userId: "u1", workoutId: "freestyle-correction", outcomeId: outcome.id, patch: { actualReps: 9 }, reason: "修正次数", idempotencyKey: "freestyle-correction-fix" });
  assert.equal((await app.testLedger.read()).presentations.find((presentation) => presentation.id === presentationId)?.status, "stale");
});

test("food descriptions never become an energy-path judgement", async () => {
  const app = await fixture("fat_loss_preserve_lean_mass", false);
  const decision = await app.reviewGoalPath({ userId: "u1", evaluatedAt: "2026-08-15T20:00:00.000+08:00", timezoneOffsetMinutes: 480 });
  assert.equal(decision.state, "insufficient_evidence");
  assert.ok(decision.reasonCodes.includes("fat_loss_confirmed_energy_and_comparable_weight_path_unknown"));
});

test("单个完整饮食日不会被放大成长周期失败信号", async () => {
  const app = await fixture("fat_loss_preserve_lean_mass", false);
  await app.confirmMealObservation({
    userId: "u1",
    idempotencyKey: "one-complete-day",
    observation: { id: "one-complete-day", occurredAt: "2026-08-14T20:00:00.000+08:00", mode: "structured", description: "仅这一天完整", nutrients: [{ nutrientId: "energy", amount: 3200, unit: "kcal", source: { kind: "manual_form", ref: "one-complete-day" } }], provenance: "manual_form", dayCoverage: "complete" },
  });
  const decision = await app.reviewGoalPath({ userId: "u1", evaluatedAt: "2026-08-15T20:00:00.000+08:00", timezoneOffsetMinutes: 480 });
  assert.equal(decision.state, "insufficient_evidence");
  assert.ok(
    decision.reasonCodes.includes("fat_loss_representative_energy_coverage_insufficient")
      || decision.reasonCodes.includes("fat_loss_confirmed_energy_and_comparable_weight_path_unknown"),
    JSON.stringify(decision.reasonCodes),
  );
});


test("当前趋势低于剩余期限所需速度时判为风险，而不是只因存在少量缺口就 on-path", async () => {
  const app = await fixture("fat_loss_preserve_lean_mass");
  const before = await app.readDomainProjection({ userId: "u1" });
  await app.executeDomainCommand({
    type: "goal_contract.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "pace-goal" },
    goalContractId: "goal", expectedRevision: 1,
    goalContract: { ...before.goalContract!.value, horizon: { startDate: "2026-08-01", endDate: "2026-10-01" }, targets: { targetWeight: { value: 70, unit: "kg" } } },
  });
  await app.executeDomainCommand({ type: "plan.revise", meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:01:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "pace-plan" }, planId: "plan", expectedRevision: 1, revision: { ...before.plan!.value, effectiveFrom: "2026-07-20", goalContractRef: { kind: "goal_contract", id: "goal", revision: 2 } } });
  // 平台窗政策（plateau.v1）：仅体重信号不足 4 个周均点不出判定——
  // 夹具给 5 周缓慢降重，证明「速度慢于期限所需」在窗口满足后仍判风险。
  for (const [day, kg] of [[8, 75], [15, 74.9], [22, 74.85], [29, 74.8], [36, 74.75]] as const) {
    const date = new Date(Date.parse("2026-07-10T00:00:00.000Z") + day * 86_400_000).toISOString().slice(0, 10);
    await app.recordTimelineFact({ userId: "u1", idempotencyKey: `pace-weight-${day}`, fact: { kind: "body", confidence: "confirmed", measurement: { metric: "body_weight", quantity: { value: kg, unit: "kg" }, condition: "morning" } }, envelope: { time: { startedAt: `${date}T07:00:00.000+08:00`, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" } });
  }
  const decision = await app.reviewGoalPath({ userId: "u1", evaluatedAt: "2026-08-15T20:00:00.000+08:00", timezoneOffsetMinutes: 480 });
  assert.equal(decision.state, "at_risk");
  assert.ok(decision.reasonCodes.includes("observed_weight_trend_below_required_goal_path"));
});

test("体脂目标所需速度跨越护栏时按剩余期限判不可达", async () => {
  const app = await fixture("fat_loss_preserve_lean_mass");
  const before = await app.readDomainProjection({ userId: "u1" });
  await app.executeDomainCommand({
    type: "goal_contract.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "body-fat-deadline-goal" },
    goalContractId: "goal", expectedRevision: 1,
    goalContract: { ...before.goalContract!.value, horizon: { startDate: "2026-08-01", endDate: "2026-08-29" }, targets: { currentBodyFat: { value: 30, unit: "percent" }, targetBodyFat: { value: 20, unit: "percent" } } },
  });
  await app.executeDomainCommand({ type: "plan.revise", meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:01:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "body-fat-deadline-plan" }, planId: "plan", expectedRevision: 1, revision: { ...before.plan!.value, goalContractRef: { kind: "goal_contract", id: "goal", revision: 2 } } });
  const decision = await app.reviewGoalPath({ userId: "u1", evaluatedAt: "2026-08-15T20:00:00.000+08:00", timezoneOffsetMinutes: 480 });
  assert.equal(decision.state, "infeasible_under_guardrails");
  assert.ok(decision.reasonCodes.includes("deadline_target:body_fat"));
});

test("力量目标缺少可比较起点时返回证据不足，不会默认 on-path", async () => {
  const app = await fixture("strength");
  const before = await app.readDomainProjection({ userId: "u1" });
  await app.executeDomainCommand({
    type: "goal_contract.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "strength-deadline-goal" },
    goalContractId: "goal", expectedRevision: 1,
    goalContract: { ...before.goalContract!.value, primaryGoal: "strength", targets: { strength: { benchPress: { value: 120, unit: "kg" } } } },
  });
  await app.executeDomainCommand({ type: "plan.revise", meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:01:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "strength-deadline-plan" }, planId: "plan", expectedRevision: 1, revision: { ...before.plan!.value, goalContractRef: { kind: "goal_contract", id: "goal", revision: 2 } } });
  const decision = await app.reviewGoalPath({ userId: "u1", evaluatedAt: "2026-08-15T20:00:00.000+08:00", timezoneOffsetMinutes: 480 });
  assert.equal(decision.state, "insufficient_evidence");
  assert.ok(decision.reasonCodes.includes("goal_deadline_baseline_missing"));
  assert.ok(decision.reasonCodes.includes("current_strength_missing_for_deadline:benchPress"));
});

test("record-first daily review does not turn silence into plan non-execution", async () => {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), { now: () => "2026-08-15T20:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` });
  await app.executeDomainCommand({ type: "user.bootstrap", meta: { userId: "u2", actor: { kind: "user", id: "u2" }, deviceId: "phone", occurredAt: "2026-08-01T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" }, profile: { id: "profile", locale: "zh-CN" }, mandate: { id: "mandate", mode: "manual", planChangeAuthorization: "always_ask" } });
  const decision = await app.runDailyGoalPathReview({ userId: "u2", idempotencyKey: "daily:u2:2026-08-15", timezoneOffsetMinutes: 480 });
  assert.equal(decision.state, "insufficient_evidence");
  assert.equal(decision.diagnosis, "goal_plan_mismatch");
  assert.ok(!decision.reasonCodes.includes("confirmed_execution_failure_rate_high"));
});

test("physique uses waist and shoulder proxy progress instead of fat-loss or hypertrophy energy rules", async () => {
  const app = await fixture("strength");
  await app.executeDomainCommand({
    type: "goal_contract.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "physique-goal" },
    goalContractId: "goal",
    expectedRevision: 1,
    goalContract: {
      id: "goal",
      primaryGoal: "physique",
      horizon: { startDate: "2026-08-01", endDate: "2026-12-01" },
      targets: { targetShoulderWaistRatio: 1.5 },
      status: "active",
    },
  });
  const domain = await app.readDomainProjection({ userId: "u1" });
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:05:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "physique-plan" },
    planId: "plan",
    expectedRevision: 1,
    revision: { ...domain.plan!.value, goalContractRef: { kind: "goal_contract", id: "goal", revision: 2 } },
  });
  for (const [day, waist, shoulder] of [[1, 90, 120], [14, 89, 121]] as const) {
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    for (const [site, value, minute] of [["waist", waist, "00"], ["shoulder", shoulder, "05"]] as const) {
      await app.recordTimelineFact({
        userId: "u1",
        idempotencyKey: `${site}-${day}`,
        fact: { kind: "body", confidence: "confirmed", measurement: { metric: "circumference", site, quantity: { value, unit: "cm" }, condition: "morning" } },
        envelope: { time: { startedAt: `${date}T07:${minute}:00.000+08:00`, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
      });
    }
  }

  const decision = await app.reviewGoalPath({ userId: "u1", evaluatedAt: "2026-08-15T20:00:00.000+08:00", timezoneOffsetMinutes: 480 });
  assert.equal(decision.state, "on_path", JSON.stringify(decision));
  assert.equal(decision.diagnosis, "none");
  assert.ok(decision.reasonCodes.includes("current_plan_path_supported"));
  assert.ok(!decision.reasonCodes.some((code) => code.startsWith("fat_loss_") || code.startsWith("hypertrophy_")));
});

test("goal completion remains a user-confirmed candidate and becomes stale after the fact frontier changes", async () => {
  const prepareReachedGoal = async () => {
    const app = await fixture("hypertrophy");
    const before = await app.readDomainProjection({ userId: "u1" });
    await app.executeDomainCommand({
      type: "goal_contract.revise",
      meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "completion-goal" },
      goalContractId: "goal",
      expectedRevision: 1,
      goalContract: { ...before.goalContract!.value, targets: { targetWeight: { value: 78, unit: "kg" } }, measurementPlan: { requiredMeasurements: ["body_weight"] } },
    });
    await app.executeDomainCommand({
      type: "plan.revise",
      meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:05:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "completion-plan" },
      planId: "plan",
      expectedRevision: 1,
      revision: { ...before.plan!.value, goalContractRef: { kind: "goal_contract", id: "goal", revision: 2 } },
    });
    for (const [date, value] of [["2026-08-01", 77.4], ["2026-08-14", 78]] as const) {
      await app.recordTimelineFact({
        userId: "u1",
        idempotencyKey: `completion-weight:${date}`,
        fact: { kind: "body", confidence: "confirmed", measurement: { metric: "body_weight", quantity: { value, unit: "kg" }, condition: "after_waking" } },
        envelope: { time: { startedAt: `${date}T07:00:00.000+08:00`, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
      });
    }
    return app;
  };

  const app = await prepareReachedGoal();
  const proposal = await app.proposeGoalCompletion({ userId: "u1", timezoneOffsetMinutes: 480, idempotencyKey: "completion-proposal" });
  assert.equal(proposal.goalCompletionProposal?.status, "awaiting_confirmation");
  assert.notEqual((await app.readDomainProjection({ userId: "u1" })).plan?.value.lifecycle?.state, "completed");
  const completed = await app.resolveGoalCompletion({ userId: "u1", proposalId: proposal.id, resolution: "confirm_and_record_only", idempotencyKey: "completion-confirm" });
  assert.equal(completed.status, "completed");
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan?.value.lifecycle?.state, "completed");
  assert.equal((await app.readProductProjection({ userId: "u1", date: "2026-08-15", timezoneOffsetMinutes: 480, calendarMode: "week", calendarAnchorDate: "2026-08-15" })).today.state, "record_first");

  const maintenanceApp = await prepareReachedGoal();
  const maintenanceProposal = await maintenanceApp.proposeGoalCompletion({ userId: "u1", timezoneOffsetMinutes: 480, idempotencyKey: "maintenance-proposal" });
  const maintenance = await maintenanceApp.resolveGoalCompletion({ userId: "u1", proposalId: maintenanceProposal.id, resolution: "confirm_and_maintain", idempotencyKey: "maintenance-confirm" });
  assert.equal(maintenance.next, "maintenance_planning");
  assert.equal((await maintenanceApp.readDomainProjection({ userId: "u1" })).plan?.value.lifecycle?.state, "completed");
  const durableCompletion = (await maintenanceApp.readEvidenceBriefArtifact({ userId: "u1", artifactId: `${maintenanceProposal.id}:completed` })).goalCompletionProposal;
  assert.equal(durableCompletion?.next, "maintenance_planning");
  assert.equal((await maintenanceApp.readProductProjection({ userId: "u1", date: "2026-08-15", timezoneOffsetMinutes: 480, calendarMode: "week", calendarAnchorDate: "2026-08-15" })).coach.goalCompletionNext, "maintenance_planning");

  const staleApp = await prepareReachedGoal();
  const staleProposal = await staleApp.proposeGoalCompletion({ userId: "u1", timezoneOffsetMinutes: 480, idempotencyKey: "stale-proposal" });
  await staleApp.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "new-frontier-fact",
    fact: { kind: "recovery", perceivedRecovery: 4, confidence: "confirmed" },
    envelope: { time: { startedAt: "2026-08-15T19:00:00.000+08:00", timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
  });
  await assert.rejects(
    () => staleApp.resolveGoalCompletion({ userId: "u1", proposalId: staleProposal.id, resolution: "confirm_and_record_only", idempotencyKey: "stale-confirm" }),
    /goal_completion_proposal_stale/,
  );
  assert.notEqual((await staleApp.readDomainProjection({ userId: "u1" })).plan?.value.lifecycle?.state, "completed");
});
