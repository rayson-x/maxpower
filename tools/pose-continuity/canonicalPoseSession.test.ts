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
    continuityReason: null,
    renderable: false,
    usable: false,
  });
  assert.notEqual(frame.landmarks, raw.landmarks);
  assert.notEqual(frame.landmarks[0], raw.landmarks[0]);
});

test("legacy stabilization labels prediction without making it product-renderable", () => {
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
  assert.equal(predictedFrame.landmarks[0].renderable, false);
  assert.equal(predictedFrame.landmarks[0].usable, false);
  assert.deepEqual(predictedFrame.landmarks[0].repairFlags, ["smoothed"]);
});

test("weak elbow fusion stays on the historical two-circle branch", () => {
  const session = createPoseContinuitySession({
    sequenceId: "synthetic:branch",
    schema: "blazepose33",
    image: {
      widthPx: 1000,
      heightPx: 1000,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
  });
  const observation = (
    timestampMs: number,
    elbowY: number,
    elbowVisibility: number,
  ): PoseEstimate => {
    const landmarks = Array.from({ length: 17 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0.95,
    }));
    landmarks[11] = { x: 0.4, y: 0.4, z: 0, visibility: 0.95 };
    landmarks[13] = {
      x: 0.5,
      y: elbowY,
      z: 0,
      visibility: elbowVisibility,
    };
    landmarks[15] = { x: 0.6, y: 0.4, z: 0, visibility: 0.95 };
    return { timestampMs, landmarks, worldLandmarks: [] };
  };

  for (let frame = 0; frame < 5; frame += 1) {
    session.process(observation(frame * 50, 0.55, 0.95));
  }
  const fused = session.process(observation(250, 0.25, 0.35));

  assert.equal(fused.landmarks[13].source, "fused");
  assert.ok(
    fused.landmarks[13].y > 0.4,
    `elbow flipped across shoulder-wrist axis: ${fused.landmarks[13].y}`,
  );
});

test("gap repair uses elapsed milliseconds instead of frame count", () => {
  for (const fps of [20, 30, 60]) {
    const frameMs = 1000 / fps;
    for (const gapMs of [50, 100, 150, 250, 500]) {
      const session = createPoseContinuitySession({
        sequenceId: `synthetic:gap:${fps}:${gapMs}`,
        schema: "blazepose33",
        image: {
          widthPx: 1000,
          heightPx: 1000,
          rotationDegrees: 0,
          mirrored: false,
        },
        stabilization: "fusion",
      });
      session.process({
        timestampMs: 0,
        landmarks: [{ x: 0.4, y: 0.5, z: 0, visibility: 0.95 }],
        worldLandmarks: [],
      });
      session.process({
        timestampMs: frameMs,
        landmarks: [
          { x: 0.4 + frameMs * 0.001, y: 0.5, z: 0, visibility: 0.95 },
        ],
        worldLandmarks: [],
      });
      const repaired = session.process({
        timestampMs: frameMs + gapMs,
        landmarks: [{ x: 0, y: 0, z: 0, visibility: 0 }],
        worldLandmarks: [],
      }).landmarks[0];

      if (gapMs <= 150) {
        assert.equal(repaired.source, "predicted", `${fps}fps/${gapMs}ms`);
        assert.equal(repaired.renderable, true);
        assert.equal(repaired.usable, false);
        assert.ok(Math.abs(repaired.x - (0.4 + (frameMs + gapMs) * 0.001)) < 1e-6);
      } else {
        assert.equal(repaired.source, "unknown", `${fps}fps/${gapMs}ms`);
        assert.equal(repaired.continuityReason, "prediction-timeout");
        assert.equal(repaired.renderable, false);
        assert.equal(repaired.usable, false);
      }
      assert.ok(repaired.uncertainty !== null && repaired.uncertainty > 0);
    }
  }
});

test("seek and large dt clear stale prediction state before reacquisition", () => {
  const session = createPoseContinuitySession({
    sequenceId: "synthetic:reset",
    schema: "blazepose33",
    image: {
      widthPx: 1000,
      heightPx: 1000,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
  });
  const frame = (timestampMs: number, x: number, visibility: number) => ({
    timestampMs,
    landmarks: [{ x, y: 0.5, z: 0, visibility }],
    worldLandmarks: [],
  });

  session.process(frame(0, 0.4, 0.95));
  session.process(frame(50, 0.45, 0.95));
  session.process(frame(25, 0, 0));
  assert.equal(session.process(frame(75, 0, 0)).landmarks[0].source, "unknown");

  session.process(frame(1000, 0.8, 0.95));
  const afterReacquisition = session.process(frame(1050, 0, 0)).landmarks[0];
  assert.equal(afterReacquisition.source, "predicted");
  assert.equal(afterReacquisition.x, 0.8);
});

test("high-confidence isolated elbow spike is rejected without freezing coherent motion", () => {
  const createSession = (sequenceId: string) =>
    createPoseContinuitySession({
      sequenceId,
      schema: "blazepose33",
      image: {
        widthPx: 1000,
        heightPx: 1000,
        rotationDegrees: 0,
        mirrored: false,
      },
      stabilization: "fusion",
    });
  const pose = (
    timestampMs: number,
    shiftX: number,
    elbow: { x: number; y: number } = { x: 0.5 + shiftX, y: 0.55 },
  ): PoseEstimate => {
    const landmarks = Array.from({ length: 17 }, (_, index) => ({
      x: 0.2 + (index % 5) * 0.08 + shiftX,
      y: 0.2 + Math.floor(index / 5) * 0.08,
      z: 0,
      visibility: 0.99,
    }));
    landmarks[11] = { x: 0.4 + shiftX, y: 0.4, z: 0, visibility: 0.99 };
    landmarks[13] = { ...elbow, z: 0, visibility: 0.99 };
    landmarks[15] = { x: 0.6 + shiftX, y: 0.4, z: 0, visibility: 0.99 };
    return { timestampMs, landmarks, worldLandmarks: [] };
  };

  const spikeSession = createSession("synthetic:spike");
  for (let frame = 0; frame < 5; frame += 1) {
    spikeSession.process(pose(frame * 50, 0));
  }
  const rejected = spikeSession.process(
    pose(250, 0, { x: 0.9, y: 0.1 }),
  ).landmarks[13];
  assert.equal(rejected.source, "predicted");
  assert.equal(rejected.continuityReason, "outlier-rejected-prediction");
  assert.ok(Math.hypot(rejected.x - 0.5, rejected.y - 0.55) < 0.02);

  const coherentSession = createSession("synthetic:coherent-fast");
  for (let frame = 0; frame < 5; frame += 1) {
    coherentSession.process(pose(frame * 50, 0));
  }
  const fast = coherentSession.process(pose(250, 0.15)).landmarks[13];
  assert.equal(fast.source, "measured");
  assert.equal(fast.x, 0.65);
  assert.equal(fast.y, 0.55);
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
