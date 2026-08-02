import assert from "node:assert/strict";
import test from "node:test";

import { routeCanonicalFrame } from "../../src/pose/canonicalFrameRouter";
import {
  createPoseContinuitySession,
  type CanonicalPoseFrame,
} from "../../src/pose/canonicalPose";
import { buildRecordingFixture } from "../../src/pose/recordingFixture";
import { extractRepMetrics } from "../../src/pose/repMetricsExtractor";
import { loadPoseFixture } from "../harness/fixtureRepository";

test("render, counting, recording, and analysis receive the same canonical frame", () => {
  const session = createPoseContinuitySession({
    sequenceId: "video:contract",
    schema: "blazepose33",
    image: {
      widthPx: 720,
      heightPx: 1280,
      rotationDegrees: 0,
      mirrored: false,
    },
  });
  const frame = session.process({
    timestampMs: 50,
    landmarks: [{ x: 0.25, y: 0.75, z: 0, visibility: 0.9 }],
    worldLandmarks: [],
  });
  const received: Partial<
    Record<"render" | "count" | "record" | "analyze", CanonicalPoseFrame>
  > = {};

  routeCanonicalFrame(frame, {
    render: (value) => {
      received.render = value;
    },
    count: (value) => {
      received.count = value;
    },
    record: (value) => {
      received.record = value;
    },
    analyze: (value) => {
      received.analyze = value;
    },
  });

  for (const consumer of ["render", "count", "record", "analyze"] as const) {
    assert.equal(received[consumer], frame);
    assert.equal(received[consumer]?.landmarks, frame.landmarks);
    assert.equal(received[consumer]?.frameId, 0);
  }
});

test("recording preserves canonical identity while rebasing its source timeline", () => {
  const session = createPoseContinuitySession({
    sequenceId: "camera:recording",
    schema: "blazepose33",
    image: {
      widthPx: 1280,
      heightPx: 720,
      rotationDegrees: 0,
      mirrored: true,
    },
  });
  const frames = [100, 350].map((timestampMs) =>
    session.process({
      timestampMs,
      landmarks: [{ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }],
      worldLandmarks: [],
    }),
  );

  const [fixture] = buildRecordingFixture({
    video: "canonical.webm",
    fallbackDurationSec: 1,
    model: "mediapipe:heavy",
    poses: frames,
  });

  assert.deepEqual(
    fixture.poses.map((frame) => ({
      contractVersion: frame.contractVersion,
      frameId: frame.frameId,
      timestampMs: frame.timestampMs,
      sourceTimestampMs: frame.sourceTimestampMs,
      landmarks: frame.landmarks,
    })),
    [
      {
        contractVersion: "canonical-pose-frame/v1",
        frameId: 0,
        timestampMs: 0,
        sourceTimestampMs: 0,
        landmarks: frames[0].landmarks,
      },
      {
        contractVersion: "canonical-pose-frame/v1",
        frameId: 1,
        timestampMs: 250,
        sourceTimestampMs: 250,
        landmarks: frames[1].landmarks,
      },
    ],
  );
});

test("recording rejects canonical frames from different sequences", () => {
  const config = {
    schema: "blazepose33" as const,
    image: {
      widthPx: 1280,
      heightPx: 720,
      rotationDegrees: 0 as const,
      mirrored: true,
    },
  };
  const frames = ["camera:first", "camera:second"].map((sequenceId) =>
    createPoseContinuitySession({ ...config, sequenceId }).process({
      timestampMs: 100,
      landmarks: [{ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }],
      worldLandmarks: [],
    }),
  );

  assert.throws(
    () =>
      buildRecordingFixture({
        video: "mixed.webm",
        fallbackDurationSec: 1,
        model: "mediapipe:heavy",
        poses: frames,
      }),
    /mixed canonical sequences/,
  );
});

test("raw pass-through canonical frames preserve the existing rep analysis result", () => {
  const fixture = loadPoseFixture("f4a69088e395df62a33e7272f9e78192.mp4");
  const session = createPoseContinuitySession({
    sequenceId: "fixture:analysis-equivalence",
    schema: "blazepose33",
    image: {
      widthPx: 720,
      heightPx: 1280,
      rotationDegrees: 0,
      mirrored: false,
    },
  });
  const canonicalFrames = fixture.poses.map((pose) => session.process(pose));
  const options = {
    cameraView: "oblique45" as const,
    exercise: { mode: "user" as const, exerciseId: "lat_pulldown" as const },
  };

  assert.deepEqual(
    extractRepMetrics(canonicalFrames, options),
    extractRepMetrics(fixture.poses, options),
  );
});
