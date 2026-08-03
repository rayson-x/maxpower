import assert from "node:assert/strict";
import test from "node:test";

import { MotionPerformanceDegradationController } from "../../src/motion/performanceDegradation";

test("performance degradation reacts to P95 without disabling safety contracts", () => {
  const controller = new MotionPerformanceDegradationController();
  for (let index = 0; index < 30; index += 1) controller.observe(1.2);
  assert.equal(controller.currentLevel(), 1);
  for (let index = 0; index < 30; index += 1) controller.observe(1.8);
  assert.equal(controller.currentLevel(), 2);
  // The controller returns only a cadence level. It has no switch for target
  // identity, ordering, unknown landmarks, or refusal semantics.
  assert.deepEqual(Object.keys(controller.observe(1.8)).sort(), ["changed", "level", "reason"]);
});
