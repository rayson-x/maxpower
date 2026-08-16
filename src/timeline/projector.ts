import type { TimelineFact, TimelineProjectionEvent } from "../coach/domain";
import type {
  TimelineActivityLog,
  TimelineFactEnvelope,
  TimelineReadEvent,
  TimelineSyncPayload,
  TimelineTombstone,
  TimelineMetric,
  TimelineSourceSelector,
} from "./model";

export function projectTimelineEvent(event: TimelineProjectionEvent): TimelineReadEvent {
  return {
    eventId: event.eventId,
    revision: event.revision,
    fact: event.fact,
    envelope: event.envelope,
    occurredAt: event.envelope.time.startedAt,
    recordedAt: event.recordedAt,
    timezoneOffsetMinutes: event.envelope.time.timezoneOffsetMinutes,
    ...(event.correctsEventId ? { correctsEventId: event.correctsEventId } : {}),
    ...(event.sourceMutationOfEventId ? { sourceMutationOfEventId: event.sourceMutationOfEventId } : {}),
    ...(event.tombstonesEventId ? { tombstonesEventId: event.tombstonesEventId } : {}),
    lifecycle: event.lifecycle ?? "active",
  };
}

export function stableTimelineOrder<T extends TimelineReadEvent>(events: readonly T[]): T[] {
  return [...events].sort((left, right) => {
    const occurred = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
    if (occurred !== 0) return occurred;
    const recorded = Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
    if (recorded !== 0) return recorded;
    return left.eventId.localeCompare(right.eventId);
  });
}

/**
 * Date attribution intentionally uses the source-timezone held by the event.
 * Sleep belongs to its end date (wake date); activities and training belong to
 * their start date, even if they cross midnight. Measurements are point facts.
 */
export function timelineDayKey(event: Pick<TimelineReadEvent, "fact" | "envelope" | "occurredAt" | "timezoneOffsetMinutes">): string {
  const envelope = event.envelope;
  const isSleep = event.fact.kind === "sleep";
  const instant = isSleep ? envelope.time.endedAt ?? event.occurredAt : event.occurredAt;
  const offset = isSleep
    ? envelope.time.endedTimezoneOffsetMinutes ?? envelope.time.timezoneOffsetMinutes
    : envelope.time.timezoneOffsetMinutes;
  return localDateAtOffset(instant, offset);
}

export function timelineActivityLog(
  date: string,
  timezoneOffsetMinutes: number,
  events: readonly TimelineProjectionEvent[],
): TimelineActivityLog {
  const current = events
    .filter((event) => (event.lifecycle ?? "active") === "active")
    .map(projectTimelineEvent)
    .filter((event) => timelineDayKey(event) === date);
  return { date, timezoneOffsetMinutes, entries: stableTimelineOrder(current) };
}

export function timelineRange(
  events: readonly TimelineProjectionEvent[],
  input: { startDate: string; endDate: string; includeHistory?: boolean },
): TimelineReadEvent[] {
  return stableTimelineOrder(
    events
      .filter((event) => input.includeHistory || (event.lifecycle ?? "active") === "active")
      .map(projectTimelineEvent)
      .filter((event) => {
        const date = timelineDayKey(event);
        return date >= input.startDate && date <= input.endDate;
      }),
  );
}

export function toTimelineSyncPayload(input: {
  userId: string;
  events: readonly TimelineProjectionEvent[];
  tombstones?: readonly TimelineTombstone[];
}): TimelineSyncPayload {
  return {
    schemaVersion: 1,
    userId: input.userId,
    events: stableTimelineOrder(input.events.map(projectTimelineEvent)).map((event) => {
      const envelope = event.envelope;
      return {
        eventId: event.eventId,
        revision: event.revision,
        fact: event.fact,
        envelope,
        ...(event.correctsEventId ? { correctsEventId: event.correctsEventId } : {}),
        ...(event.sourceMutationOfEventId ? { sourceMutationOfEventId: event.sourceMutationOfEventId } : {}),
        ...(event.tombstonesEventId ? { tombstonesEventId: event.tombstonesEventId } : {}),
      };
    }),
    tombstones: input.tombstones ?? [],
  };
}

export function selectPrimarySourceFacts(input: {
  events: readonly TimelineProjectionEvent[];
  metric: TimelineMetric;
  selector?: TimelineSourceSelector;
}): TimelineReadEvent[] {
  const candidates = stableTimelineOrder(
    input.events
      .filter((event) => (event.lifecycle ?? "active") === "active")
      .map(projectTimelineEvent)
      .filter((event) => supportsMetric(event, input.metric)),
  );
  const selector = input.selector;
  if (!selector) return candidates;
  return candidates.filter((event) => {
    const provenance = event.envelope?.provenance;
    const measurement = event.fact.kind === "body" ? event.fact.measurement : undefined;
    const algorithmVersion = provenance?.algorithmVersion ??
      (measurement?.metric === "body_fat_percentage" ? measurement.algorithmVersion : undefined);
    return provenance?.origin === selector.origin &&
      (!selector.deviceId || provenance?.deviceId === selector.deviceId) &&
      (!selector.recordingMethod || provenance?.recordingMethod === selector.recordingMethod) &&
      (!selector.method || measurement?.metric === "body_fat_percentage" && measurement.method === selector.method) &&
      (!selector.algorithmVersion || algorithmVersion === selector.algorithmVersion);
  });
}

function localDateAtOffset(iso: string, offsetMinutes: number): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso.slice(0, 10);
  return new Date(timestamp + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function supportsMetric(event: TimelineReadEvent, metric: TimelineMetric): boolean {
  if (metric === "sleep") return event.fact.kind === "sleep";
  if (metric === "body_weight" || metric === "body_fat_percentage") {
    return event.fact.kind === "body" && event.fact.measurement.metric === metric;
  }
  return event.fact.kind === "recovery" &&
    (metric === "hrv" ? event.fact.hrv !== undefined : event.fact.restingHeartRate !== undefined);
}

export function factHasNoCompletedClaim(fact: TimelineFact): boolean {
  // Plan / prediction artifacts have no TimelineFact variant. This guard is
  // intentionally explicit to make misuse visible at an API boundary.
  // clinical_context and subjective are user-reported experience facts: they
  // carry no completion claim either, and the fixed GoalPath safety rules
  // depend on their admission.
  return ["training", "activity", "nutrition", "sleep", "body", "recovery", "rest", "symptom", "schedule", "clinical_context", "subjective", "wellness_note"].includes(fact.kind);
}
