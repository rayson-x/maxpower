import assert from "node:assert/strict";
import test from "node:test";

import type { PoseEstimate, PoseLandmark } from "../../src/pose/PoseEngine";
import {
  chooseSegmentationConfig,
  evaluateSegmentationConfig,
  reviewedNegativeWindows,
  validateSegmentationAnnotation,
} from "../../src/pose/segmentationTraining";
import type { RepSegmentationConfig } from "../../src/pose/repSegmenter";

test("annotation validation rejects missing labels, count mismatches, overlap, and invalid boundaries", () => {
  assert.deepEqual(validateSegmentationAnnotation({
    exerciseId: "",
    capturePosition: "front",
    expectedCount: "2",
    durationMs: 5000,
    segments: [
      { repIndex: 1, startMs: 500, peakMs: 900, endMs: 1500 },
      { repIndex: 2, startMs: 1400, peakMs: 1300, endMs: 6000 },
      { repIndex: 4, startMs: 4500, peakMs: 4600, endMs: 4700 },
    ],
  }), [
    "missing_exercise",
    "count_boundary_mismatch",
    "invalid_boundary_order_or_range",
    "overlapping_boundaries",
    "non_sequential_rep_index",
    "boundary_too_short",
  ]);
});

test("fully reviewed gaps become explicit negative windows", () => {
  assert.deepEqual(reviewedNegativeWindows(5000, [
    { repIndex: 1, startMs: 500, peakMs: 1000, endMs: 1500 },
    { repIndex: 2, startMs: 2000, peakMs: 2500, endMs: 3000 },
  ]), [
    { startMs: 0, endMs: 500 },
    { startMs: 1500, endMs: 2000 },
    { startMs: 3000, endMs: 5000 },
  ]);
});

test("calibration selects the configuration that reproduces complete annotated cycles", () => {
  const poses = sinePoses(4, 1000);
  const truth = Array.from({ length: 3 }, (_, index) => ({
    repIndex: index + 1,
    startMs: index * 1000 + 750,
    peakMs: index * 1000 + 1250,
    endMs: index * 1000 + 1750,
  }));
  const permissive: RepSegmentationConfig = {
    smoothingAlpha: 0.35,
    hysteresisRatio: 0.15,
    minRepMs: 500,
    maxRepMs: 2000,
    minCycleAmplitudeRatio: 0,
  };
  const impossible: RepSegmentationConfig = { ...permissive, minRepMs: 3000 };
  const result = chooseSegmentationConfig([{
    captureId: "capture-a",
    poses,
    truth,
    signal: "elbow_angle",
    effortExtreme: "min",
  }], [impossible, permissive]);
  assert.deepEqual(result.config, permissive);
  assert.ok(result.metrics.predictedCount > 0);
});

test("reviewed non-rep windows contribute explicit interference triggers", () => {
  const poses = sinePoses(3, 1000);
  const config: RepSegmentationConfig = {
    smoothingAlpha: 0.35,
    hysteresisRatio: 0.15,
    minRepMs: 500,
    maxRepMs: 2000,
    minCycleAmplitudeRatio: 0,
  };
  const metrics = evaluateSegmentationConfig([{
    captureId: "noise-only",
    poses,
    truth: [],
    signal: "elbow_angle",
    effortExtreme: "min",
    negativeWindows: [{ startMs: 0, endMs: 3000 }],
  }], config);
  assert.ok(metrics.predictedCount > 0);
  assert.equal(metrics.negativeWindowFalsePositives, metrics.predictedCount);
  assert.equal(metrics.rawNegativeWindowTriggers, metrics.predictedCount);
});

function sinePoses(cycles: number, periodMs: number): PoseEstimate[] {
  const poses: PoseEstimate[] = [];
  for (let timestampMs = 0; timestampMs <= cycles * periodMs; timestampMs += 50) {
    const phase = (timestampMs % periodMs) / periodMs;
    const angle = (90 + 60 * Math.sin(phase * 2 * Math.PI)) * Math.PI / 180;
    const landmarks = Array.from({ length: 33 }, () => point(0, 0));
    landmarks[11] = point(0, 0);
    landmarks[13] = point(1, 0);
    landmarks[15] = point(1 + Math.cos(angle), Math.sin(angle));
    landmarks[12] = point(0, 0);
    landmarks[14] = point(1, 0);
    landmarks[16] = point(1 + Math.cos(angle), Math.sin(angle));
    landmarks[23] = point(0, 1);
    landmarks[24] = point(0.2, 1);
    poses.push({ timestampMs, landmarks, worldLandmarks: landmarks });
  }
  return poses;
}

function point(x: number, y: number): PoseLandmark {
  return { x, y, z: 0, visibility: 1 };
}
