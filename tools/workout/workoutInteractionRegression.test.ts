import assert from "node:assert/strict";
import test from "node:test";

import {
  projectLatestCanonicalRepRevisions,
} from "../../src/mobile/ui/workoutRealtime";
import type { MotionRepObservationFinding } from "../../src/motion/motionPacket";
import { workoutHorizontalIntent, workoutReorderIntent } from "../../src/mobile/ui/workoutGestures";

function rep(
  repId: bigint,
  revision: number,
  disposition: "confirmed" | "needs_review" | "rejected",
  observationFindings: readonly MotionRepObservationFinding[] = [],
) {
  return { repId, revision, disposition, observationFindings };
}

test("Realtime counter projects only the latest Rust revision for each logical rep", () => {
  const projected = projectLatestCanonicalRepRevisions([
    { subjectEpoch: 7n, completedReps: [rep(1n, 1, "confirmed")] },
    { subjectEpoch: 7n, completedReps: [rep(1n, 2, "rejected")] },
    { subjectEpoch: 8n, completedReps: [rep(1n, 1, "confirmed")] },
    { subjectEpoch: 7n, completedReps: [rep(2n, 1, "confirmed", ["cycle_faster_than_expected"])] },
  ]);

  assert.equal(projected.confirmedCount, 2);
  assert.deepEqual(projected.latestConfirmedFindings, ["cycle_faster_than_expected"]);
});

test("workout route gestures require dominant committed intent", () => {
  assert.equal(workoutHorizontalIntent(11, 2, 18), "none", "natural hand jitter");
  assert.equal(workoutHorizontalIntent(-70, 60, 64), "none", "vertical scroll wins");
  assert.equal(workoutHorizontalIntent(-70, 8, 64), "left");
  assert.equal(workoutHorizontalIntent(70, 8, 64), "right");
  assert.equal(workoutReorderIntent(2, -40, false), "none", "vertical motion is inert before long press");
  assert.equal(workoutReorderIntent(2, -40, true), "up");
  assert.equal(workoutReorderIntent(2, 40, true), "down");
});
