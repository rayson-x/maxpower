import assert from "node:assert/strict";
import test from "node:test";

import { EXERCISE_REGISTRY, MUSCLE_GROUPS } from "../../src/pose/exerciseRegistry";
import type { PoseEstimate } from "../../src/pose/PoseEngine";
import {
  MINIMUM_CALIBRATION_REPS,
  MINIMUM_REQUIRED_FEATURE_NODE_OBSERVATIONS,
  SIMULATED_PRIOR_NODE_COUNT,
  buildNominalSimulatedKinematicPrior,
  buildFiveSplitPriorWorkflow,
  buildObservedPriorRep,
  calibrateSimulatedKinematicPrior,
  instantiateSimulatedKinematicPrior,
  listSimulatedKinematicPriorTemplates,
  validateFiveSplitPriorCoverage,
  type SimulatedPriorIdentity,
} from "../../src/pose/simulatedKinematicPrior";

const squatIdentity: SimulatedPriorIdentity = {
  exerciseId: "bodyweight_squat",
  muscleGroup: "legs",
  variation: "bodyweight-standard",
  equipment: "bodyweight",
  capturePosition: "left",
  trainingSide: "bilateral",
  setupFingerprint: "bodyweight-floor/stance-shoulder-width/v1",
  coordinateSystem: "source-image/v1",
  featureSchemaId: "simulated-kinematic-features/v1",
  cameraUpright: true,
  isMirrored: false,
  projectionClass: "upright-image-2d",
  poseModelVersion: "mediapipe-pose-heavy",
};

test("simulated priors cover every five-split catalog exercise without claiming a form score", () => {
  assert.deepEqual(validateFiveSplitPriorCoverage(), []);
  const templates = listSimulatedKinematicPriorTemplates();
  assert.equal(templates.length, EXERCISE_REGISTRY.exercises.length);
  for (const group of MUSCLE_GROUPS) {
    assert.ok(templates.some((template) => template.muscleGroup === group.id), `${group.id} requires templates`);
  }
  const ready = instantiateSimulatedKinematicPrior(squatIdentity);
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  assert.equal(ready.prior.source, "simulated_kinematic_prior");
  assert.equal(ready.prior.calibrationStatus, "uncalibrated");
  assert.equal(ready.prior.qualityVerdict, null);
  assert.equal(ready.prior.nodes.length, SIMULATED_PRIOR_NODE_COUNT);
  assert.equal(ready.prior.nodes[0].phase, "to_extreme");
  assert.equal(ready.prior.nodes[15].phaseProgress, 1);
  assert.equal(ready.prior.nodes[16].phase, "from_extreme");
  assert.equal(ready.prior.nodes[31].phaseProgress, 1);
  assert.ok((ready.prior.nodes[15].latentFeatureValues.kneeAngleDeg ?? 0) < 0);
  assert.equal(ready.prior.nodes[31].latentFeatureValues.kneeAngleDeg, 0);

  for (const template of templates) {
    const nominal = buildNominalSimulatedKinematicPrior(template);
    assert.equal(nominal.nodes.length, SIMULATED_PRIOR_NODE_COUNT);
    assert.equal(nominal.identity.variation, "simulation-only/v1");
    assert.equal(nominal.identity.equipment, "simulation-only");
  }
});

test("squat, Romanian deadlift, and conventional deadlift retain separate phase priors", () => {
  const templates = listSimulatedKinematicPriorTemplates();
  const find = (exerciseId: string) => templates.find((template) => template.exerciseId === exerciseId)!;
  const squat = find("barbell_back_squat");
  const romanian = find("romanian_deadlift");
  const conventional = find("conventional_deadlift");
  assert.ok(squat.features.some((feature) => feature.feature === "kneeAngleDeg" && feature.trend === "decrease_to_extreme"));
  assert.ok(romanian.features.some((feature) => feature.feature === "kneeAngleDeg" && feature.trend === "hold"));
  assert.ok(conventional.features.some((feature) => feature.feature === "kneeAngleDeg" && feature.trend === "increase_to_extreme"));
  assert.notEqual(conventional.templateId, romanian.templateId);
});

test("prior instantiation requires exact observable identity instead of guessing equipment or camera context", () => {
  assert.equal(
    instantiateSimulatedKinematicPrior({ ...squatIdentity, variation: "" }).status,
    "rejected",
  );
  assert.equal(
    instantiateSimulatedKinematicPrior({ ...squatIdentity, capturePosition: "rear" }).status,
    "rejected",
  );
});

test("approved real reps calibrate a matching prior but never replace missing observations with synthetic coordinates", () => {
  const ready = instantiateSimulatedKinematicPrior(squatIdentity);
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  const observed = Array.from({ length: MINIMUM_CALIBRATION_REPS }, (_, index) =>
    buildObservedPriorRep({
      identity: squatIdentity,
      captureId: "future-leg-session-01",
      repIndex: index + 1,
      startMs: 0,
      extremeMs: 100,
      endMs: 200,
      poses: [squatPose(0, 160, 0.58), squatPose(100, 90, 0.72), squatPose(200, 160, 0.58)],
    }),
  );
  assert.ok(observed.every((result) => result.status === "ready"));
  const reps = observed.flatMap((result) => result.status === "ready" ? [result.rep] : []);
  assert.equal(reps.length, MINIMUM_CALIBRATION_REPS);
  assert.equal(reps[0].nodes.length, SIMULATED_PRIOR_NODE_COUNT);
  assert.ok(reps[0].nodes.some((node) => node.values.kneeAngleDeg !== null));
  assert.ok(
    (reps[0].nodes[0].values.hipHeightRelativeAnkleY ?? 0)
      < (reps[0].nodes[15].values.hipHeightRelativeAnkleY ?? 0),
    "hip height must be relative to a fixed ankle anchor, not merely torso orientation",
  );
  assert.equal(calibrateSimulatedKinematicPrior(ready.prior, [reps[0]]).status, "rejected");
  const calibrated = calibrateSimulatedKinematicPrior(ready.prior, reps);
  assert.equal(calibrated.status, "ready");
  if (calibrated.status !== "ready") return;
  assert.equal(calibrated.calibrated.calibrationStatus, "observed_personal_provisional");
  assert.equal(calibrated.calibrated.qualityVerdict, null);
  assert.equal(calibrated.calibrated.calibration.sourceRepCount, MINIMUM_CALIBRATION_REPS);
  assert.ok(calibrated.calibrated.calibration.featureCorridors
    .find((corridor) => corridor.feature === "kneeAngleDeg")!
    .nodes.some((node) => node.median !== null));

  const mismatched = reps.map((rep) => ({ ...rep, identity: { ...squatIdentity, capturePosition: "right" as const } }));
  assert.equal(calibrateSimulatedKinematicPrior(ready.prior, mismatched).status, "rejected");
  const duplicated = [...reps.slice(0, -1), reps[0]];
  assert.equal(calibrateSimulatedKinematicPrior(ready.prior, duplicated).status, "rejected");
  const malformed = reps.map((rep) => rep === reps[0]
    ? { ...rep, nodes: [{ ...rep.nodes[0], nodeIndex: 1 }, ...rep.nodes.slice(1)] }
    : rep);
  assert.equal(calibrateSimulatedKinematicPrior(ready.prior, malformed).status, "rejected");
  const sparse = reps.map((rep, index) => index === 0 ? rep : ({
    ...rep,
    nodes: rep.nodes.map((node) => ({
      ...node,
      values: { ...node.values, kneeAngleDeg: null },
    })),
  }));
  assert.equal(
    calibrateSimulatedKinematicPrior(ready.prior, sparse).status,
    "rejected",
    `${MINIMUM_REQUIRED_FEATURE_NODE_OBSERVATIONS}+ observations are required for every primary node`,
  );
});

test("mirrored source images canonicalize signed torso lean before their separate identity is calibrated", () => {
  const base: SimulatedPriorIdentity = {
    ...squatIdentity,
    exerciseId: "romanian_deadlift",
    variation: "barbell-standard",
    equipment: "barbell",
    setupFingerprint: "barbell-floor/stance-hip-width/v1",
  };
  const direct = buildObservedPriorRep({
    identity: base,
    captureId: "rdl-direct",
    repIndex: 1,
    startMs: 0,
    extremeMs: 100,
    endMs: 200,
    poses: [leanPose(0, false), leanPose(100, false), leanPose(200, false)],
  });
  const mirrored = buildObservedPriorRep({
    identity: { ...base, isMirrored: true },
    captureId: "rdl-mirrored",
    repIndex: 1,
    startMs: 0,
    extremeMs: 100,
    endMs: 200,
    poses: [leanPose(0, true), leanPose(100, true), leanPose(200, true)],
  });
  assert.equal(direct.status, "ready");
  assert.equal(mirrored.status, "ready");
  if (direct.status !== "ready" || mirrored.status !== "ready") return;
  assert.equal(
    direct.rep.nodes[0].values.torsoLeanImageDeg,
    mirrored.rep.nodes[0].values.torsoLeanImageDeg,
  );
});

test("five-split capture workflow reserves held-out video for every exact identity", () => {
  const workflow = buildFiveSplitPriorWorkflow();
  assert.equal(workflow.groups.length, 5);
  for (const group of workflow.groups) {
    const expectedExercises = EXERCISE_REGISTRY.exercises.filter((exercise) => exercise.muscleGroup === group.muscleGroup);
    for (const exercise of expectedExercises) {
      const steps = group.steps.filter((step) => step.exerciseId === exercise.id);
      assert.ok(steps.some((step) => step.role === "primary_calibration"), `${exercise.id} needs a primary capture`);
      assert.ok(steps.some((step) => step.role === "primary_held_out_validation"), `${exercise.id} needs a primary held-out capture`);
      assert.ok(steps.some((step) => step.role === "independent_profile_calibration"), `${exercise.id} needs an independent angle profile`);
      assert.ok(steps.every((step) => step.requiredMetadata.includes("setupFingerprint") && step.requiredMetadata.includes("projectionClass")));
    }
  }
});

function squatPose(timestampMs: number, kneeAngleDeg: number, hipY: number): PoseEstimate {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const radians = kneeAngleDeg * Math.PI / 180;
  for (const [offset, hip, knee, ankle] of [[0, 23, 25, 27], [0.12, 24, 26, 28]] as const) {
    landmarks[11 + (hip === 23 ? 0 : 1)] = { x: 0.42 + offset, y: 0.35, z: 0, visibility: 1 };
    landmarks[hip] = { x: 0.42 + offset, y: hipY, z: 0, visibility: 1 };
    landmarks[knee] = { x: 0.42 + offset, y: 0.78, z: 0, visibility: 1 };
    landmarks[ankle] = {
      x: 0.42 + offset + Math.sin(radians) * 0.12,
      y: 0.78 - Math.cos(radians) * 0.12,
      z: 0,
      visibility: 1,
    };
    landmarks[ankle + 2] = { x: landmarks[ankle].x + 0.04, y: landmarks[ankle].y + 0.02, z: 0, visibility: 1 };
  }
  return { timestampMs, landmarks, worldLandmarks: [] };
}

function leanPose(timestampMs: number, mirrored: boolean): PoseEstimate {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const x = (value: number) => mirrored ? 1 - value : value;
  landmarks[11] = { x: x(0.42), y: 0.3, z: 0, visibility: 1 };
  landmarks[12] = { x: x(0.58), y: 0.3, z: 0, visibility: 1 };
  landmarks[23] = { x: x(0.54), y: 0.62, z: 0, visibility: 1 };
  landmarks[24] = { x: x(0.7), y: 0.62, z: 0, visibility: 1 };
  landmarks[25] = { x: x(0.54), y: 0.78, z: 0, visibility: 1 };
  landmarks[26] = { x: x(0.7), y: 0.78, z: 0, visibility: 1 };
  landmarks[27] = { x: x(0.54), y: 0.9, z: 0, visibility: 1 };
  landmarks[28] = { x: x(0.7), y: 0.9, z: 0, visibility: 1 };
  landmarks[29] = { x: x(0.58), y: 0.9, z: 0, visibility: 1 };
  landmarks[30] = { x: x(0.74), y: 0.9, z: 0, visibility: 1 };
  return { timestampMs, landmarks, worldLandmarks: [] };
}
