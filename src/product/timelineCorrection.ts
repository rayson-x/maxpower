import type { DomainActor, TimelineFact } from "../coach/domain";
import type {
  TimelineAppendInput,
  TimelineCorrection,
  TimelineFactEnvelope,
  TimelineReadEvent,
} from "../timeline";

/**
 * A small, product-facing translation for Timeline correction sheets.
 *
 * The sheet is allowed to construct a replacement value, but it is never
 * allowed to edit a projected Timeline row in place.  This function produces
 * only the public `CoachApplication.correctTimelineFact` payload; the
 * application remains responsible for CAS, an append-only CorrectionEvent,
 * stale artifacts and the Action Log.
 */
export interface TimelineCorrectionRequest {
  correction: TimelineCorrection;
  fact: TimelineFact;
  envelope: TimelineAppendInput["envelope"];
}

export function canCorrectTimelineEntry(entry: TimelineReadEvent): boolean {
  return entry.lifecycle === "active" && entry.envelope !== undefined;
}

export function buildTimelineCorrectionRequest(input: {
  entry: TimelineReadEvent;
  reason: string;
  actor: DomainActor;
  recordedAt: string;
  fact: TimelineFact;
}): TimelineCorrectionRequest {
  if (!input.reason.trim()) throw new Error("correction_reason_required");
  if (input.entry.lifecycle !== "active") throw new Error("timeline_correction_target_not_active");
  const originalEnvelope = input.entry.envelope;
  if (!originalEnvelope) throw new Error("timeline_correction_envelope_required");
  if (input.fact.kind !== input.entry.fact.kind) {
    throw new Error("timeline_correction_fact_kind_mismatch");
  }
  return {
    correction: {
      correctsEventId: input.entry.eventId,
      reason: input.reason.trim(),
      actor: input.actor,
      recordedAt: input.recordedAt,
    },
    fact: input.fact,
    envelope: correctionEnvelope(originalEnvelope, input.entry.eventId, input.fact),
  };
}

function correctionEnvelope(
  original: TimelineFactEnvelope,
  correctedEventId: string,
  fact: TimelineFact,
): TimelineAppendInput["envelope"] {
  return {
    time: { ...original.time },
    provenance: {
      origin: "manual",
      recordingMethod: "manual_entry",
      dataStatus: "available",
      confidence: fact.confidence,
    },
    privacyClass: original.privacyClass,
    causalRefs: uniqueRefs([...original.causalRefs, correctedEventId]),
    evidenceRefs: [],
    layer: "canonical_projection",
    valueStatus: "available",
  };
}

function uniqueRefs(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
