import assert from "node:assert/strict";
import test from "node:test";

import { buildRecordingFixture } from "../../src/pose/recordingFixture";
import { selectLandmarksByOriginalIndex } from "../../src/pose/selectLandmarks";

test("selected landmarks retain their original model indices after visibility filtering", () => {
  const landmarks = [
    { x: 0.1, y: 0.1, visibility: 0.2 },
    { x: 0.2, y: 0.2, visibility: 0.9 },
    { x: 0.3, y: 0.3, visibility: 0.8 },
  ];

  const selected = selectLandmarksByOriginalIndex(
    landmarks,
    (landmark) => landmark.visibility >= 0.5,
  );

  assert.deepEqual([...selected.keys()], [1, 2]);
  assert.equal(selected.get(1)?.x, 0.2);
  assert.equal(selected.get(2)?.x, 0.3);
});

test("recording fixture remains importable when no pose was detected", () => {
  const fixture = buildRecordingFixture({
    video: "field-capture.webm",
    fallbackDurationSec: 12.345,
    model: "mediapipe:/models/pose_landmarker_heavy.task",
    poses: [],
  });

  assert.deepEqual(fixture, [
    {
      video: "field-capture.webm",
      durationSec: 12.345,
      stepMs: 0,
      model: "mediapipe:/models/pose_landmarker_heavy.task",
      poses: [],
    },
  ]);
});

test("recording fixture retains the full media duration when pose coverage is shorter", () => {
  const poses = [
    { timestampMs: 100, landmarks: [], worldLandmarks: [] },
    { timestampMs: 350, landmarks: [], worldLandmarks: [] },
  ];

  const [fixture] = buildRecordingFixture({
    video: "field-capture.webm",
    fallbackDurationSec: 5,
    model: "mediapipe:/models/pose_landmarker_heavy.task",
    poses,
  });

  assert.equal(fixture.durationSec, 5);
  assert.equal(fixture.stepMs, 250);
  assert.deepEqual(
    fixture.poses.map((pose) => pose.timestampMs),
    [0, 250],
  );
});
