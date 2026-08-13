import assert from "node:assert/strict";
import test from "node:test";

import { assembleQualityReviewRelease } from "./buildQualityReviewRelease.js";

test("review release keeps human start/end separate from immutable Rust proposal", () => {
  const release = assembleQualityReviewRelease({
    releaseId: "release-a",
    frozenAt: "2026-08-13T10:30:00.000Z",
    fullDataRun: {
      runId: "full-a",
      runKind: "full_data_proposal",
      frozenDigest: "a".repeat(64),
      sources: [{
        sourceCaptureId: "source-a",
        videoRef: "chest/source-a.mp4",
        contexts: [{
          captureId: "context-a",
          actionId: "barbell_bench_press",
          capturePosition: "front",
          qualityProposals: [{ capability: "quality_supported" }],
          reviewProposal: {
            schemaVersion: "maxpower.motion-quality-proposal/v1",
            proposalHash: "b".repeat(64),
            lineage: { runKind: "full_data_proposal" },
            reps: [],
          },
        }],
      }],
    },
    records: [{
      captureId: "context-a",
      sourceCaptureId: "source-a",
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      expectedCount: 1,
      evaluationWindow: { startMs: 0, endMs: 2_000 },
      segments: [{ startMs: 500, peakMs: 1_000, endMs: 1_500 }],
      source: { video: "chest/source-a.mp4", durationMs: 2_000 },
    }],
    evidenceBySource: new Map([[
      "source-a",
      [{ timestampMs: 1_000, landmarks: [], equipment: [] }],
    ]]),
  });
  assert.equal(release.schemaVersion, "maxpower-motion-quality-review-release/v1");
  assert.match(release.releaseHash, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(release.items[0].humanSegments, [{ startMs: 500, endMs: 1_500 }]);
  assert.equal("peakMs" in release.items[0].humanSegments[0], false);
  assert.equal(release.items[0].proposal.proposalHash, "b".repeat(64));
  assert.equal(Object.isFrozen(release), true);
});
