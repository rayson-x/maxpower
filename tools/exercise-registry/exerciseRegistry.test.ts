import assert from "node:assert/strict";
import test from "node:test";

import {
  EXERCISE_REGISTRY,
  loadExerciseRegistry,
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
