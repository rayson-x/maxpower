import assert from "node:assert/strict";
import test from "node:test";

import { resolveRustExerciseProfile } from "../../src/motion/rustProfileResolver";

test("Rust profile selection requires exact action, camera position, side, and variation", () => {
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "lat_pulldown",
    capturePosition: "rearLeft45",
    trainingSide: "bilateral",
    variation: "绳索直杆",
  }), "lat_pulldown_rear_left_45");
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "lat_pulldown",
    capturePosition: "front",
    trainingSide: "bilateral",
    variation: "",
  }), null);
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "lat_pulldown",
    capturePosition: "rear",
    trainingSide: "left",
    variation: "",
  }), null);
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "lat_pulldown",
    capturePosition: "rear",
    trainingSide: "bilateral",
    variation: "宽握",
  }), null);
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "seated_shoulder_press",
    capturePosition: "front",
    trainingSide: "bilateral",
    variation: "哑铃",
  }), "seated_shoulder_press_front");
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "seated_shoulder_press",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "器械",
  }), null);
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "seated_shoulder_press",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "绳索直杆",
  }), null);
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "lat_pulldown",
    capturePosition: "rear",
    trainingSide: "bilateral",
    variation: "哑铃",
  }), null);
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "lat_pulldown",
    capturePosition: "rear",
    trainingSide: "bilateral",
    variation: "随便写的未知器械",
  }), null);

  for (const [exerciseId, expected] of [
    ["march_in_place", "march_in_place"],
    ["side_step_touch", "side_step_touch"],
    ["alternating_knee_raise", "alternating_knee_raise"],
    ["step_jack", "step_jack"],
  ] as const) {
    assert.equal(resolveRustExerciseProfile({
      exerciseId,
      capturePosition: "front",
      trainingSide: "bilateral",
      variation: "",
    }), expected);
    assert.equal(resolveRustExerciseProfile({
      exerciseId,
      capturePosition: "frontLeft45",
      trainingSide: "bilateral",
      variation: "",
    }), null);
  }
});
