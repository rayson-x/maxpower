import assert from "node:assert/strict";
import test from "node:test";

import { workoutHorizontalIntent, workoutReorderIntent } from "../../src/mobile/ui/workoutGestures";

test("workout route gestures require dominant committed intent", () => {
  assert.equal(workoutHorizontalIntent(11, 2, 18), "none", "natural hand jitter");
  assert.equal(workoutHorizontalIntent(-70, 60, 64), "none", "vertical scroll wins");
  assert.equal(workoutHorizontalIntent(-70, 8, 64), "left");
  assert.equal(workoutHorizontalIntent(70, 8, 64), "right");
  assert.equal(workoutReorderIntent(2, -40, false), "none", "vertical motion is inert before long press");
  assert.equal(workoutReorderIntent(2, -40, true), "up");
  assert.equal(workoutReorderIntent(2, 40, true), "down");
});
