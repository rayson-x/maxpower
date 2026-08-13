import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptRustExerciseProfileToPoseSchema,
  encodeRustExerciseProfileInstallation,
} from "../../src/motion/rustCanonicalWasm";
import { resolveSimulatedRecognitionProfile } from "../../src/motion/simulatedRecognitionProfile";

test("Halpe-26 data profile preserves the Rust ABI maturity-then-schema order", () => {
  const blazeProfile = resolveSimulatedRecognitionProfile({
    exerciseId: "barbell_back_squat",
    capturePosition: "left",
    trainingSide: "bilateral",
    variation: "",
  });
  assert.ok(blazeProfile);
  const profile = adaptRustExerciseProfileToPoseSchema(blazeProfile, "halpe26");
  const installation = encodeRustExerciseProfileInstallation(profile);

  assert.equal(installation.abiArguments[2], 0, "provisional maturity code");
  assert.equal(installation.abiArguments[3], 1, "Halpe-26 schema code");
});
