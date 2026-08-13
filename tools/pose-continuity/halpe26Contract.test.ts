import assert from "node:assert/strict";
import test from "node:test";

import {
  BLAZEPOSE33_TO_COCO17,
  COCO17_KEYPOINT_COUNT,
  COCO17_KEYPOINT_NAMES,
  HALPE26_KEYPOINT_COUNT,
  HALPE26_KEYPOINT_NAMES,
  hasExactCoco17Prefix,
  mappedMmFitBlazePose33ToHalpe26,
} from "../../src/pose/halpe26";
import { detectTopology } from "../../src/pose/trajectory";

test("Halpe-26 preserves the exact COCO-17 prefix", () => {
  assert.equal(COCO17_KEYPOINT_COUNT, 17);
  assert.equal(HALPE26_KEYPOINT_COUNT, 26);
  assert.equal(hasExactCoco17Prefix(), true);
  assert.deepEqual(HALPE26_KEYPOINT_NAMES.slice(0, 17), COCO17_KEYPOINT_NAMES);
  assert.deepEqual(HALPE26_KEYPOINT_NAMES.slice(17), [
    "head",
    "neck",
    "hip_center",
    "left_big_toe",
    "right_big_toe",
    "left_small_toe",
    "right_small_toe",
    "left_heel",
    "right_heel",
  ]);
});

test("MM-Fit mapping preserves its real COCO prefix and marks added points unavailable", () => {
  const blaze = Array.from({ length: 33 }, (_, index) => ({
    x: index / 100,
    y: index / 200,
    z: -index / 300,
    visibility: 0.9,
  }));
  const halpe = mappedMmFitBlazePose33ToHalpe26(blaze);
  assert.equal(halpe.length, 26);
  BLAZEPOSE33_TO_COCO17.forEach((sourceIndex, targetIndex) => {
    assert.deepEqual(halpe[targetIndex], blaze[sourceIndex]);
  });
  halpe.slice(17).forEach((landmark) => {
    assert.equal(landmark.visibility, 0);
  });
});

test("trajectory topology distinguishes Halpe-26 from its COCO prefix", () => {
  const pose = (count: number) => [{
    timestampMs: 0,
    landmarks: Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0, visibility: 1 })),
    worldLandmarks: [],
  }];
  assert.equal(detectTopology(pose(17)), "coco17");
  assert.equal(detectTopology(pose(26)), "halpe26");
  assert.equal(detectTopology(pose(33)), "blazepose33");
});
