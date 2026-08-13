import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewedInboxArtifacts,
  parseAnnotationInboxManifest,
} from "../../src/pose/annotationInbox";

test("annotation page accepts only safe local inbox entries", () => {
  assert.deepEqual(parseAnnotationInboxManifest({
    version: "maxpower-annotation-inbox/v1",
    items: [{ id: "bench", filename: "bench.mp4", sizeBytes: 12, videoUrl: "/videos/bench.mp4" }],
  }).items[0], {
    id: "bench",
    filename: "bench.mp4",
    sizeBytes: 12,
    videoUrl: "/videos/bench.mp4",
  });
  assert.throws(() => parseAnnotationInboxManifest({
    version: "maxpower-annotation-inbox/v1",
    items: [{ id: "escape", filename: "../escape.mp4", sizeBytes: 1, videoUrl: "/videos/../escape.mp4" }],
  }), /安全/);
});

test("approved inbox video becomes an auditable archive triplet", () => {
  const artifacts = buildReviewedInboxArtifacts({
    filename: "bench.mp4",
    fixture: { video: "bench.mp4", durationSec: 2, stepMs: 40, model: "pose_landmarker_lite", poses: [] },
    approval: {
      exerciseId: "dumbbell_bench_press",
      cameraView: "side",
      capturePosition: "left",
      expectedCount: "1",
      approvedAt: "2026-08-06T00:00:00.000Z",
      approvedSegments: [{ repIndex: 1, startMs: 100, peakMs: 450, endMs: 900, note: "rack occlusion" }],
      candidateId: "manual_range",
      note: "one clean rep",
    },
  });

  assert.equal(artifacts.archiveGroup, "chest");
  assert.equal(artifacts.keypoints[0].video, "bench.mp4");
  assert.deepEqual(artifacts.labels.labels, [{
    repIndex: 1,
    startMs: 100,
    extremeMs: 450,
    endMs: 900,
    note: "rack occlusion",
  }]);
  assert.equal(artifacts.labels.exerciseId, "dumbbell_bench_press");
  assert.equal(artifacts.metadata.annotationStatus, "human_approved");

  assert.throws(() => buildReviewedInboxArtifacts({
    filename: "reviewed-profile.mp4",
    fixture: { video: "reviewed-profile.mp4", durationSec: 2, stepMs: 40, model: "pose", poses: [] },
    approval: {
      exerciseId: "lat_pulldown",
      cameraView: "front",
      capturePosition: "front",
      expectedCount: "1",
      approvedAt: "2026-08-06T00:00:00.000Z",
      approvedSegments: [{ repIndex: 1, startMs: 0, peakMs: 400, endMs: 800 }],
      candidateId: "manual_range",
    },
  }), /尚无 Rust profile/);
});
