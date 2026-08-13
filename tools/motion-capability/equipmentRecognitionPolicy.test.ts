import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveEquipmentRecognitionPolicy,
  routeEquipmentObservations,
} from "../../src/motion/equipmentRecognitionPolicy";

test("器械识别只由用户选择的具体动作开启", () => {
  const bench = resolveEquipmentRecognitionPolicy({ exerciseId: "barbell_bench_press" });
  assert.equal(bench.enabled, true);
  assert.deepEqual(bench.kinds, ["barbell_shaft", "weight_plate"]);
  assert.equal(bench.role, "phase_evidence");
  assert.equal(bench.requiredForRepCounting, false);

  const pushUp = resolveEquipmentRecognitionPolicy({ exerciseId: "push_up" });
  assert.equal(pushUp.enabled, false);
  assert.deepEqual(pushUp.kinds, []);

  const noSelection = resolveEquipmentRecognitionPolicy({ exerciseId: "" });
  assert.equal(noSelection.enabled, false);
});

test("名称不足以确定器械时必须使用用户给出的器械上下文", () => {
  const unspecified = resolveEquipmentRecognitionPolicy({ exerciseId: "romanian_deadlift" });
  assert.equal(unspecified.enabled, false);
  assert.equal(unspecified.reason, "equipment-variant-not-selected");

  const barbell = resolveEquipmentRecognitionPolicy({
    exerciseId: "romanian_deadlift",
    selectedEquipment: "barbell",
  });
  assert.deepEqual(barbell.kinds, ["barbell_shaft", "weight_plate"]);

  const dumbbell = resolveEquipmentRecognitionPolicy({
    exerciseId: "romanian_deadlift",
    selectedEquipment: "dumbbell",
  });
  assert.deepEqual(dumbbell.kinds, ["dumbbell"]);

  const shoulderBarbell = resolveEquipmentRecognitionPolicy({
    exerciseId: "seated_shoulder_press",
    selectedEquipment: "barbell",
  });
  assert.deepEqual(shoulderBarbell.kinds, ["barbell_shaft", "weight_plate"]);
  const shoulderDumbbell = resolveEquipmentRecognitionPolicy({
    exerciseId: "seated_shoulder_press",
    selectedEquipment: "dumbbell",
  });
  assert.deepEqual(shoulderDumbbell.kinds, ["dumbbell"]);
});

test("关闭偏好和动作切换都不能把旧器械观测送进 Rust", () => {
  const observation = {
    proposalId: 1,
    kind: "barbell_shaft" as const,
    bbox: { x: 0.2, y: 0.3, width: 0.5, height: 0.02 },
    score: 0.9,
    uncertaintyPx: 3,
    source: "detector" as const,
  };
  assert.deepEqual(routeEquipmentObservations(
    resolveEquipmentRecognitionPolicy({ exerciseId: "barbell_bench_press", preference: "disabled" }),
    [observation],
  ), []);
  assert.deepEqual(routeEquipmentObservations(
    resolveEquipmentRecognitionPolicy({ exerciseId: "dumbbell_bench_press" }),
    [observation],
  ), []);
});
