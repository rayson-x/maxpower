import assert from "node:assert/strict";
import test from "node:test";

import { reviewDraftAfterContextChange } from "../../src/pose/reviewCaptureState";

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
