import assert from "node:assert/strict";
import test from "node:test";

import { LandmarkTracker } from "../../src/pose/landmarkTracker";
import {
  createPoseContinuitySession,
  type CanonicalLandmark,
} from "../../src/pose/canonicalPose";
import { buildCanonicalPosePresentation } from "../../src/pose/canonicalPosePresentation";
import {
  loadPoseFixture,
  loadPoseFixtureAnnotation,
  poseAtTimestamp,
} from "../harness/fixtureRepository";

const LAT_PULLDOWN_VIDEO = "f4a69088e395df62a33e7272f9e78192.mp4";

test("lat-pulldown baseline registers independently reviewed elbow coordinates", () => {
  const annotation = loadPoseFixtureAnnotation(LAT_PULLDOWN_VIDEO);

  assert.equal(annotation.videoId, LAT_PULLDOWN_VIDEO);
  assert.deepEqual(annotation.evidence, {
    rawObservation: "recorded_fixture",
    currentImplementationBehavior: "characterization_only",
    manualCoordinateGroundTruth: "annotated_video_frame",
  });
  assert.deepEqual(annotation.acceptance, {
    coordinateSpace: "image_normalized",
    maxElbowErrorPx: 12,
    minArmEdgeCoverage: 1,
  });
  assert.deepEqual(
    annotation.challengeFrames.map(({ timestampMs }) => timestampMs),
    [1950, 2000],
  );
});

test("weak observed elbows remain accurate and connected at the lat-pulldown challenge", () => {
  const fixture = loadPoseFixture(LAT_PULLDOWN_VIDEO);
  const annotation = loadPoseFixtureAnnotation(LAT_PULLDOWN_VIDEO);
  const session = createPoseContinuitySession({
    sequenceId: `fixture:${LAT_PULLDOWN_VIDEO}:fusion`,
    schema: "blazepose33",
    image: {
      widthPx: 720,
      heightPx: 1280,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
  });
  const challengeFrames = new Map<number, ReturnType<typeof session.process>>();

  for (const pose of fixture.poses) {
    const frame = session.process(pose);
    if (annotation.challengeFrames.some(({ timestampMs }) => timestampMs === pose.timestampMs)) {
      challengeFrames.set(pose.timestampMs, frame);
    }
  }

  for (const annotatedFrame of annotation.challengeFrames) {
    const frame = challengeFrames.get(annotatedFrame.timestampMs);
    assert.ok(frame, `missing canonical frame at ${annotatedFrame.timestampMs}ms`);
    const raw = poseAtTimestamp(fixture, annotatedFrame.timestampMs);

    for (const anchorIndex of [11, 12, 15, 16]) {
      assert.equal(frame.landmarks[anchorIndex].source, "measured");
      assert.equal(frame.landmarks[anchorIndex].x, raw.landmarks[anchorIndex].x);
      assert.equal(frame.landmarks[anchorIndex].y, raw.landmarks[anchorIndex].y);
    }

    for (const annotatedJoint of annotatedFrame.joints.filter(
      ({ manualCoordinate }) => manualCoordinate !== undefined,
    )) {
      const expected = annotatedJoint.manualCoordinate!;
      const actual: CanonicalLandmark =
        frame.landmarks[annotatedJoint.landmarkIndex];
      const errorPx = Math.hypot(
        (actual.x - expected.x) * frame.image.widthPx,
        (actual.y - expected.y) * frame.image.heightPx,
      );
      assert.equal(actual.source, "fused");
      assert.equal(actual.renderable, true);
      assert.ok(actual.uncertainty !== null && actual.uncertainty > 0);
      assert.ok(
        errorPx <= annotation.acceptance.maxElbowErrorPx,
        `${annotatedJoint.name} error ${errorPx.toFixed(2)}px at ${annotatedFrame.timestampMs}ms`,
      );
    }

    const presentation = buildCanonicalPosePresentation(frame, [
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
    ]);
    assert.equal(
      presentation.edges.length / 4,
      annotation.acceptance.minArmEdgeCoverage,
    );
  }
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
