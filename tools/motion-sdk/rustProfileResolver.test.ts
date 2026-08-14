import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCoarseMotionView,
  resolveRustExerciseProfile,
  resolveRustRuntimeProfile,
} from "../../src/motion/rustProfileResolver";

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

test("local-coordinate candidates are explicit, equipment-exact, and preserve oblique handedness", () => {
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "barbell_bench_press",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "",
    equipment: "barbell",
    experiment: "local-motion-coordinate-v1",
  }), "barbell_bench_press_local_front_left");
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "seated_shoulder_press",
    capturePosition: "frontRight45",
    trainingSide: "bilateral",
    variation: "",
    equipment: "barbell",
    experiment: "local-motion-coordinate-v1",
  }), "seated_barbell_shoulder_press_local_front_right");
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "seated_shoulder_press",
    capturePosition: "rear",
    trainingSide: "bilateral",
    variation: "",
    equipment: "barbell",
    experiment: "local-motion-coordinate-v1",
  }), null);
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "seated_shoulder_press",
    capturePosition: "front",
    trainingSide: "bilateral",
    variation: "",
    equipment: "dumbbell",
    experiment: "local-motion-coordinate-v1",
  }), "seated_shoulder_press_front");
  assert.equal(normalizeCoarseMotionView("frontLeft45"), "front_oblique_left");
  assert.equal(normalizeCoarseMotionView("frontRight45"), "front_oblique_right");
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "barbell_bench_press",
    capturePosition: "front_oblique_left",
    trainingSide: "bilateral",
    variation: "standard_variant",
    equipment: "barbell",
    experiment: "local-motion-coordinate-v1",
  }), "barbell_bench_press_local_front_left");
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "barbell_bench_press",
    capturePosition: "front",
    trainingSide: "bilateral",
    variation: "close_grip",
    equipment: "barbell",
    experiment: "local-motion-coordinate-v1",
  }), null, "an uncalibrated variation must fail closed");
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "seated_shoulder_press",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "",
    equipment: "barbell",
  }), null, "candidate code must not auto-promote without the explicit experiment");
  assert.equal(resolveRustExerciseProfile({
    exerciseId: "dumbbell_shoulder_press",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "",
    equipment: "dumbbell",
    experiment: "local-motion-coordinate-v1",
  }), null, "dumbbell context must not inherit the barbell oblique profile");
});

test("local-coordinate runtime profiles require the RTMPose Halpe-26 observation contract", () => {
  const context = {
    exerciseId: "seated_shoulder_press",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "",
    equipment: "barbell",
  } as const;

  assert.deepEqual(resolveRustRuntimeProfile({
    ...context,
    poseRuntime: { engine: "rtmpose", schema: "halpe26" },
  }), {
    kind: "built_in",
    profile: "seated_barbell_shoulder_press_local_front_left",
    promotion: null,
  });
  assert.deepEqual(resolveRustRuntimeProfile({
    ...context,
    poseRuntime: { engine: "mediapipe", schema: "blazepose33" },
  }), {
    kind: "legacy",
    profile: null,
    promotion: null,
  });
  assert.deepEqual(resolveRustRuntimeProfile({
    ...context,
    poseRuntime: { engine: "rtmpose", schema: "blazepose33" },
  }), {
    kind: "legacy",
    profile: null,
    promotion: null,
  });
  assert.deepEqual(resolveRustRuntimeProfile({
    exerciseId: "lat_pulldown",
    capturePosition: "rear",
    trainingSide: "bilateral",
    variation: "绳索直杆",
    poseRuntime: { engine: "mediapipe", schema: "blazepose33" },
  }), {
    kind: "built_in",
    profile: "lat_pulldown",
    promotion: null,
  }, "a compatible legacy BlazePose profile remains available");
});
