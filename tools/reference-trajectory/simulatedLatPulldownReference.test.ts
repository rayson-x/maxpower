import assert from "node:assert/strict";
import test from "node:test";

import { buildSimulatedLatPulldownReference } from "../../src/pose/simulatedLatPulldownReference";

const identity = {
  exerciseId: "lat_pulldown" as const,
  capturePosition: "rear" as const,
  variation: "front_bar_pronated",
  trainingSide: "bilateral" as const,
  equipment: "cable_lat_pulldown/straight_bar",
  coordinateSystem: "source-image/v1" as const,
  featureSchemaId: "lat_pulldown/source-image-piecewise-32/v2" as const,
  poseModelVersion: "mediapipe-pose-heavy",
};

test("simulated high-pulldown baseline is installable-shaped but explicitly uncalibrated", () => {
  const profile = buildSimulatedLatPulldownReference(identity);
  assert.equal(profile.profileStatus, "simulated_nominal");
  assert.equal(profile.referencePopulation.repCount, 0);
  assert.equal(profile.corridor.nodes.length, 32);
  assert.equal(profile.corridor.nodes[0]?.phase, "pull");
  assert.equal(profile.corridor.nodes[16]?.phase, "return");
  const startElbow = profile.corridor.nodes[0]!.features[2]!;
  const bottomElbow = profile.corridor.nodes[15]!.features[2]!;
  assert.ok((startElbow.median ?? 0) > (bottomElbow.median ?? 0));
  for (const node of profile.corridor.nodes) {
    for (const feature of node.features) {
      assert.ok(feature.nObserved > 0, "Rust reference ABI requires an explicit nominal envelope");
      assert.ok((feature.qLow ?? Infinity) <= (feature.qHigh ?? -Infinity));
    }
  }
});
