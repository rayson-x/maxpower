import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppleHealthKitPort,
  type AppleHealthKitNativeModule,
} from "../../src/mobile/native/AppleHealthKitPort";

function native(overrides: Partial<AppleHealthKitNativeModule> = {}): AppleHealthKitNativeModule {
  return {
    async getAvailabilityAsync() { return "available" as const; },
    async getPermissionStateAsync(types) {
      return Object.fromEntries(types.map((type) => [type, "requested" as const]));
    },
    async requestPermissionsAsync(types) {
      return Object.fromEntries(types.map((type) => [type, "requested" as const]));
    },
    async readEvidencePageAsync() {
      return {
        nextCursor: "hk-anchor-2",
        evidence: [{
          id: "sdnn-1", metric: "hrv_sdnn", value: 51.4, unit: "milliseconds",
          occurredAt: "2026-08-09T06:40:00.000+08:00", observedAt: "2026-08-09T06:42:00.000+08:00",
          timezoneOffsetMinutes: 480, sourceBundleId: "com.example.watch", sourceVersion: "12.1",
          deviceManufacturer: "Example", deviceModel: "Watch", deviceType: "watch",
          recordingMethod: "automatic", lastModifiedAt: "2026-08-09T06:41:00.000+08:00",
        }],
      };
    },
    ...overrides,
  };
}

test("HealthKit keeps read authorization privacy-safe while normalizing SDNN provenance", async () => {
  const port = createAppleHealthKitPort(native(), { now: () => new Date("2026-08-09T08:00:00.000+08:00") });
  const connection = await port.getConnectionState?.({ metricTypes: ["hrv_sdnn", "hrv_rmssd"] });
  assert.equal(connection?.availability, "available");
  assert.deepEqual(connection?.permissionByMetric, { hrv_sdnn: "unknown", hrv_rmssd: "not_supported" });
  assert.deepEqual(connection?.capabilityByMetric, { hrv_sdnn: "supported", hrv_rmssd: "not_supported" });

  const page = await port.readEvidencePage?.({ userId: "u1", metricTypes: ["hrv_sdnn", "hrv_rmssd"] });
  assert.equal(page?.availability, "available");
  assert.equal(page?.nextCursor, "hk-anchor-2");
  assert.equal(page?.evidence.length, 1);
  assert.deepEqual(page?.evidence[0], {
    id: "sdnn-1", metric: "hrv_sdnn", value: 51.4, unit: "milliseconds",
    occurredAt: "2026-08-09T06:40:00.000+08:00", observedAt: "2026-08-09T06:42:00.000+08:00",
    timezoneOffsetMinutes: 480, origin: "healthkit", sourceAppId: "com.example.watch",
    deviceManufacturer: "Example", deviceModel: "Watch", deviceType: "watch",
    sourceRecordingMethod: "automatic", recordingMethod: "platform_import", sourceRevision: "12.1",
    lastModifiedAt: "2026-08-09T06:41:00.000+08:00", permission: "unknown", freshness: "fresh", sourceRecordId: "sdnn-1",
  });
});

test("HealthKit never forwards an unsupported cross-platform metric into an Apple native query", async () => {
  let requested: readonly string[] = [];
  const port = createAppleHealthKitPort(native({
    async readEvidencePageAsync(types) {
      requested = types;
      return { evidence: [] };
    },
  }));

  const page = await port.readEvidencePage?.({ userId: "u1", metricTypes: ["hrv_sdnn", "hrv_rmssd"] });
  assert.deepEqual(requested, ["hrv_sdnn"]);
  assert.deepEqual(page?.permissionByMetric, { hrv_sdnn: "unknown", hrv_rmssd: "not_supported" });
  assert.deepEqual(page?.capabilityByMetric, { hrv_sdnn: "supported", hrv_rmssd: "not_supported" });
});

test("HealthKit no-data remains an honest readable-coverage uncertainty, not a fabricated denial", async () => {
  let queried: readonly string[] = [];
  const port = createAppleHealthKitPort(native({
    async readEvidencePageAsync(types) { queried = types; return { evidence: [] }; },
  }));
  const page = await port.readEvidencePage?.({ userId: "u1", metricTypes: ["sleep", "body_weight"] });
  assert.deepEqual(queried, ["sleep", "body_weight"]);
  assert.equal(page?.availability, "available");
  assert.deepEqual(page?.permissionByMetric, { sleep: "unknown", body_weight: "unknown" });
  assert.deepEqual(page?.evidence, []);
});

test("HealthKit only asks for selected types and does not expose a false per-type grant", async () => {
  let requested: readonly string[] = [];
  const port = createAppleHealthKitPort(native({
    async requestPermissionsAsync(types) {
      requested = types;
      return Object.fromEntries(types.map((type) => [type, "requested" as const]));
    },
  }));
  const result = await port.requestPermissions?.({ metricTypes: ["sleep", "hrv_sdnn"] });
  assert.deepEqual(requested, ["sleep", "hrv_sdnn"]);
  assert.equal(result?.availability, "available");
  assert.deepEqual(result?.permissionByMetric, { sleep: "unknown", hrv_sdnn: "unknown" });
});

test("HealthKit unavailable and query failure retain cursor semantics rather than returning a successful empty page", async () => {
  const unavailable = createAppleHealthKitPort(native({
    async getAvailabilityAsync() { return "not_supported" as const; },
  }));
  assert.equal((await unavailable.readEvidencePage?.({ userId: "u1", metricTypes: ["sleep"] }))?.availability, "not_supported");

  const failed = createAppleHealthKitPort(native({
    async readEvidencePageAsync() { throw new Error("store_locked"); },
  }));
  const page = await failed.readEvidencePage?.({ userId: "u1", metricTypes: ["sleep"], cursor: "old-anchor" });
  assert.equal(page?.availability, "query_error");
  assert.equal(page?.nextCursor, undefined);
  assert.deepEqual(page?.evidence, []);
});
