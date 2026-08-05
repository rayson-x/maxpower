import assert from "node:assert/strict";
import test from "node:test";

import {
  HOME_WORKOUT_ACTIONS,
  evaluateHomeWorkoutValidation,
  type HomeWorkoutValidationRound,
} from "../../src/motion/homeWorkoutValidation";

test("empty home-workout evidence remains explicitly unmeasured", () => {
  const report = evaluateHomeWorkoutValidation({ rounds: [], performanceRuns: [] });
  assert.equal(report.status, "unmeasured");
  assert.equal(report.criteria.countError.status, "unmeasured");
  assert.equal(report.criteria.processedFps.status, "unmeasured");
});

test("complete held-out field and device evidence passes every fixed threshold", () => {
  const rounds: HomeWorkoutValidationRound[] = [];
  for (let participant = 1; participant <= 5; participant += 1) {
    for (const action of HOME_WORKOUT_ACTIONS) {
      for (const round of [1, 2, 3] as const) {
        rounds.push({ participantId: `p${participant}`, action, round, durationMs: 45_000,
          manualRepCount: 20, recognizedRepCount: 19, startLatencyMs: 500, stopLatencyMs: 700,
          restDurationMs: 30_000, restFalseRepCount: 1, processedFrames: 900, validFrames: 855,
          processedFps: 20, droppedFrames: null, maxBacklogFrames: 1 });
      }
    }
  }
  const report = evaluateHomeWorkoutValidation({ rounds, performanceRuns: [{
    deviceId: "declared-midrange-phone", durationMs: 480_000, processedFrames: 9_600,
    validFrames: 9_120, processedFps: 20, droppedFrames: null, maxBacklogFrames: 1,
    crashed: false, sustainedBacklog: false,
  }] });
  assert.equal(report.status, "pass");
  assert.equal(report.coverageComplete, true);
  assert.equal(report.perAction.step_jack.countErrorRate, 0.05);
});

test("one failing action or unsafe device run fails the report", () => {
  const report = evaluateHomeWorkoutValidation({ rounds: [{
    participantId: "p1", action: "march_in_place", round: 1, durationMs: 45_000,
    manualRepCount: 20, recognizedRepCount: 10, startLatencyMs: 1_500, stopLatencyMs: 500,
    restDurationMs: 30_000, restFalseRepCount: 2, processedFrames: 100, validFrames: 80,
    processedFps: 12, droppedFrames: 20, maxBacklogFrames: 2,
  }], performanceRuns: [{
    deviceId: "phone", durationMs: 300_000, processedFrames: 3_600, validFrames: 3_000,
    processedFps: 12, droppedFrames: 100, maxBacklogFrames: 2, crashed: true,
    sustainedBacklog: true,
  }] });
  assert.equal(report.status, "fail");
  assert.equal(report.perAction.march_in_place.status, "fail");
  assert.equal(report.criteria.boundedBacklog.status, "fail");
});

test("the eight-minute device run cannot hide an invalid canonical-frame ratio", () => {
  const report = evaluateHomeWorkoutValidation({ rounds: [], performanceRuns: [{
    deviceId: "phone", durationMs: 480_000, processedFrames: 9_600, validFrames: 7_680,
    processedFps: 20, droppedFrames: null, maxBacklogFrames: 1, crashed: false,
    sustainedBacklog: false,
  }] });
  assert.equal(report.criteria.validFrameRatio.status, "fail");
  assert.equal(report.criteria.validFrameRatio.measured, 0.8);
});
