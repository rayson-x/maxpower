import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_TRACKER_READINESS,
  updateTrackerReadiness,
} from "../../src/pose/trackerReadiness";

test("tracker readiness separates asset loading, source calibration, and stable tracking", () => {
  const loaded = updateTrackerReadiness(INITIAL_TRACKER_READINESS, {
    assetsReady: true,
    sourceOpen: false,
    targetLocked: false,
    usableLandmarkRatio: 0,
  });
  assert.equal(loaded.phase, "loaded");

  const calibrating = updateTrackerReadiness(loaded, {
    assetsReady: true,
    sourceOpen: true,
    targetLocked: true,
    usableLandmarkRatio: 1,
  });
  assert.equal(calibrating.phase, "calibrating");

  const ready = updateTrackerReadiness(calibrating, {
    assetsReady: true,
    sourceOpen: true,
    targetLocked: true,
    usableLandmarkRatio: 1,
  });
  assert.equal(ready.phase, "ready");
});

test("an invalid frame resets calibration before readiness", () => {
  const firstStable = updateTrackerReadiness(
    { phase: "loaded", stableFrameCount: 0 },
    { assetsReady: true, sourceOpen: true, targetLocked: true, usableLandmarkRatio: 0.9 },
  );
  const reset = updateTrackerReadiness(firstStable, {
    assetsReady: true,
    sourceOpen: true,
    targetLocked: false,
    usableLandmarkRatio: 0.9,
  });

  assert.deepEqual(reset, { phase: "calibrating", stableFrameCount: 0 });
});

test("a ready tracker reports interruption and recovers on the next reliable frame", () => {
  const interrupted = updateTrackerReadiness(
    { phase: "ready", stableFrameCount: 2 },
    { assetsReady: true, sourceOpen: true, targetLocked: false, usableLandmarkRatio: 0 },
  );
  assert.equal(interrupted.phase, "interrupted");

  const recovered = updateTrackerReadiness(interrupted, {
    assetsReady: true,
    sourceOpen: true,
    targetLocked: true,
    usableLandmarkRatio: 0.8,
  });
  assert.equal(recovered.phase, "ready");
});
