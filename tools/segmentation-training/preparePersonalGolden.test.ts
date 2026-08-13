import assert from "node:assert/strict";
import test from "node:test";

import { mergePersonalApprovalExports } from "./preparePersonalGolden";

test("merges disjoint exports and applies a provenance-bearing correction", () => {
  const first = Buffer.from(JSON.stringify({
    version: "v1",
    exportedAt: "2026-08-03T00:00:00Z",
    drafts: {
      missing: {
        exerciseId: "",
        capturePosition: "right",
        expectedCount: "1",
        draftSegments: [{ repIndex: 1, startMs: 1, peakMs: 2, endMs: 3 }],
      },
    },
  }));
  const second = Buffer.from(JSON.stringify({
    version: "v2",
    exportedAt: "2026-08-08T00:00:00Z",
    approvals: {
      complete: {
        exerciseId: "bench_press",
        capturePosition: "front",
        expectedCount: "2",
        approvedSegments: [
          { repIndex: 1, startMs: 1, peakMs: 2, endMs: 3 },
          { repIndex: 2, startMs: 4, peakMs: 5, endMs: 6 },
        ],
      },
    },
  }));
  const correctionBytes = Buffer.from("correction");
  const output = mergePersonalApprovalExports(
    [
      { file: "/tmp/first.json", bytes: first, value: JSON.parse(first.toString()) },
      { file: "/tmp/second.json", bytes: second, value: JSON.parse(second.toString()) },
    ],
    "/tmp/corrections.json",
    correctionBytes,
    {
      schemaVersion: "test/v1",
      corrections: [{
        captureId: "missing",
        field: "exerciseId",
        from: "",
        to: "seated_row",
        reason: "manual review",
        evidence: { video: "missing.webm", reviewedTimestampsMs: [1] },
      }],
      consent: {
        consentId: "test",
        allowedUses: ["rep_counting"],
        forbiddenUses: ["upload"],
        evidence: "test",
      },
    },
  );

  assert.equal(output.drafts?.missing.exerciseId, "seated_row");
  assert.equal(output.summary.captureCount, 2);
  assert.equal(output.summary.setCountTruthTotal, 3);
  assert.equal(output.summary.perRepBoundaryCount, 3);
  assert.deepEqual(output.summary.peakProvenance, {
    human_adjusted: 0,
    algorithm_candidate: 0,
    range_midpoint: 0,
    legacy_unattributed: 3,
  });
  assert.equal(output.drafts?.missing.draftSegments[0]?.peakSource, "legacy_unattributed");
  assert.deepEqual(output.summary.annotationIssues, []);
  assert.equal(output.sourceExports.length, 2);
});

test("preserves group-count truth when one rep has no strong boundary", () => {
  const source = Buffer.from(JSON.stringify({
    version: "v1",
    exportedAt: "2026-08-03T00:00:00Z",
    drafts: {
      partial: {
        exerciseId: "barbell_row",
        capturePosition: "front",
        expectedCount: "2",
        draftSegments: [{ repIndex: 1, startMs: 1, peakMs: 2, endMs: 3 }],
      },
    },
  }));
  const output = mergePersonalApprovalExports(
    [{ file: "/tmp/source.json", bytes: source, value: JSON.parse(source.toString()) }],
    "/tmp/corrections.json",
    Buffer.from("{}"),
    {
      schemaVersion: "test/v1",
      corrections: [],
      consent: { consentId: "test", allowedUses: [], forbiddenUses: [], evidence: "test" },
    },
  );

  assert.equal(output.summary.setCountTruthTotal, 2);
  assert.equal(output.summary.perRepBoundaryCount, 1);
  assert.equal(output.summary.countOnlyRepCount, 1);
  assert.equal(output.summary.annotationIssues[0]?.captureId, "partial");
});

test("splits a multi-view source capture without losing or duplicating human reps", () => {
  const source = Buffer.from(JSON.stringify({
    version: "v1",
    exportedAt: "2026-08-03T00:00:00Z",
    drafts: {
      turning: {
        exerciseId: "single_arm_cable_lateral_raise",
        capturePosition: "front",
        expectedCount: "2",
        draftSegments: [
          { repIndex: 1, startMs: 10, peakMs: 20, endMs: 30 },
          { repIndex: 2, startMs: 70, peakMs: 80, endMs: 90 },
        ],
      },
    },
  }));
  const output = mergePersonalApprovalExports(
    [{ file: "/tmp/source.json", bytes: source, value: JSON.parse(source.toString()) }],
    "/tmp/corrections.json",
    Buffer.from("{}"),
    {
      schemaVersion: "test/v1",
      corrections: [],
      contextSplits: [{
        captureId: "turning",
        reason: "the athlete turns between unilateral blocks",
        windows: [
          { id: "front", capturePosition: "frontLeft45", startMs: 0, endMs: 50, expectedCount: 1, repIndexes: [1] },
          { id: "rear", capturePosition: "rearRight45", startMs: 50, endMs: 100, expectedCount: 1, repIndexes: [2] },
        ],
        evidence: { video: "turning.webm", reviewedTimestampsMs: [20, 60, 80] },
      }],
      consent: { consentId: "test", allowedUses: [], forbiddenUses: [], evidence: "test" },
    },
  );

  assert.equal(output.summary.captureCount, 1);
  assert.equal(output.summary.trainingSequenceCount, 2);
  assert.equal(output.summary.contextSplitCaptureCount, 1);
  assert.deepEqual(output.contextSplits[0]?.windows.map((window) => window.repIndexes), [[1], [2]]);
});
