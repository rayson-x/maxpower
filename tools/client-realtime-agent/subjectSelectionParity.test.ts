import assert from "node:assert/strict";
import test from "node:test";

import {
  associatePersonCandidateIds,
  selectDominantContinuousPerson,
} from "../../src/pose/RtmposeEngine";
import { writeRgbaPixelsAsBgrChw } from "../../src/pose/YoloxPersonDetector";

const detection = (bbox: readonly [number, number, number, number]) => ({ bbox, score: 0.9 });

test("v5 acquires the dominant centered subject", () => {
  const foreground = detection([200, 100, 520, 900]);
  const reflection = detection([20, 50, 150, 500]);
  const result = selectDominantContinuousPerson([reflection, foreground], null, 720, 1280);
  assert.equal(result.detection, foreground);
  assert.equal(result.reason, "initial_dominant_centered");
});

test("v5 rejects a mirror jump and keeps identity for a later frame", () => {
  const previous = [200, 100, 520, 900] as const;
  const mirror = detection([0, 100, 250, 900]);
  const rejected = selectDominantContinuousPerson([mirror], previous, 720, 1280);
  assert.equal(rejected.detection, null);
  assert.equal(rejected.reason, "identity_mismatch_rejected");
  const continuous = detection([205, 105, 525, 905]);
  const reacquired = selectDominantContinuousPerson([mirror, continuous], previous, 720, 1280);
  assert.equal(reacquired.detection, continuous);
  assert.equal(reacquired.reason, "continuous_iou_center");
});

test("v5 allows a dominant body to replace a tiny tentative initial lock", () => {
  const tiny = [330, 100, 390, 180] as const;
  const body = detection([170, 80, 550, 1100]);
  const result = selectDominantContinuousPerson([body], tiny, 720, 1280);
  assert.equal(result.detection, body);
  assert.equal(result.reason, "dominant_subject_reacquired");
});

test("raw candidate adapter keeps a new exerciser separate from an earlier false person box", () => {
  const previous = [{ ...detection([0, 0, 300, 700]), candidateId: 4 }];
  const machine = detection([2, 0, 302, 700]);
  const exerciser = detection([560, 80, 710, 680]);

  const result = associatePersonCandidateIds(
    [machine, exerciser], previous, 1280, 720, 5,
  );

  assert.deepEqual(result.detections.map((item) => item.candidateId), [4, 5]);
  assert.equal(result.nextCandidateId, 6);
});

test("raw candidate adapter preserves both identities when detector order changes", () => {
  const previous = [
    { ...detection([100, 100, 300, 650]), candidateId: 7 },
    { ...detection([800, 100, 1_000, 650]), candidateId: 8 },
  ];
  const result = associatePersonCandidateIds([
    detection([805, 102, 1_005, 652]),
    detection([105, 98, 305, 648]),
  ], previous, 1280, 720, 9);

  assert.deepEqual(result.detections.map((item) => item.candidateId), [8, 7]);
  assert.equal(result.nextCandidateId, 9);
});

test("client preprocessing writes OpenCV BGR planes instead of browser RGB", () => {
  const rgba = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 255,
  ]);
  const output = new Float32Array(6);

  writeRgbaPixelsAsBgrChw(rgba, output, 0, 2);

  assert.deepEqual(Array.from(output), [30, 60, 20, 50, 10, 40]);
});

test("client BGR pose normalization applies BGR-ordered mean and std", () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 255]);
  const output = new Float32Array(3);

  writeRgbaPixelsAsBgrChw(rgba, output, 0, 1, [1, 2, 3], [1, 2, 7]);

  assert.deepEqual(Array.from(output), [29, 9, 1]);
});
