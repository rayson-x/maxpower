import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import {
  InMemoryPersonalKnowledgeStore,
  PersonalKnowledgeLayer,
} from "../../src/knowledge/personalLayer";

function fixture(options: { withPersonalLayer?: boolean } = {}) {
  let now = "2026-08-08T07:00:00.000+08:00";
  let sequence = 0;
  let monotonic = 10_000;
  const ledger = new InMemoryCoachLedger();
  const personalStore = new InMemoryPersonalKnowledgeStore();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => now, nextId: (prefix) => `${prefix}-${++sequence}` },
    monotonicClock: { nowMs: () => monotonic, epochId: () => "process-1" },
    notifications: { async schedule() {}, async cancel() {} },
    ...(options.withPersonalLayer
      ? {
          personalKnowledge: new PersonalKnowledgeLayer(personalStore, {
            now: () => now,
            nextId: (prefix: string) => `pk-${++sequence}`,
          }),
        }
      : {}),
  });
  return {
    app,
    personalStore,
    setMonotonic(value: number) { monotonic = value; },
    advanceMonotonic(ms: number) { monotonic += ms; },
  };
}

async function bootstrapPlan(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-08T07:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "mandate", mode: "collaborative" },
  });
  const pins = app.getInstalledKnowledgeVersionPins();
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-08T07:01:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "plan" },
    planId: "plan", expectedRevision: 0,
    revision: {
      id: "plan-r1", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, effectiveFrom: "2026-08-08", knowledgePins: pins,
      sessions: [{
        id: "push", title: "Push", scheduledFor: "2026-08-08", knowledgePins: pins,
        tasks: [{
          id: "press", exerciseVariantId: "dumbbell_bench_press.flat.standard",
          sets: [
            { id: "set-1", targetReps: { min: 8, max: 8 }, targetLoad: { value: 20, unit: "kg" }, targetRir: 3, rest: { value: 90, unit: "seconds" } },
            { id: "set-2", targetReps: { min: 8, max: 8 }, targetLoad: { value: 20, unit: "kg" }, targetRir: 3, rest: { value: 90, unit: "seconds" } },
            { id: "set-3", targetReps: { min: 8, max: 8 }, targetLoad: { value: 20, unit: "kg" }, targetRir: 3, rest: { value: 90, unit: "seconds" } },
          ],
        }],
      }],
    },
  });
}

async function startWorkout(app: CoachApplication) {
  await app.prepareWorkoutSession({
    userId: "u1", workoutId: "workout-1",
    prescriptionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "push" },
    idempotencyKey: "prepare",
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "workout-1", idempotencyKey: "activate" });
}

test("休息计时器实测：过短标记 too_short，过长标记 too_long，区间内 within", async () => {
  const { app, advanceMonotonic } = fixture();
  await bootstrapPlan(app);
  await startWorkout(app);

  await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s1" });
  await app.startRestTimer({ userId: "u1", workoutId: "workout-1", duration: { value: 90, unit: "seconds" }, idempotencyKey: "rest-1" });
  advanceMonotonic(30_000); // 30s < 90s×0.5 → 过短
  const short = await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s2" });
  assert.equal(short.measuredRestSeconds, 30);
  assert.equal(short.restDeviation, "too_short");

  await app.startRestTimer({ userId: "u1", workoutId: "workout-1", duration: { value: 90, unit: "seconds" }, idempotencyKey: "rest-2" });
  advanceMonotonic(150_000); // 150s > 90s×1.5 → 过长
  const long = await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s3" });
  assert.equal(long.measuredRestSeconds, 150);
  assert.equal(long.restDeviation, "too_long");
});

test("无休息计时器时不测、不编造", async () => {
  const { app } = fixture();
  await bootstrapPlan(app);
  await startWorkout(app);
  const outcome = await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s1" });
  assert.equal(outcome.measuredRestSeconds, undefined);
  assert.equal(outcome.restDeviation, undefined);
});

test("完成训练后实测休息沉淀为个人节奏校准，后续计划引用", async () => {
  const { app, personalStore, advanceMonotonic } = fixture({ withPersonalLayer: true });
  await bootstrapPlan(app);
  await startWorkout(app);

  await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s1" });
  await app.startRestTimer({ userId: "u1", workoutId: "workout-1", duration: { value: 90, unit: "seconds" }, idempotencyKey: "rest-1" });
  advanceMonotonic(120_000);
  await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s2" });
  await app.startRestTimer({ userId: "u1", workoutId: "workout-1", duration: { value: 90, unit: "seconds" }, idempotencyKey: "rest-2" });
  advanceMonotonic(150_000);
  await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s3" });
  await app.completeWorkoutSession({ userId: "u1", workoutId: "workout-1", idempotencyKey: "complete" });

  const entries = await personalStore.list("u1");
  const tempo = entries.find((entry) => entry.key === "rest_tempo_seconds");
  assert.ok(tempo, "应写入个人节奏校准");
  assert.equal(tempo?.kind, "observed_calibration");
  assert.equal(tempo?.value?.medianRestSeconds, 135); // median(120, 150)
});

test("休息过短确认后产生下一组建议 artifact（主动提案，不直接改训练）", async () => {
  const { app, advanceMonotonic } = fixture();
  await bootstrapPlan(app);
  await startWorkout(app);
  await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s1" });
  await app.startRestTimer({ userId: "u1", workoutId: "workout-1", duration: { value: 90, unit: "seconds" }, idempotencyKey: "rest-1" });
  advanceMonotonic(30_000);
  await app.confirmCurrentSet({ userId: "u1", workoutId: "workout-1", confirmAsPlanned: true, idempotencyKey: "s2" });

  const snapshot = await app.readDomainProjection({ userId: "u1" });
  void snapshot;
  const artifacts = (await (app as unknown as { ledger: { read(): Promise<{ artifacts: readonly import("../../src/coach/model").Artifact[] }> } }).ledger.read()).artifacts;
  const proposal = artifacts.find((item) => item.kind === "evidence_brief" && item.title === "下一组建议");
  assert.ok(proposal, "休息过短应产生下一组建议 artifact");
  assert.ok(proposal?.capabilityBoundary.some((line) => line.includes("确认后才应用")));
});
