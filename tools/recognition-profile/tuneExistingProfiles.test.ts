import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRustExerciseProfileHash,
  encodeRustExerciseProfileInstallation,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import { resolveGenerationArtifactPaths } from "./generate";
import {
  mergeProfileEntries,
  resolveTuningArtifactPaths,
  scoreReplayObjective,
  matchSegments,
  selectBeamByScore,
  type ReplayObjectiveRow,
} from "./tuneExistingProfiles";

const root = "/workspace/maxpower";

test("standalone tuning requires an injected workflow-run candidate destination", () => {
  assert.throws(() => resolveTuningArtifactPaths([], root), /--output/);
  assert.throws(() => resolveTuningArtifactPaths([
    "--dataset", "data/training/personal-golden-segmentation-v1.json",
    "--source", "data/workflows/motion-profile/manual/run-1/candidates/seed.json",
    "--output",
    "public/archives/confirmed-captures/recognition-profiles.candidate.json",
  ], root), /data\/workflows\/motion-profile/);
});

test("standalone tuning keeps candidate and report inside one workflow run", () => {
  const paths = resolveTuningArtifactPaths([
    "--dataset", "data/training/personal-golden-segmentation-v1.json",
    "--source", "data/workflows/motion-profile/manual/run-1/candidates/seed.json",
    "--output",
    "data/workflows/motion-profile/manual/run-1/candidates/self-profiles.json",
  ], root);
  assert.equal(paths.datasetPath, "/workspace/maxpower/data/training/personal-golden-segmentation-v1.json");
  assert.equal(paths.sourcePath, "/workspace/maxpower/data/workflows/motion-profile/manual/run-1/candidates/seed.json");
  assert.equal(paths.outputPath, "/workspace/maxpower/data/workflows/motion-profile/manual/run-1/candidates/self-profiles.json");
  assert.equal(paths.reportPath, "/workspace/maxpower/data/workflows/motion-profile/manual/run-1/training-report.json");
  assert.throws(() => resolveTuningArtifactPaths([
    "--dataset", "data/training/personal-golden-segmentation-v1.json",
    "--source", "data/workflows/motion-profile/manual/run-1/candidates/seed.json",
    "--output",
    "data/workflows/motion-profile/manual/run-1/candidates/self-profiles.json",
    "--report",
    "docs/reports/leaked.json",
  ], root), /same workflow run/);
});

test("observed profile generation cannot overwrite the production profile artifact", () => {
  assert.throws(() => resolveGenerationArtifactPaths([], root), /--dataset/);
  assert.throws(() => resolveGenerationArtifactPaths([
    "--dataset", "data/training/personal-golden-segmentation-v1.json",
    "--output", "public/archives/confirmed-captures/recognition-profiles.json",
  ], root), /data\/workflows\/motion-profile/);
  assert.deepEqual(resolveGenerationArtifactPaths([
    "--dataset", "data/training/personal-golden-segmentation-v1.json",
    "--output", "data/workflows/motion-profile/personal/run-1/candidates/seed.json",
  ], root), {
    datasetPath: "/workspace/maxpower/data/training/personal-golden-segmentation-v1.json",
    outputPath: "/workspace/maxpower/data/workflows/motion-profile/personal/run-1/candidates/seed.json",
  });
});

test("beam selection keeps the highest-scoring unique candidates deterministically", () => {
  const selected = selectBeamByScore(
    [
      { id: "b", score: 2 },
      { id: "a", score: 3 },
      { id: "b", score: 5 },
      { id: "c", score: 3 },
    ],
    2,
    (item) => item.id,
    (item) => item.score,
  );
  assert.deepEqual(selected, [
    { id: "b", score: 5 },
    { id: "a", score: 3 },
  ]);
});

test("tuning appends a newly recovered exact-context profile instead of dropping it", () => {
  assert.deepEqual(mergeProfileEntries(
    [{ exerciseId: "raise", capturePosition: "front", value: 1 }],
    [
      { exerciseId: "raise", capturePosition: "front", value: 2 },
      { exerciseId: "raise", capturePosition: "rearRight45", value: 3 },
    ],
  ), [
    { exerciseId: "raise", capturePosition: "front", value: 2 },
    { exerciseId: "raise", capturePosition: "rearRight45", value: 3 },
  ]);
});

test("median state graphs keep stable ABI codes for profile installation", () => {
  const stateMachines: Array<[RustExerciseProfileData["stateMachineId"], number]> = [
    ["ready-effort-peak-return/v1", 0],
    ["alternating-ready-effort-return/v1", 1],
    ["median-100ms-ready-effort-peak-return/v1", 2],
    ["median-200ms-ready-effort-peak-return/v1", 3],
    ["median-300ms-ready-effort-peak-return/v1", 4],
    ["median-400ms-ready-effort-peak-return/v1", 5],
    ["median-600ms-ready-effort-peak-return/v1", 6],
    ["cycle-aligned-ready-effort-peak-return/v1", 7],
    ["cycle-aligned-median-100ms-ready-effort-peak-return/v1", 8],
    ["cycle-aligned-median-200ms-ready-effort-peak-return/v1", 9],
    ["cycle-aligned-median-300ms-ready-effort-peak-return/v1", 10],
    ["cycle-aligned-median-400ms-ready-effort-peak-return/v1", 11],
    ["cycle-aligned-median-600ms-ready-effort-peak-return/v1", 12],
    ["stable-cycle-200ms-ready-effort-peak-return/v1", 13],
  ];
  for (const [stateMachineId, expectedCode] of stateMachines) {
    const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
      identity: `test/front/bilateral/bodyweight/${expectedCode}`,
      maturity: "provisional",
      schema: "blazepose33",
      coordinateUnit: "image-angle-deg",
      stateMachineId,
      requiredCapabilities: ["canonical-landmarks", "subject-lock"],
      direction: "auto",
      primarySignal: { kind: "joint-angle", landmarks: [11, 13, 15] },
      secondarySignal: { kind: "joint-angle", landmarks: [12, 14, 16] },
      startAmplitude: 5,
      minPrimaryAmplitude: 20,
      minSecondaryAmplitude: 20,
      returnHysteresis: 4,
      readyTolerance: 5,
      maxGapMs: 700,
      minRepDurationMs: 450,
      maxRepDurationMs: 8_000,
    };
    const profile = { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) };
    assert.equal(encodeRustExerciseProfileInstallation(profile).abiArguments[5], expectedCode);
  }
});

test("profile objective refuses count equality that trades away aligned cycles", () => {
  const row = (
    predictedCount: number,
    matchedCount: number,
    alignedCount: number,
    exact: boolean,
  ): ReplayObjectiveRow => ({
    expectedSetCount: 8,
    truthCount: 8,
    predictedCount,
    matchedCount,
    alignedCount,
    alignmentErrorMs: (matchedCount - alignedCount) * 2_000,
    falsePositiveCount: Math.max(0, predictedCount - matchedCount),
    needsReviewCount: 0,
    exact,
  });
  const threeEqualCountsOneAligned = [
    row(8, 8, 8, true),
    row(8, 7, 6, false),
    row(8, 7, 6, false),
    row(7, 7, 7, false),
  ];
  const twoEqualCountsTwoAligned = [
    row(8, 8, 8, true),
    row(8, 8, 8, true),
    row(7, 7, 7, false),
    row(7, 7, 7, false),
  ];
  assert.ok(
    scoreReplayObjective(twoEqualCountsTwoAligned)
      > scoreReplayObjective(threeEqualCountsOneAligned),
  );
});

test("timeline matching requires start, peak and end alignment instead of peak-only proximity", () => {
  const truth = [{ startMs: 1_000, peakMs: 2_000, endMs: 3_000 }];
  const shortFragment = [{ startMs: 1_800, peakMs: 2_050, endMs: 2_200 }];
  const alignedCycle = [{ startMs: 1_100, peakMs: 2_050, endMs: 3_100 }];
  const fragmentMatch = matchSegments(truth, shortFragment);
  const alignedMatch = matchSegments(truth, alignedCycle);
  assert.equal(fragmentMatch.length, 1);
  assert.equal(fragmentMatch[0].aligned, false);
  assert.ok(fragmentMatch[0].intersectionOverUnion < 0.3);
  assert.equal(alignedMatch[0].aligned, true);
  assert.ok(alignedMatch[0].intersectionOverUnion > 0.8);
});
