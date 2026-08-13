import assert from "node:assert/strict";
import test from "node:test";

import {
  adjacentReviewItem,
  buildManualReviewFixture,
  manualReviewValidationError,
  reviewDraftAfterContextChange,
} from "../../src/pose/reviewCaptureState";

test("changing exercise or capture position preserves reviewed rep ranges", () => {
  const segments = [
    { repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000, note: "底部停顿" },
    { repIndex: 2, startMs: 2500, peakMs: 3000, endMs: 3500 },
  ];

  assert.deepEqual(reviewDraftAfterContextChange({
    candidateId: "auto",
    segments,
  }), {
    candidateId: "manual_range",
    segments,
  });
  assert.deepEqual(reviewDraftAfterContextChange({
    candidateId: "auto",
    segments: [],
  }), {
    candidateId: null,
    segments: [],
  });
});

test("adjacent review navigation follows the complete inbox order", () => {
  const items = [
    { id: "20260808_090000" },
    { id: "20260808_100000" },
    { id: "20260808_110000" },
  ];

  assert.equal(adjacentReviewItem(items, items[0].id, 1), items[1]);
  assert.equal(adjacentReviewItem(items, items[1].id, -1), items[0]);
  assert.equal(adjacentReviewItem(items, items[0].id, -1), null);
  assert.equal(adjacentReviewItem(items, items[2].id, 1), null);
});

test("manual inbox review uses video time without requiring pose extraction", () => {
  assert.deepEqual(buildManualReviewFixture("bench.mp4"), {
    video: "bench.mp4",
    durationSec: 0,
    stepMs: 0,
    model: "manual-video-review/v1",
    poses: [],
  });

  assert.equal(manualReviewValidationError({
    exerciseId: "barbell_bench_press",
    capturePosition: "left",
    expectedCount: "1",
    durationMs: 2_000,
    segments: [{ repIndex: 1, startMs: 100, peakMs: 500, endMs: 900 }],
  }), null);
  assert.match(manualReviewValidationError({
    exerciseId: "barbell_bench_press",
    capturePosition: "left",
    expectedCount: "1",
    durationMs: 800,
    segments: [{ repIndex: 1, startMs: 100, peakMs: 500, endMs: 900 }],
  }) ?? "", /录像范围/);
});
