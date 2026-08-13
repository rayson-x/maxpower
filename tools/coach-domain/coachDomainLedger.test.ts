import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

test("CoachApplication 从版本化事件重放 Profile、Timeline、Plan 与 Workout，并保留更正链", async () => {
  let now = "2026-08-08T00:10:00.000+08:00";
  let sequence = 0;
  const runtime = {
    now: () => now,
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  const ledger = new InMemoryCoachLedger();
  let app = new CoachApplication(ledger, runtime);
  const knowledgePins = app.getInstalledKnowledgeVersionPins();

  const bootstrap = await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "iphone-1",
      occurredAt: "2026-08-08T00:05:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap-user-1",
    },
    profile: {
      id: "profile-1",
      trainingExperience: "intermediate",
      locale: "zh-CN",
    },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08", endDate: "2026-12-08" },
    },
    mandate: {
      id: "mandate-1",
      mode: "collaborative",
    },
  });
  assert.deepEqual(bootstrap.aggregateRevisions, [
    { kind: "user_profile", id: "profile-1", revision: 1 },
    { kind: "goal_contract", id: "goal-1", revision: 1 },
    { kind: "coaching_mandate", id: "mandate-1", revision: 1 },
  ]);

  now = "2026-08-08T07:01:00.000+08:00";
  const bodyFact = await app.executeDomainCommand({
    type: "timeline.append",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "iphone-1",
      occurredAt: "2026-08-08T07:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "body-weight-2026-08-08",
    },
    timelineId: "timeline-user-1",
    expectedRevision: 0,
    fact: {
      kind: "body",
      measurement: {
        metric: "body_weight",
        quantity: { value: 80.2, unit: "kg" },
        condition: "after_waking_before_food",
      },
      confidence: "confirmed",
    },
  });

  now = "2026-08-08T07:05:00.000+08:00";
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "iphone-1",
      occurredAt: "2026-08-08T07:05:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "plan-revision-1",
    },
    planId: "plan-1",
    expectedRevision: 0,
    revision: {
      id: "plan-revision-1",
      goalContractRef: { kind: "goal_contract", id: "goal-1", revision: 1 },
      effectiveFrom: "2026-08-08",
      knowledgePins,
      sessions: [
        {
          id: "prescription-1",
          title: "上肢推",
          scheduledFor: "2026-08-08",
          knowledgePins,
          tasks: [
            {
              id: "bench-task",
              exerciseVariantId: "barbell_bench_press.flat.standard",
              sets: [
                {
                  id: "bench-set-1",
                  targetReps: { min: 6, max: 8 },
                  targetLoad: { value: 60, unit: "kg" },
                  targetRir: 2,
                },
              ],
            },
          ],
        },
      ],
    },
  });

  now = "2026-08-08T08:00:00.000+08:00";
  await app.executeDomainCommand({
    type: "workout.start",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "iphone-1",
      occurredAt: "2026-08-08T08:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "start-workout-1",
    },
    workoutId: "workout-1",
    expectedRevision: 0,
    prescriptionRef: {
      planId: "plan-1",
      planRevision: 1,
      sessionPrescriptionId: "prescription-1",
    },
  });

  now = "2026-08-08T08:12:00.000+08:00";
  await app.executeDomainCommand({
    type: "workout.record_set",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "iphone-1",
      occurredAt: "2026-08-08T08:12:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "record-workout-1-set-1",
    },
    workoutId: "workout-1",
    expectedRevision: 1,
    outcome: {
      id: "set-outcome-1",
      prescriptionSetId: "bench-set-1",
      exerciseVariantId: "barbell_bench_press.flat.standard",
      actualLoad: { value: 60, unit: "kg" },
      actualReps: 8,
      actualRir: 2,
      source: "user_confirmed",
    },
  });

  now = "2026-08-08T09:00:00.000+08:00";
  await app.executeDomainCommand({
    type: "timeline.correct",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "iphone-1",
      occurredAt: "2026-08-08T09:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "correct-body-weight-2026-08-08",
    },
    timelineId: "timeline-user-1",
    expectedRevision: 1,
    correctsEventId: bodyFact.eventIds[0]!,
    fact: {
      kind: "body",
      measurement: {
        metric: "body_weight",
        quantity: { value: 79.8, unit: "kg" },
        condition: "after_waking_before_food",
      },
      confidence: "confirmed",
    },
  });

  const beforeRestart = await app.readDomainProjection({
    userId: "user-1",
    date: "2026-08-08",
  });
  app = new CoachApplication(ledger, runtime);
  const afterRestart = await app.readDomainProjection({
    userId: "user-1",
    date: "2026-08-08",
  });

  assert.deepEqual(afterRestart, beforeRestart);
  assert.equal(afterRestart.profile?.revision, 1);
  assert.equal(afterRestart.goalContract?.revision, 1);
  assert.equal(afterRestart.mandate?.revision, 1);
  assert.equal(afterRestart.plan?.revision, 1);
  assert.equal(afterRestart.workouts[0]?.revision, 2);
  assert.equal(afterRestart.workouts[0]?.setOutcomes[0]?.actualLoad?.value, 60);
  assert.equal(afterRestart.timeline.revision, 2);
  assert.equal(afterRestart.timeline.events.length, 2);
  assert.equal(afterRestart.timeline.current[0]?.fact.kind, "body");
  assert.deepEqual(afterRestart.timeline.current[0]?.fact, {
    kind: "body",
    measurement: {
      metric: "body_weight",
      quantity: { value: 79.8, unit: "kg" },
      condition: "after_waking_before_food",
    },
    confidence: "confirmed",
  });
  assert.equal(afterRestart.timeline.current[0]?.correctsEventId, bodyFact.eventIds[0]);
});
