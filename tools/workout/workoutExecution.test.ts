import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let now = "2026-08-08T07:00:00.000+08:00";
  let sequence = 0;
  let monotonic = 10_000;
  let clockEpoch = "process-1";
  const scheduled: string[] = [];
  const cancelled: string[] = [];
  const ledger = new InMemoryCoachLedger();
  const app = new LocalProductKernel({
    ledger,
    runtime: { now: () => now, nextId: (prefix) => `${prefix}-${++sequence}` },
    monotonicClock: { nowMs: () => monotonic, epochId: () => clockEpoch },
    notifications: {
      async upsert(input) { scheduled.push(input.id); },
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

async function bootstrapPlan(app: LocalProductKernel, exerciseVariantId = "dumbbell_bench_press.flat.standard") {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-08T07:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap",
    },
    profile: { id: "profile", locale: "zh-CN" },
    goalContract: { id: "goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "mandate", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const pins = app.getInstalledKnowledgeVersionPins();
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-08T07:01:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "plan",
    },
    planId: "plan", expectedRevision: 0,
    revision: {
      id: "plan", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, effectiveFrom: "2026-08-08", knowledgePins: pins,
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
  workout = await app.editUpcomingWorkoutPlan({
    userId: "u1",
    workoutId: "workout-edit",
    change: {
      kind: "add_task",
      index: 3,
      task: {
        id: "temporary-focus",
        exerciseVariantId: "push_up.bodyweight.floor.standard.bilateral.full_rom",
        mode: "bodyweight_reps",
        sets: [{ id: "temporary-focus-1", targetReps: { min: 5, max: 5 } }],
      },
    },
    reason: "user_undid_removed_unstarted_task",
    idempotencyKey: "edit-undo-remove-temporary-focus",
  });
  assert.equal(workout.frozenPrescription.tasks[3]?.id, "temporary-focus");
  assert.equal(workout.state.currentSetId, "set-2", "undo restores the route without stealing current focus");

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
  const replacementDraft = await app.saveCurrentSetDraft({
    userId: "u1",
    workoutId: "workout-partial-replacement",
    draft: { actualReps: 8, actualRir: 2 },
    idempotencyKey: "partial-replacement-draft",
  });
  const replacementOutcome = await app.confirmCurrentSet({
    userId: "u1",
    workoutId: "workout-partial-replacement",
    draftId: replacementDraft.id,
    idempotencyKey: "partial-replacement-confirm-replacement",
  });
  assert.equal(replacementOutcome.prescriptionSetId, "set-2");
  assert.equal(replacementOutcome.exerciseVariantId, "push_up.bodyweight.floor.standard.bilateral.full_rom");

  const afterRestart = new LocalProductKernel({
    ledger,
    runtime: { now: () => "2026-08-08T08:00:00.000+08:00", nextId: (prefix) => `restart-${prefix}` },
  });
  workout = await afterRestart.readWorkoutSession({ userId: "u1", workoutId: "workout-partial-replacement" });
  assert.deepEqual(workout.frozenPrescription.tasks.map((task) => task.id), ["press", "press:replacement:1"]);
  assert.equal(workout.setOutcomes[0]?.id, completed.id);
  assert.equal(workout.setOutcomes[1]?.id, replacementOutcome.id);
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
  const afterRestart = new LocalProductKernel({
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

  const afterRestart = new LocalProductKernel({
    ledger,
    runtime: { now: () => "2026-08-08T08:00:00.000+08:00", nextId: (prefix) => `restart-${prefix}` },
  });
  workout = (await afterRestart.readDomainProjection({ userId: "u1" })).workouts.find((item) => item.id === "workout-skip")!;
  assert.equal(workout.skippedSets?.[0]?.prescriptionSetId, "set-1");
  assert.equal(workout.setOutcomes.length, 1);
  assert.deepEqual(workout.outcome?.skippedPrescriptionSetIds, ["set-1"]);
});
