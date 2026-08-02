import assert from "node:assert/strict";
import test from "node:test";

import {
  createPoseContinuityDiagnostic,
  createPoseContinuitySession,
} from "../../src/pose/canonicalPose";
import type { PoseEstimate } from "../../src/pose/PoseEngine";

test("raw observation becomes a versioned canonical frame without overwriting raw data", () => {
  const session = createPoseContinuitySession({
    sequenceId: "video:f4a69088",
    schema: "blazepose33",
    image: {
      widthPx: 720,
      heightPx: 1280,
      rotationDegrees: 0,
      mirrored: false,
    },
  });
  const raw: PoseEstimate = {
    timestampMs: 1950,
    landmarks: [
      { x: 0.37096, y: 0.60717, z: -0.12203, visibility: 0.4715 },
    ],
    worldLandmarks: [
      { x: -0.2, y: 0.1, z: 0.05, visibility: 0.4715 },
    ],
  };
  const rawBefore = structuredClone(raw);

  const frame = session.process(raw);

  assert.deepEqual(raw, rawBefore);
  assert.equal(frame.contractVersion, "canonical-pose-frame/v1");
  assert.equal(frame.algorithmVersion, "raw-pass-through/v1");
  assert.equal(frame.frameId, 0);
  assert.equal(frame.sequenceId, "video:f4a69088");
  assert.equal(frame.timestampMs, 1950);
  assert.equal(frame.sourceTimestampMs, 1950);
  assert.equal(frame.schema, "blazepose33");
  assert.equal(frame.coordinateSpace, "image_normalized");
  assert.equal(frame.worldCoordinateSpace, "meters");
  assert.deepEqual(frame.image, {
    widthPx: 720,
    heightPx: 1280,
    rotationDegrees: 0,
    mirrored: false,
  });
  assert.deepEqual(frame.landmarks[0], {
    x: 0.37096,
    y: 0.60717,
    z: -0.12203,
    visibility: 0.4715,
    predicted: false,
    observationScore: 0.4715,
    canonicalConfidence: 0.4715,
    uncertainty: null,
    source: "measured",
    repairFlags: [],
    renderable: false,
    usable: false,
  });
  assert.notEqual(frame.landmarks, raw.landmarks);
  assert.notEqual(frame.landmarks[0], raw.landmarks[0]);
});

test("legacy stabilization exposes a predicted point as renderable canonical data", () => {
  const session = createPoseContinuitySession({
    sequenceId: "camera:1",
    schema: "blazepose33",
    image: {
      widthPx: 1280,
      heightPx: 720,
      rotationDegrees: 0,
      mirrored: true,
    },
    stabilization: "legacy",
  });

  session.process({
    timestampMs: 1000,
    landmarks: [{ x: 0.4, y: 0.5, z: 0, visibility: 0.9 }],
    worldLandmarks: [],
  });
  const predictedFrame = session.process({
    timestampMs: 1050,
    landmarks: [{ x: 0.41, y: 0.5, z: 0, visibility: 0.4 }],
    worldLandmarks: [],
  });

  assert.equal(predictedFrame.algorithmVersion, "legacy-web-tracker/v1");
  assert.equal(predictedFrame.frameId, 1);
  assert.equal(predictedFrame.landmarks[0].observationScore, 0.4);
  assert.equal(predictedFrame.landmarks[0].source, "predicted");
  assert.equal(predictedFrame.landmarks[0].predicted, true);
  assert.equal(predictedFrame.landmarks[0].renderable, true);
  assert.equal(predictedFrame.landmarks[0].usable, false);
  assert.deepEqual(predictedFrame.landmarks[0].repairFlags, ["smoothed"]);
});

test("raw observation is available only through the explicit diagnostic entry", () => {
  const session = createPoseContinuitySession({
    sequenceId: "diagnostic:1",
    schema: "coco17",
    image: {
      widthPx: 1920,
      heightPx: 1080,
      rotationDegrees: 0,
      mirrored: false,
    },
  });
  const raw: PoseEstimate = {
    timestampMs: 500,
    landmarks: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.8 }],
    worldLandmarks: [],
  };
  const canonicalFrame = session.process(raw);

  assert.equal("rawObservation" in canonicalFrame, false);
  const diagnostic = createPoseContinuityDiagnostic(raw, canonicalFrame);
  assert.equal(diagnostic.sequenceId, "diagnostic:1");
  assert.equal(diagnostic.frameId, 0);
  assert.equal(diagnostic.rawObservation, raw);
  assert.equal(diagnostic.canonicalFrame, canonicalFrame);

  assert.throws(
    () =>
      createPoseContinuityDiagnostic(
        { ...raw, timestampMs: raw.timestampMs + 1 },
        canonicalFrame,
      ),
    /Raw diagnostic timestamp mismatch/,
  );
});
