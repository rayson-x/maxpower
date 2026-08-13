export interface ReviewTimelineSegment {
  repIndex: number;
  startMs: number;
  peakMs: number;
  endMs: number;
  note?: string;
  peakSource?: ReviewPeakSource;
}

export type ReviewPeakSource = "human_adjusted" | "algorithm_candidate" | "range_midpoint" | "legacy_unattributed";

export type AddReviewRangeResult =
  | { status: "added"; segments: ReviewTimelineSegment[]; added: ReviewTimelineSegment }
  | { status: "ignored"; reason: string }
  | { status: "rejected"; reason: string };

const MIN_RANGE_MS = 250;
export type ReviewRangeEditMode = "move" | "resize-start" | "move-peak" | "resize-end";

/**
 * Builds one human rep annotation from a drag range. The phase point snaps to
 * the closest candidate peak inside the selected interval, otherwise it uses
 * the midpoint. Existing ranges remain authoritative and may not overlap.
 */
export function addReviewRange(input: {
  existing: readonly ReviewTimelineSegment[];
  candidateSegments: readonly ReviewTimelineSegment[];
  anchorMs: number;
  focusMs: number;
  durationMs: number;
}): AddReviewRangeResult {
  const durationMs = Math.max(0, input.durationMs);
  const startMs = Math.round(clamp(Math.min(input.anchorMs, input.focusMs), 0, durationMs));
  const endMs = Math.round(clamp(Math.max(input.anchorMs, input.focusMs), 0, durationMs));
  if (endMs - startMs < MIN_RANGE_MS) {
    return { status: "ignored", reason: "短按只用于跳转；拖动至少 0.25 秒才会新增 rep。" };
  }
  if (input.existing.some((segment) => startMs < segment.endMs && endMs > segment.startMs)) {
    return { status: "rejected", reason: "新范围与已有 rep 重叠；请先移除旧范围或重新拖选。" };
  }

  const midpointMs = (startMs + endMs) / 2;
  const candidatePeak = input.candidateSegments
    .map((segment) => segment.peakMs)
    .filter((peakMs) => peakMs >= startMs && peakMs <= endMs)
    .sort((left, right) => Math.abs(left - midpointMs) - Math.abs(right - midpointMs))[0];
  const pending: ReviewTimelineSegment = {
    repIndex: 0,
    startMs,
    peakMs: Math.round(candidatePeak ?? midpointMs),
    endMs,
    peakSource: candidatePeak === undefined ? "range_midpoint" : "algorithm_candidate",
  };
  const segments = [...input.existing.map((segment) => ({ ...segment })), pending]
    .sort((left, right) => left.startMs - right.startMs)
    .map((segment, index) => ({ ...segment, repIndex: index + 1 }));
  const added = segments.find((segment) =>
    segment.startMs === pending.startMs && segment.endMs === pending.endMs,
  )!;
  return { status: "added", segments, added };
}

export function timelineTimeAt(clientX: number, left: number, width: number, durationMs: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.round(clamp((clientX - left) / width, 0, 1) * Math.max(0, durationMs));
}

/**
 * Restores timeline geometry without discarding notes typed after the edit.
 * Count-changing operations (add/remove/clear) restore their complete snapshot.
 */
export function restoreReviewRangeSnapshot(
  snapshot: readonly ReviewTimelineSegment[],
  current: readonly ReviewTimelineSegment[],
): ReviewTimelineSegment[] {
  if (snapshot.length !== current.length) return snapshot.map((segment) => ({ ...segment }));
  return snapshot.map((segment) => {
    const currentSegment = current.find((item) => item.repIndex === segment.repIndex);
    return currentSegment?.note === undefined ? { ...segment } : { ...segment, note: currentSegment.note };
  });
}

/** Compares only undoable timeline geometry; notes are edited independently. */
export function reviewRangeGeometryEquals(
  left: readonly ReviewTimelineSegment[],
  right: readonly ReviewTimelineSegment[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((segment) => {
    const other = right.find((candidate) => candidate.repIndex === segment.repIndex);
    return other?.startMs === segment.startMs
      && other.peakMs === segment.peakMs
      && other.endMs === segment.endMs;
  });
}

export function unreviewedPeakRepIndexes(
  segments: readonly ReviewTimelineSegment[],
): number[] {
  return segments
    .filter((segment) => segment.peakSource !== "human_adjusted")
    .map((segment) => segment.repIndex);
}

/** Moves or resizes one range while keeping it between adjacent annotations. */
export function editReviewRange(input: {
  segment: ReviewTimelineSegment;
  mode: ReviewRangeEditMode;
  pointerMs: number;
  pointerOriginMs: number;
  previousEndMs: number;
  nextStartMs: number;
}): ReviewTimelineSegment {
  const original = input.segment;
  if (input.mode === "move") {
    const duration = original.endMs - original.startMs;
    const desiredStart = original.startMs + input.pointerMs - input.pointerOriginMs;
    const startMs = Math.round(clamp(desiredStart, input.previousEndMs, input.nextStartMs - duration));
    const delta = startMs - original.startMs;
    return { ...original, startMs, peakMs: original.peakMs + delta, endMs: original.endMs + delta };
  }
  if (input.mode === "move-peak") {
    return {
      ...original,
      peakMs: Math.round(clamp(input.pointerMs, original.startMs, original.endMs)),
      peakSource: "human_adjusted",
    };
  }
  if (input.mode === "resize-start") {
    const startMs = Math.round(clamp(input.pointerMs, input.previousEndMs, original.endMs - MIN_RANGE_MS));
    const peakMs = Math.max(startMs, original.peakMs);
    return {
      ...original,
      startMs,
      peakMs,
      ...(peakMs === original.peakMs ? {} : { peakSource: "human_adjusted" as const }),
    };
  }
  const endMs = Math.round(clamp(input.pointerMs, original.startMs + MIN_RANGE_MS, input.nextStartMs));
  const peakMs = Math.min(endMs, original.peakMs);
  return {
    ...original,
    peakMs,
    endMs,
    ...(peakMs === original.peakMs ? {} : { peakSource: "human_adjusted" as const }),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
