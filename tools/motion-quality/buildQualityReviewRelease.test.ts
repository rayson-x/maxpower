import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { assembleQualityReviewRelease } from "./buildQualityReviewRelease.js";

test("review release keeps human start/end separate from immutable Rust proposal", () => {
  const evidence = {
    schemaVersion: "maxpower-current-rust-context-evidence/v1" as const,
    packetSchema: "MOTN/1.8+QLT1",
    producer: "current_rust_single_pass" as const,
    frames: [{
      timestampMs: 1_000,
      landmarks: [],
      equipment: [{ centerX: 0.5, centerY: 0.4, source: "geometry" }],
    }],
  };
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
          currentRustEvidence: {
            ...evidence,
            evidenceHash: sha256(stableStringify(evidence)),
          },
        }],
      }],
    },
    frozenEvaluationRun: frozenEvaluationRun(),
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
  });
  assert.equal(release.schemaVersion, "maxpower-motion-quality-review-release/v1");
  assert.match(release.releaseHash, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(release.items[0].humanSegments, [{ startMs: 500, endMs: 1_500 }]);
  assert.equal("peakMs" in release.items[0].humanSegments[0], false);
  assert.equal(release.items[0].proposal.proposalHash, "b".repeat(64));
  assert.equal(release.items[0].evidence.source, "current_rust_single_pass");
  assert.equal(release.items[0].evidence.equipmentTrajectories[0].points[0].y, 0.4);
  assert.deepEqual(
    release.evidenceRuns.benchmark.frozenPredictions,
    frozenEvaluationRun(),
  );
  assert.equal(release.evidenceRuns.benchmark.acceptanceEligible, false);
  assert.equal(release.evidenceRuns.benchmark.truthStatus, "withheld_from_inference");
  assert.equal(release.evidenceRuns.calibration.runKind, "full_data_proposal");
  assert.equal(release.items[0].evidenceLinks.benchmarkContextId, "context-a");
  assert.equal(Object.isFrozen(release), true);
});

function frozenEvaluationRun() {
  const semantic = {
    schemaVersion: "maxpower-motion-quality-frozen-predictions/v1" as const,
    state: "frozen_before_truth" as const,
    runId: "benchmark-a",
    runKind: "touched_benchmark",
    planDigest: "c".repeat(64),
    contexts: [{
      runKind: "touched_benchmark",
      sourceCaptureId: "source-a",
      contextId: "context-a",
      processing: {
        chronologicalMonotonic: true as const,
        singlePass: true as const,
        sourceTimestampsMs: [0, 1_000, 2_000],
      },
      packetHash: "d".repeat(64),
      proposalHash: "e".repeat(64),
      versions: {
        visualModel: "rtmpose-halpe26",
        rustEngine: "motion-sdk",
        packetSchema: "MOTN/1.8+QLT1",
        profileBundle: "bench-v1",
        rulePack: "quality-v1",
      },
      reps: [{
        repId: "rep-1",
        startTimestampMs: 500,
        turnaroundTimestampMs: 1_000,
        endTimestampMs: 1_500,
        disposition: "confirmed",
      }],
      qualityConclusions: [],
      actionId: "barbell_bench_press",
      capturePosition: "front",
      capability: "quality_supported",
      bundleHash: "f".repeat(64),
    }],
  };
  return {
    ...semantic,
    frozenDigest: sha256(stableStringify(semantic)),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
