import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPoseFixture,
  poseAtTimestamp,
} from "./fixtureRepository";

const LAT_PULLDOWN_VIDEO = "f4a69088e395df62a33e7272f9e78192.mp4";

test("loads the lat-pulldown fixture by stable video id", () => {
  const fixture = loadPoseFixture(LAT_PULLDOWN_VIDEO);

  assert.equal(fixture.video, LAT_PULLDOWN_VIDEO);
  assert.equal(fixture.stepMs, 50);
  assert.equal(fixture.poses.length, 149);
  assert.equal(poseAtTimestamp(fixture, 1950).timestampMs, 1950);
  assert.equal(poseAtTimestamp(fixture, 2000).timestampMs, 2000);
});

test("rejects an unknown video id instead of falling back to array order", () => {
  assert.throws(
    () => loadPoseFixture("missing-video.mp4"),
    /Pose fixture not found: missing-video\.mp4/,
  );
});
