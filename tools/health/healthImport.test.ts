import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { HealthEvidencePage } from "../../src/coach/ports";

async function bootstrap(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "health-user",
      actor: { kind: "user", id: "health-user" },
      deviceId: "phone-1",
      occurredAt: "2026-08-08T00:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08" },
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
}

function page(input: Omit<HealthEvidencePage, "availability" | "permissionByMetric" | "capabilityByMetric">): HealthEvidencePage {
  return {
    availability: "available",
    ...input,
    permissionByMetric: {
      sleep: "granted",
      hrv_rmssd: "granted",
      resting_heart_rate: "granted",
      body_weight: "granted",
      activity: "granted",
    },
    capabilityByMetric: {
      sleep: "supported",
      hrv_rmssd: "supported",
      resting_heart_rate: "supported",
      body_weight: "supported",
      activity: "supported",
    },
  };
}

test("Health page 在一个原子提交中写入 Timeline 与本地 cursor；重复请求不重读 Provider", async () => {
  let sequence = 0;
  const pages: HealthEvidencePage[] = [
    page({
      nextCursor: "changes-1",
      evidence: [
        {
          id: "sleep-1", metric: "sleep", value: 7.5, unit: "hours",
          occurredAt: "2026-08-07T23:00:00.000+08:00", endedAt: "2026-08-08T06:30:00.000+08:00",
          timezoneOffsetMinutes: 480, origin: "health_connect", deviceId: "watch-a",
          recordingMethod: "platform_import", sourceRecordId: "sleep-1", sourceRevision: "1",
          lastModifiedAt: "2026-08-08T06:35:00.000+08:00", permission: "granted", freshness: "fresh",
        },
        {
          id: "hrv-1", metric: "hrv_rmssd", value: 42, unit: "milliseconds",
          occurredAt: "2026-08-08T06:31:00.000+08:00", timezoneOffsetMinutes: 480,
          origin: "health_connect", deviceId: "watch-a", recordingMethod: "platform_import",
          sourceRecordId: "hrv-1", algorithmVersion: "health-connect-v1", permission: "granted", freshness: "fresh",
        },
        {
          id: "rhr-1", metric: "resting_heart_rate", value: 54, unit: "beats_per_minute",
          occurredAt: "2026-08-08T06:32:00.000+08:00", timezoneOffsetMinutes: 480,
          origin: "health_connect", deviceId: "watch-a", recordingMethod: "platform_import",
          sourceRecordId: "rhr-1", permission: "granted", freshness: "fresh",
        },
        {
          id: "weight-1", metric: "body_weight", value: 80.2, unit: "kg",
          occurredAt: "2026-08-08T07:00:00.000+08:00", timezoneOffsetMinutes: 480,
          origin: "health_connect", deviceId: "scale-a", recordingMethod: "platform_import",
          sourceRecordId: "weight-1", measurementMethod: "after_waking", lastModifiedAt: "2026-08-08T07:01:00.000+08:00",
          permission: "granted", freshness: "fresh",
        },
      ],
    }),
    page({
      nextCursor: "changes-2",
      evidence: [
        {
          id: "weight-1", metric: "body_weight", value: 79.8, unit: "kg",
          occurredAt: "2026-08-08T07:00:00.000+08:00", timezoneOffsetMinutes: 480,
          origin: "health_connect", deviceId: "scale-a", recordingMethod: "platform_import",
          sourceRecordId: "weight-1", measurementMethod: "after_waking", lastModifiedAt: "2026-08-08T07:03:00.000+08:00",
          permission: "granted", freshness: "fresh",
        },
        {
          id: "hrv-1", metric: "hrv_rmssd",
          occurredAt: "2026-08-08T06:31:00.000+08:00", timezoneOffsetMinutes: 480,
          origin: "health_connect", deviceId: "watch-a", recordingMethod: "platform_import",
          sourceRecordId: "hrv-1", change: "delete", permission: "granted", freshness: "fresh",
        },
      ],
    }),
  ];
  const requests: unknown[] = [];
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-08T08:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    health: {
      async readFacts() { return []; },
      async readEvidencePage(request) {
        requests.push(request);
        const next = pages.shift();
        if (!next) throw new Error("unexpected_provider_read");
        return next;
      },
    },
  });
  await bootstrap(app);

  const first = await app.importHealthEvidence({
    userId: "health-user",
    platform: "health_connect",
    metricTypes: ["sleep", "hrv_rmssd", "resting_heart_rate", "body_weight"],
    idempotencyKey: "health-page-1",
  });
  assert.equal(first.status, "committed");
  assert.equal(first.importedEventIds.length, 4);
  assert.equal(first.state.cursor, "changes-1");
  assert.equal(first.state.version, 1);
  assert.equal(requests.length, 1);
  const afterFirst = await app.readDomainProjection({ userId: "health-user" });
  const rmssd = afterFirst.timeline.current.find(
    (event) => event.fact.kind === "recovery" && event.fact.hrvMetric === "rmssd",
  );
  assert.equal(rmssd?.fact.kind === "recovery" && rmssd.fact.hrv, 42);
  assert.equal(rmssd?.envelope?.provenance.algorithmVersion, "health-connect-v1");
  const productAfterFirst = await app.readProductProjection({
    userId: "health-user",
    date: "2026-08-08",
    timezoneOffsetMinutes: 480,
    calendarMode: "week",
    calendarAnchorDate: "2026-08-08",
  });
  assert.deepEqual(productAfterFirst.profile.healthSources, [{
    platform: "health_connect",
    availability: "available",
    metricTypes: ["sleep", "hrv_rmssd", "resting_heart_rate", "body_weight"],
    grantedMetricTypes: ["sleep", "hrv_rmssd", "resting_heart_rate", "body_weight"],
    unknownPermissionMetricTypes: [],
    lastSuccessfulImportAt: "2026-08-08T08:00:00.000+08:00",
    lastAttemptAt: "2026-08-08T08:00:00.000+08:00",
  }]);

  const retry = await app.importHealthEvidence({
    userId: "health-user",
    platform: "health_connect",
    metricTypes: ["sleep", "hrv_rmssd", "resting_heart_rate", "body_weight"],
    idempotencyKey: "health-page-1",
  });
  assert.equal(retry.status, "idempotent");
  assert.equal(requests.length, 1);

  const second = await app.importHealthEvidence({
    userId: "health-user",
    platform: "health_connect",
    metricTypes: ["hrv_rmssd", "body_weight"],
    idempotencyKey: "health-page-2",
  });
  assert.equal(second.state.cursor, "changes-2");
  assert.equal(second.state.version, 2);
  assert.deepEqual(requests[1], {
    userId: "health-user",
    cursor: "changes-1",
    metricTypes: ["hrv_rmssd", "body_weight"],
  });
  const afterSecond = await app.readDomainProjection({ userId: "health-user" });
  assert.equal(
    afterSecond.timeline.current.some(
      (event) => event.fact.kind === "recovery" && event.fact.hrvMetric === "rmssd",
    ),
    false,
  );
  const currentWeight = afterSecond.timeline.current.find(
    (event) => event.fact.kind === "body" && event.fact.measurement.metric === "body_weight",
  );
  assert.equal(
    currentWeight?.fact.kind === "body" && currentWeight.fact.measurement.quantity.value,
    79.8,
  );
  assert.equal(afterSecond.timeline.events.filter((event) => event.lifecycle === "superseded").length, 1);
  assert.equal(afterSecond.timeline.tombstones.length, 1);
  assert.equal((await app.listActionLog("health-user")).some((event) => event.actor === "sync"), true);
});

test("平台删除只提供 record ID 时，既有来源元数据不会阻止对应 Timeline 事实 tombstone", async () => {
  let sequence = 0;
  const pages: HealthEvidencePage[] = [
    page({
      nextCursor: "changes-before-delete",
      evidence: [{
        id: "weight-device-record", metric: "body_weight", value: 79.4, unit: "kg",
        occurredAt: "2026-08-08T07:00:00.000+08:00", timezoneOffsetMinutes: 480,
        origin: "health_connect", deviceId: "scale-a", recordingMethod: "platform_import",
        sourceRecordId: "weight-device-record", sourceRevision: "7", permission: "granted", freshness: "fresh",
      }],
    }),
    page({
      nextCursor: "changes-after-delete",
      // Health Connect DeletionChange intentionally only exposes Metadata.id.
      evidence: [{
        id: "weight-device-record", metric: "body_weight",
        occurredAt: "2026-08-08T07:00:00.000+08:00", timezoneOffsetMinutes: 480,
        origin: "health_connect", recordingMethod: "platform_import",
        sourceRecordId: "weight-device-record", change: "delete", permission: "granted", freshness: "fresh",
      }],
    }),
  ];
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-08T08:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    health: {
      async readFacts() { return []; },
      async readEvidencePage() {
        const next = pages.shift();
        if (!next) throw new Error("unexpected_provider_read");
        return next;
      },
    },
  });
  await bootstrap(app);
  await app.importHealthEvidence({
    userId: "health-user", platform: "health_connect", metricTypes: ["body_weight"], idempotencyKey: "before-delete",
  });
  await app.importHealthEvidence({
    userId: "health-user", platform: "health_connect", metricTypes: ["body_weight"], idempotencyKey: "after-delete",
  });
  const timeline = (await app.readDomainProjection({ userId: "health-user" })).timeline;
  assert.equal(timeline.current.some((item) => item.fact.kind === "body"), false);
  assert.equal(timeline.tombstones.length, 1);
});

test("Health Connect 授权只能经 CoachApplication 发起，并将真实平台结果镜像到本地 PermissionSet", async () => {
  let requests = 0;
  let sequence = 0;
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-08T08:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-permission-${++sequence}`,
    },
    health: {
      async readFacts() { return []; },
      async getConnectionState() {
        return {
          availability: "permission_not_requested" as const,
          permissionByMetric: { sleep: "missing" as const },
          capabilityByMetric: { sleep: "supported" as const },
        };
      },
      async requestPermissions(input) {
        requests += 1;
        assert.deepEqual(input.metricTypes, ["sleep", "hrv_rmssd"]);
        return {
          availability: "available" as const,
          permissionByMetric: { sleep: "granted" as const, hrv_rmssd: "denied" as const },
          capabilityByMetric: { sleep: "supported" as const, hrv_rmssd: "supported" as const },
        };
      },
    },
  });
  await bootstrap(app);
  await app.executeDomainCommand({
    type: "permission_set.revise",
    meta: {
      userId: "health-user",
      actor: { kind: "user", id: "health-user" },
      deviceId: "phone-1",
      occurredAt: "2026-08-08T08:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "health-permissions",
    },
    permissionSetId: "health-permissions",
    expectedRevision: 0,
    permissionSet: {
      id: "health-permissions",
      camera: "not_configured",
      health: "not_configured",
      notifications: "not_configured",
      remoteLlm: "not_configured",
      cloudSync: "not_configured",
      mediaUpload: "not_configured",
    },
    authorization: {
      kind: "local_user_presence",
      verifiedAt: "2026-08-08T08:00:00.000+08:00",
      nonce: "health-permission-bootstrap",
    },
  });
  const initial = await app.getHealthConnectionState({ metricTypes: ["sleep"] });
  assert.equal(initial.availability, "permission_not_requested");

  const projection = await app.readDomainProjection({ userId: "health-user" });
  const result = await app.requestHealthConnectionPermissions({
    userId: "health-user",
    metricTypes: ["sleep", "hrv_rmssd"],
    expectedPermissionRevision: projection.permissions?.revision ?? 0,
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-08T08:00:00.000+08:00", nonce: "health-system-prompt" },
    idempotencyKey: "request-health-connect",
  });
  assert.equal(requests, 1);
  assert.equal(result.availability, "available");
  const after = await app.readDomainProjection({ userId: "health-user" });
  assert.equal(after.permissions?.value.health, "granted");
  assert.equal((await app.listActionLog("health-user")).some((event) => event.action === "permission.changed"), true);
});

test("HealthKit privacy-preserving unknown read state may import returned samples but never fabricates a grant", async () => {
  let sequence = 0;
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-08T08:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    health: {
      async readFacts() { return []; },
      async readEvidencePage() {
        return {
          availability: "available",
          nextCursor: "hk-anchor-1",
          evidence: [{
            id: "hk-sdnn-1", metric: "hrv_sdnn", value: 48, unit: "milliseconds",
            occurredAt: "2026-08-08T06:20:00.000+08:00", timezoneOffsetMinutes: 480,
            origin: "healthkit", recordingMethod: "platform_import", permission: "unknown", freshness: "fresh",
            sourceRecordId: "hk-sdnn-1",
          }],
          permissionByMetric: { hrv_sdnn: "unknown" },
          capabilityByMetric: { hrv_sdnn: "supported" },
        };
      },
    },
  });
  await bootstrap(app);
  const result = await app.importHealthEvidence({
    userId: "health-user", platform: "healthkit", metricTypes: ["hrv_sdnn"], idempotencyKey: "healthkit-sdnn",
  });
  assert.equal(result.importedEventIds.length, 1);
  assert.equal(result.state.permissionByMetric.hrv_sdnn, "unknown");
  const timeline = (await app.readDomainProjection({ userId: "health-user" })).timeline;
  assert.equal(timeline.current[0]?.fact.kind, "recovery");
  assert.equal(timeline.current[0]?.envelope?.provenance.origin, "healthkit");
});

test("Provider 缺失或查询异常只更新连接状态，不伪装为空数据或清空既有 Timeline", async () => {
  let sequence = 0;
  const pages: HealthEvidencePage[] = [
    page({
      evidence: [],
      nextCursor: "existing-cursor-must-survive",
    }),
    {
      availability: "provider_missing_or_update_required",
      evidence: [],
      permissionByMetric: { sleep: "missing" },
      capabilityByMetric: { sleep: "not_supported" },
    },
  ];
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-08T08:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    health: {
      async readFacts() { return []; },
      async readEvidencePage() {
        const next = pages.shift();
        if (!next) throw new Error("unexpected_provider_read");
        return next;
      },
    },
  });
  await bootstrap(app);
  await app.importHealthEvidence({
    userId: "health-user", platform: "health_connect", metricTypes: ["sleep"], idempotencyKey: "healthy-page",
  });
  const unavailable = await app.importHealthEvidence({
    userId: "health-user", platform: "health_connect", metricTypes: ["sleep"], idempotencyKey: "missing-provider",
  });
  assert.equal(unavailable.availability, "provider_missing_or_update_required");
  assert.equal(unavailable.importedEventIds.length, 0);
  assert.equal(unavailable.state.cursor, "existing-cursor-must-survive");
  assert.equal(unavailable.state.lastSuccessfulImportAt, "2026-08-08T08:00:00.000+08:00");
  assert.equal(unavailable.state.lastErrorCode, "provider_missing_or_update_required");
  const source = (await app.readProductProjection({
    userId: "health-user", date: "2026-08-08", timezoneOffsetMinutes: 480,
    calendarMode: "week", calendarAnchorDate: "2026-08-08",
  })).profile.healthSources[0];
  assert.equal(source?.availability, "provider_missing_or_update_required");
});

test("前台和后台可共用有界 Health catch-up；每页仅在原子提交后读取下一 cursor", async () => {
  let sequence = 0;
  const requests: Array<{ cursor?: string }> = [];
  const pages: HealthEvidencePage[] = [
    page({
      nextCursor: "initial-page-2",
      hasMore: true,
      initialSyncPending: true,
      evidence: [{
        id: "sleep-page-1", metric: "sleep", value: 420, unit: "minutes",
        occurredAt: "2026-08-07T23:00:00.000+08:00", endedAt: "2026-08-08T06:00:00.000+08:00",
        timezoneOffsetMinutes: 480, origin: "health_connect", recordingMethod: "platform_import",
        sourceRecordId: "sleep-page-1", permission: "granted", freshness: "fresh",
      }],
    }),
    page({
      nextCursor: "changes-ready",
      evidence: [{
        id: "weight-page-2", metric: "body_weight", value: 72, unit: "kg",
        occurredAt: "2026-08-08T07:00:00.000+08:00", timezoneOffsetMinutes: 480,
        origin: "health_connect", recordingMethod: "platform_import", sourceRecordId: "weight-page-2",
        permission: "granted", freshness: "fresh",
      }],
    }),
  ];
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-08T08:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    health: {
      async readFacts() { return []; },
      async readEvidencePage(input) {
        requests.push({ cursor: input.cursor });
        const next = pages.shift();
        if (!next) throw new Error("unexpected_provider_read");
        return next;
      },
    },
  });
  await bootstrap(app);

  const result = await app.catchUpHealthEvidence({
    userId: "health-user",
    platform: "health_connect",
    metricTypes: ["sleep", "body_weight"],
    idempotencyKeyPrefix: "foreground-health",
    maxPages: 4,
  });
  assert.equal(result.stoppedBecause, "caught_up");
  assert.equal(result.pages.length, 2);
  assert.deepEqual(requests, [{ cursor: undefined }, { cursor: "initial-page-2" }]);
  const state = result.pages[1]?.state;
  assert.equal(state?.cursor, "changes-ready");
  assert.equal(state?.initialSyncPending, undefined);
  assert.equal(state?.hasMore, undefined);
  const timeline = (await app.readDomainProjection({ userId: "health-user" })).timeline;
  assert.equal(timeline.current.length, 2);
});
