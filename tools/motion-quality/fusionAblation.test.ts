import assert from "node:assert/strict";
import test from "node:test";

import { freezeFusionPolicy } from "./fusionAblation";

const common = {
  actionId: "barbell_bench_press",
  capturePosition: "front",
  observationSetHash: "a".repeat(64),
  frameScheduleHash: "b".repeat(64),
  truthSplitHash: "c".repeat(64),
  endpointCoverage: 1,
  evidenceConflictRate: 0,
  abstentionRate: 0,
  p90ConfirmationLatencyMs: 200,
};

test("ablation can freeze fused bench evidence without creating a universal equipment priority", () => {
  const result = freezeFusionPolicy([
    { ...common, candidateId: "pose_only", precision: 0.91, recall: 0.22, exactSetRate: 0 },
    {
      ...common,
      candidateId: "pose_equipment_fused",
      precision: 1,
      recall: 1,
      exactSetRate: 1,
      poseLineage: "independent_measured_pose",
      equipmentLineage: "subject_associated_barbell_axis",
    },
  ]);
  assert.equal(result.status, "selected");
  assert.equal(result.selectedCandidateId, "pose_equipment_fused");
  assert.equal(result.scope.actionId, "barbell_bench_press");
  assert.equal(result.scope.capturePosition, "front");
  assert.match(result.policyHash ?? "", /^[0-9a-f]{64}$/);
});

test("ablation refuses to double count equipment-constrained pose", () => {
  assert.throws(() => freezeFusionPolicy([{
    ...common,
    candidateId: "pose_equipment_fused",
    precision: 1,
    recall: 1,
    exactSetRate: 1,
    poseLineage: "equipment_constrained_pose",
    equipmentLineage: "subject_associated_barbell_axis",
  }]), /independent/i);
});

test("ablation returns no winner instead of carrying bench policy into row", () => {
  const result = freezeFusionPolicy([{ ...common, actionId: "barbell_row", candidateId: "pose_only", precision: 0.9, recall: 0.9, exactSetRate: 0.8 }]);
  assert.equal(result.status, "no_winner");
  assert.equal(result.selectedCandidateId, null);
});
