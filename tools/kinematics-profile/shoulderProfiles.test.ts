import assert from "node:assert/strict";
import test from "node:test";

import { EXERCISE_REGISTRY } from "../../src/pose/exerciseRegistry";
import { getKinematicsProfile } from "../../src/pose/kinematicsProfile";

test("shoulder exercises are manually selectable experimental profiles with explicit signals", () => {
  const expected = {
    seated_shoulder_press: { signal: "wrist_height", extreme: "min", views: ["front", "oblique45"] },
    lateral_raise: { signal: "shoulder_angle", extreme: "max", views: ["front", "oblique45"] },
    rear_delt_fly: { signal: "shoulder_angle", extreme: "max", views: ["oblique45"] },
    face_pull: { signal: "elbow_angle", extreme: "min", views: ["front", "oblique45"] },
  } as const;

  for (const [exerciseId, contract] of Object.entries(expected)) {
    const exercise = EXERCISE_REGISTRY.require(exerciseId);
    assert.equal(exercise.maturity, "experimental");
    assert.equal(EXERCISE_REGISTRY.canRunSpecializedAnalysis(exerciseId), true);

    const profile = getKinematicsProfile(exerciseId);
    assert.ok(profile, `${exerciseId} needs a replay profile`);
    assert.equal(profile.autoRecognizable, false);
    assert.equal(profile.phaseSignal.kind, contract.signal);
    assert.equal(profile.phaseSignal.effortExtreme, contract.extreme);
    assert.deepEqual(profile.supportedViews, contract.views);
  }
});
