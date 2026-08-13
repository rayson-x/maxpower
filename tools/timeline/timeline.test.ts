import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { healthConnectAggregationMode } from "../../src/timeline";

function createApp() {
  let sequence = 0;
  let now = "2026-08-08T00:00:00.000+08:00";
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => now,
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  return {
    app,
    setNow(value: string) { now = value; },
  };
}

async function bootstrap(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1",
      actor: { kind: "user", id: "u1" },
      deviceId: "phone-1",
      occurredAt: "2026-08-08T00:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08", endDate: "2026-12-08" },
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
}

function manualEnvelope(input: {
  at: string;
  origin?: "manual" | "healthkit" | "smart_scale" | "wearable" | "llm_estimate";
  sourceRecordId?: string;
  deviceId?: string;
  lastModifiedAt?: string;
  endedAt?: string;
  media?: boolean;
}) {
  return {
    time: {
      startedAt: input.at,
      ...(input.endedAt ? { endedAt: input.endedAt } : {}),
      timezoneOffsetMinutes: 480,
      ...(input.endedAt ? { endedTimezoneOffsetMinutes: 480 } : {}),
    },
    provenance: {
      origin: input.origin ?? "manual",
      ...(input.sourceRecordId ? { sourceRecordId: input.sourceRecordId } : {}),
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      recordingMethod: input.origin === "healthkit" ? "platform_import" as const : input.origin === "llm_estimate" ? "llm_estimate" as const : "manual_entry" as const,
      ...(input.lastModifiedAt ? { lastModifiedAt: input.lastModifiedAt } : {}),
      dataStatus: "available" as const,
      confidence: input.origin === "llm_estimate" ? "estimated" as const : "confirmed" as const,
    },
    privacyClass: "sensitive" as const,
    causalRefs: [],
    evidenceRefs: input.media
      ? [{ kind: "media" as const, id: "local-video-1", version: 1, hash: "media-hash", mediaType: "video" as const }]
      : [],
    layer: "raw_observation" as const,
  };
}

test("Timeline 保留来源与修订链，外部更新/更正不覆盖原始事实", async () => {
  const { app, setNow } = createApp();
  await bootstrap(app);
  assert.deepEqual(await app.readActivityLog({ userId: "u1", date: "2026-08-08", timezoneOffsetMinutes: 480 }), {
    date: "2026-08-08",
    timezoneOffsetMinutes: 480,
    entries: [],
  });

  setNow("2026-08-08T07:01:00.000+08:00");
  const first = await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "scale-1",
    fact: {
      kind: "body",
      measurement: { metric: "body_weight", quantity: { value: 80.2, unit: "kg" }, condition: "after_waking" },
      confidence: "confirmed",
    },
    envelope: manualEnvelope({
      at: "2026-08-08T07:00:00.000+08:00",
      origin: "healthkit",
      sourceRecordId: "weight-1",
      deviceId: "scale-a",
      lastModifiedAt: "2026-08-08T07:00:30.000+08:00",
      media: true,
    }),
  });
  setNow("2026-08-08T07:03:00.000+08:00");
  const mutation = await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "scale-1-update",
    fact: {
      kind: "body",
      measurement: { metric: "body_weight", quantity: { value: 79.8, unit: "kg" }, condition: "after_waking" },
      confidence: "confirmed",
    },
    envelope: manualEnvelope({
      at: "2026-08-08T07:00:00.000+08:00",
      origin: "healthkit",
      sourceRecordId: "weight-1",
      deviceId: "scale-a",
      lastModifiedAt: "2026-08-08T07:02:30.000+08:00",
      media: true,
    }),
  });
  assert.equal(first.status, "committed");
  assert.equal(mutation.status, "committed");
  const afterMutation = await app.readDomainProjection({ userId: "u1" });
  assert.equal(afterMutation.timeline.events.length, 2);
  assert.equal(afterMutation.timeline.current.length, 1);
  assert.equal(afterMutation.timeline.current[0]?.fact.kind, "body");
  assert.equal((afterMutation.timeline.current[0]?.fact as Extract<typeof afterMutation.timeline.current[number]["fact"], { kind: "body" }>).measurement.quantity.value, 79.8);
  assert.equal(afterMutation.timeline.events[0]?.lifecycle, "superseded");

  const corrected = await app.correctTimelineFact({
    userId: "u1",
    idempotencyKey: "weight-correct",
    correction: {
      correctsEventId: mutation.eventIds[0]!,
      reason: "同步记录使用了错误单位",
      actor: { kind: "user", id: "u1" },
      recordedAt: "2026-08-08T07:04:00.000+08:00",
    },
    fact: {
      kind: "body",
      measurement: { metric: "body_weight", quantity: { value: 80, unit: "kg" }, condition: "after_waking" },
      confidence: "confirmed",
    },
    envelope: manualEnvelope({ at: "2026-08-08T07:00:00.000+08:00" }),
  });
  assert.equal(corrected.status, "committed");
  const projection = await app.readDomainProjection({ userId: "u1" });
  assert.equal(projection.timeline.events.length, 3);
  assert.equal(projection.timeline.current.length, 1);
  assert.equal(projection.timeline.current[0]?.correctsEventId, mutation.eventIds[0]);
  assert.equal(projection.timeline.events[1]?.lifecycle, "superseded");

  const sync = await app.createTimelineSyncPayload("u1");
  assert.equal(sync.events[0]?.envelope?.evidenceRefs.length, 0);
  assert.deepEqual(sync.events[0]?.envelope?.localMediaAssetIds, ["local-video-1"]);

  await app.tombstoneTimelineSource({
    userId: "u1",
    idempotencyKey: "source-delete",
    mutation: {
      sourceEventId: corrected.eventIds[0]!,
      reason: "source_deleted",
      actor: { kind: "sync", id: "healthkit-import" },
      recordedAt: "2026-08-08T08:00:00.000+08:00",
    },
  });
  const archive = await app.exportTimeline("u1");
  assert.equal(archive.tombstones.length, 1);
  const imported = createApp();
  await bootstrap(imported.app);
  const replay = await imported.app.importTimeline({ userId: "u1", archive, idempotencyKey: "restore" });
  assert.equal(replay.importedEventIds.length, 4);
  const repeated = await imported.app.importTimeline({ userId: "u1", archive, idempotencyKey: "restore-again" });
  assert.equal(repeated.importedEventIds.length, 0);
  assert.equal(repeated.skippedEventIds.length, 4);
  const replayProjection = await imported.app.readDomainProjection({ userId: "u1" });
  assert.equal(replayProjection.timeline.events.length, 3);
  assert.equal(replayProjection.timeline.tombstones.length, 1);
  assert.equal(replayProjection.timeline.current.length, 0);
});

test("动作库选择只保存概念，不伪造为可比较的力量历史", async () => {
  const { app } = createApp();
  await bootstrap(app);
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "daily-log-bench",
    fact: {
      kind: "training",
      reportedSession: {
        summary: "自主训练",
        exercises: [{
          name: "卧推",
          exerciseConceptId: "concept.bench_press",
          sets: [{ reps: 8, load: { value: 60, unit: "kg" }, rir: 2 }],
        }],
      },
      confidence: "confirmed",
    },
    envelope: manualEnvelope({ at: "2026-08-08T18:00:00.000+08:00" }),
  });
  const activity = await app.readActivityLog({ userId: "u1", date: "2026-08-08", timezoneOffsetMinutes: 480 });
  const fact = activity.entries.find((entry) => entry.fact.kind === "training")?.fact;
  assert.equal(fact?.kind, "training");
  if (!fact || fact.kind !== "training") throw new Error("missing daily training fact");
  assert.equal(fact.historicalSet, undefined);
  assert.equal(fact.reportedSession?.exercises?.[0]?.exerciseConceptId, "concept.bench_press");
  assert.equal(fact.reportedSession?.exercises?.[0]?.sets?.[0]?.load?.value, 60);
});

test("Timeline 按源/时区投影，并且趋势不会自动改变计划", async () => {
  const { app } = createApp();
  await bootstrap(app);
  await assert.rejects(
    app.recordTimelineFact({
      userId: "u1",
      idempotencyKey: "unconfirmed-food",
      fact: { kind: "nutrition", observationId: "food-1", energy: { value: 500, unit: "kcal" }, confidence: "estimated" },
      envelope: manualEnvelope({ at: "2026-08-08T12:00:00.000+08:00", origin: "llm_estimate" }),
    }),
    /user_confirmation_required_for_llm_estimate/,
  );
  await assert.rejects(
    app.recordTimelineFact({
      userId: "u1",
      idempotencyKey: "agent-claim",
      actor: { kind: "agent", id: "coach" },
      fact: { kind: "activity", activityType: "run", duration: { value: 30, unit: "minutes" }, confidence: "confirmed" },
      envelope: manualEnvelope({ at: "2026-08-08T12:00:00.000+08:00" }),
    }),
    /user_confirmation_required_for_agent_fact/,
  );
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "sleep-health",
    fact: { kind: "sleep", duration: { value: 7, unit: "hours" }, confidence: "confirmed" },
    envelope: {
      ...manualEnvelope({ at: "2026-08-07T23:00:00.000+08:00", endedAt: "2026-08-08T06:00:00.000+08:00", origin: "healthkit", deviceId: "watch-a" }),
      provenance: {
        origin: "healthkit",
        deviceId: "watch-a",
        recordingMethod: "platform_import",
        dataStatus: "available",
        confidence: "confirmed",
      },
    },
  });
  await app.setPrimaryDataSources({
    userId: "u1",
    preferences: {
      sleep: { origin: "healthkit", deviceId: "watch-a" },
      body_fat_percentage: {
        origin: "smart_scale",
        deviceId: "scale-a",
        method: "bioimpedance-a",
        algorithmVersion: "v1",
      },
    },
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-08T08:00:00.000+08:00", nonce: "source-choice" },
    idempotencyKey: "primary-sleep-source",
  });
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "sleep",
    fact: { kind: "sleep", duration: { value: 8, unit: "hours" }, confidence: "confirmed" },
    envelope: manualEnvelope({ at: "2026-08-08T23:00:00.000+08:00", endedAt: "2026-08-09T07:00:00.000+08:00" }),
  });
  for (const [key, value, device, method] of [
    ["fat-a", 20, "scale-a", "bioimpedance-a"],
    ["fat-b", 25, "scale-b", "bioimpedance-b"],
  ] as const) {
    await app.recordTimelineFact({
      userId: "u1",
      idempotencyKey: key,
      fact: {
        kind: "body",
        measurement: { metric: "body_fat_percentage", quantity: { value, unit: "percent" }, method, algorithmVersion: "v1" },
        confidence: "estimated",
      },
      envelope: {
        ...manualEnvelope({ at: "2026-08-09T07:05:00.000+08:00", origin: "smart_scale", deviceId: device }),
        provenance: {
          origin: "smart_scale",
          deviceId: device,
          recordingMethod: "device_measurement",
          dataStatus: "estimated",
          confidence: "estimated",
        },
      },
    });
  }
  const onEighth = await app.queryTimeline({ userId: "u1", range: "day", anchorDate: "2026-08-08" });
  const onNinth = await app.queryTimeline({ userId: "u1", range: "day", anchorDate: "2026-08-09" });
  assert.equal(onEighth.some((event) => event.fact.kind === "sleep"), true);
  assert.equal(onNinth.some((event) => event.fact.kind === "sleep"), true);
  const primarySleep = await app.readPrimarySourceFacts({ userId: "u1", metric: "sleep" });
  assert.equal(primarySleep.length, 1);
  assert.equal(primarySleep[0]?.envelope?.provenance.deviceId, "watch-a");
  const primaryBodyFat = await app.readPrimarySourceFacts({ userId: "u1", metric: "body_fat_percentage" });
  assert.equal(primaryBodyFat.length, 1);
  assert.equal(primaryBodyFat[0]?.envelope?.provenance.deviceId, "scale-a");
  const trends = await app.readBodyTrends({ userId: "u1" });
  assert.equal(trends.bodyFat.length, 2);
  assert.equal(trends.bodyFat.every((series) => series.confidence === "low"), true);
  assert.equal(trends.automaticPlanChange, false);
  assert.equal(
    healthConnectAggregationMode({ metric: "heart_rate", officialAggregateSupport: ["steps"] }),
    "preserve_per_source",
  );
});

test("体重趋势不会把同一来源的 kg 与 lb 原始值混入同一个中位数", async () => {
  const { app } = createApp();
  await bootstrap(app);
  for (const [idempotencyKey, value, unit, at] of [
    ["weight-kg", 80, "kg", "2026-08-08T07:00:00.000+08:00"],
    ["weight-lb", 176, "lb", "2026-08-09T07:00:00.000+08:00"],
  ] as const) {
    await app.recordTimelineFact({
      userId: "u1",
      idempotencyKey,
      fact: {
        kind: "body",
        measurement: { metric: "body_weight", quantity: { value, unit }, condition: "after_waking" },
        confidence: "confirmed",
      },
      envelope: {
        ...manualEnvelope({ at, origin: "smart_scale", deviceId: "scale-a" }),
        provenance: {
          origin: "smart_scale",
          deviceId: "scale-a",
          recordingMethod: "device_measurement",
          dataStatus: "available",
          confidence: "confirmed",
        },
      },
    });
  }
  const trends = await app.readBodyTrends({ userId: "u1" });
  assert.equal(trends.weight.length, 2);
  assert.deepEqual(
    trends.weight.map((series) => series.rawPoints[0]?.unit).sort(),
    ["kg", "lb"],
  );
  assert.deepEqual(trends.weight.map((series) => series.rawPoints[0]?.smoothedValue).sort((a, b) => (a ?? 0) - (b ?? 0)), [80, 176]);
});
