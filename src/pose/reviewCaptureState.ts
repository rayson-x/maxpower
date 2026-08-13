export interface ReviewDraftSelection<TSegment> {
  readonly candidateId: string | null;
  readonly segments: readonly TSegment[];
}

export interface ManualReviewSegment {
  readonly repIndex: number;
  readonly startMs: number;
  readonly peakMs: number;
  readonly endMs: number;
}

export function buildManualReviewFixture(filename: string) {
  return {
    video: filename,
    durationSec: 0,
    stepMs: 0,
    model: "manual-video-review/v1",
    poses: [],
  };
}

export function manualReviewValidationError(input: {
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly expectedCount: string;
  readonly durationMs: number;
  readonly segments: readonly ManualReviewSegment[];
}): string | null {
  if (!input.exerciseId) return "请先确认本组动作。";
  if (!input.capturePosition) return "请确认实际八向机位。";
  const actualCount = Number(input.expectedCount);
  if (!Number.isInteger(actualCount) || actualCount <= 0) return "实际次数必须是大于 0 的整数。";
  if (actualCount !== input.segments.length) return `实际次数 ${actualCount} 与逐 rep 边界数 ${input.segments.length} 不一致。`;
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) return "视频时长尚未加载，不能批准本组真值。";
  let previousEnd = -Infinity;
  let previousRepIndex = 0;
  for (const segment of input.segments) {
    if (
      !Number.isInteger(segment.repIndex)
      || segment.repIndex <= previousRepIndex
      || ![segment.startMs, segment.peakMs, segment.endMs].every(Number.isFinite)
      || segment.startMs < 0
      || segment.startMs > segment.peakMs
      || segment.peakMs > segment.endMs
      || segment.endMs > input.durationMs
      || segment.startMs < previousEnd
    ) {
      return "逐 rep 边界必须按时间和 rep 编号严格递增，并落在录像范围内。";
    }
    previousEnd = segment.endMs;
    previousRepIndex = segment.repIndex;
  }
  return null;
}

export function adjacentReviewItem<TItem extends { readonly id: string }>(
  items: readonly TItem[],
  currentId: string | undefined,
  direction: -1 | 1,
): TItem | null {
  if (!currentId) return null;
  const currentIndex = items.findIndex((item) => item.id === currentId);
  if (currentIndex < 0) return null;
  return items[currentIndex + direction] ?? null;
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
