import assert from "node:assert/strict";
import test from "node:test";

import { EXERCISE_REGISTRY } from "../../src/pose/exerciseRegistry";
import { getKinematicsProfile } from "../../src/pose/kinematicsProfile";

test("field-observed horizontal presses are selectable recognition profiles", () => {
  for (const exerciseId of ["barbell_bench_press", "machine_chest_press", "push_up"]) {
    const exercise = EXERCISE_REGISTRY.require(exerciseId);
    assert.equal(exercise.maturity, "experimental");
    assert.equal(EXERCISE_REGISTRY.canRunSpecializedAnalysis(exerciseId), true);

    const profile = getKinematicsProfile(exerciseId);
    assert.ok(profile, `${exerciseId} needs an installed kinematics profile`);
    assert.equal(profile.movementPattern, "horizontal_push");
    assert.equal(profile.autoRecognizable, false);
    assert.equal(profile.phaseSignal.kind, "elbow_angle");
    assert.equal(profile.phaseSignal.effortExtreme, "max");
    assert.deepEqual(profile.supportedViews, ["front", "oblique45"]);
  }
});
