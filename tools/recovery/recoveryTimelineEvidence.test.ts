import assert from "node:assert/strict";
import test from "node:test";

import type { TimelineProjectionEvent } from "../../src/coach/domain";
import { deriveRecoveryTimelineEvidence, evaluateRecovery } from "../../src/recovery";

const NOW = "2026-08-08T08:00:00.000+08:00";

function recoveryEvent(input: {
  id: string;
  at: string;
  hrv?: number;
  hrvMetric?: "sdnn" | "rmssd";
  rhr?: number;
  deviceId: string;
  algorithmVersion?: string;
}): TimelineProjectionEvent {
  return {
    eventId: input.id,
    revision: 1,
    occurredAt: input.at,
    recordedAt: input.at,
    timezoneOffsetMinutes: 480,
    fact: {
      kind: "recovery",
      ...(input.hrv !== undefined ? { hrv: input.hrv, hrvMetric: input.hrvMetric, hrvUnit: "milliseconds" as const } : {}),
      ...(input.rhr !== undefined ? { restingHeartRate: input.rhr, restingHeartRateUnit: "beats_per_minute" as const } : {}),
      confidence: "confirmed",
    },
    envelope: {
      id: `entry-${input.id}`,
      schemaVersion: 1,
      factType: "recovery",
      time: { startedAt: input.at, timezoneOffsetMinutes: 480 },
      recordedAt: input.at,
      actor: { kind: "sync", id: "health-import" },
      provenance: {
        origin: "health_connect",
        deviceId: input.deviceId,
        recordingMethod: "platform_import",
        ...(input.algorithmVersion ? { algorithmVersion: input.algorithmVersion } : {}),
        dataStatus: "available",
        confidence: "confirmed",
      },
      privacyClass: "sensitive",
      causalRefs: ["health_metric:hrv"],
      evidenceRefs: [],
      layer: "raw_observation",
    },
  };
}

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 24 * 60 * 60 * 1000).toISOString();
}

test("恢复证据只以同 metric/source/device/algorithm 的选择序列建立 HRV baseline", () => {
  const events: TimelineProjectionEvent[] = [
    ...Array.from({ length: 7 }, (_, index) => recoveryEvent({
      id: `rmssd-${index}`,
      at: daysAgo(8 - index),
      hrv: 40 + index % 2,
      hrvMetric: "rmssd",
      deviceId: "watch-a",
      algorithmVersion: "v1",
    })),
    recoveryEvent({ id: "rmssd-current", at: "2026-08-08T07:30:00.000+08:00", hrv: 28, hrvMetric: "rmssd", deviceId: "watch-a", algorithmVersion: "v1" }),
    ...Array.from({ length: 8 }, (_, index) => recoveryEvent({
      id: `sdnn-${index}`,
      at: daysAgo(8 - index),
      hrv: 70,
      hrvMetric: "sdnn",
      deviceId: "watch-b",
      algorithmVersion: "v1",
    })),
  ];
  const evidence = deriveRecoveryTimelineEvidence({
    events,
    now: NOW,
    primarySources: {
      hrv: { origin: "health_connect", deviceId: "watch-a", recordingMethod: "platform_import", algorithmVersion: "v1" },
    },
  });
  assert.equal(evidence.checkIn.hrv?.metric, "rmssd");
  assert.equal(evidence.checkIn.hrv?.baselineMature, true);
  assert.equal(evidence.checkIn.hrv?.direction, "lower");
  assert.equal(evidence.series[0]?.eventIds.includes("sdnn-0"), false);
  assert.equal(evidence.factRefs.includes("timeline_event:sdnn-0"), true);
});

test("多个未经选择的可穿戴来源会降级为 unknown，而非取平均或猜测主要来源", () => {
  const evidence = deriveRecoveryTimelineEvidence({
    events: [
      recoveryEvent({ id: "a", at: "2026-08-08T07:00:00.000+08:00", hrv: 40, hrvMetric: "rmssd", deviceId: "watch-a" }),
      recoveryEvent({ id: "b", at: "2026-08-08T07:05:00.000+08:00", hrv: 75, hrvMetric: "sdnn", deviceId: "watch-b" }),
    ],
    now: NOW,
  });
  assert.equal(evidence.checkIn.hrv, undefined);
  assert.ok(evidence.attribution.missingOrStale?.includes("hrv_primary_source_not_selected"));
  assert.ok(evidence.attribution.contradictingFactRefs?.includes("timeline_event:a"));
  assert.ok(evidence.attribution.contradictingFactRefs?.includes("timeline_event:b"));
});

test("用户感觉良好而设备异常时保留原计划，并把设备作为可追溯的反向佐证", () => {
  const events: TimelineProjectionEvent[] = [
    ...Array.from({ length: 7 }, (_, index) => recoveryEvent({
      id: `baseline-${index}`,
      at: daysAgo(8 - index),
      rhr: 52,
      deviceId: "watch-a",
      algorithmVersion: "v1",
    })),
    recoveryEvent({ id: "rhr-current", at: "2026-08-08T07:30:00.000+08:00", rhr: 65, deviceId: "watch-a", algorithmVersion: "v1" }),
  ];
  const evidence = deriveRecoveryTimelineEvidence({
    events,
    now: NOW,
    primarySources: {
      resting_heart_rate: { origin: "health_connect", deviceId: "watch-a", recordingMethod: "platform_import", algorithmVersion: "v1" },
    },
    checkIn: { perceivedRecovery: 8, fatigue: 2 },
  });
  const decision = evaluateRecovery({
    id: "recovery-1",
    evaluatedAt: NOW,
    validUntil: "2026-08-09T08:00:00.000+08:00",
    checkIn: evidence.checkIn,
    factRefs: evidence.factRefs,
    evidence: evidence.attribution,
  });
  assert.equal(decision.constraint.level, "normal");
  assert.equal(decision.constraint.intentions?.[0]?.kind, "warmup_check");
  assert.ok(decision.constraint.evaluation?.contradictingFactRefs.includes("timeline_event:rhr-current"));
  assert.equal(decision.constraint.evaluation?.confirmationRequired, false);
});
