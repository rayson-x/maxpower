import type { DomainActor, ImmutableEvidenceRef, TimelineFact } from "../coach/domain";

/** A source state is intentionally not a numerical health or training value. */
export type TimelineDataStatus =
  | "available"
  | "missing"
  | "permission_denied"
  | "not_supported"
  | "stale"
  | "partial"
  | "estimated"
  | "conflict";

export type TimelineOrigin =
  | "manual"
  | "healthkit"
  | "health_connect"
  | "smart_scale"
  | "wearable"
  | "canonical_motion_packet"
  | "import"
  | "professional_directive"
  | "system";

export type TimelinePrivacyClass = "private" | "sensitive" | "provider_authorized";

export type TimelineRecordingMethod =
  | "manual_entry"
  | "device_measurement"
  | "platform_import"
  | "canonical_packet"
  | "professional_entry"
  | "system_import";

export interface TimelineTimeRange {
  /** Original instant, never recomputed from the current device timezone. */
  startedAt: string;
  endedAt?: string;
  timezoneOffsetMinutes: number;
  /** Needed when a sleep/activity interval crosses a timezone boundary. */
  endedTimezoneOffsetMinutes?: number;
}

export interface TimelineProvenance {
  origin: TimelineOrigin;
  sourceRecordId?: string;
  sourceRevision?: string;
  /** Platform-origin metadata is evidence provenance, not an identity guess. */
  sourceAppId?: string;
  clientRecordId?: string;
  clientRecordVersion?: string;
  deviceId?: string;
  deviceManufacturer?: string;
  deviceModel?: string;
  deviceType?: string;
  sourceRecordingMethod?: string;
  /** Raw measurement semantics when the platform exposes them (for example, a sleep stage). */
  measurementMethod?: string;
  recordingMethod: TimelineRecordingMethod;
  /** Provider/model algorithm identity when a platform makes it available. */
  algorithmVersion?: string;
  lastModifiedAt?: string;
  dataStatus: TimelineDataStatus;
  /** `estimated` remains a separate data state; confidence describes evidence quality. */
  confidence: "confirmed" | "estimated" | "unknown";
}

/**
 * The immutable fact envelope. A correction/mutation creates a new envelope;
 * it never overwrites this one in the event log.
 */
export interface TimelineFactEnvelope {
  id: string;
  schemaVersion: 1;
  factType: TimelineFact["kind"];
  time: TimelineTimeRange;
  recordedAt: string;
  actor: DomainActor;
  provenance: TimelineProvenance;
  privacyClass: TimelinePrivacyClass;
  causalRefs: readonly string[];
  evidenceRefs: readonly ImmutableEvidenceRef[];
  layer: "raw_observation" | "canonical_projection";
  canonicalFromEventIds?: readonly string[];
  /** State is explicit instead of silently turning absent values into zero. */
  valueStatus?: TimelineDataStatus;
}

export interface TimelineCorrection {
  correctsEventId: string;
  reason: string;
  actor: DomainActor;
  recordedAt: string;
}

export interface TimelineSourceMutation {
  sourceEventId: string;
  reason: "source_updated" | "source_deleted" | "source_revoked";
  actor: DomainActor;
  recordedAt: string;
}

export type TimelineMetric = "sleep" | "hrv" | "resting_heart_rate" | "body_weight" | "body_fat_percentage";

export type PrimarySourcePreferences = Partial<Record<TimelineMetric, TimelineSourceSelector>>;

export interface TimelineSourceSelector {
  origin: TimelineOrigin;
  deviceId?: string;
  recordingMethod?: TimelineRecordingMethod;
  /** Body-fat is only comparable within this measurement identity. */
  method?: string;
  algorithmVersion?: string;
}

/**
 * A Health Connect adapter must explicitly declare support before accepting a
 * platform aggregate. The default preserves individual source observations.
 */
export function healthConnectAggregationMode(input: {
  metric: string;
  officialAggregateSupport: readonly string[];
}): "platform_aggregate" | "preserve_per_source" {
  return input.officialAggregateSupport.includes(input.metric)
    ? "platform_aggregate"
    : "preserve_per_source";
}

export interface TimelineAppendInput {
  timelineId: string;
  fact: TimelineFact;
  envelope: Omit<TimelineFactEnvelope, "id" | "schemaVersion" | "factType" | "recordedAt" | "actor"> & {
    id?: string;
  };
}

export interface TimelineActivityLog {
  date: string;
  timezoneOffsetMinutes: number;
  entries: readonly TimelineReadEvent[];
}

export interface TimelineReadEvent {
  eventId: string;
  revision: number;
  fact: TimelineFact;
  envelope: TimelineFactEnvelope;
  occurredAt: string;
  recordedAt: string;
  timezoneOffsetMinutes: number;
  correctsEventId?: string;
  sourceMutationOfEventId?: string;
  tombstonesEventId?: string;
  lifecycle: "active" | "superseded" | "tombstoned";
}

export interface TimelineExport {
  schemaVersion: 1;
  userId: string;
  exportedAt: string;
  events: readonly TimelineReadEvent[];
  tombstones: readonly TimelineTombstone[];
}

export interface TimelineTombstone {
  eventId: string;
  revision: number;
  sourceEventId: string;
  reason: "source_deleted" | "source_revoked";
  occurredAt: string;
  recordedAt: string;
}

export interface TimelineSyncPayload {
  schemaVersion: 1;
  userId: string;
  events: readonly {
    eventId: string;
    revision: number;
    fact: TimelineFact;
    envelope: TimelineFactEnvelope;
    correctsEventId?: string;
    sourceMutationOfEventId?: string;
    tombstonesEventId?: string;
  }[];
  tombstones: readonly TimelineTombstone[];
}

export function timelineSourceIdentity(envelope: TimelineFactEnvelope): string {
  const source = envelope.provenance;
  return [
    source.origin,
    source.sourceRecordId ?? "",
    source.deviceId ?? "",
    source.recordingMethod,
    envelope.factType,
    envelope.time.startedAt,
    envelope.time.endedAt ?? "",
  ].join("|");
}
