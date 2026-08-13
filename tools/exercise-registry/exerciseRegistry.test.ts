import assert from "node:assert/strict";
import test from "node:test";

import {
  EXERCISE_REGISTRY,
  loadExerciseRegistry,
  MUSCLE_GROUPS,
  type ExerciseConcept,
} from "../../src/pose/exerciseRegistry";

test("seed registry keeps historical ids and exposes catalog-only variants", () => {
  const historicalIds = [
    "barbell_row",
    "pull_up",
    "lat_pulldown",
    "seated_row",
    "straight_arm_pulldown",
  ];
  assert.deepEqual(
    historicalIds.filter((id) => !EXERCISE_REGISTRY.get(id)),
    [],
  );

  const catalogOnly = EXERCISE_REGISTRY.require("wide_grip_lat_pulldown");
  assert.equal(catalogOnly.variationOf, "lat_pulldown");
  assert.equal(catalogOnly.maturity, "catalog_only");
  assert.equal(EXERCISE_REGISTRY.canRunSpecializedAnalysis(catalogOnly.id), false);
  assert.ok(catalogOnly.source.name);
  assert.ok(catalogOnly.source.license);
});

test("catalog covers every training muscle group and carries the group in each record", () => {
  for (const group of MUSCLE_GROUPS) {
    assert.ok(
      EXERCISE_REGISTRY.exercises.some((exercise) => exercise.muscleGroup === group.id),
      `${group.labelZh} must have at least one catalog exercise`,
    );
  }
  assert.equal(EXERCISE_REGISTRY.require("barbell_bench_press").muscleGroup, "chest");
  assert.equal(EXERCISE_REGISTRY.require("romanian_deadlift").muscleGroup, "legs");
  assert.equal(EXERCISE_REGISTRY.require("conventional_deadlift").movementPattern, "hip_hinge");
  assert.equal(EXERCISE_REGISTRY.require("triceps_pushdown").muscleGroup, "arms");
});

test("catalog includes the first reviewed batch of common gym identities", () => {
  const commonExerciseIds = [
    "decline_barbell_bench_press",
    "chest_dip",
    "pec_deck_fly",
    "chin_up",
    "t_bar_row",
    "back_extension",
    "front_squat",
    "goblet_squat",
    "seated_leg_curl",
    "lying_leg_curl",
    "glute_bridge",
    "arnold_press",
    "dumbbell_shoulder_press",
    "upright_row",
    "preacher_curl",
    "incline_dumbbell_curl",
    "close_grip_bench_press",
  ];

  assert.deepEqual(
    commonExerciseIds.filter((exerciseId) => !EXERCISE_REGISTRY.get(exerciseId)),
    [],
  );
  assert.equal(EXERCISE_REGISTRY.exercises.length, 70);
  assert.ok(
    commonExerciseIds.every(
      (exerciseId) => EXERCISE_REGISTRY.require(exerciseId).maturity === "catalog_only",
    ),
  );
});

test("external research actions keep exact identities and remain catalog-only", () => {
  const expected = ["jumping_jack", "sit_up", "alternating_lunge", "standing_dumbbell_row", "alternating_dumbbell_biceps_curl"];
  assert.deepEqual(expected.filter((id) => !EXERCISE_REGISTRY.get(id)), []);
  assert.ok(expected.every((id) => EXERCISE_REGISTRY.require(id).maturity === "catalog_only"));
  assert.notEqual(EXERCISE_REGISTRY.require("jumping_jack").id, "step_jack");
  assert.notEqual(EXERCISE_REGISTRY.require("alternating_lunge").id, "walking_lunge");
  assert.equal(EXERCISE_REGISTRY.require("sit_up").muscleGroup, "core");
});

test("registry rejects duplicate ids, broken variants, and illegal maturity", () => {
  const base = EXERCISE_REGISTRY.require("barbell_row");
  assert.throws(
    () => loadExerciseRegistry([base, { ...base }]),
    /Duplicate exercise id/,
  );
  assert.throws(
    () => loadExerciseRegistry([{ ...base, id: "broken_child", variationOf: "missing" }]),
    /references missing variation parent/,
  );
  assert.throws(
    () => loadExerciseRegistry([{ ...base, muscleGroup: "neck" }]),
    /invalid muscleGroup/,
  );
  assert.throws(
    () => loadExerciseRegistry([{ ...base, maturity: "production" }]),
    /invalid maturity/,
  );
});

test("registry rejects cycles in otherwise valid variation relationships", () => {
  const base = EXERCISE_REGISTRY.require("barbell_row");
  const records: ExerciseConcept[] = [
    { ...base, id: "row_a", variationOf: "row_b" },
    { ...base, id: "row_b", variationOf: "row_a" },
  ];
  assert.throws(() => loadExerciseRegistry(records), /Variation cycle/);
});

test("registry owns free-text matching and leaves unknown labels unresolved", () => {
  assert.equal(EXERCISE_REGISTRY.matchText("宽握高位下拉")?.id, "wide_grip_lat_pulldown");
  assert.equal(EXERCISE_REGISTRY.matchText("Lat_Pulldown")?.id, "lat_pulldown");
  assert.equal(EXERCISE_REGISTRY.matchText("正手引体")?.id, "pull_up");
  assert.equal(EXERCISE_REGISTRY.matchText("传统杠铃硬拉")?.id, "conventional_deadlift");
  assert.equal(
    EXERCISE_REGISTRY.matchText("宽握高位下拉 Lat pulldown")?.id,
    "wide_grip_lat_pulldown",
  );
  assert.equal(EXERCISE_REGISTRY.matchText("unrecognised movement"), undefined);
});
