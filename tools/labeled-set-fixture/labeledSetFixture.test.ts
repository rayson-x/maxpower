import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLabeledSetFixtureTemplate,
  validateLabeledSetFixture,
} from "../../src/pose/labeledSetFixture";

const template = () =>
  buildLabeledSetFixtureTemplate({
    videoId: "gym-row-001.webm",
    keypointsFile: "gym-row-001.json",
    exerciseId: "barbell_row",
    cameraView: "oblique45",
    ruleVersion: "form-rules-experimental-v1",
    segments: [
      {
        repIndex: 0,
        startMs: 200,
        peakMs: 700,
        endMs: 1200,
        durationMs: 1000,
        concentricMs: 500,
        eccentricMs: 500,
        amplitude: 0.6,
      },
    ],
  });

test("labeled template freezes profile semantics and requires an explicit cohort identity", () => {
  const fixture = template();
  assert.equal(fixture.profileVersion, "barbell-row-kinematics/v1");
  assert.equal(fixture.ruleVersion, "form-rules-experimental-v1");
  assert.deepEqual(fixture.labels[0].labels, {
    amplitude: "unjudgeable",
    torsoCompensation: "unjudgeable",
    bilateralAsymmetry: "unjudgeable",
    eccentricControl: "unjudgeable",
  });
  assert.match(
    validateLabeledSetFixture(fixture, {
      videoId: fixture.videoId,
      keypointsFile: fixture.keypointsFile,
      durationMs: 1500,
    }).join("\n"),
    /subjectId/,
  );
});

test("labeled fixture validator catches profile drift, invalid labels, and overlapping reps", () => {
  const fixture = template();
  fixture.subjectId = "subject-a";
  fixture.recordingBatchId = "batch-a";
  fixture.profileVersion = "obsolete-profile";
  fixture.labels[0].labels.amplitude = "full";
  fixture.labels.push({
    ...fixture.labels[0],
    repIndex: 1,
    startMs: 1000,
    extremeMs: 1250,
    endMs: 1400,
    labels: { ...fixture.labels[0].labels, bilateralAsymmetry: "bad" as never },
  });
  const errors = validateLabeledSetFixture(fixture, {
    videoId: "different-recording.webm",
    keypointsFile: "different-recording.json",
    durationMs: 1500,
  });
  assert.match(errors.join("\n"), /profileVersion/);
  assert.match(errors.join("\n"), /overlaps/);
  assert.match(errors.join("\n"), /bilateralAsymmetry/);
  assert.match(errors.join("\n"), /videoId/);
  assert.match(errors.join("\n"), /keypointsFile/);
});
