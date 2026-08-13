import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { workoutSetRealtimeGate } from "../../src/mobile/ui/workoutRealtimeGate";
import { decodeMotionPacket, type MotionRepDisposition } from "../../src/motion/motionPacket";
import { buildCanonicalSetObservation } from "../../src/workout/CanonicalSetObservation";

function fixture() {
  let now = "2026-08-08T07:00:00.000+08:00";
  let sequence = 0;
  let monotonic = 10_000;
  let clockEpoch = "process-1";
  const scheduled: string[] = [];
  const cancelled: string[] = [];
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => now, nextId: (prefix) => `${prefix}-${++sequence}` },
    monotonicClock: { nowMs: () => monotonic, epochId: () => clockEpoch },
    notifications: {
      async schedule(input) { scheduled.push(input.id); },
      async cancel(id) { cancelled.push(id); },
    },
  });
  return {
    app,
    ledger,
    scheduled,
    cancelled,
    setNow(value: string) { now = value; },
    setMonotonic(value: number) { monotonic = value; },
    setClockEpoch(value: string) { clockEpoch = value; },
  };
}

test("WorkoutSession Realtime 入口只在 exact view/profile/bridge/runtime 全部可用时出现", () => {
  const exact = {
    nativeRuntimeAvailable: true,
    recognition: { canRunRustRecognition: true, profileIdentity: "bench/front-left-45/halpe26/v1" },
    runtime: { localRecording: "available", repCounting: "available", profileIdentity: "bench/front-left-45/halpe26/v1" },
  } as const;
  assert.equal(workoutSetRealtimeGate(exact), true);
  assert.equal(workoutSetRealtimeGate({ ...exact, recognition: { canRunRustRecognition: false, profileIdentity: null } }), false, "unsupported exercise/view");
  assert.equal(workoutSetRealtimeGate({ ...exact, runtime: { ...exact.runtime, profileIdentity: "bench/front/halpe26/v1" } }), false, "wrong exact view/profile identity");
  assert.equal(workoutSetRealtimeGate({ ...exact, runtime: { ...exact.runtime, repCounting: "unavailable" } }), false, "bridge cannot emit canonical reps");
  assert.equal(workoutSetRealtimeGate({ ...exact, nativeRuntimeAvailable: false }), false, "native runtime unavailable");
});

async function bootstrapPlan(app: CoachApplication, exerciseVariantId = "dumbbell_bench_press.flat.standard") {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-08T07:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap",
    },
    profile: { id: "profile", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "mandate", mode: "collaborative" },
  });
  const pins = app.getInstalledKnowledgeVersionPins();
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-08T07:01:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "plan",
    },
    planId: "plan", expectedRevision: 0,
    revision: {
      id: "plan-r1", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, effectiveFrom: "2026-08-08", knowledgePins: pins,
      sessions: [{
        id: "push", title: "Push", scheduledFor: "2026-08-08", knowledgePins: pins,
        tasks: [{
          id: "press", exerciseVariantId,
          sets: [
            { id: "set-1", targetReps: { min: 8, max: 8 }, targetLoad: { value: 20, unit: "kg" }, targetRir: 3, rest: { value: 90, unit: "seconds" } },
            { id: "set-2", targetReps: { min: 8, max: 8 }, targetLoad: { value: 20, unit: "kg" }, targetRir: 3, rest: { value: 90, unit: "seconds" } },
          ],
        }],
      }],
    },
  });
}

function canonicalWorkoutPacketFixture(input: {
  repId: bigint;
  disposition: MotionRepDisposition;
  profileIdentity: string;
  frameId?: bigint;
  landmarkSource?: "measured" | "unknown";
  canonicalConfidence?: number;
}) {
  const sequence = new TextEncoder().encode("fixture:workout-canonical");
  const algorithm = new TextEncoder().encode("rust-canonical-fixture/v1");
  const identity = new TextEncoder().encode(input.profileIdentity);
  const length = 44 + sequence.length + algorithm.length + 26 + 4 + 30 + 84 + identity.length + 5;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("MOTN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 5, true);
  view.setUint32(8, length, true);
  view.setBigUint64(12, input.frameId ?? input.repId, true);
  view.setBigUint64(20, 1_000n + input.repId * 100n, true);
  view.setBigUint64(28, 1n, true);
  view.setUint8(36, 1);
  view.setUint8(37, 1);
  view.setUint16(38, sequence.length, true);
  let offset = 40;
  bytes.set(sequence, offset); offset += sequence.length;
  view.setUint16(offset, algorithm.length, true); offset += 2;
  bytes.set(algorithm, offset); offset += algorithm.length;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint8(offset, input.landmarkSource === "unknown" ? 3 : 0);
  view.setUint8(offset + 1, 0b111);
  offset += 2;
  for (const value of [0.25, 0.5, 0, 0.95, input.canonicalConfidence ?? 0.95, 0.01]) { view.setFloat32(offset, value, true); offset += 4; }
  bytes.set(new TextEncoder().encode("RPS1"), offset); offset += 4;
  view.setUint8(offset, 1); offset += 1;
  view.setBigUint64(offset, 7n, true); offset += 8;
  view.setUint8(offset, 0); offset += 1;
  view.setBigUint64(offset, 0n, true); offset += 8;
  view.setUint8(offset, 0); offset += 1;
  view.setBigUint64(offset, 0n, true); offset += 8;
  view.setUint8(offset, 0); offset += 1;
  view.setUint16(offset, 1, true); offset += 2;
  for (const value of [input.repId, 1n, 1_000n, 2n, 1_050n, 3n, 1_100n, 100n + input.repId, 456n]) { view.setBigUint64(offset, value, true); offset += 8; }
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint8(offset, 0); offset += 1;
  const dispositionCode = input.disposition === "confirmed" ? 0 : input.disposition === "needs_review" ? 1 : 2;
  view.setUint8(offset, dispositionCode << 2); offset += 1;
  view.setUint8(offset, 0); offset += 1;
  view.setUint8(offset, 0); offset += 1;
  view.setUint16(offset, identity.length, true); offset += 2;
  bytes.set(identity, offset); offset += identity.length;
  view.setUint16(offset, 0, true); offset += 2;
  bytes.set(new TextEncoder().encode("SET1"), offset); offset += 4;
  view.setUint8(offset, 2);
  return decodeMotionPacket(buffer);
}

test("WorkoutSession 在同一执行实体中切换记录/监控、提交真实组并原子写入 Timeline", async () => {
  const { app, scheduled, cancelled, setMonotonic } = fixture();
  await bootstrapPlan(app);
  let workout = await app.prepareWorkoutSession({
    userId: "u1", workoutId: "workout-1", prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" }, mode: "record_only", idempotencyKey: "prepare",
  });
  assert.equal(workout.status, "planned");
  workout = await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-1", mode: "coach_monitor", idempotencyKey: "start" });
  assert.equal(workout.state.mode, "coach_monitor");
  assert.equal(workout.state.currentSetId, "set-1");
  workout = await app.setWorkoutMonitoringMode({ userId: "u1", workoutId: "workout-1", enabled: false, idempotencyKey: "monitor-off" });
  assert.equal(workout.state.mode, "record_only");
  workout = await app.reviseUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-1",
    scope: "next_set",
    reason: "user_adjusted_unstarted_set",
    idempotencyKey: "adjust-unstarted-set",
    frozenPrescription: {
      ...workout.frozenPrescription,
      tasks: [{
        ...workout.frozenPrescription.tasks[0]!,
        sets: [{ ...workout.frozenPrescription.tasks[0]!.sets[0]!, targetLoad: { value: 22, unit: "kg" } }, workout.frozenPrescription.tasks[0]!.sets[1]!],
      }],
    },
  });
  assert.equal(workout.frozenPrescription.tasks[0]?.sets[0]?.targetLoad?.value, 22);

  const unsubmitted = await app.saveCurrentSetDraft({ userId: "u1", workoutId: "workout-1", idempotencyKey: "draft" });
  assert.equal(unsubmitted.proposedFromPrescription.targetLoad?.value, 22);
  workout = await app.setWorkoutMonitoringMode({
    userId: "u1",
    workoutId: "workout-1",
    enabled: true,
    idempotencyKey: "monitor-during-current",
  });
  assert.equal(workout.state.mode, "coach_monitor");
  assert.equal(workout.state.currentSetId, "set-1");
  assert.equal(workout.drafts[0]?.id, unsubmitted.id);
  assert.equal(workout.drafts[0]?.proposedFromPrescription.targetLoad?.value, 22);
  workout = await app.setWorkoutMonitoringMode({
    userId: "u1",
    workoutId: "workout-1",
    enabled: false,
    idempotencyKey: "monitor-during-current-off",
  });
  assert.equal(workout.drafts[0]?.id, unsubmitted.id);
  await app.retractCurrentSetDraft({ userId: "u1", workoutId: "workout-1", draftId: unsubmitted.id, idempotencyKey: "retract" });
  workout = (await app.readDomainProjection({ userId: "u1" })).workouts[0]!;
  assert.equal(workout.drafts.length, 0);
  assert.equal(workout.setOutcomes.length, 0);

  const draft = await app.saveCurrentSetDraft({
    userId: "u1", workoutId: "workout-1", idempotencyKey: "draft-edited",
    draft: { actualLoad: { value: 18, unit: "kg" }, actualReps: 9, noviceFeedback: "appropriate", noviceFeedbackMappingVersion: "novice-v1" },
  });
  const outcome = await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", draftId: draft.id, idempotencyKey: "confirm-edited" });
  assert.equal(outcome.completedAs, "user_edited");
  assert.equal(outcome.actualLoad?.value, 18);
  assert.equal(outcome.actualRir, undefined);
  workout = (await app.readDomainProjection({ userId: "u1" })).workouts[0]!;
  assert.equal(workout.state.currentSetId, "set-2");
  await app.startRestTimer({ userId: "u1", workoutId: "workout-1", duration: { value: 90, unit: "seconds" }, idempotencyKey: "rest" });
  assert.equal(scheduled.length, 1);
  const replayedTimer = await app.startRestTimer({ userId: "u1", workoutId: "workout-1", duration: { value: 90, unit: "seconds" }, idempotencyKey: "rest" });
  assert.equal(replayedTimer.notificationScheduled, false);
  assert.equal(scheduled.length, 1);
  setMonotonic(55_000);
  assert.equal(await app.remainingWorkoutRest({ userId: "u1", workoutId: "workout-1" }), 45);
  const extended = await app.adjustWorkoutRest({ userId: "u1", workoutId: "workout-1", deltaSeconds: 30, idempotencyKey: "rest-plus" });
  assert.deepEqual(extended, { remainingSeconds: 75, notificationScheduled: true });
  assert.equal(await app.remainingWorkoutRest({ userId: "u1", workoutId: "workout-1" }), 75);
  assert.equal(scheduled.length, 2);
  const shortened = await app.adjustWorkoutRest({ userId: "u1", workoutId: "workout-1", deltaSeconds: -15, idempotencyKey: "rest-minus" });
  assert.deepEqual(shortened, { remainingSeconds: 60, notificationScheduled: true });
  assert.equal(await app.remainingWorkoutRest({ userId: "u1", workoutId: "workout-1" }), 60);
  assert.equal(scheduled.length, 3);
  await app.cancelWorkoutRest({ userId: "u1", workoutId: "workout-1", idempotencyKey: "rest-cancel" });
  assert.deepEqual(cancelled, [scheduled.at(-1)]);
  assert.equal(await app.remainingWorkoutRest({ userId: "u1", workoutId: "workout-1" }), null);
  await app.cancelWorkoutRest({ userId: "u1", workoutId: "workout-1", idempotencyKey: "rest-cancel" });
  assert.deepEqual(cancelled, [scheduled.at(-1)]);

  const confirmed = await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "confirm-plan" });
  assert.equal(confirmed.completedAs, "confirmed_as_planned");
  const sessionOutcome = await app.completeWorkoutSession({ userId: "u1", workoutId: "workout-1", idempotencyKey: "finish" });
  assert.equal(sessionOutcome.status, "completed");
  const projection = await app.readDomainProjection({ userId: "u1" });
  assert.equal(projection.workouts[0]?.status, "completed");
  const trainingFacts = projection.timeline.current.filter((event) => event.fact.kind === "training");
  const historicalSetFacts = trainingFacts.filter((event) => event.fact.kind === "training" && event.fact.historicalSet);
  // ticket 02：1 条完成事实 + 每组一条 historicalSet
  assert.equal(trainingFacts.length - historicalSetFacts.length, 1);
  assert.equal(historicalSetFacts.length, 2);
  assert.equal(projection.timeline.current[0]?.fact.kind, "training");
});

test("canonical observation 重启后保留且用户 performed 修正不会改写 observed evidence", async () => {
  const { app, ledger } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({
    userId: "u1", workoutId: "workout-observation", prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" }, idempotencyKey: "observation-prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-observation", idempotencyKey: "observation-start" });
  const profileIdentity = "dumbbell-bench/front-left-45/v1";
  const packets = [
    canonicalWorkoutPacketFixture({ repId: 1n, disposition: "confirmed", profileIdentity }),
    canonicalWorkoutPacketFixture({ repId: 2n, disposition: "needs_review", profileIdentity }),
    canonicalWorkoutPacketFixture({ repId: 3n, disposition: "rejected", profileIdentity }),
  ];
  const observation = await app.saveCurrentSetObservation({
    userId: "u1",
    workoutId: "workout-observation",
    context: { workoutId: "workout-observation", setId: "set-1", exerciseVariantId: "dumbbell_bench_press.flat.standard", capabilityIdentity: profileIdentity },
    packets,
    telemetry: { processedFrames: 3, validFrames: 3 },
    observedAt: "2026-08-08T07:02:00.000+08:00",
    idempotencyKey: "save-observation",
  });
  assert.deepEqual(observation.counts, { confirmed: 1, needsReview: 1, rejected: 1 });
  const noValidFrames = buildCanonicalSetObservation({
    context: { workoutId: "workout-observation", setId: "set-1", exerciseVariantId: "dumbbell_bench_press.flat.standard", capabilityIdentity: profileIdentity },
    packets,
    telemetry: { processedFrames: 3, validFrames: 0 },
    observedAt: "2026-08-08T07:02:30.000+08:00",
  });
  assert.equal(noValidFrames.judgement, "cannot_judge");
  assert.equal(noValidFrames.cannotJudgeReason, "no_valid_frames");
  const lowConfidenceButCanonical = buildCanonicalSetObservation({
    context: { workoutId: "workout-observation", setId: "set-1", exerciseVariantId: "dumbbell_bench_press.flat.standard", capabilityIdentity: profileIdentity },
    packets: [canonicalWorkoutPacketFixture({ repId: 4n, disposition: "needs_review", profileIdentity, canonicalConfidence: 0.01 })],
    telemetry: { processedFrames: 1, validFrames: 1 },
    observedAt: "2026-08-08T07:02:31.000+08:00",
  });
  assert.equal(lowConfidenceButCanonical.judgement, "observed", "TS must not invent a confidence threshold over Rust output");
  const producerUnknown = buildCanonicalSetObservation({
    context: { workoutId: "workout-observation", setId: "set-1", exerciseVariantId: "dumbbell_bench_press.flat.standard", capabilityIdentity: profileIdentity },
    packets: [canonicalWorkoutPacketFixture({ repId: 5n, disposition: "needs_review", profileIdentity, landmarkSource: "unknown" })],
    telemetry: { processedFrames: 1, validFrames: 1 },
    observedAt: "2026-08-08T07:02:32.000+08:00",
  });
  assert.equal(producerUnknown.judgement, "cannot_judge");
  assert.equal(producerUnknown.cannotJudgeReason, "canonical_producer_unknown");
  await assert.rejects(
    (app.saveCurrentSetObservation as unknown as (input: unknown) => Promise<unknown>)({
      userId: "u1", workoutId: "workout-observation", observation: { ...observation, counts: { confirmed: 99, needsReview: 0, rejected: 0 } }, idempotencyKey: "forged-observation",
    }),
    /prebuilt_canonical_observation_not_accepted/,
  );

  const restarted = new CoachApplication({
    ledger,
    runtime: { now: () => "2026-08-08T07:03:00.000+08:00", nextId: (prefix) => `restart-${prefix}` },
  });
  let workout = await restarted.readWorkoutSession({ userId: "u1", workoutId: "workout-observation" });
  assert.deepEqual(workout.setObservations, [observation]);
  const draft = await restarted.saveCurrentSetDraft({
    userId: "u1", workoutId: "workout-observation", draft: { actualReps: 7, actualLoad: { value: 18, unit: "kg" }, actualRir: 2 }, idempotencyKey: "observed-user-draft",
  });
  const outcome = await restarted.confirmCurrentSet({
    userId: "u1", workoutId: "workout-observation", draftId: draft.id, observationId: observation.id, idempotencyKey: "observed-user-confirm",
  });
  assert.equal(outcome.actualReps, 7);
  assert.deepEqual(outcome.observationRef, { id: observation.id });
  assert.deepEqual(outcome.performedRepsProvenance, { source: "user_confirmed", observedConfirmedReps: 1, userAdjusted: true });
  workout = await restarted.readWorkoutSession({ userId: "u1", workoutId: "workout-observation" });
  assert.deepEqual(workout.setObservations, [observation]);
  assert.equal(workout.setObservations?.[0]?.counts.confirmed, 1);
});

test("训练中的 Coach 会话与同一 WorkoutSession 绑定，并在记录/监控切换后复用", async () => {
  const { app } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId: "workout-coach",
    prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" },
    idempotencyKey: "coach-prepare",
  });
  await app.activateWorkoutSession({
    userId: "u1",
    workoutId: "workout-coach",
    mode: "record_only",
    idempotencyKey: "coach-start",
  });

  const first = await app.ensureWorkoutCoachSession({
    userId: "u1",
    workoutId: "workout-coach",
    idempotencyKey: "coach-open-first",
  });
  assert.equal(first.context.kind, "workout");
  assert.equal(first.context.ref, "workout-coach");
  assert.equal(first.taskKind, "workout_execution");
  assert.equal(first.status, "active");

  await app.setWorkoutMonitoringMode({
    userId: "u1",
    workoutId: "workout-coach",
    enabled: true,
    idempotencyKey: "coach-monitor-on",
  });
  await app.setWorkoutMonitoringMode({
    userId: "u1",
    workoutId: "workout-coach",
    enabled: false,
    idempotencyKey: "coach-monitor-off",
  });
  await app.pauseWorkoutSession({
    userId: "u1",
    workoutId: "workout-coach",
    idempotencyKey: "coach-pause",
  });
  await app.setSessionStatus(first.id, "suspended");

  const reopened = await app.ensureWorkoutCoachSession({
    userId: "u1",
    workoutId: "workout-coach",
    idempotencyKey: "coach-reopen-paused-workout",
  });
  assert.equal(reopened.id, first.id);
  assert.equal(reopened.context.ref, "workout-coach");
  assert.equal(reopened.status, "active");
  assert.equal(
    (await app.listCoachSessions({ userId: "u1", taskKind: "workout_execution" })).filter(
      (session) => session.context.ref === "workout-coach",
    ).length,
    1,
  );

  await app.completeWorkoutSession({
    userId: "u1",
    workoutId: "workout-coach",
    status: "partial",
    idempotencyKey: "coach-finish",
  });
  await assert.rejects(
    app.ensureWorkoutCoachSession({
      userId: "u1",
      workoutId: "workout-coach",
      idempotencyKey: "coach-open-completed",
    }),
    /workout_not_coachable/,
  );
});

test("休息计时在同一进程用单调时钟，重启后使用持久化墙钟 deadline", async () => {
  const { app, setMonotonic, setClockEpoch, setNow } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId: "workout-timer-restart",
    prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" },
    idempotencyKey: "prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-timer-restart", idempotencyKey: "start" });
  await app.startRestTimer({
    userId: "u1",
    workoutId: "workout-timer-restart",
    duration: { value: 90, unit: "seconds" },
    idempotencyKey: "rest",
  });

  // A new JS process has a new monotonic epoch; its small local counter must
  // not make the persisted deadline look almost untouched.
  setClockEpoch("process-2");
  setMonotonic(2);
  setNow("2026-08-08T07:01:00.000+08:00");
  assert.equal(await app.remainingWorkoutRest({ userId: "u1", workoutId: "workout-timer-restart" }), 30);
});

test("当前组冻结、安全暂停与过期恢复都不能被静默绕过", async () => {
  const { app, setNow } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({ userId: "u1", workoutId: "workout-2", prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" }, idempotencyKey: "prepare" });
  let workout = await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-2", idempotencyKey: "start" });
  await app.saveCurrentSetDraft({ userId: "u1", workoutId: "workout-2", idempotencyKey: "begin-current" });
  workout = (await app.readDomainProjection({ userId: "u1" })).workouts[0]!;
  await assert.rejects(
    app.reviseUpcomingWorkoutPlan({
      userId: "u1", workoutId: "workout-2", idempotencyKey: "rewrite-current", scope: "next_set", reason: "agent request",
      frozenPrescription: {
        ...workout.frozenPrescription,
        tasks: [{ ...workout.frozenPrescription.tasks[0]!, sets: [{ ...workout.frozenPrescription.tasks[0]!.sets[0]!, targetLoad: { value: 30, unit: "kg" } }, workout.frozenPrescription.tasks[0]!.sets[1]! ] }],
      },
    }),
    /current_or_completed_set_is_frozen/,
  );
  workout = await app.pauseWorkoutForSafety({ userId: "u1", workoutId: "workout-2", signal: "new_sharp_pain", idempotencyKey: "safety" });
  assert.equal(workout.state.pauseReason, "safety");
  await assert.rejects(app.resumeWorkoutSession({ userId: "u1", workoutId: "workout-2", idempotencyKey: "resume" }), /safety_confirmation_required/);
  const resumed = await app.resumeWorkoutSession({ userId: "u1", workoutId: "workout-2", idempotencyKey: "resume-confirmed", acknowledgeSafetyPause: true });
  assert.equal(resumed.status, "resumed");
  await app.pauseWorkoutSession({ userId: "u1", workoutId: "workout-2", idempotencyKey: "pause" });
  setNow("2026-08-10T12:00:00.000+08:00");
  const expired = await app.resumeWorkoutSession({ userId: "u1", workoutId: "workout-2", idempotencyKey: "expired" });
  assert.equal(expired.status, "partial_proposal");
});

test("训练中后续动作编辑使用 typed command，平替不复制重量且不能穿过已开始边界", async () => {
  const { app } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId: "workout-edit",
    prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" },
    idempotencyKey: "edit-prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-edit", idempotencyKey: "edit-start" });

  let workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-edit",
    change: {
      kind: "adjust_set",
      taskId: "press",
      setId: "set-1",
      patch: { targetLoad: { value: 22, unit: "kg" }, targetRir: 2 },
    },
    reason: "user_adjusted_next_set",
    idempotencyKey: "edit-next-set",
  });
  assert.equal(workout.frozenPrescription.tasks[0]?.sets[0]?.targetLoad?.value, 22);
  assert.equal(workout.frozenPrescription.tasks[0]?.sets[0]?.targetRir, 2);

  await app.confirmCurrentSet({
    userId: "u1",
    workoutId: "workout-edit",
    confirmAsPlanned: true,
    idempotencyKey: "edit-confirm-first",
  });
  workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-edit",
    change: {
      kind: "add_task",
      index: 1,
      task: {
        id: "accessory-a",
        exerciseVariantId: "push_up.bodyweight.floor.standard.bilateral.full_rom",
        mode: "bodyweight_reps",
        sets: [{ id: "accessory-a-1", targetReps: { min: 8, max: 12 }, targetRir: 4, rest: { value: 60, unit: "seconds" } }],
      },
    },
    reason: "user_added_unstarted_accessory",
    idempotencyKey: "edit-add-a",
  });
  workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-edit",
    change: {
      kind: "add_task",
      index: 2,
      task: {
        id: "accessory-b",
        exerciseVariantId: "squat.bodyweight.shoulder_width.standard.bilateral.full_rom",
        mode: "bodyweight_reps",
        sets: [{ id: "accessory-b-1", targetReps: { min: 8, max: 10 }, targetLoad: { value: 10, unit: "kg" }, targetRir: 4 }],
      },
    },
    reason: "user_added_unstarted_accessory",
    idempotencyKey: "edit-add-b",
  });
  assert.deepEqual(workout.frozenPrescription.tasks.map((task) => task.id), ["press", "accessory-a", "accessory-b"]);

  workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-edit",
    change: { kind: "reorder_task", taskId: "accessory-b", toIndex: 1 },
    reason: "user_reordered_unstarted_tasks",
    idempotencyKey: "edit-reorder",
  });
  assert.deepEqual(workout.frozenPrescription.tasks.map((task) => task.id), ["press", "accessory-b", "accessory-a"]);

  workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-edit",
    change: {
      kind: "replace_task_exercise",
      taskId: "accessory-b",
      replacementExerciseVariantId: "push_up.bodyweight.floor.standard.bilateral.full_rom",
    },
    reason: "user_selected_temporary_substitution",
    idempotencyKey: "edit-replace",
  });
  const replacement = workout.frozenPrescription.tasks.find((task) => task.id === "accessory-b");
  assert.equal(replacement?.exerciseVariantId, "push_up.bodyweight.floor.standard.bilateral.full_rom");
  assert.equal(replacement?.sets[0]?.targetLoad, undefined);

  workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-edit",
    change: {
      kind: "add_task",
      task: {
        id: "temporary-focus",
        exerciseVariantId: "push_up.bodyweight.floor.standard.bilateral.full_rom",
        mode: "bodyweight_reps",
        sets: [{ id: "temporary-focus-1", targetReps: { min: 5, max: 5 } }],
      },
    },
    reason: "test_removed_focused_task_cursor",
    idempotencyKey: "edit-add-temporary-focus",
  });
  workout = await app.focusWorkoutTask({
    userId: "u1",
    workoutId: "workout-edit",
    taskId: "temporary-focus",
    idempotencyKey: "edit-focus-temporary",
  });
  assert.equal(workout.state.currentSetId, "temporary-focus-1");
  workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-edit",
    change: { kind: "remove_task", taskId: "temporary-focus" },
    reason: "test_removed_focused_task_cursor",
    idempotencyKey: "edit-remove-temporary-focus",
  });
  assert.equal(workout.state.currentSetId, "set-2", "removed focused task falls back to the next unresolved set");

  workout = await app.focusWorkoutTask({
    userId: "u1",
    workoutId: "workout-edit",
    taskId: "accessory-a",
    idempotencyKey: "edit-focus-accessory-a",
  });
  assert.equal(workout.state.currentTaskId, "accessory-a");
  assert.equal(workout.state.currentSetId, "accessory-a-1");
  assert.equal(workout.setOutcomes[0]?.prescriptionSetId, "set-1");
  workout = await app.focusWorkoutTask({
    userId: "u1",
    workoutId: "workout-edit",
    taskId: "press",
    idempotencyKey: "edit-focus-press",
  });
  assert.equal(workout.state.currentSetId, "set-2");

  await assert.rejects(
    app.editUpcomingWorkoutPlan({
      userId: "u1",
      workoutId: "workout-edit",
      change: {
        kind: "replace_task_exercise",
        taskId: "accessory-a",
        replacementExerciseVariantId: "unknown.custom.exercise",
      },
      reason: "invalid_variant",
      idempotencyKey: "edit-unknown",
    }),
    /unknown_or_archived_workout_exercise_variant/,
  );

  const draft = await app.saveCurrentSetDraft({
    userId: "u1",
    workoutId: "workout-edit",
    idempotencyKey: "edit-begin-current",
  });
  assert.equal(draft.prescriptionSetId, "set-2");
  await assert.rejects(
    app.editUpcomingWorkoutPlan({
      userId: "u1",
      workoutId: "workout-edit",
      change: { kind: "remove_task", taskId: "press" },
      reason: "cannot_remove_current_task",
      idempotencyKey: "edit-remove-current",
    }),
    /workout_task_has_frozen_set/,
  );
  await assert.rejects(
    app.editUpcomingWorkoutPlan({
      userId: "u1",
      workoutId: "workout-edit",
      change: { kind: "adjust_set", taskId: "press", setId: "set-2", patch: { targetRir: 1 } },
      reason: "cannot_change_current_set",
      idempotencyKey: "edit-current-set",
    }),
    /current_or_completed_set_is_frozen/,
  );
});

test("部分完成动作原地替换时保留已确认组，并把剩余组插在原动作之后", async () => {
  const { app, ledger } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId: "workout-partial-replacement",
    prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" },
    idempotencyKey: "partial-replacement-prepare",
  });
  await app.activateWorkoutSession({
    userId: "u1",
    workoutId: "workout-partial-replacement",
    idempotencyKey: "partial-replacement-start",
  });
  const completed = await app.confirmCurrentSet({
    userId: "u1",
    workoutId: "workout-partial-replacement",
    confirmAsPlanned: true,
    idempotencyKey: "partial-replacement-confirm-first",
  });
  let workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-partial-replacement",
    change: {
      kind: "replace_remaining_task",
      taskId: "press",
      replacementTaskId: "press:replacement:1",
      replacementExerciseVariantId: "push_up.bodyweight.floor.standard.bilateral.full_rom",
    },
    reason: "equipment_unavailable_after_first_set",
    idempotencyKey: "partial-replacement-apply",
  });
  assert.deepEqual(workout.frozenPrescription.tasks.map((task) => task.id), ["press", "press:replacement:1"]);
  assert.deepEqual(workout.frozenPrescription.tasks[0]?.sets.map((set) => set.id), ["set-1"]);
  assert.equal(workout.frozenPrescription.tasks[1]?.sets[0]?.id, "set-2");
  assert.equal(workout.frozenPrescription.tasks[1]?.sets[0]?.targetLoad, undefined);
  assert.equal(workout.setOutcomes[0]?.id, completed.id);
  assert.equal(workout.setOutcomes[0]?.actualLoad?.value, 20);
  assert.equal(workout.state.currentSetId, "set-2");
  const replacementProfile = "push-up/front-left-45/v1";
  const replacementObservation = await app.saveCurrentSetObservation({
    userId: "u1",
    workoutId: "workout-partial-replacement",
    context: { workoutId: "workout-partial-replacement", setId: "set-2", exerciseVariantId: "push_up.bodyweight.floor.standard.bilateral.full_rom", capabilityIdentity: replacementProfile },
    packets: [canonicalWorkoutPacketFixture({ repId: 11n, disposition: "confirmed", profileIdentity: replacementProfile })],
    telemetry: { processedFrames: 1, validFrames: 1 },
    observedAt: "2026-08-08T07:30:00.000+08:00",
    idempotencyKey: "partial-replacement-observation",
  });
  assert.equal(replacementObservation.prescriptionSetId, "set-2");
  assert.equal(replacementObservation.exerciseVariantId, "push_up.bodyweight.floor.standard.bilateral.full_rom");
  const replacementOutcome = await app.confirmCurrentSet({
    userId: "u1",
    workoutId: "workout-partial-replacement",
    confirmAsPlanned: true,
    observationId: replacementObservation.id,
    idempotencyKey: "partial-replacement-confirm-replacement",
  });
  assert.equal(replacementOutcome.prescriptionSetId, "set-2");
  assert.equal(replacementOutcome.exerciseVariantId, "push_up.bodyweight.floor.standard.bilateral.full_rom");

  const afterRestart = new CoachApplication({
    ledger,
    runtime: { now: () => "2026-08-08T08:00:00.000+08:00", nextId: (prefix) => `restart-${prefix}` },
  });
  workout = await afterRestart.readWorkoutSession({ userId: "u1", workoutId: "workout-partial-replacement" });
  assert.deepEqual(workout.frozenPrescription.tasks.map((task) => task.id), ["press", "press:replacement:1"]);
  assert.equal(workout.setOutcomes[0]?.id, completed.id);
  assert.equal(workout.setOutcomes[1]?.id, replacementOutcome.id);
  assert.equal(workout.setObservations?.[0]?.id, replacementObservation.id);
});

test("已确认的吃力表现只在真实器材档位和同动作下一组形成确定性建议", async () => {
  const { app } = fixture();
  await bootstrapPlan(app, "bench_press.dumbbell.flat.standard.bilateral.full_rom");
  await app.executeDomainCommand({
    type: "equipment_profile.revise",
    equipmentProfileId: "gym",
    expectedRevision: 0,
    equipmentProfile: {
      id: "gym",
      name: "健身房",
      equipmentIds: ["dumbbell_pair"],
      equipment: [{ id: "dumbbell_pair", status: "available", discreteLoads: [
        { value: 18, unit: "kg" }, { value: 20, unit: "kg" }, { value: 22, unit: "kg" },
      ] }],
    },
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-08T07:02:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "progression-equipment" },
  });
  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId: "workout-progress",
    prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" },
    idempotencyKey: "progression-prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-progress", idempotencyKey: "progression-start" });
  await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-progress",
    change: { kind: "adjust_set", taskId: "press", setId: "set-2", patch: { targetLoad: { value: 22, unit: "kg" } } },
    reason: "user_configured_next_set",
    idempotencyKey: "progression-set-next-target",
  });
  const draft = await app.saveCurrentSetDraft({
    userId: "u1",
    workoutId: "workout-progress",
    idempotencyKey: "progression-draft",
    draft: { actualLoad: { value: 22, unit: "kg" }, actualReps: 6, actualRir: 0 },
  });
  const outcome = await app.confirmCurrentSet({
    userId: "u1",
    workoutId: "workout-progress",
    draftId: draft.id,
    idempotencyKey: "progression-confirm",
  });
  const recommendation = await app.recommendNextWorkoutSet({
    userId: "u1",
    workoutId: "workout-progress",
    sourceOutcomeId: outcome.id,
  });
  assert.equal(recommendation.status, "proposal");
  assert.equal(recommendation.decision.decision, "reduce_load");
  assert.deepEqual(recommendation.change, {
    kind: "adjust_set",
    taskId: "press",
    setId: "set-2",
    patch: { targetLoad: { value: 20, unit: "kg" } },
  });
  const replayedRecommendation = await app.recommendNextWorkoutSet({
    userId: "u1",
    workoutId: "workout-progress",
    sourceOutcomeId: outcome.id,
  });
  assert.deepEqual(replayedRecommendation.change, recommendation.change);
  assert.equal((await app.listActionLog("u1")).filter((event) => event.intent === "workout.next_set_rule_assessment").length, 1);
  await app.dismissNextWorkoutSetRecommendation({
    recommendation,
    disposition: "ignored",
    idempotencyKey: "progression-ignore-once",
  });
  assert.ok((await app.listActionLog("u1")).some((event) =>
    event.intent === "workout.next_set_recommendation.ignored"
    && event.after.disposition === "ignored"
    && event.after.prescriptionChanged === false
  ));
  const applied = await app.applyNextWorkoutSetRecommendation({
    recommendation,
    idempotencyKey: "progression-apply",
  });
  assert.equal(applied.frozenPrescription.tasks[0]?.sets[1]?.targetLoad?.value, 20);
  const actionLog = await app.listActionLog("u1");
  assert.ok(actionLog.some((event) => event.intent === "workout.revise_prescription" && event.targetId === "workout-progress"));

  await assert.rejects(
    app.applyNextWorkoutSetRecommendation({ recommendation, idempotencyKey: "progression-apply-stale" }),
    /stale_next_set_recommendation/,
  );
});

test("重复 partial WorkoutOutcome 才触发保守漏练重排；单次 partial 只复核当前训练", async () => {
  const { app, setNow } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({
    userId: "u1", workoutId: "miss-1", prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" }, idempotencyKey: "miss-prepare-1",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "miss-1", idempotencyKey: "miss-activate-1" });
  await app.completeWorkoutSession({ userId: "u1", workoutId: "miss-1", status: "partial", idempotencyKey: "miss-complete-1" });
  assert.equal((await app.readLatestReplanEvaluation("u1"))?.evaluation.trigger.kind, "session_completed");

  setNow("2026-08-10T07:00:00.000+08:00");
  await app.prepareWorkoutSession({
    userId: "u1", workoutId: "miss-2", prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" }, idempotencyKey: "miss-prepare-2",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "miss-2", idempotencyKey: "miss-activate-2" });
  await app.completeWorkoutSession({ userId: "u1", workoutId: "miss-2", status: "partial", idempotencyKey: "miss-complete-2" });
  const evaluation = await app.readLatestReplanEvaluation("u1");
  assert.equal(evaluation?.evaluation.trigger.kind, "repeated_missed_sessions");
  assert.equal(evaluation?.evaluation.trigger.causationId, "miss-2");
});

test("已提交的组和训练结果只通过追加更正链改变当前视图", async () => {
  const { app, ledger } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId: "workout-correction",
    prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" },
    idempotencyKey: "correction-prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-correction", idempotencyKey: "correction-start" });
  const first = await app.confirmCurrentSet({
    userId: "u1",
    workoutId: "workout-correction",
    confirmAsPlanned: true,
    idempotencyKey: "correction-confirm-1",
  });
  await app.confirmCurrentSet({
    userId: "u1",
    workoutId: "workout-correction",
    confirmAsPlanned: true,
    idempotencyKey: "correction-confirm-2",
  });
  await app.completeWorkoutSession({
    userId: "u1",
    workoutId: "workout-correction",
    idempotencyKey: "correction-complete",
  });

  await app.correctRecordedSet({
    userId: "u1",
    workoutId: "workout-correction",
    outcomeId: first.id,
    patch: { actualLoad: { value: 17.5, unit: "kg" }, actualReps: 7 },
    reason: "第一组实际重量和次数录错了",
    idempotencyKey: "correction-set",
  });
  let workout = (await app.readDomainProjection({ userId: "u1" })).workouts.find((item) => item.id === "workout-correction")!;
  assert.equal(workout.setOutcomes[0]?.id, first.id);
  assert.equal(workout.setOutcomes[0]?.actualLoad?.value, 17.5);
  assert.equal(workout.setOutcomes[0]?.actualReps, 7);
  assert.equal(workout.setOutcomes[0]?.source, "user_confirmed");
  assert.equal(workout.setOutcomes[0]?.packetRef, undefined);
  assert.equal(workout.setOutcomeCorrections?.length, 1);
  assert.equal(workout.setOutcomeCorrections?.[0]?.correctsOutcomeId, first.id);
  const recordedEvents = (await ledger.read()).domainEvents.filter((event) => event.aggregate.id === "workout-correction");
  const originalEvent = recordedEvents.find((event) => event.name === "workout.set_recorded");
  const correctionEvent = recordedEvents.find((event) => event.name === "workout.set_corrected");
  assert.equal(originalEvent?.name, "workout.set_recorded");
  assert.equal(originalEvent?.name === "workout.set_recorded" ? originalEvent.payload.outcome.actualLoad?.value : undefined, 20);
  assert.equal(correctionEvent?.name, "workout.set_corrected");
  assert.equal(correctionEvent?.name === "workout.set_corrected" ? correctionEvent.payload.correction.reason : undefined, "第一组实际重量和次数录错了");

  await app.correctWorkoutSessionOutcome({
    userId: "u1",
    workoutId: "workout-correction",
    patch: { subjectiveFeedback: "hard" },
    reason: "训练结束后的主观反馈漏填",
    idempotencyKey: "correction-session",
  });
  workout = (await app.readDomainProjection({ userId: "u1" })).workouts.find((item) => item.id === "workout-correction")!;
  assert.equal(workout.outcome?.subjectiveFeedback, "hard");
  assert.equal(workout.sessionOutcomeCorrections?.length, 1);
  assert.equal(workout.status, "completed");
  assert.equal(
    (await app.listActionLog("u1", { changesOnly: true })).filter((event) => event.action === "workout.corrected").length,
    2,
  );
  const afterRestart = new CoachApplication({
    ledger,
    runtime: { now: () => "2026-08-08T08:00:00.000+08:00", nextId: (prefix) => `restart-${prefix}` },
  });
  const replayed = (await afterRestart.readDomainProjection({ userId: "u1" })).workouts.find((item) => item.id === "workout-correction")!;
  assert.equal(replayed.setOutcomes[0]?.actualLoad?.value, 17.5);
  assert.equal(replayed.setOutcomeCorrections?.[0]?.reason, "第一组实际重量和次数录错了");
  assert.equal(replayed.outcome?.subjectiveFeedback, "hard");
  assert.equal(replayed.sessionOutcomeCorrections?.[0]?.reason, "训练结束后的主观反馈漏填");

  await assert.rejects(
    app.correctRecordedSet({
      userId: "u1",
      workoutId: "workout-correction",
      outcomeId: first.id,
      patch: { actualReps: 0 },
      reason: " ",
      idempotencyKey: "correction-no-reason",
    }),
    /correction_reason_required/,
  );
});

test("跳过一组是可回放的执行事实，不伪造完成训练量", async () => {
  const { app, ledger } = fixture();
  await bootstrapPlan(app);
  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId: "workout-skip",
    prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" },
    idempotencyKey: "skip-prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-skip", idempotencyKey: "skip-start" });
  await assert.rejects(
    app.skipCurrentSet({ userId: "u1", workoutId: "workout-skip", reason: "  ", idempotencyKey: "skip-no-reason" }),
    /skip_reason_required/,
  );

  const skipped = await app.skipCurrentSet({
    userId: "u1",
    workoutId: "workout-skip",
    reason: "器械暂时被占用，今天不替换动作",
    idempotencyKey: "skip-first-set",
  });
  let workout = (await app.readDomainProjection({ userId: "u1" })).workouts.find((item) => item.id === "workout-skip")!;
  assert.equal(skipped.prescriptionSetId, "set-1");
  assert.equal(workout.setOutcomes.length, 0);
  assert.equal(workout.skippedSets?.[0]?.prescriptionSetId, "set-1");
  assert.equal(workout.state.currentSetId, "set-2");
  await assert.rejects(
    app.reviseUpcomingWorkoutPlan({
      userId: "u1",
      workoutId: "workout-skip",
      frozenPrescription: {
        ...workout.frozenPrescription,
        tasks: [{ ...workout.frozenPrescription.tasks[0]!, sets: [workout.frozenPrescription.tasks[0]!.sets[1]!] }],
      },
      scope: "future_sets",
      reason: "attempt_to_delete_skipped_history",
      idempotencyKey: "skip-rewrite-history",
    }),
    /current_or_completed_set_is_frozen/,
  );
  const skipEvent = (await ledger.read()).domainEvents.find((event) => event.aggregate.id === "workout-skip" && event.name === "workout.set_skipped");
  assert.equal(skipEvent?.name, "workout.set_skipped");
  assert.equal(skipEvent?.name === "workout.set_skipped" ? skipEvent.payload.skipped.reason : undefined, "器械暂时被占用，今天不替换动作");
  const skipAction = (await app.listActionLog("u1")).find((event) => event.intent === "workout.skip_set");
  assert.equal(skipAction?.action, "workout.set_skipped");
  assert.equal(skipAction?.reversible, false);

  await app.confirmCurrentSet({
    userId: "u1",
    workoutId: "workout-skip",
    confirmAsPlanned: true,
    idempotencyKey: "skip-confirm-second",
  });
  const outcome = await app.completeWorkoutSession({ userId: "u1", workoutId: "workout-skip", idempotencyKey: "skip-complete" });
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.completedWorkSets, 1);
  assert.deepEqual(outcome.incompletePrescriptionSetIds, []);
  assert.deepEqual(outcome.skippedPrescriptionSetIds, ["set-1"]);
  assert.equal(outcome.dataCompleteness, "partial");

  const afterRestart = new CoachApplication({
    ledger,
    runtime: { now: () => "2026-08-08T08:00:00.000+08:00", nextId: (prefix) => `restart-${prefix}` },
  });
  workout = (await afterRestart.readDomainProjection({ userId: "u1" })).workouts.find((item) => item.id === "workout-skip")!;
  assert.equal(workout.skippedSets?.[0]?.prescriptionSetId, "set-1");
  assert.equal(workout.setOutcomes.length, 1);
  assert.deepEqual(workout.outcome?.skippedPrescriptionSetIds, ["set-1"]);
});
