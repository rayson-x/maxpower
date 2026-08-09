import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { coachDrawerAvailableForRoute } from "../../src/product";

function fixture() {
  let sequence = 0;
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-08T08:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  return app;
}

async function bootstrapAndPlan(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1",
      actor: { kind: "user", id: "u1" },
      deviceId: "phone-1",
      occurredAt: "2026-08-08T08:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: {
      id: "profile-1",
      trainingExperience: "beginner",
      locale: "zh-CN",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{
        id: "home-1",
        kind: "home",
        environment: { space: "medium", noise: "quiet" },
        availableEquipment: ["bodyweight", "floor_space"],
      }],
    },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08", endDate: "2026-10-30" },
      status: "active",
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  const decision = await app.materializeGoalCycle({
    userId: "u1",
    currentDate: "2026-08-08",
    trigger: "initial_plan",
    idempotencyKey: "initial-plan",
  });
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") throw new Error("fixture requires a plan");
}

test("CoachApplication 只用 canonical facts 投影 Today、Calendar、Plan、Progress 和 Profile", async () => {
  const app = fixture();
  await bootstrapAndPlan(app);
  const domain = await app.readDomainProjection({ userId: "u1" });
  const workoutDate = domain.plan?.value.sessions.find(
    (session) => session.kind === "weighted_reps" || session.kind === "bodyweight_reps",
  )?.scheduledFor;
  assert.ok(workoutDate);
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "walk-1",
    fact: {
      kind: "activity",
      activityType: "步行",
      duration: { value: 25, unit: "minutes" },
      intensity: "easy",
      confidence: "confirmed",
    },
    envelope: {
      time: { startedAt: `${workoutDate}T18:00:00.000+08:00`, timezoneOffsetMinutes: 480 },
      provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "private",
      causalRefs: [],
      evidenceRefs: [],
      layer: "raw_observation",
    },
  });

  const screen = await app.readProductProjection({
    userId: "u1",
    date: workoutDate,
    timezoneOffsetMinutes: 480,
    calendarMode: "week",
    calendarAnchorDate: workoutDate,
  });

  assert.equal(screen.source.planRevision, 1);
  assert.equal(screen.today.state, "workout");
  assert.equal(screen.today.action, "start_workout");
  assert.ok(screen.today.session);
  assert.equal(screen.today.activityLog.entries[0]?.fact.kind, "activity");
  assert.equal(screen.calendar.dates.length, 7);
  assert.equal(screen.calendar.selected.activityLog.entries.length, 1);
  assert.ok(screen.plan.currentWeek.length > 0);
  assert.equal(screen.plan.strategySelection?.primary, "conservative_gain");
  assert.deepEqual(screen.plan.forecasts.map((forecast) => forecast.scenario), ["strict_aggressive", "balanced", "flexible"]);
  assert.equal(screen.plan.explanation?.researchEvidence[0]?.citationId, "maxpower.exercise-wiki.v1");
  assert.equal(screen.profile.onboardingComplete, true);
  assert.equal(screen.profile.primaryGoal, "hypertrophy");
  assert.ok(screen.profile.actionLog.total > 0);
  assert.ok(screen.profile.actionLog.recent.length > 0);
  assert.equal(screen.progress.completedWorkoutCount, 0);

  const cycle = domain.goalCycles.at(-1)?.value.phasePath?.[0];
  assert.ok(cycle);
  if (!cycle) throw new Error("fixture requires a mesocycle");
  await app.createMesocycleReview({ userId: "u1", mesocycleId: cycle.id, idempotencyKey: "product-mesocycle-review" });
  const withReview = await app.readProductProjection({
    userId: "u1", date: workoutDate, timezoneOffsetMinutes: 480, calendarMode: "week", calendarAnchorDate: workoutDate,
  });
  assert.equal(withReview.progress.reportArtifacts.some((artifact) => artifact.kind === "mesocycle_review"), true);

  const prescription = screen.today.session!;
  const workoutId = "product-workout";
  await app.prepareWorkoutSession({
    userId: "u1",
    workoutId,
    prescriptionRef: {
      planId: screen.source.planId!,
      planRevision: screen.source.planRevision!,
      sessionPrescriptionId: prescription.id,
    },
    idempotencyKey: "product-workout-prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId, idempotencyKey: "product-workout-start" });
  for (let index = 0; index < prescription.totalSetCount; index += 1) {
    await app.confirmCurrentSet({
      userId: "u1",
      workoutId,
      confirmAsPlanned: true,
      idempotencyKey: `product-workout-set-${index}`,
    });
  }
  const completedOutcome = await app.completeWorkoutSession({
    userId: "u1",
    workoutId,
    idempotencyKey: "product-workout-complete",
  });
  const replayedOutcome = await app.completeWorkoutSession({
    userId: "u1",
    workoutId,
    idempotencyKey: "product-workout-complete",
  });
  assert.deepEqual(replayedOutcome, completedOutcome);
  assert.equal(
    (await app.readDomainProjection({ userId: "u1" })).workouts.find((workout) => workout.id === workoutId)?.outcome?.completedAt,
    completedOutcome.completedAt,
  );
  const replanEvaluation = await app.readLatestReplanEvaluation("u1");
  assert.equal(replanEvaluation?.evaluation.trigger.kind, "session_completed");
  assert.equal(replanEvaluation?.evaluation.trigger.causationId, workoutId);
  const completed = await app.readProductProjection({
    userId: "u1",
    date: workoutDate,
    timezoneOffsetMinutes: 480,
    calendarMode: "week",
    calendarAnchorDate: workoutDate,
  });
  assert.equal(completed.today.state, "completed");
  assert.equal(completed.calendar.selected.completedWorkout?.status, "completed");
  // The shared shell needs an outcome summary that remains distinct from the
  // scheduled prescription. It is reconstructed from the completed
  // WorkoutSession, not a view-local "done" flag.
  assert.equal(completed.today.completedWorkout?.id, workoutId);
  assert.equal(completed.today.completedWorkout?.completedAt, completedOutcome.completedAt);
  assert.equal(completed.today.completedWorkout?.completedWorkSets, completedOutcome.completedWorkSets);
  assert.equal(completed.today.completedWorkout?.incompleteSetCount, completedOutcome.incompletePrescriptionSetIds.length);
  // The selected scheduled date has the prescription and its linked outcome,
  // while Calendar's factual marks remain on the actual occurrence date.
  assert.equal(completed.calendar.selected.performedWorkouts.length, 0);
  const performedDay = await app.readProductProjection({
    userId: "u1",
    date: "2026-08-08",
    timezoneOffsetMinutes: 480,
    calendarMode: "week",
    calendarAnchorDate: "2026-08-08",
  });
  // Scheduled and performed dates remain distinct: a later prescribed session
  // does not rewrite the actual completion date held by the Timeline fact.
  assert.equal(performedDay.today.activityLog.entries.some((entry) => entry.fact.kind === "training"), true);
  assert.equal(performedDay.calendar.selected.performedWorkouts[0]?.id, workoutId);
  assert.equal(performedDay.calendar.selected.performedWorkouts[0]?.title, prescription.title);
  assert.equal(performedDay.calendar.selected.performedWorkouts[0]?.scheduledFor, prescription.scheduledFor);
  assert.equal(performedDay.calendar.selected.performedWorkouts[0]?.completedAt, completedOutcome.completedAt);
});

test("没有已确认档案时 Today 明确进入建档，而不是捏造训练任务", async () => {
  const app = fixture();
  const screen = await app.readProductProjection({
    userId: "new-user",
    date: "2026-08-08",
    timezoneOffsetMinutes: 480,
    calendarMode: "month",
    calendarAnchorDate: "2026-08-08",
  });

  assert.equal(screen.today.state, "onboarding_required");
  assert.equal(screen.today.action, "open_onboarding");
  assert.equal(screen.today.session, undefined);
  assert.equal(screen.calendar.dates.length, 31);
});

test("个人资料与建档不保留全局 Coach 气泡，任务页面仍可进入 task-scoped Coach", () => {
  assert.equal(coachDrawerAvailableForRoute("profile"), false);
  assert.equal(coachDrawerAvailableForRoute("onboarding"), false);
  assert.equal(coachDrawerAvailableForRoute("today"), true);
  assert.equal(coachDrawerAvailableForRoute("calendar"), true);
  assert.equal(coachDrawerAvailableForRoute("plan"), true);
  assert.equal(coachDrawerAvailableForRoute("progress"), true);
  assert.equal(coachDrawerAvailableForRoute("workout"), true);
});
