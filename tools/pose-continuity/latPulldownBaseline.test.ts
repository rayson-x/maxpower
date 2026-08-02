import assert from "node:assert/strict";
import test from "node:test";

import { LandmarkTracker } from "../../src/pose/landmarkTracker";
import { createPoseContinuitySession } from "../../src/pose/canonicalPose";
import { buildCanonicalPosePresentation } from "../../src/pose/canonicalPosePresentation";
import {
  loadPoseFixture,
  loadPoseFixtureAnnotation,
  poseAtTimestamp,
} from "../harness/fixtureRepository";

const LAT_PULLDOWN_VIDEO = "f4a69088e395df62a33e7272f9e78192.mp4";

test("lat-pulldown baseline distinguishes recorded observations from unannotated coordinate truth", () => {
  const annotation = loadPoseFixtureAnnotation(LAT_PULLDOWN_VIDEO);

  assert.equal(annotation.videoId, LAT_PULLDOWN_VIDEO);
  assert.deepEqual(annotation.evidence, {
    rawObservation: "recorded_fixture",
    currentImplementationBehavior: "characterization_only",
    manualCoordinateGroundTruth: "not_annotated",
  });
  assert.deepEqual(
    annotation.challengeFrames.map(({ timestampMs }) => timestampMs),
    [1950, 2000],
  );
});

test("lat-pulldown challenge frames preserve raw visibility and current predicted behavior", () => {
  const fixture = loadPoseFixture(LAT_PULLDOWN_VIDEO);
  const annotation = loadPoseFixtureAnnotation(LAT_PULLDOWN_VIDEO);
  const tracker = new LandmarkTracker();
  const trackedByTimestamp = new Map<
    number,
    ReturnType<LandmarkTracker["update"]>
  >();

  for (const pose of fixture.poses) {
    const tracked = tracker.update(pose.landmarks, pose.timestampMs);
    if (
      annotation.challengeFrames.some(
        ({ timestampMs }) => timestampMs === pose.timestampMs,
      )
    ) {
      trackedByTimestamp.set(pose.timestampMs, tracked);
    }
  }

  assert.deepEqual(
    annotation.challengeFrames.map((frame) => ({
      timestampMs: frame.timestampMs,
      rawVisibility: frame.joints.map(({ rawVisibility }) => rawVisibility),
    })),
    [
      {
        timestampMs: 1950,
        rawVisibility: [0.9997, 0.4715, 0.6859, 0.9995, 0.4246, 0.7498],
      },
      {
        timestampMs: 2000,
        rawVisibility: [0.9998, 0.4508, 0.6568, 0.9995, 0.4063, 0.7352],
      },
    ],
  );

  for (const frame of annotation.challengeFrames) {
    const rawPose = poseAtTimestamp(fixture, frame.timestampMs);
    const trackedPose = trackedByTimestamp.get(frame.timestampMs);
    assert.ok(trackedPose, `missing tracker output at ${frame.timestampMs}ms`);

    for (const joint of frame.joints) {
      assert.equal(
        rawPose.landmarks[joint.landmarkIndex]?.visibility,
        joint.rawVisibility,
        `${joint.name} raw visibility changed at ${frame.timestampMs}ms`,
      );
      assert.equal(
        trackedPose[joint.landmarkIndex]?.predicted,
        joint.currentBehavior === "predicted",
        `${joint.name} tracker behavior changed at ${frame.timestampMs}ms`,
      );
    }
  }
});

test("canonical rendering keeps both arm edges at the lat-pulldown challenge frames", () => {
  const fixture = loadPoseFixture(LAT_PULLDOWN_VIDEO);
  const session = createPoseContinuitySession({
    sequenceId: `fixture:${LAT_PULLDOWN_VIDEO}`,
    schema: "blazepose33",
    image: {
      widthPx: 720,
      heightPx: 1280,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "legacy",
  });
  const challengeFrames = new Map<number, ReturnType<typeof session.process>>();

  for (const pose of fixture.poses) {
    const frame = session.process(pose);
    if (pose.timestampMs === 1950 || pose.timestampMs === 2000) {
      challengeFrames.set(pose.timestampMs, frame);
    }
  }

  for (const timestampMs of [1950, 2000]) {
    const frame = challengeFrames.get(timestampMs);
    assert.ok(frame, `missing canonical frame at ${timestampMs}ms`);
    assert.equal(frame.landmarks[13].source, "predicted");
    assert.equal(frame.landmarks[14].source, "predicted");
    assert.equal(frame.landmarks[13].renderable, true);
    assert.equal(frame.landmarks[14].renderable, true);

    const presentation = buildCanonicalPosePresentation(frame, [
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
    ]);
    assert.equal(presentation.edges.length, 4);
    assert.ok(presentation.edges.every((edge) => edge.repaired));
  }
});
