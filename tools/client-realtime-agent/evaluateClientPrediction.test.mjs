import assert from "node:assert/strict";
import test from "node:test";

import { aggregateRows, evaluateSegments } from "./evaluateClientPrediction.mjs";

const tolerance = {
  startEndToleranceMs: 500,
  peakToleranceMs: 250,
  minimumIntervalIoU: 0.6,
};

test("legacy midpoint is not treated as phase truth", () => {
  const result = evaluateSegments(
    [{ startMs: 1_000, peakMs: null, endMs: 3_000, legacyMidpointMs: 2_000 }],
    [{ startMs: 1_100, peakMs: 2_800, endMs: 3_100 }],
    tolerance,
  );
  assert.equal(result.rangeAlignedCount, 1);
  assert.equal(result.peakTruthCount, 0);
  assert.equal(result.matches[0].peakOffsetMs, null);
  assert.equal(result.matches[0].peakWithinTolerance, null);
  assert.equal(result.matches[0].fullyAligned, null);
});

test("human-confirmed turnaround is scored independently from the manual range", () => {
  const result = evaluateSegments(
    [{ startMs: 1_000, peakMs: 2_000, endMs: 3_000 }],
    [{ startMs: 1_100, peakMs: 2_400, endMs: 3_100 }],
    tolerance,
  );
  assert.equal(result.rangeAlignedCount, 1);
  assert.equal(result.peakTruthCount, 1);
  assert.equal(result.matches[0].peakWithinTolerance, false);
  assert.equal(result.matches[0].fullyAligned, false);
});

test("aggregate keeps confirmed and needs-review recognition lanes separate", () => {
  const emptyRuntime = { effectiveObservationFps: 15, maximumInferenceMs: 10, emptyCandidateFrames: 0 };
  const evaluation = (predicted, matched) => ({
    predictedSegments: Array.from({ length: predicted }, () => ({})),
    matchedCount: matched,
    rangeAlignedCount: matched,
    peakTruthCount: 1,
    fullyAlignedCount: matched,
    startWithinToleranceCount: matched,
    peakWithinToleranceCount: matched,
    endWithinToleranceCount: matched,
    exactCount: predicted === 1,
  });
  const rows = [{
    truthSegments: [{}],
    clientRuntime: emptyRuntime,
    confirmedEvaluation: evaluation(0, 0),
    reviewableEvaluation: evaluation(1, 1),
  }];
  assert.equal(aggregateRows(rows, "confirmedEvaluation").candidateRecall, 0);
  assert.equal(aggregateRows(rows, "reviewableEvaluation").candidateRecall, 1);
});
