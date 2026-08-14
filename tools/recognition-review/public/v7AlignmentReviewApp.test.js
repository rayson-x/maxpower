const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const {
  normalizeReport,
  frameAt,
  rangeAt,
  predictionMatchMap,
  rowProblem,
  formatPercent,
} = require("./v7AlignmentReviewApp.js");

test("v7 alignment page is independent from the quality annotation desk", () => {
  const html = readFileSync("tools/recognition-review/public/v7-alignment-review.html", "utf8");
  assert.match(html, /data-v7-alignment-review/u);
  assert.match(html, /人工标注 × v7 预测/u);
  assert.match(html, /不会在浏览器内伪造或重算/u);
  assert.match(html, /v7AlignmentReviewApp\.js/u);
  assert.doesNotMatch(html, /qualityReviewApp\.js/u);
});

test("normalization preserves frozen matches and rejects duplicate contexts", () => {
  const report = normalizeReport(fixtureReport());
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].truthRanges.length, 2);
  assert.equal(report.rows[0].predictedReps.length, 2);
  assert.equal(predictionMatchMap(report.rows[0]).get(0).strictBoundaryAligned, true);
  assert.equal(rowProblem(report.rows[0]), true);
  assert.equal(formatPercent(0.871264), "87.1%");

  const duplicate = fixtureReport();
  duplicate.rows.push({ ...duplicate.rows[0] });
  assert.throws(() => normalizeReport(duplicate), /重复 contextId/u);
});

test("frame and Rep lookup use source timestamps without inventing observations", () => {
  const frames = [
    { timestampMs: 100, frameNumber: 1 },
    { timestampMs: 200, frameNumber: 2 },
    { timestampMs: 300, frameNumber: 3 },
  ];
  assert.equal(frameAt(frames, 245, 60).frameNumber, 2);
  assert.equal(frameAt(frames, 500, 60), null);
  assert.equal(rangeAt([{ startMs: 1_000, endMs: 2_000 }], 1_500).index, 0);
  assert.equal(rangeAt([{ startMs: 1_000, endMs: 2_000 }], 900), null);
});

function fixtureReport() {
  return {
    schemaVersion: "maxpower-current-rust-known-video-alignment/v1",
    reportDigest: "a".repeat(64),
    predictionSha256: "b".repeat(64),
    aggregate: {
      candidatePrecision: 0.8,
      candidateRecall: 0.5,
      strictBoundaryAlignedRate: 0.5,
      exactSetRate: 0,
    },
    rows: [{
      sourceCaptureId: "capture-a",
      contextId: "capture-a:lateral_raise:front",
      exerciseId: "lateral_raise",
      capturePosition: "front",
      videoUrl: "/media/v7-alignment?id=capture-a",
      poseUrl: "/api/review/v7-pose?id=capture-a",
      durationMs: 5_000,
      truthRanges: [
        { startMs: 1_000, endMs: 2_000 },
        { startMs: 2_500, endMs: 3_500 },
      ],
      predictedReps: [
        { repId: 1, startMs: 1_050, turnaroundMs: 1_500, endMs: 2_050, disposition: "confirmed" },
        { repId: 2, startMs: 3_800, turnaroundMs: 4_000, endMs: 4_200, disposition: "needs_review" },
      ],
      matches: [{
        truthIndex: 0,
        predictedIndex: 0,
        startErrorMs: 50,
        endErrorMs: 50,
        intervalIou: 0.9,
        strictBoundaryAligned: true,
      }],
      truthCount: 2,
      predictedCount: 2,
      matchedCount: 1,
      missedCount: 1,
      falsePositiveCount: 1,
      exactSet: true,
      qualityFindingStates: ["TaskCompletion/ObservedAcceptable"],
      bundleId: "bundle-a",
      bundleHash: "c".repeat(64),
      traceRootCount: 8,
      traceContentHash: "d".repeat(16),
    }],
  };
}
