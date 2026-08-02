import assert from "node:assert/strict";
import test from "node:test";

import { createPoseContinuitySession } from "../../src/pose/canonicalPose";
import { buildCanonicalPosePresentation } from "../../src/pose/canonicalPosePresentation";

test("a renderable predicted elbow keeps both arm edges on canonical coordinates", () => {
  const session = createPoseContinuitySession({
    sequenceId: "video:arm-edge",
    schema: "blazepose33",
    image: {
      widthPx: 720,
      heightPx: 1280,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "legacy",
  });
  session.process({
    timestampMs: 1000,
    landmarks: [
      { x: 0.4, y: 0.4, z: 0, visibility: 0.95 },
      { x: 0.3, y: 0.5, z: 0, visibility: 0.9 },
      { x: 0.2, y: 0.6, z: 0, visibility: 0.9 },
    ],
    worldLandmarks: [],
  });
  const frame = session.process({
    timestampMs: 1050,
    landmarks: [
      { x: 0.4, y: 0.4, z: 0, visibility: 0.95 },
      { x: 0.3, y: 0.5, z: 0, visibility: 0.4 },
      { x: 0.2, y: 0.6, z: 0, visibility: 0.9 },
    ],
    worldLandmarks: [],
  });

  const presentation = buildCanonicalPosePresentation(frame, [
    [0, 1],
    [1, 2],
  ]);

  assert.equal(presentation.renderableLandmarks.size, 3);
  assert.equal(presentation.measuredLandmarks.size, 2);
  assert.equal(presentation.repairedLandmarks.size, 1);
  assert.equal(presentation.usableLandmarks.size, 2);
  assert.equal(presentation.edges.length, 2);
  assert.equal(presentation.edges[0].start, frame.landmarks[0]);
  assert.equal(presentation.edges[0].end, frame.landmarks[1]);
  assert.equal(presentation.edges[1].start, frame.landmarks[1]);
  assert.equal(presentation.edges[1].end, frame.landmarks[2]);
  assert.equal(presentation.edges[0].repaired, true);
  assert.equal(presentation.edges[1].repaired, true);
});
