import assert from "node:assert/strict";
import test from "node:test";

import {
  projectLatestCanonicalRepRevisions,
} from "../../src/mobile/ui/workoutRealtime";
import type { MotionRepObservationFinding } from "../../src/motion/motionPacket";

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
