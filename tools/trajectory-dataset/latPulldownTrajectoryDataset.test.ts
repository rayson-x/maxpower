import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApprovedLatPulldownTrajectorySample,
} from "../../src/pose/trajectoryDataset";
import type { PoseEstimate } from "../../src/pose/PoseEngine";

function pose(timestampMs: number, wristY: number): PoseEstimate {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  landmarks[11] = { x: 0.4, y: 0.4, z: 0, visibility: 1 };
  landmarks[12] = { x: 0.6, y: 0.4, z: 0, visibility: 1 };
  landmarks[13] = { x: 0.37, y: (0.4 + wristY) / 2, z: 0, visibility: 1 };
  landmarks[14] = { x: 0.63, y: (0.4 + wristY) / 2, z: 0, visibility: 1 };
  landmarks[15] = { x: 0.35, y: wristY, z: 0, visibility: 1 };
  landmarks[16] = { x: 0.65, y: wristY, z: 0, visibility: 1 };
  landmarks[23] = { x: 0.43, y: 0.7, z: 0, visibility: 1 };
  landmarks[24] = { x: 0.57, y: 0.7, z: 0, visibility: 1 };
  return { timestampMs, landmarks, worldLandmarks: [] };
}

const segments = [
  { repIndex: 1, startMs: 0, peakMs: 400, endMs: 800 },
  { repIndex: 2, startMs: 800, peakMs: 1200, endMs: 1600 },
];

test("approved lat pulldown exports normalized multi-joint trajectories per rep", () => {
  const result = buildApprovedLatPulldownTrajectorySample({
    captureId: "capture-001",
    exerciseId: "lat_pulldown",
    cameraView: "front",
    capturePosition: "front",
    approvedAt: "2026-08-03T00:00:00.000Z",
    expectedCount: "2",
    approvedSegments: segments,
    poses: [
      pose(0, 0.2), pose(200, 0.3), pose(400, 0.6), pose(600, 0.3), pose(800, 0.2),
      pose(1000, 0.3), pose(1200, 0.6), pose(1400, 0.3), pose(1600, 0.2),
    ],
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.sample.exerciseId, "lat_pulldown");
  assert.equal(result.sample.intendedUse, "rep_segmentation_observation");
  assert.equal(result.sample.formReference, "not_labeled");
  assert.equal(result.sample.reps.length, 2);
  assert.equal(result.sample.reps[0].frames.length, 32);
  assert.equal(result.sample.reps[0].frames[0].length, result.sample.featureNames.length);
  assert.equal(result.sample.quality.eligibleForSegmentationTraining, true);
  assert.equal(result.sample.source.capturePosition, "front");
  assert.equal(result.sample.source.coordinateSystem, "source-image/v1");
  // The first feature is left wrist height relative to shoulder and must reflect the pull phase.
  const start = result.sample.reps[0].frames[0][0];
  const midpoint = result.sample.reps[0].frames[16][0];
  assert.equal(typeof start, "number");
  assert.equal(typeof midpoint, "number");
  assert.ok((midpoint as number) > (start as number));
});

test("a count that disagrees with approved boundaries is kept out of the trajectory database", () => {
  const result = buildApprovedLatPulldownTrajectorySample({
    captureId: "capture-001",
    exerciseId: "lat_pulldown",
    cameraView: "front",
    capturePosition: "front",
    approvedAt: "2026-08-03T00:00:00.000Z",
    expectedCount: "8",
    approvedSegments: segments,
    poses: [pose(0, 0.2), pose(400, 0.6), pose(800, 0.2), pose(1200, 0.6), pose(1600, 0.2)],
  });

  assert.deepEqual(result, {
    status: "rejected",
    reason: "人工次数 8 与批准边界数 2 不一致；请先选择或修正 rep 边界。",
  });
});

test("invalid approved boundaries cannot become a trajectory sample", () => {
  const result = buildApprovedLatPulldownTrajectorySample({
    captureId: "capture-001",
    exerciseId: "lat_pulldown",
    cameraView: "front",
    capturePosition: "front",
    approvedAt: "2026-08-03T00:00:00.000Z",
    expectedCount: "1",
    approvedSegments: [{ repIndex: 1, startMs: 500, peakMs: 400, endMs: 800 }],
    poses: [pose(0, 0.2), pose(400, 0.6), pose(800, 0.2)],
  });

  assert.deepEqual(result, {
    status: "rejected",
    reason: "批准边界未按时间顺序落在关键点录像范围内。",
  });
});

test("sparse source poses cannot be upsampled into an eligible trajectory", () => {
  const result = buildApprovedLatPulldownTrajectorySample({
    captureId: "capture-sparse",
    exerciseId: "lat_pulldown",
    cameraView: "front",
    capturePosition: "front",
    approvedAt: "2026-08-03T00:00:00.000Z",
    expectedCount: "1",
    approvedSegments: [{ repIndex: 1, startMs: 0, peakMs: 800, endMs: 1600 }],
    poses: [pose(0, 0.2), pose(1600, 0.2)],
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.sample.quality.eligibleForSegmentationTraining, false);
  assert.ok(result.sample.reps[0].featureCoverage < 0.8);
});

test("degenerate arm geometry is quarantined instead of serializing NaN features", () => {
  const collapsed = (timestampMs: number): PoseEstimate => {
    const frame = pose(timestampMs, 0.4);
    frame.landmarks[13] = { ...frame.landmarks[11] };
    frame.landmarks[14] = { ...frame.landmarks[12] };
    frame.landmarks[15] = { ...frame.landmarks[11] };
    frame.landmarks[16] = { ...frame.landmarks[12] };
    return frame;
  };
  const result = buildApprovedLatPulldownTrajectorySample({
    captureId: "capture-degenerate",
    exerciseId: "lat_pulldown",
    cameraView: "front",
    capturePosition: "front",
    approvedAt: "2026-08-03T00:00:00.000Z",
    expectedCount: "1",
    approvedSegments: [{ repIndex: 1, startMs: 0, peakMs: 100, endMs: 200 }],
    poses: [collapsed(0), collapsed(100), collapsed(200)],
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.sample.quality.eligibleForSegmentationTraining, false);
  assert.equal(result.sample.reps[0].featureCoverage, 0);
  assert.ok(result.sample.reps[0].frames.every((frame) => frame.every((value) => value === null)));
});

test("a trajectory without its physical capture position is kept out of angle-specific training", () => {
  const result = buildApprovedLatPulldownTrajectorySample({
    captureId: "capture-unplaced",
    exerciseId: "lat_pulldown",
    cameraView: "front",
    approvedAt: "2026-08-03T00:00:00.000Z",
    expectedCount: "1",
    approvedSegments: [{ repIndex: 1, startMs: 0, peakMs: 400, endMs: 800 }],
    poses: [pose(0, 0.2), pose(200, 0.3), pose(400, 0.6), pose(600, 0.3), pose(800, 0.2)],
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.sample.quality.eligibleForSegmentationTraining, false);
  assert.match(result.sample.quality.reason ?? "", /实体机位/);
});

test("a missing pull-to-bottom peak is quarantined even when total coverage stays high", () => {
  const result = buildApprovedLatPulldownTrajectorySample({
    captureId: "capture-missing-peak",
    exerciseId: "lat_pulldown",
    cameraView: "front",
    capturePosition: "front",
    approvedAt: "2026-08-03T00:00:00.000Z",
    expectedCount: "1",
    approvedSegments: [{ repIndex: 1, startMs: 0, peakMs: 400, endMs: 800 }],
    // Resampling points are close enough to a frame except the critical peak.
    poses: [pose(0, 0.2), pose(200, 0.3), pose(600, 0.3), pose(800, 0.2)],
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.ok(result.sample.reps[0].featureCoverage >= 0.8);
  assert.equal(result.sample.reps[0].peakFeatureAvailable, false);
  assert.equal(result.sample.quality.eligibleForSegmentationTraining, false);
  assert.match(result.sample.quality.reason ?? "", /峰值/);
});

test("a malformed sidecar capture position is quarantined rather than exported as a new angle bucket", () => {
  const result = buildApprovedLatPulldownTrajectorySample({
    captureId: "capture-malformed-position",
    exerciseId: "lat_pulldown",
    cameraView: "front",
    capturePosition: "untrusted-angle" as never,
    approvedAt: "2026-08-03T00:00:00.000Z",
    expectedCount: "1",
    approvedSegments: [{ repIndex: 1, startMs: 0, peakMs: 400, endMs: 800 }],
    poses: [pose(0, 0.2), pose(200, 0.3), pose(400, 0.6), pose(600, 0.3), pose(800, 0.2)],
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.sample.source.capturePosition, null);
  assert.equal(result.sample.quality.eligibleForSegmentationTraining, false);
});
