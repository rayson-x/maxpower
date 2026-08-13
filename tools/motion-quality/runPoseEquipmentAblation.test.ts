import assert from "node:assert/strict";
import test from "node:test";

import {
  ablationFrameCandidates,
  buildRowNoWinnerScope,
  freezeStartEndTruthSplit,
} from "./runPoseEquipmentAblation";
import type { RawObservationFrame } from "./runnerInputs";

const rawFrame: RawObservationFrame = {
  frameNumber: 17,
  timestampMs: 850,
  selectedBbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
  landmarks: Array.from({ length: 26 }, (_, index) => ({
    x: index / 30,
    y: index / 40,
    z: 0,
    visibility: 0.9,
  })),
};

test("equipment-only keeps subject identity but supplies no joint pose signal", () => {
  const pose = ablationFrameCandidates(rawFrame, "pose_only");
  const equipment = ablationFrameCandidates(rawFrame, "equipment_only");

  assert.equal(equipment.length, 1);
  assert.deepEqual(equipment[0]?.bbox, pose[0]?.bbox);
  assert.equal(equipment[0]?.candidateId, pose[0]?.candidateId);
  assert.equal(equipment[0]?.landmarks.length, 26);
  assert.ok(equipment[0]?.landmarks.every((point) => (
    point.x === 0 && point.y === 0 && point.z === 0 && point.visibility === 0
  )));
  assert.ok(pose[0]?.landmarks.some((point) => point.visibility > 0));
});

test("start/end truth split is invariant to excluded historical peaks", () => {
  const first = freezeStartEndTruthSplit([{
    captureId: "bench-a",
    sourceCaptureId: "bench-a",
    exerciseId: "barbell_bench_press",
    capturePosition: "front",
    segments: [{ startMs: 100, peakMs: 250, endMs: 400 }],
  }]);
  const changedPeak = freezeStartEndTruthSplit([{
    captureId: "bench-a",
    sourceCaptureId: "bench-a",
    exerciseId: "barbell_bench_press",
    capturePosition: "front",
    segments: [{ startMs: 100, peakMs: 399, endMs: 400 }],
  }]);

  assert.deepEqual(first.contexts, changedPeak.contexts);
  assert.equal(first.truthSplitHash, changedPeak.truthSplitHash);
  assert.deepEqual(first.forbiddenFieldsConsumed, []);
});

test("row remains a separate no-winner scope when frozen equipment evidence is absent", () => {
  const row = buildRowNoWinnerScope();
  assert.equal(row.scope.actionId, "barbell_row");
  assert.equal(row.status, "no_winner");
  assert.equal(row.selectedCandidateId, null);
  assert.deepEqual(row.candidates, []);
  assert.match(row.missingEvidence, /row_equipment_sidecar/);
});
