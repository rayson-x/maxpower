import assert from "node:assert/strict";
import test from "node:test";

import {
  addReviewRange,
  editReviewRange,
  reviewRangeGeometryEquals,
  restoreReviewRangeSnapshot,
  timelineTimeAt,
  unreviewedPeakRepIndexes,
} from "../../src/pose/reviewTimeline";

test("dragging a range creates a sorted rep and snaps its phase point to a candidate peak", () => {
  const result = addReviewRange({
    existing: [{ repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000 }],
    candidateSegments: [{ repIndex: 9, startMs: 2900, peakMs: 3650, endMs: 4400 }],
    anchorMs: 4500,
    focusMs: 3000,
    durationMs: 10_000,
  });

  assert.equal(result.status, "added");
  if (result.status !== "added") return;
  assert.deepEqual(result.segments, [
    { repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000 },
    { repIndex: 2, startMs: 3000, peakMs: 3650, endMs: 4500, peakSource: "algorithm_candidate" },
  ]);
});

test("ranges without a candidate expose midpoint provenance instead of claiming a human peak", () => {
  const result = addReviewRange({
    existing: [], candidateSegments: [], anchorMs: 1000, focusMs: 3000, durationMs: 5000,
  });

  assert.equal(result.status, "added");
  if (result.status !== "added") return;
  assert.deepEqual(result.added, {
    repIndex: 1, startMs: 1000, peakMs: 2000, endMs: 3000, peakSource: "range_midpoint",
  });
});

test("short clicks seek without adding and overlapping drags are rejected", () => {
  const short = addReviewRange({
    existing: [], candidateSegments: [], anchorMs: 1000, focusMs: 1100, durationMs: 5000,
  });
  assert.equal(short.status, "ignored");

  const overlap = addReviewRange({
    existing: [{ repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000 }],
    candidateSegments: [], anchorMs: 1800, focusMs: 2600, durationMs: 5000,
  });
  assert.equal(overlap.status, "rejected");
});

test("timeline pointer positions clamp to the video duration", () => {
  assert.equal(timelineTimeAt(150, 100, 200, 10_000), 2500);
  assert.equal(timelineTimeAt(20, 100, 200, 10_000), 0);
  assert.equal(timelineTimeAt(400, 100, 200, 10_000), 10_000);
});

test("selected ranges move and resize without crossing adjacent reps", () => {
  const segment = { repIndex: 2, startMs: 2000, peakMs: 2500, endMs: 3000, note: "力竭" };
  assert.deepEqual(editReviewRange({
    segment, mode: "move", pointerOriginMs: 2000, pointerMs: 6000,
    previousEndMs: 1500, nextStartMs: 4200,
  }), { repIndex: 2, startMs: 3200, peakMs: 3700, endMs: 4200, note: "力竭" });
  assert.deepEqual(editReviewRange({
    segment, mode: "resize-start", pointerOriginMs: 2000, pointerMs: 2800,
    previousEndMs: 1500, nextStartMs: 4200,
  }), {
    repIndex: 2, startMs: 2750, peakMs: 2750, endMs: 3000, note: "力竭",
    peakSource: "human_adjusted",
  });
  assert.deepEqual(editReviewRange({
    segment, mode: "resize-end", pointerOriginMs: 3000, pointerMs: 2200,
    previousEndMs: 1500, nextStartMs: 4200,
  }), {
    repIndex: 2, startMs: 2000, peakMs: 2250, endMs: 2250, note: "力竭",
    peakSource: "human_adjusted",
  });
  assert.deepEqual(editReviewRange({
    segment, mode: "move-peak", pointerOriginMs: 2500, pointerMs: 2875,
    previousEndMs: 1500, nextStartMs: 4200,
  }), {
    repIndex: 2, startMs: 2000, peakMs: 2875, endMs: 3000, note: "力竭",
    peakSource: "human_adjusted",
  });
});

test("undoing a geometry edit preserves a note typed after that edit", () => {
  const snapshot = [{ repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000 }];
  const current = [{ repIndex: 1, startMs: 1200, peakMs: 1700, endMs: 2200, note: "底部停顿" }];
  assert.deepEqual(restoreReviewRangeSnapshot(snapshot, current), [
    { repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000, note: "底部停顿" },
  ]);
});

test("numeric edit sessions detect geometry changes but ignore note-only changes", () => {
  const snapshot = [{ repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000, note: "原备注" }];

  assert.equal(reviewRangeGeometryEquals(snapshot, [
    { repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000, note: "新备注" },
  ]), true);
  assert.equal(reviewRangeGeometryEquals(snapshot, [
    { repIndex: 1, startMs: 1000, peakMs: 1600, endMs: 2000, note: "原备注" },
  ]), false);
  assert.equal(reviewRangeGeometryEquals(snapshot, []), false);
});

test("approval can identify every rep whose phase peak is not human-confirmed", () => {
  assert.deepEqual(unreviewedPeakRepIndexes([
    { repIndex: 1, startMs: 0, peakMs: 500, endMs: 1000, peakSource: "human_adjusted" },
    { repIndex: 2, startMs: 1000, peakMs: 1500, endMs: 2000, peakSource: "range_midpoint" },
    { repIndex: 3, startMs: 2000, peakMs: 2500, endMs: 3000 },
  ]), [2, 3]);
});
