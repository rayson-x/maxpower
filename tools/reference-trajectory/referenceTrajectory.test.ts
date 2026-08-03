import assert from "node:assert/strict";
import test from "node:test";

import type { PoseEstimate } from "../../src/pose/PoseEngine";
import {
  LAT_PULLDOWN_REFERENCE_FEATURES,
  buildPersonalProvisionalReference,
  extractNormalizedLatPulldownRep,
  matchLatPulldownTrajectory,
} from "../../src/pose/referenceTrajectory";

function pose(timestampMs: number, wristY: number, rightElbowVisibility = 1): PoseEstimate {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  landmarks[11] = { x: 0.4, y: 0.4, z: 0, visibility: 1 };
  landmarks[12] = { x: 0.6, y: 0.4, z: 0, visibility: 1 };
  landmarks[13] = { x: 0.34, y: (0.4 + wristY) / 2 + 0.03, z: 0, visibility: 1 };
  landmarks[14] = { x: 0.66, y: (0.4 + wristY) / 2 + 0.03, z: 0, visibility: rightElbowVisibility };
  landmarks[15] = { x: 0.3, y: wristY, z: 0, visibility: 1 };
  landmarks[16] = { x: 0.7, y: wristY, z: 0, visibility: 1 };
  landmarks[23] = { x: 0.43, y: 0.7, z: 0, visibility: 1 };
  landmarks[24] = { x: 0.57, y: 0.7, z: 0, visibility: 1 };
  return { timestampMs, landmarks, worldLandmarks: [] };
}

test("piecewise normalization preserves pull/bottom/return and refuses only the occluded metric", () => {
  const result = extractNormalizedLatPulldownRep({
    captureId: "capture-left-oblique",
    capturePosition: "rearLeft45",
    sourceStatus: "human_edited_draft",
    profileContext: {
      variation: "unrecorded",
      trainingSide: "bilateral",
      equipment: "test-machine",
      coordinateSystem: "source-image/v1",
      poseModelVersion: "test-pose-model/v1",
    },
    segment: { repIndex: 1, startMs: 0, peakMs: 200, endMs: 400 },
    poses: [
      pose(0, 0.2, 0),
      pose(100, 0.4, 0),
      pose(200, 0.6, 0),
      pose(300, 0.4, 0),
      pose(400, 0.2, 0),
    ],
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.rep.nodes.length, 32);
  assert.equal(result.rep.nodes[0].phase, "pull");
  assert.equal(result.rep.nodes[15].phase, "pull");
  assert.equal(result.rep.nodes[16].phase, "return");
  assert.equal(result.rep.nodes[31].phase, "return");
  assert.ok(result.rep.nodes[1].targetTimestampMs > 0);
  assert.equal(result.rep.nodes[1].sourceTimestampMs, 0);

  const leftWrist = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("leftWristHeight");
  const rightWrist = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("rightWristHeight");
  const rightElbow = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("rightElbowAngleDeg");
  assert.ok(result.rep.nodes.every((node) => node.values[leftWrist] !== null));
  assert.ok(result.rep.nodes.every((node) => node.values[rightWrist] !== null));
  assert.ok(result.rep.nodes.every((node) => node.values[rightElbow] === null));
  assert.ok((result.rep.nodes[15].values[leftWrist] ?? -Infinity) > (result.rep.nodes[0].values[leftWrist] ?? Infinity));
  assert.equal(result.rep.screening.status, "biomechanically_compatible_candidate");
});

function normalizedRep(captureId: string, wristOffset: number) {
  const result = extractNormalizedLatPulldownRep({
    captureId,
    capturePosition: "rear",
    sourceStatus: "human_edited_draft",
    profileContext: {
      variation: "unrecorded",
      trainingSide: "bilateral",
      equipment: "local_cable_lat_pulldown_unrecorded",
      coordinateSystem: "source-image/v1",
      poseModelVersion: "test-pose-model/v1",
    },
    segment: { repIndex: 1, startMs: 0, peakMs: 200, endMs: 400 },
    poses: [
      pose(0, 0.2 + wristOffset),
      pose(100, 0.4 + wristOffset),
      pose(200, 0.6 + wristOffset),
      pose(300, 0.4 + wristOffset),
      pose(400, 0.2 + wristOffset),
    ],
  });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw new Error("expected a normalized rep");
  return result.rep;
}

test("personal corridor matches by phase without DTW and keeps missing metrics unknown", () => {
  const reps = [-0.02, -0.01, 0, 0.01, 0.02].map((offset, index) =>
    normalizedRep(`seed-${index + 1}`, offset),
  );
  const built = buildPersonalProvisionalReference({
    capturePosition: "rear",
    reps,
    identity: {
      variation: "unrecorded",
      trainingSide: "bilateral",
      equipment: "local_cable_lat_pulldown_unrecorded",
      coordinateSystem: "source-image/v1",
    },
  });
  assert.equal(built.status, "ready");
  if (built.status !== "ready") return;
  assert.equal(built.profile.referencePopulation.participantCount, 1);
  assert.equal(built.profile.referencePopulation.repCount, 5);
  assert.equal(built.profile.profileStatus, "personal_provisional_unreviewed");
  assert.equal(built.profile.matchingPolicy.sustainedOutsideNodes, null);
  assert.equal(built.profile.matchingPolicy.maximumOutsideNodeRatio, null);

  const centerMatch = matchLatPulldownTrajectory(built.profile, reps[2]);
  assert.equal(centerMatch.status, "comparison_available");
  assert.equal(centerMatch.qualityVerdict, null);
  assert.equal(centerMatch.calibrationStatus, "uncalibrated");

  const shifted = structuredClone(reps[2]);
  const leftWrist = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("leftWristHeight");
  for (let node = 4; node <= 10; node += 1) {
    shifted.nodes[node].values[leftWrist]! += 2;
  }
  const shiftedMatch = matchLatPulldownTrajectory(built.profile, shifted);
  assert.equal(shiftedMatch.status, "comparison_available");
  const shiftedWrist = shiftedMatch.features.find(
    (feature) => feature.feature === "leftWristHeight",
  );
  assert.equal(shiftedWrist?.status, "compared");
  assert.ok((shiftedWrist?.outsideNodeCount ?? 0) >= 7);
  assert.ok((shiftedWrist?.maximumConsecutiveOutsideNodes ?? 0) >= 7);

  const partiallyOccluded = structuredClone(reps[2]);
  const rightElbow = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("rightElbowAngleDeg");
  partiallyOccluded.nodes.forEach((node) => {
    node.values[rightElbow] = null;
    node.confidence[rightElbow] = 0;
  });
  const partialMatch = matchLatPulldownTrajectory(built.profile, partiallyOccluded);
  assert.equal(
    partialMatch.features.find((feature) => feature.feature === "rightElbowAngleDeg")?.status,
    "unknown",
  );
  assert.equal(partialMatch.status, "comparison_available");
  assert.equal(partialMatch.qualityVerdict, null);
});

test("matching refuses a physical camera-position mismatch", () => {
  const rearRep = normalizedRep("rear-seed", 0);
  const built = buildPersonalProvisionalReference({
    capturePosition: "rear",
    reps: [
      rearRep,
      normalizedRep("rear-seed-2", 0.01),
      normalizedRep("rear-seed-3", -0.01),
    ],
    identity: {
      variation: "unrecorded",
      trainingSide: "bilateral",
      equipment: "local_cable_lat_pulldown_unrecorded",
      coordinateSystem: "source-image/v1",
    },
  });
  assert.equal(built.status, "ready");
  if (built.status !== "ready") return;
  const wrongView = structuredClone(rearRep);
  wrongView.capturePosition = "rearLeft45";
  const match = matchLatPulldownTrajectory(built.profile, wrongView);
  assert.equal(match.status, "profile_mismatch");

  const wrongEquipment = structuredClone(rearRep);
  wrongEquipment.profileContext.equipment = "different-machine";
  const equipmentMatch = matchLatPulldownTrajectory(built.profile, wrongEquipment);
  assert.equal(equipmentMatch.status, "profile_mismatch");
});

test("torso lateral shift is translation relative to the start, not a scale-change artifact", () => {
  const scaleChanging = [
    pose(0, 0.2),
    pose(100, 0.4),
    pose(200, 0.6),
    pose(300, 0.4),
    pose(400, 0.2),
  ];
  scaleChanging.forEach((frame, index) => {
    frame.landmarks[23].y = 0.7 + index * 0.03;
    frame.landmarks[24].y = 0.7 + index * 0.03;
  });
  const result = extractNormalizedLatPulldownRep({
    captureId: "scale-change",
    capturePosition: "rear",
    sourceStatus: "human_edited_draft",
    profileContext: {
      variation: "unrecorded",
      trainingSide: "bilateral",
      equipment: "test-machine",
      coordinateSystem: "source-image/v1",
      poseModelVersion: "test-pose-model/v1",
    },
    segment: { repIndex: 1, startMs: 0, peakMs: 200, endMs: 400 },
    poses: scaleChanging,
  });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  const torsoShift = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("torsoLateralShift");
  assert.ok(result.rep.nodes.every((node) => Math.abs(node.values[torsoShift] ?? Infinity) < 1e-6));
});
