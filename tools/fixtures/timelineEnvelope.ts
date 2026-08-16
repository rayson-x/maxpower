import type { TimelineFact } from "../../src/coach/domain";
import type { TimelineFactEnvelope } from "../../src/timeline";

export function confirmedTimelineEnvelope(input: {
  id: string;
  factType: TimelineFact["kind"];
  occurredAt: string;
  timezoneOffsetMinutes?: number;
}): TimelineFactEnvelope {
  return {
    id: input.id,
    schemaVersion: 1,
    factType: input.factType,
    time: {
      startedAt: input.occurredAt,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes ?? 480,
    },
    recordedAt: input.occurredAt,
    actor: { kind: "user", id: "test-user" },
    provenance: {
      origin: "manual",
      recordingMethod: "manual_entry",
      dataStatus: "available",
      confidence: "confirmed",
    },
    privacyClass: "sensitive",
    causalRefs: [],
    evidenceRefs: [],
    layer: "raw_observation",
  };
}
