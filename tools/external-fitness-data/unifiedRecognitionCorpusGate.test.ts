import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnifiedRecognitionCorpusReport,
  parseUnifiedRecognitionCorpusGateArgs,
} from "./unifiedRecognitionCorpusGate";

const mmfitRows = Array.from({ length: 616 }, (_, index) => ({
  sourceSequenceId: `mmfit-${index}`,
  split: index < 500 ? "train" : "unseen_test",
  exerciseId: "bodyweight_squat",
  expectedCount: 10,
  predictedCount: 10,
  status: "evaluated",
}));

const approvedRows = Array.from({ length: 11 }, (_, index) => ({
  captureId: `approved-${index}`,
  truthCount: 5,
  predictedCount: 5,
  matchedCount: 5,
  falsePositiveCount: 0,
  exact: true,
}));

test("unified gate requires all 616 MM-Fit sets and all 11 phase-annotated captures", () => {
  const report = buildUnifiedRecognitionCorpusReport({
    summary: { clipCount: 616, truthRepCount: 6160, predictedRepCount: 6160, exactCountRatio: 1 },
    bySplit: {},
    rows: mmfitRows,
  }, {
    summary: {
      captureCount: 11,
      exactCaptureCount: 11,
      truthRepCount: 55,
      predictedRepCount: 55,
      matchedRepCount: 55,
    },
    buckets: [{ key: "bodyweight_squat|front", status: "evaluated", rows: approvedRows }],
  });
  assert.equal(report.aggregate.totalSampleCount, 627);
  assert.equal(report.passed, true);
});

test("matching totals cannot hide a missed and fabricated rep in approved video", () => {
  const corrupted = approvedRows.map((row, index) => index === 0
    ? { ...row, matchedCount: 4, falsePositiveCount: 1 }
    : row);
  const report = buildUnifiedRecognitionCorpusReport({
    summary: { clipCount: 616, truthRepCount: 6160, predictedRepCount: 6160, exactCountRatio: 1 },
    bySplit: {},
    rows: mmfitRows,
  }, {
    summary: {
      captureCount: 11,
      exactCaptureCount: 11,
      truthRepCount: 55,
      predictedRepCount: 55,
      matchedRepCount: 54,
    },
    buckets: [{ key: "bodyweight_squat|front", status: "evaluated", rows: corrupted }],
  });
  assert.equal(report.aggregate.exactSampleCount, 627);
  assert.equal(report.aggregate.approvedPhaseExactCaptureCount, 10);
  assert.equal(report.passed, false);
});

test("--enforce is a flag and never replaces the first input path", () => {
  assert.deepEqual(parseUnifiedRecognitionCorpusGateArgs(["--enforce"]), {
    mmfitPath: "docs/reports/mmfit-candidate-profile-benchmark-2026-08-09.json",
    approvedPath: "docs/reports/existing-video-profile-tuning-2026-08-09.json",
    outputPath: "docs/reports/unified-recognition-corpus-gate-2026-08-09.json",
    enforce: true,
  });
  assert.deepEqual(parseUnifiedRecognitionCorpusGateArgs([
    "mmfit.json",
    "--enforce",
    "approved.json",
    "gate.json",
  ]), {
    mmfitPath: "mmfit.json",
    approvedPath: "approved.json",
    outputPath: "gate.json",
    enforce: true,
  });
});
