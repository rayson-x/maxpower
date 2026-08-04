import assert from "node:assert/strict";
import test from "node:test";

import { computeRustExerciseProfileHash, type RustExerciseProfileData } from "../../src/motion/rustCanonicalWasm";
import { applyObservedRecognitionCompatibilityPolicy } from "../../src/motion/observedRecognitionProfiles";

const sourceProfile = (): RustExerciseProfileData => {
  const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
    identity: "lateral_raise/front/bilateral/observed/v1",
    maturity: "provisional",
    schema: "blazepose33",
    coordinateUnit: "image-angle-deg",
    stateMachineId: "ready-effort-peak-return/v1",
    requiredCapabilities: ["canonical-landmarks", "subject-lock"],
    direction: "increasing",
    primarySignal: { kind: "joint-angle", landmarks: [23, 11, 15] },
    secondarySignal: { kind: "joint-angle", landmarks: [24, 12, 16] },
    startAmplitude: 10,
    minPrimaryAmplitude: 24,
    minSecondaryAmplitude: 30,
    returnHysteresis: 7,
    readyTolerance: 7,
    maxGapMs: 700,
    minRepDurationMs: 700,
    maxRepDurationMs: 2_600,
  };
  return { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) };
};

test("front bilateral lateral raises use a bounded soft-cycle compatibility policy", () => {
  const source = sourceProfile();
  const actual = applyObservedRecognitionCompatibilityPolicy({
    exerciseId: "lateral_raise",
    capturePosition: "front",
    trainingSide: "bilateral",
    variation: "",
  }, source);

  assert.equal(actual.identity, "lateral_raise/front/bilateral/observed/v1/soft-cycle/v1");
  assert.equal(actual.minPrimaryAmplitude, 20.4);
  assert.equal(actual.minSecondaryAmplitude, 25.5);
  assert.equal(actual.minRepDurationMs, 595);
  assert.equal(actual.maxGapMs, source.maxGapMs);
  assert.notEqual(actual.contentHash, source.contentHash);
});

test("soft-cycle policy never leaks to a different view or explicit variation", () => {
  const source = sourceProfile();
  const wrongView = applyObservedRecognitionCompatibilityPolicy({
    exerciseId: "lateral_raise",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "",
  }, source);
  const explicitVariation = applyObservedRecognitionCompatibilityPolicy({
    exerciseId: "lateral_raise",
    capturePosition: "front",
    trainingSide: "bilateral",
    variation: "cable",
  }, source);
  assert.equal(wrongView, source);
  assert.equal(explicitVariation, source);
});

test("front bilateral rear-delt fly switches to its versioned wrist-spread signal", () => {
  const { contentHash: _sourceHash, ...sourceWithoutHash } = sourceProfile();
  const rearSourceWithoutHash = {
    ...sourceWithoutHash,
    identity: "rear_delt_fly/front/bilateral/observed/v1",
  };
  const source = {
    ...rearSourceWithoutHash,
    contentHash: computeRustExerciseProfileHash(rearSourceWithoutHash),
  };
  const actual = applyObservedRecognitionCompatibilityPolicy({
    exerciseId: "rear_delt_fly",
    capturePosition: "front",
    trainingSide: "bilateral",
    variation: "",
  }, source);
  assert.equal(actual.identity, "rear_delt_fly/front/bilateral/observed/v1/wrist-spread-cycle/v2");
  assert.equal(actual.coordinateUnit, "torso-normalized-distance");
  assert.deepEqual(actual.primarySignal, { kind: "landmark-distance", landmarks: [15, 16] });
  assert.deepEqual(actual.secondarySignal, { kind: "landmark-distance", landmarks: [15, 16] });
  assert.equal(actual.minPrimaryAmplitude, 0.15);
  assert.notEqual(actual.contentHash, source.contentHash);
});
