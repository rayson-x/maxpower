import assert from "node:assert/strict";
import test from "node:test";

import { buildJointAngleArc } from "../../src/motion/jointAngleOverlay";
import type { DecodedJointAngle } from "../../src/motion/motionPacket";

const leftElbow: DecodedJointAngle = {
  kind: "elbow",
  side: "left",
  valueDeg: 90,
  confidence: 0.95,
  source: "measured",
  judgeable: true,
};

test("angle overlay positions an arc from canonical points but keeps the Rust value", () => {
  const points = new Map([
    [11, { x: 10, y: 0 }],
    [13, { x: 10, y: 10 }],
    [15, { x: 20, y: 10 }],
  ]);
  const presentation = buildJointAngleArc(leftElbow, (index) => points.get(index) ?? null, 8);
  assert.ok(presentation);
  assert.equal(presentation.valueText, "90°");
  assert.equal(presentation.accessibleLabel, "左肘 90°");
  assert.match(presentation.path, /^M 10\.000 10\.000 L /);
});

test("angle overlay refuses snapshots Rust marked as not judgeable", () => {
  const presentation = buildJointAngleArc(
    { ...leftElbow, judgeable: false, source: "predicted" },
    () => ({ x: 1, y: 1 }),
    8,
  );
  assert.equal(presentation, null);
});
