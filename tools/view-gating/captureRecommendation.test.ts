import assert from "node:assert/strict";
import test from "node:test";

import { recommendCapturePosition } from "../../src/pose/viewGating";

test("exercise defaults choose the documented capture placement", () => {
  assert.equal(recommendCapturePosition("seated_shoulder_press")?.position, "frontLeft45");
  assert.equal(recommendCapturePosition("lateral_raise")?.position, "front");
  assert.equal(recommendCapturePosition("rear_delt_fly")?.position, "rearLeft45");
  assert.equal(recommendCapturePosition("romanian_deadlift")?.position, "left");
  assert.equal(recommendCapturePosition("unlisted_action"), null);
});
