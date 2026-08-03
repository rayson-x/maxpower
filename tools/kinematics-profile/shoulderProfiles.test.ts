import assert from "node:assert/strict";
import test from "node:test";

import { EXERCISE_REGISTRY } from "../../src/pose/exerciseRegistry";
import { getKinematicsProfile } from "../../src/pose/kinematicsProfile";
import { classifyLocally } from "../../src/pose/localClassifier";
import type { TrajectoryFeatures } from "../../src/pose/trajectory";

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

test("auto recognition rejects seated vertical motion that can be a shoulder press", () => {
  const trajectory: TrajectoryFeatures = {
    topology: "blazepose33",
    frames: 120,
    scaledFrameRatio: 1,
    jointRom: [
      { joint: "elbow", meanDeg: 110, p05Deg: 70, p95Deg: 145, rangeDeg: 75, rawMinDeg: 65, rawMaxDeg: 150 },
      { joint: "shoulder", meanDeg: 90, p05Deg: 50, p95Deg: 130, rangeDeg: 80, rawMinDeg: 45, rawMaxDeg: 135 },
    ],
    dominantJoint: "shoulder",
    wristPath: { points: 120, pathLength: 5, netDisplacement: 0.1, straightness: 0.02, principalAxisDeg: 90, linearity: 0.95, primaryRange: 1.2, secondaryRange: 0.08, rangeX: 0.08, rangeY: 1.2 },
    wristSide: "left",
    wristPathLeft: null,
    wristPathRight: null,
    bilateralPathGap: 0.08,
    hipPath: null,
    shoulderPath: null,
    bodyTravelRatio: 0.12,
    period: { periodSec: 2, strength: 0.8 },
    consistency: null,
    torsoAngle: { meanDeg: 10, maxDeg: 12, driftDeg: 2 },
  };
  const result = classifyLocally({
    trajectory,
    posture: "seated",
    segmentation: {
      signal: "wrist_height",
      periodStrength: 0.8,
      periodSec: 2,
      cycles: [{ index: 1, startMs: 0, extremeMs: 1_000, endMs: 2_000, durationMs: 2_000, amplitude: 0.8 }],
      extremeAtLow: true,
      ranking: [],
    },
  });

  assert.equal(result.id, "unknown");
  assert.equal(result.confidence, "low");
  assert.match(result.dataIssues.join("\n"), /无法区分推肩与高位下拉/);
});
