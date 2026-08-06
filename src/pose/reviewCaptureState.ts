export interface ReviewDraftSelection<TSegment> {
  readonly candidateId: string | null;
  readonly segments: readonly TSegment[];
}

export interface CaptureVideoResource {
  readonly videoUrl: string;
  readonly revokeVideoUrl: boolean;
}

export type ReviewBootstrapSource = "inbox" | "project";

/** Metadata can invalidate candidate provenance, but never the reviewed ranges. */
export function reviewDraftAfterContextChange<TSegment>(
  current: ReviewDraftSelection<TSegment>,
): ReviewDraftSelection<TSegment> {
  return {
    candidateId: current.segments.length > 0 ? "manual_range" : null,
    segments: current.segments,
  };
}

/** Returns revocable URLs owned only by `candidates`, preserving shared objects. */
export function revocableCaptureUrlsExcluding<TCapture extends CaptureVideoResource>(
  candidates: readonly TCapture[],
  retained: readonly TCapture[],
): string[] {
  const retainedCaptures = new Set(retained);
  return [...new Set(candidates
    .filter((capture) => capture.revokeVideoUrl && !retainedCaptures.has(capture))
    .map((capture) => capture.videoUrl))];
}

export function shouldSelectProcessedInboxCapture(input: {
  readonly foreground: boolean;
  readonly interactionRevisionAtStart: number;
  readonly currentInteractionRevision: number;
}): boolean {
  if (input.foreground) return true;
  return input.interactionRevisionAtStart === 0 && input.currentInteractionRevision === 0;
}

/** New, unreviewed footage owns the initial selection; archives merge afterwards. */
export function reviewBootstrapSourceOrder(input: {
  readonly hasInboxVideo: boolean;
  readonly hasProjectCaptures: boolean;
}): ReviewBootstrapSource[] {
  return [
    ...(input.hasInboxVideo ? ["inbox" as const] : []),
    ...(input.hasProjectCaptures ? ["project" as const] : []),
  ];
}
