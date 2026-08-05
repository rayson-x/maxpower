import assert from "node:assert/strict";
import test from "node:test";

import { CanonicalActiveDurationAccumulator } from "../../src/motion/canonicalActiveDuration";

test("active duration follows canonical lifecycle and excludes paused wall time", () => {
  const duration = new CanonicalActiveDurationAccumulator();
  assert.equal(duration.update(0, "idle"), 0);
  assert.equal(duration.update(100, "active"), 0);
  assert.equal(duration.update(350, "active"), 250);
  assert.equal(duration.update(500, "paused"), 400);
  assert.equal(duration.update(900, "active"), 400);
  assert.equal(duration.update(1_000, "finished"), 500);
});
