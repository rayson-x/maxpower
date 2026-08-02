import assert from "node:assert/strict";
import test from "node:test";

import { analyzePoseSet } from "../../src/pose/poseSetAnalysis";
import { loadPoseFixture } from "../harness/fixtureRepository";

test("barbell-row real fixture produces one versioned analysis result", () => {
  const fixture = loadPoseFixture("6e26dae721570a61cc5c9873d18c9380.mp4");
  const result = analyzePoseSet({
    poses: fixture.poses,
    cameraView: "oblique45",
    exercise: { mode: "user", exerciseId: "barbell_row" },
  });

  assert.notEqual(result.status, "unsupported");
  assert.equal(result.exercise.id, "barbell_row");
  assert.equal(result.exercise.userSelectionOverrodeAutoSuggestion, false);
  assert.equal(result.profile?.version, "barbell-row-kinematics/v1");
  assert.equal(result.profile?.phaseSignal.kind, "elbow_angle");
  assert.equal(result.profile?.phaseSignal.effortExtreme, "min");
  assert.ok(result.extraction && result.extraction.reps.length > 0);
  assert.equal(result.score?.totalRepCount, result.extraction?.reps.length);
  assert.equal(result.versions.rule, result.score?.engineVersion);
  assert.equal(result.coverage.totalEvaluations, result.coverage.passed +
    result.coverage.deducted + result.coverage.refused + result.coverage.notApplicable);
});

test("user selection records an override and catalog-only stays unscored", () => {
  const fixture = loadPoseFixture("6e26dae721570a61cc5c9873d18c9380.mp4");
  const selected = analyzePoseSet({
    poses: fixture.poses,
    cameraView: "oblique45",
    exercise: { mode: "user", exerciseId: "barbell_row" },
    autoSuggestion: { exerciseId: "seated_row", confidence: 0.9 },
  });
  assert.equal(selected.exercise.userSelectionOverrodeAutoSuggestion, true);

  const catalogOnly = analyzePoseSet({
    poses: fixture.poses,
    cameraView: "oblique45",
    exercise: { mode: "user", exerciseId: "wide_grip_lat_pulldown" },
  });
  assert.equal(catalogOnly.status, "unsupported");
  assert.equal(catalogOnly.score, null);
  assert.equal(catalogOnly.extraction, null);
  assert.match(catalogOnly.reason ?? "", /catalog_only/);
});
