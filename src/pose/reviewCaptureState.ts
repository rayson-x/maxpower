export interface ReviewDraftSelection<TSegment> {
  readonly candidateId: string | null;
  readonly segments: readonly TSegment[];
}

/** Metadata can invalidate candidate provenance, but never the reviewed ranges. */
export function reviewDraftAfterContextChange<TSegment>(
  current: ReviewDraftSelection<TSegment>,
): ReviewDraftSelection<TSegment> {
  return {
    candidateId: current.segments.length > 0 ? "manual_range" : null,
    segments: current.segments,
  };
}
