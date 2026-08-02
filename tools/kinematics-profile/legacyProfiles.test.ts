import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKinematicsProfileArchive,
  getKinematicsProfile,
} from "../../src/pose/kinematicsProfile";

test("legacy exercise profiles preserve explicit segmentation, phase, and metric contracts", () => {
  const expected = {
    barbell_row: {
      signal: "elbow_angle",
      extreme: "min",
      amplitudeJoints: ["shoulder", "elbow", "wrist"],
    },
    pull_up: {
      signal: "wrist_height",
      extreme: "max",
      amplitudeJoints: ["shoulder", "wrist"],
    },
    lat_pulldown: {
      signal: "wrist_height",
      extreme: "max",
      amplitudeJoints: ["shoulder", "wrist"],
    },
    seated_row: {
      signal: "elbow_angle",
      extreme: "min",
      amplitudeJoints: ["shoulder", "elbow", "wrist"],
    },
    straight_arm_pulldown: {
      signal: "shoulder_angle",
      extreme: "min",
      amplitudeJoints: ["hip", "shoulder", "wrist"],
    },
  } as const;

  for (const [exerciseId, contract] of Object.entries(expected)) {
    const profile = getKinematicsProfile(exerciseId);
    assert.ok(profile, `${exerciseId} profile must remain registered`);
    assert.equal(profile.phaseSignal.kind, contract.signal);
    assert.equal(profile.phaseSignal.effortExtreme, contract.extreme);
    assert.equal(profile.phaseSignal.toExtreme, "concentric");
    assert.equal(profile.phaseSignal.fromExtreme, "eccentric");
    assert.deepEqual(profile.metrics.amplitude.joints, contract.amplitudeJoints);
    assert.match(profile.metrics.amplitude.definitionId, new RegExp(`^${exerciseId.replaceAll("_", "-")}/v1/`));
    assert.match(profile.metrics.phaseDuration.definitionId, new RegExp(`^${exerciseId.replaceAll("_", "-")}/v1/`));
  }
});

test("profile archive retains a prior version after the current profile advances", () => {
  const v1 = getKinematicsProfile("barbell_row");
  assert.ok(v1);
  const v2 = { ...v1, version: "barbell-row-kinematics/v2" };
  const archive = buildKinematicsProfileArchive([v2], [v1]);

  assert.equal(archive.get(`barbell_row:${v1.version}`), v1);
  assert.equal(archive.get("barbell_row:barbell-row-kinematics/v2"), v2);
});
