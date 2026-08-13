import assert from "node:assert/strict";
import test from "node:test";

import {
  createAndroidHealthConnectPort,
  type AndroidHealthConnectNativeModule,
} from "../../src/mobile/native/AndroidHealthConnectPort";

function native(overrides: Partial<AndroidHealthConnectNativeModule> = {}): AndroidHealthConnectNativeModule {
  return {
    async getAvailabilityAsync() { return "available" as const; },
    async getPermissionStateAsync(types) {
      return Object.fromEntries(types.map((type) => [type, "granted" as const]));
    },
    async readEvidencePageAsync() {
      return {
        nextCursor: "hc-next-1",
        evidence: [{
          id: "rmssd-1",
          metric: "hrv_rmssd",
          value: 43.2,
          unit: "milliseconds",
          occurredAt: "2026-08-09T06:40:00.000+08:00",
          observedAt: "2026-08-09T06:42:30.000+08:00",
          timezoneOffsetMinutes: 480,
          dataOriginPackage: "com.example.watch",
          deviceId: "watch-opaque-id",
          deviceManufacturer: "Example",
          deviceModel: "Example Watch",
          deviceType: "watch",
          clientRecordId: "client-7",
          clientRecordVersion: "3",
          lastModifiedAt: "2026-08-09T06:42:00.000+08:00",
          recordingMethod: "automatically_recorded",
        }],
      };
    },
    ...overrides,
  };
}

test("Android Health Connect port normalizes RMSSD and preserves non-inferred provenance", async () => {
  const port = createAndroidHealthConnectPort(native(), {
    now: () => new Date("2026-08-09T08:00:00.000+08:00"),
  });

  const page = await port.readEvidencePage?.({ userId: "u-1", metricTypes: ["hrv_rmssd"] });
  assert.equal(page?.availability, "available");
  assert.equal(page?.nextCursor, "hc-next-1");
  assert.deepEqual(page?.permissionByMetric, { hrv_rmssd: "granted" });
  assert.equal(page?.evidence.length, 1);
  assert.deepEqual(page?.evidence[0], {
    id: "rmssd-1",
    metric: "hrv_rmssd",
    value: 43.2,
    unit: "milliseconds",
    occurredAt: "2026-08-09T06:40:00.000+08:00",
    observedAt: "2026-08-09T06:42:30.000+08:00",
    timezoneOffsetMinutes: 480,
    origin: "health_connect",
    sourceAppId: "com.example.watch",
    clientRecordId: "client-7",
    clientRecordVersion: "3",
    deviceId: "watch-opaque-id",
    deviceManufacturer: "Example",
    deviceModel: "Example Watch",
    deviceType: "watch",
    sourceRecordingMethod: "automatically_recorded",
    recordingMethod: "platform_import",
    sourceRevision: "3",
    lastModifiedAt: "2026-08-09T06:42:00.000+08:00",
    permission: "granted",
    freshness: "fresh",
    sourceRecordId: "rmssd-1",
  });
});

test("missing provider and denied metrics never masquerade as empty health history", async () => {
  const providerMissing = createAndroidHealthConnectPort(native({
    async getAvailabilityAsync() { return "provider_missing_or_update_required"; },
  }));
  assert.deepEqual(await providerMissing.readEvidencePage?.({
    userId: "u-1", metricTypes: ["sleep", "body_weight"],
  }), {
    availability: "provider_missing_or_update_required",
    evidence: [],
    permissionByMetric: { sleep: "missing", body_weight: "missing" },
    capabilityByMetric: { sleep: "supported", body_weight: "supported" },
  });

  const denied = createAndroidHealthConnectPort(native({
    async getPermissionStateAsync(types) {
      return Object.fromEntries(types.map((type) => [type, "denied" as const]));
    },
  }));
  const deniedPage = await denied.readEvidencePage?.({ userId: "u-1", metricTypes: ["sleep"] });
  assert.equal(deniedPage?.availability, "permission_denied_or_revoked");
  assert.deepEqual(deniedPage?.evidence, []);
  assert.deepEqual(deniedPage?.permissionByMetric, { sleep: "denied" });
});

test("connection probe and progressive request do not read observations and retain Android RMSSD-only capability", async () => {
  let reads = 0;
  let requested: readonly string[] = [];
  const port = createAndroidHealthConnectPort(native({
    async getPermissionStateAsync(types) {
      return Object.fromEntries(types.map((type) => [type, "not_requested" as const]));
    },
    async requestPermissionsAsync(types) {
      requested = types;
      return Object.fromEntries(types.map((type) => [type, type === "sleep" ? "granted" as const : "denied" as const]));
    },
    async readEvidencePageAsync() {
      reads += 1;
      return { evidence: [] };
    },
  }));
  const before = await port.getConnectionState?.({ metricTypes: ["sleep", "hrv_sdnn"] });
  assert.equal(before?.availability, "permission_not_requested");
  assert.deepEqual(before?.capabilityByMetric, { sleep: "supported", hrv_sdnn: "not_supported" });
  assert.equal(reads, 0);

  const after = await port.requestPermissions?.({ metricTypes: ["sleep", "hrv_rmssd"] });
  assert.deepEqual(requested, ["sleep", "hrv_rmssd"]);
  assert.equal(after?.availability, "available");
  assert.deepEqual(after?.permissionByMetric, { sleep: "granted", hrv_rmssd: "denied" });
  assert.equal(reads, 0);
});

test("Android never forwards Apple-only SDNN into a Health Connect query", async () => {
  let requested: readonly string[] = [];
  const port = createAndroidHealthConnectPort(native({
    async readEvidencePageAsync(types) {
      requested = types;
      return { evidence: [] };
    },
  }));

  const page = await port.readEvidencePage?.({ userId: "u-1", metricTypes: ["hrv_rmssd", "hrv_sdnn"] });
  assert.deepEqual(requested, ["hrv_rmssd"]);
  assert.deepEqual(page?.permissionByMetric, { hrv_rmssd: "granted", hrv_sdnn: "not_supported" });
  assert.deepEqual(page?.capabilityByMetric, { hrv_rmssd: "supported", hrv_sdnn: "not_supported" });
});

test("only granted metrics are queried; invalid values and provider errors do not create facts or advance a cursor", async () => {
  let requested: readonly string[] = [];
  const port = createAndroidHealthConnectPort(native({
    async getPermissionStateAsync(types) {
      return Object.fromEntries(types.map((type) => [type, type === "body_weight" ? "denied" : "granted"]));
    },
    async readEvidencePageAsync(metricTypes) {
      requested = metricTypes;
      return {
        nextCursor: "must-not-be-used-for-invalid-only",
        evidence: [
          { id: "bad-hrv", metric: "hrv_rmssd", value: 15, unit: "beats_per_minute", occurredAt: "2026-08-09T07:00:00.000Z" },
          { id: "weight-denied", metric: "body_weight", value: 70, unit: "kg", occurredAt: "2026-08-09T07:00:00.000Z" },
        ],
      };
    },
  }));
  const invalid = await port.readEvidencePage?.({
    userId: "u-1", metricTypes: ["hrv_rmssd", "body_weight"], cursor: "prior-token",
  });
  assert.deepEqual(requested, ["hrv_rmssd"]);
  assert.deepEqual(invalid?.evidence, []);
  // The native cursor is returned only for a successful provider page. The
  // application still decides whether to commit it atomically with facts.
  assert.equal(invalid?.nextCursor, "must-not-be-used-for-invalid-only");

  const failed = createAndroidHealthConnectPort(native({
    async readEvidencePageAsync() { throw new Error("provider temporarily busy"); },
  }));
  const failedPage = await failed.readEvidencePage?.({ userId: "u-1", metricTypes: ["sleep"], cursor: "prior-token" });
  assert.equal(failedPage?.availability, "query_error");
  assert.equal(failedPage?.nextCursor, undefined);
  assert.deepEqual(failedPage?.evidence, []);
});

test("deletion carries only stable record identity and is accepted without fabricated metadata", async () => {
  const port = createAndroidHealthConnectPort(native({
    async readEvidencePageAsync() {
      return {
        nextCursor: "delete-cursor",
        evidence: [{
          id: "weight-1",
          metric: "body_weight",
          observedAt: "2026-08-09T09:00:00.000Z",
          change: "delete",
        }],
      };
    },
  }));
  const page = await port.readEvidencePage?.({ userId: "u-1", metricTypes: ["body_weight"] });
  assert.deepEqual(page?.evidence[0], {
    id: "weight-1",
    metric: "body_weight",
    observedAt: "2026-08-09T09:00:00.000Z",
    timezoneOffsetMinutes: 0,
    origin: "health_connect",
    recordingMethod: "platform_import",
    change: "delete",
    permission: "granted",
    freshness: "fresh",
    sourceRecordId: "weight-1",
  });
});

test("an expired native Changes cursor is surfaced as an explicit bounded-resync marker", async () => {
  const port = createAndroidHealthConnectPort(native({
    async readEvidencePageAsync() {
      return { nextCursor: "bounded-resync-cursor", cursorReset: true, evidence: [] };
    },
  }));
  const page = await port.readEvidencePage?.({ userId: "u-1", metricTypes: ["sleep"], cursor: "expired" });
  assert.equal(page?.availability, "available");
  assert.equal(page?.cursorReset, true);
  assert.equal(page?.nextCursor, "bounded-resync-cursor");
});

test("bounded initial-history and changes-backlog hints stay transport hints for the application catch-up loop", async () => {
  const port = createAndroidHealthConnectPort(native({
    async readEvidencePageAsync() {
      return {
        nextCursor: "second-bounded-page",
        hasMore: true,
        initialSyncPending: true,
        evidence: [],
      };
    },
  }));
  const page = await port.readEvidencePage?.({ userId: "u-1", metricTypes: ["sleep"] });
  assert.equal(page?.hasMore, true);
  assert.equal(page?.initialSyncPending, true);
  assert.equal(page?.nextCursor, "second-bounded-page");
});
