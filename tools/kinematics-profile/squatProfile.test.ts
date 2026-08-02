import assert from "node:assert/strict";
import test from "node:test";

import { EXERCISE_REGISTRY } from "../../src/pose/exerciseRegistry";
import { getKinematicsProfile } from "../../src/pose/kinematicsProfile";
import type { PoseEstimate } from "../../src/pose/PoseEngine";
import { segmentRepsBySignal } from "../../src/pose/repSegmenter";

test("bodyweight squat declares lower-body phase and view-dependent metrics", () => {
  assert.equal(EXERCISE_REGISTRY.require("bodyweight_squat").movementPattern, "squat");
  const profile = getKinematicsProfile("bodyweight_squat");
  assert.ok(profile);
  assert.equal(profile.phaseSignal.kind, "knee_angle");
  assert.equal(profile.phaseSignal.effortExtreme, "min");
  assert.equal(profile.phaseSignal.toExtreme, "eccentric");
  assert.equal(profile.phaseSignal.fromExtreme, "concentric");
  assert.deepEqual(profile.metrics.amplitude.joints, ["hip", "knee", "ankle"]);
  assert.deepEqual(profile.supportedViews, ["side", "oblique45"]);
  assert.deepEqual(profile.metrics.amplitude.supportedViews, ["side", "oblique45"]);
  assert.deepEqual(profile.metrics.bilateralAsymmetry.joints, ["knee"]);
  assert.deepEqual(profile.metrics.bilateralAsymmetry.supportedViews, []);
});

test("known knee-angle segmentation chooses its hip-knee-ankle evidence side", () => {
  const kneeAngles = [155, 125, 90, 125, 155, 125, 90, 125, 155, 125, 90, 125, 155];
  const poses = kneeAngles.map((angle, index) => syntheticKneePose(index * 200, angle));
  const segments = segmentRepsBySignal(poses, "knee_angle", "min");
  assert.ok(segments.length > 0);
  assert.ok(segments.every((segment) => segment.evidenceSide === "left"));
});

function syntheticKneePose(timestampMs: number, angleDeg: number): PoseEstimate {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const radians = (angleDeg * Math.PI) / 180;
  // Left lower body is observable; right shoulder/wrist are deliberately
  // stronger than the left upper body so an accidental upper-body side gate
  // would select the unusable right knee chain.
  landmarks[23] = { x: 0.4, y: 0.3, z: 0, visibility: 1 };
  landmarks[25] = { x: 0.4, y: 0.5, z: 0, visibility: 1 };
  landmarks[27] = {
    x: 0.4 + Math.sin(radians) * 0.2,
    y: 0.5 - Math.cos(radians) * 0.2,
    z: 0,
    visibility: 1,
  };
  landmarks[24] = { x: 0.6, y: 0.3, z: 0, visibility: 1 };
  landmarks[12] = { x: 0.6, y: 0.2, z: 0, visibility: 1 };
  landmarks[16] = { x: 0.6, y: 0.1, z: 0, visibility: 1 };
  return { timestampMs, landmarks, worldLandmarks: [] };
}
