import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_MUSCLE_ASSOCIATIONS,
  loadExpectedMuscleAssociationDatabase,
  presentExpectedMuscleAssociation,
  type ExpectedMuscleAssociation,
} from "../../src/pose/expectedMuscleAssociations";

function knownAssociation(exerciseId: string): ExpectedMuscleAssociation {
  const association = EXPECTED_MUSCLE_ASSOCIATIONS.get(exerciseId);
  assert.ok(association, `Missing test association for ${exerciseId}`);
  return association;
}

test("known exercise exposes expected muscles and phase evidence without claiming activation", () => {
  assert.equal(
    EXPECTED_MUSCLE_ASSOCIATIONS.schemaVersion,
    "form-coach-expected-muscle-associations/v1",
  );
  const squat = knownAssociation("bodyweight_squat");

  assert.deepEqual(
    squat.muscles.filter((muscle) => muscle.role === "primary").map((muscle) => muscle.muscleId),
    ["quadriceps", "gluteals"],
  );
  assert.deepEqual(
    squat.phases.map((phase) => phase.id),
    ["lowering", "rising"],
  );
  assert.ok(
    squat.phases[1].expectedJointMotions.some(
      (motion) => motion.joint === "knee" && motion.action === "extension",
    ),
  );
  assert.equal(squat.claimLevel, "expected_participation");
  assert.equal(squat.evidenceStatus, "exact_exercise_reference");
  assert.equal("activationPercent" in squat, false);

  const presentation = presentExpectedMuscleAssociation("bodyweight_squat");
  assert.equal(presentation?.titleZh, "预计参与肌群");
  assert.match(presentation?.disclaimerZh ?? "", /不能直接测量肌肉激活/);
});

test("the current home-workout recognition profiles all have lightweight associations", () => {
  const homeWorkoutIds = [
    "march_in_place",
    "side_step_touch",
    "alternating_knee_raise",
    "step_jack",
  ];

  assert.deepEqual(
    homeWorkoutIds.filter((exerciseId) => !EXPECTED_MUSCLE_ASSOCIATIONS.get(exerciseId)),
    [],
  );
});

test("unknown exercise stays unknown instead of borrowing a nearby muscle map", () => {
  assert.equal(EXPECTED_MUSCLE_ASSOCIATIONS.get("reverse_lunge"), undefined);
  assert.equal(presentExpectedMuscleAssociation("reverse_lunge"), undefined);
});

test("database validation rejects unsupported identities and activation-like records", () => {
  const squat = knownAssociation("bodyweight_squat");

  assert.throws(
    () => loadExpectedMuscleAssociationDatabase([{ ...squat, exerciseId: "missing_exercise" }]),
    /unknown exercise/,
  );
  assert.throws(
    () => loadExpectedMuscleAssociationDatabase([squat, { ...squat }]),
    /Duplicate muscle association/,
  );
  assert.throws(
    () =>
      loadExpectedMuscleAssociationDatabase([
        { ...squat, muscles: squat.muscles.map((muscle) => ({ ...muscle, role: "secondary" })) },
      ]),
    /at least one primary muscle/,
  );
  assert.throws(
    () =>
      loadExpectedMuscleAssociationDatabase([
        { ...squat, activationPercent: 72 } as ExpectedMuscleAssociation,
      ]),
    /activationPercent is forbidden/,
  );
  assert.throws(
    () =>
      loadExpectedMuscleAssociationDatabase([
        {
          ...squat,
          phases: [
            {
              ...squat.phases[0],
              expectedMechanicalContributors: ["pectorals"],
            },
            squat.phases[1],
          ],
        },
      ]),
    /phase references undeclared muscle pectorals/,
  );
  assert.throws(
    () =>
      loadExpectedMuscleAssociationDatabase([
        { ...squat, sourceIds: ["ace-exercise-library"] },
      ]),
    /exact evidence must match the exercise identity/,
  );
});
