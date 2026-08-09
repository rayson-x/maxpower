import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

async function bootstrap(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1",
      actor: { kind: "user", id: "u1" },
      deviceId: "phone",
      occurredAt: "2026-08-08T06:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: { id: "profile", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "mandate", mode: "collaborative" },
  });
}

test("恢复自检先保存用户事实，再生成可追溯但不直接改计划的约束", async () => {
  let sequence = 0;
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-08T07:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  await bootstrap(app);

  const result = await app.submitRecoveryCheckIn({
    userId: "u1",
    idempotencyKey: "morning-checkin",
    occurredAt: "2026-08-08T07:00:00.000+08:00",
    validUntil: "2026-08-09T07:00:00.000+08:00",
    checkIn: { perceivedRecovery: 2, fatigue: 8, comparablePerformanceDeclines: 2 },
  });

  assert.equal(result.decision.constraint.level, "recovery_priority");
  assert.equal(result.timelineEventIds.length, 1);
  const domain = await app.readDomainProjection({ userId: "u1" });
  assert.equal(domain.timeline.current[0]?.fact.kind, "recovery");
  assert.equal(domain.recoveryConstraints.length, 1);
  assert.ok(
    domain.recoveryConstraints[0]?.value.evaluation?.triggeringFactRefs.includes(
      `timeline_event:${result.timelineEventIds[0]}`,
    ),
  );
  const daily = await app.evaluateDailyRecovery({
    userId: "u1",
    date: "2026-08-08",
    validUntil: "2026-08-09T07:00:00.000+08:00",
    timezoneOffsetMinutes: 480,
  });
  assert.equal(daily.evaluation.status, "DAILY_ADJUST");
  assert.equal(daily.evaluation.planBoundary, "current_day_only");
  assert.ok(daily.evaluation.factRefs.length > 0);
  assert.equal(domain.plan?.revision, undefined);
  const replan = await app.readLatestReplanEvaluation("u1");
  assert.equal(replan?.evaluation.trigger.kind, "recovery_constraint_changed");
  assert.equal(replan?.evaluation.trigger.causationId, result.decision.constraint.id);

  const repeated = await app.submitRecoveryCheckIn({
    userId: "u1",
    idempotencyKey: "morning-checkin",
    occurredAt: "2026-08-08T07:00:00.000+08:00",
    validUntil: "2026-08-09T07:00:00.000+08:00",
    checkIn: { perceivedRecovery: 2, fatigue: 8, comparablePerformanceDeclines: 2 },
  });
  assert.deepEqual(repeated.timelineEventIds, result.timelineEventIds);
  assert.equal((await app.readDomainProjection({ userId: "u1" })).recoveryConstraints.length, 1);
  assert.equal((await app.readLatestReplanEvaluation("u1"))?.id, replan?.id);

  await app.submitRecoveryCheckIn({
    userId: "u1",
    idempotencyKey: "morning-checkin-normal",
    occurredAt: "2026-08-09T07:00:00.000+08:00",
    validUntil: "2026-08-10T07:00:00.000+08:00",
    checkIn: { perceivedRecovery: 7, fatigue: 2 },
  });
  // A single green check-in supports the existing plan; it is not a new
  // volume/progression trigger and must not replace the earlier evaluation.
  assert.equal((await app.readLatestReplanEvaluation("u1"))?.id, replan?.id);
});

test("疼痛与酸痛同时存在时保留两条独立的主观症状事实", async () => {
  let sequence = 0;
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-08T07:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  await bootstrap(app);

  const result = await app.submitRecoveryCheckIn({
    userId: "u1",
    idempotencyKey: "mixed-symptoms",
    occurredAt: "2026-08-08T07:00:00.000+08:00",
    validUntil: "2026-08-09T07:00:00.000+08:00",
    checkIn: {
      pain: { area: "right_shoulder", severity: 4 },
      soreness: { area: "chest", severity: 6 },
    },
  });

  assert.equal(result.timelineEventIds.length, 3);
  const domain = await app.readDomainProjection({ userId: "u1" });
  const symptoms = domain.timeline.current
    .map((item) => item.fact)
    .filter((fact): fact is Extract<typeof fact, { kind: "symptom" }> => fact.kind === "symptom");
  assert.deepEqual(
    symptoms.map((fact) => [fact.symptom, fact.area, fact.severity]).sort(),
    [["pain", "right_shoulder", 4], ["soreness", "chest", 6]],
  );
});

test("Facade 从已确认 Timeline 和用户选择的来源重建恢复上下文，不读取平台 SDK", async () => {
  let sequence = 0;
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-08T08:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone",
      occurredAt: "2026-08-01T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap-source",
    },
    profile: {
      id: "profile", trainingExperience: "beginner", locale: "zh-CN",
      primaryDataSources: {
        resting_heart_rate: {
          origin: "health_connect", deviceId: "watch-a", recordingMethod: "platform_import", algorithmVersion: "v1",
        },
      },
    },
    goalContract: { id: "goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-01" } },
    mandate: { id: "mandate", mode: "collaborative" },
  });
  for (let index = 0; index < 8; index += 1) {
    const at = index === 7
      ? "2026-08-08T07:30:00.000+08:00"
      : `2026-08-0${index + 1}T07:30:00.000+08:00`;
    await app.recordTimelineFact({
      userId: "u1",
      idempotencyKey: `rhr-${index}`,
      fact: { kind: "recovery", restingHeartRate: index === 7 ? 65 : 52, restingHeartRateUnit: "beats_per_minute", confidence: "confirmed" },
      envelope: {
        time: { startedAt: at, timezoneOffsetMinutes: 480 },
        provenance: {
          origin: "health_connect", deviceId: "watch-a", recordingMethod: "platform_import", algorithmVersion: "v1",
          dataStatus: "available", confidence: "confirmed",
        },
        privacyClass: "sensitive", causalRefs: ["health_metric:resting_heart_rate"], evidenceRefs: [], layer: "raw_observation",
      },
    });
  }
  const result = await app.evaluateRecoveryFromTimeline({
    userId: "u1",
    validUntil: "2026-08-09T08:00:00.000+08:00",
    checkIn: { perceivedRecovery: 8, fatigue: 2 },
  });
  assert.equal(result.evidence.checkIn.restingHeartRate?.baselineMature, true);
  assert.equal(result.evidence.checkIn.restingHeartRate?.direction, "higher");
  assert.equal(result.decision.constraint.level, "normal");
  assert.equal(result.decision.constraint.intentions?.[0]?.kind, "warmup_check");
  assert.ok(result.decision.constraint.evaluation?.contradictingFactRefs.length);
});

test("Agent 的 recovery timeline 工具只呈现 assessment 卡，不把评估结果伪装成已提交事实", async () => {
  let sequence = 0;
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-08T08:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  await bootstrap(app);
  const session = await app.startSession({ userId: "u1", context: { kind: "today", ref: "2026-08-08" } });
  const result = await app.evaluateRecoveryTimelineForTool(
    { sessionId: session.id },
    { runId: "recovery-run", toolCallId: "recovery-timeline-tool" },
  );
  assert.equal(result.artifact.kind, "recovery_brief");
  assert.equal(result.artifact.status, "timeline_assessment");
  assert.equal(result.card.renderer, "recovery_brief/1");
  assert.equal(result.events.filter((event) => event.type === "artifact-ready").length, 1);
  assert.equal((await app.readDomainProjection({ userId: "u1" })).recoveryConstraints.length, 0);
});

test("恢复评估只将同变式、同单位、用户确认的连续实际表现作为保守降级证据", async () => {
  let now = "2026-08-08T07:00:00.000+08:00";
  let sequence = 0;
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => now,
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  await bootstrap(app);
  const pins = app.getInstalledKnowledgeVersionPins();
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone",
      occurredAt: now, timezoneOffsetMinutes: 480, idempotencyKey: "performance-series-plan",
    },
    planId: "plan", expectedRevision: 0,
    revision: {
      id: "plan-r1",
      goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 },
      effectiveFrom: "2026-08-08",
      knowledgePins: pins,
      sessions: ["a", "b", "c"].map((id, index) => ({
        id: `session-${id}`,
        title: "卧推",
        scheduledFor: `2026-08-${String(8 + index).padStart(2, "0")}`,
        knowledgePins: pins,
        tasks: [{
          id: `press-${id}`,
          exerciseVariantId: "dumbbell_bench_press.flat.standard",
          sets: [{
            id: `set-${id}`,
            targetReps: { min: 5, max: 5 },
            targetLoad: { value: 20, unit: "kg" },
            targetRir: 3,
            rest: { value: 90, unit: "seconds" },
          }],
        }],
      })),
    },
  });

  for (const [index, load] of [20, 17, 14].entries()) {
    const day = 8 + index;
    now = `2026-08-${String(day).padStart(2, "0")}T07:00:00.000+08:00`;
    const workoutId = `performance-${index + 1}`;
    await app.prepareWorkoutSession({
      userId: "u1",
      workoutId,
      prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: `session-${["a", "b", "c"][index]}` },
      idempotencyKey: `${workoutId}:prepare`,
    });
    await app.activateWorkoutSession({ userId: "u1", workoutId, idempotencyKey: `${workoutId}:activate` });
    const draft = await app.saveCurrentSetDraft({
      userId: "u1",
      workoutId,
      draft: { actualLoad: { value: load, unit: "kg" }, actualReps: 5 },
      idempotencyKey: `${workoutId}:draft`,
    });
    await app.confirmCurrentSet({
      userId: "u1",
      workoutId,
      draftId: draft.id,
      idempotencyKey: `${workoutId}:confirm`,
    });
    await app.completeWorkoutSession({ userId: "u1", workoutId, idempotencyKey: `${workoutId}:complete` });
  }

  now = "2026-08-11T07:00:00.000+08:00";
  const result = await app.evaluateRecoveryFromTimeline({
    userId: "u1",
    validUntil: "2026-08-12T07:00:00.000+08:00",
  });

  assert.equal(result.decision.constraint.level, "slight_reduction");
  assert.ok(result.decision.constraint.evaluation?.reasonCodes.includes("repeated_comparable_performance_decline"));
  assert.deepEqual(
    result.decision.constraint.evaluation?.triggeringFactRefs,
    ["workout_session:performance-1", "workout_session:performance-2", "workout_session:performance-3"],
  );
  assert.equal(result.decision.constraint.evaluation?.triggeringFactRefs.some((reference) => reference.startsWith("canonical_packet:")), false);
});
