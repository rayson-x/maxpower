import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePoseKeypoints } from "./poseKeypointEvaluation";
import type {
  PoseJointTruth,
  PoseKeypointEvaluationDataset,
  PoseKeypointEvaluationExample,
  PoseModelPoint,
} from "./poseKeypointReview";

const requiredJoints = [
  { index: 5, name: "left_shoulder" },
  { index: 6, name: "right_shoulder" },
  { index: 7, name: "left_elbow" },
  { index: 8, name: "right_elbow" },
  { index: 9, name: "left_wrist" },
  { index: 10, name: "right_wrist" },
  { index: 11, name: "left_hip" },
  { index: 12, name: "right_hip" },
] as const;

const coordinates = [
  [0.4, 0.4], [0.6, 0.4], [0.32, 0.52], [0.68, 0.52],
  [0.25, 0.65], [0.75, 0.65], [0.45, 0.7], [0.55, 0.7],
] as const;

function truth(): PoseJointTruth[] {
  return requiredJoints.map((joint, position) => ({
    ...joint,
    status: "visible",
    x: coordinates[position]![0],
    y: coordinates[position]![1],
  }));
}

function modelPoints(): PoseModelPoint[] {
  return requiredJoints.map((joint, position) => ({
    ...joint,
    x: coordinates[position]![0],
    y: coordinates[position]![1],
    score: 0.9,
    source: "measured",
    predicted: false,
    renderable: true,
    usable: true,
    humanTruth: false,
  }));
}

function example(overrides: Partial<PoseKeypointEvaluationExample> = {}): PoseKeypointEvaluationExample {
  const points = modelPoints();
  return {
    reviewItemId: "pose-keypoint:source-a:frame:100",
    sourceCaptureId: "source-a",
    exerciseId: "barbell_bench_press",
    capturePosition: "front",
    equipmentContext: "barbell",
    mirrorPresent: true,
    split: "test",
    frameNumber: 100,
    timestampMs: 5_000,
    selectionReason: "human_phase_peak",
    phaseContext: { repIndex: 1, phase: "peak" },
    image: "images/source-a/frame-000100.jpg",
    imageSha256: "d".repeat(64),
    rawRtmpose: { timestampMs: 5_000, requiredJoints: points, humanTruth: false },
    rustCanonical: { timestampMs: 5_000, requiredJoints: points, humanTruth: false },
    joints: truth(),
    reviewEventRefs: ["pose_keypoint_review_event:event-a"],
    humanTruth: true,
    trainerReadable: false,
    ...overrides,
  };
}

function dataset(overrides: Partial<PoseKeypointEvaluationDataset> = {}): PoseKeypointEvaluationDataset {
  const examples = [example()];
  return {
    schemaVersion: "maxpower-personal-pose-keypoint-evaluation-dataset/v1",
    queueSha256: "a".repeat(64),
    status: "research_evaluable",
    split: "test",
    trainerReadable: false,
    productionPromotion: false,
    requiredJoints,
    acceptance: {
      pckThresholdTorsoRatio: 0.1,
      requiredJointPckMinimum: 0.95,
      requiredJointUsableFrameRateMinimum: 0.95,
      occludedOrAmbiguousMeasuredOverclaimMaximum: 0.01,
      minimumHumanKeypointFramesPerExactContext: 1,
    },
    modelFreeze: {
      pipeline: "test",
      detectorSha256: "1".repeat(64),
      poseSha256: "2".repeat(64),
      rustWasmSha256: "3".repeat(64),
    },
    stats: { queueItemCount: 1, eligibleItemCount: 1, disagreementCount: 0 },
    blockedReasons: ["single_known_person_cannot_prove_cross_user_pose_generalization"],
    examples,
    ...overrides,
  };
}

test("pose PCK evaluates raw and Rust separately without granting production promotion", () => {
  const occludedTruth = truth();
  occludedTruth[4] = { ...occludedTruth[4]!, status: "occluded", x: null, y: null };
  const occludedPoints = modelPoints();
  occludedPoints[4] = { ...occludedPoints[4]!, x: null, y: null, source: "unknown", renderable: false, usable: false };
  const occludedExample = example({
    reviewItemId: "pose-keypoint:source-a:frame:101",
    frameNumber: 101,
    timestampMs: 5_100,
    joints: occludedTruth,
    rawRtmpose: { timestampMs: 5_100, requiredJoints: occludedPoints, humanTruth: false },
    rustCanonical: { timestampMs: 5_100, requiredJoints: occludedPoints, humanTruth: false },
  });
  const report = evaluatePoseKeypoints(dataset({
    stats: { queueItemCount: 2, eligibleItemCount: 2, disagreementCount: 0 },
    examples: [example(), occludedExample],
  }));
  assert.equal(report.status, "research_pass_single_person_only");
  assert.equal(report.researchMetricPass, true);
  assert.equal(report.acceptanceEligible, false);
  assert.equal(report.productionPromotion, false);
  assert.equal(report.metrics.rawRtmpose.pckAtThreshold.rate, 1);
  assert.equal(report.metrics.rustCanonical.pckAtThreshold.rate, 1);
  assert.equal(report.metrics.rustCanonical.usableJointFrameRate.rate, 1);
  assert.equal(report.metrics.falseMeasuredOverclaim.rate, 0);
});

test("missing and displaced Rust joints count as PCK and usable-rate failures", () => {
  const points = modelPoints();
  points[4] = { ...points[4]!, x: points[4]!.x! + 0.2 };
  points[5] = { ...points[5]!, x: null, y: null, source: "unknown", renderable: false, usable: false };
  const report = evaluatePoseKeypoints(dataset({
    examples: [example({ rustCanonical: { timestampMs: 5_000, requiredJoints: points, humanTruth: false } })],
  }));
  assert.equal(report.status, "fail");
  assert.equal(report.metrics.rustCanonical.pckAtThreshold.numerator, 6);
  assert.equal(report.metrics.rustCanonical.pckAtThreshold.denominator, 8);
  assert.ok(report.metricFailures.includes("rust_required_joint_pck_below_minimum"));
  assert.ok(report.metricFailures.includes("rust_required_joint_usable_frame_rate_below_minimum"));
});

test("occluded truth exposes false reliable measured overclaim", () => {
  const joints = truth();
  joints[4] = { ...joints[4]!, status: "occluded", x: null, y: null };
  const report = evaluatePoseKeypoints(dataset({ examples: [example({ joints })] }));
  assert.equal(report.status, "fail");
  assert.equal(report.metrics.falseMeasuredOverclaim.numerator, 1);
  assert.equal(report.metrics.falseMeasuredOverclaim.denominator, 1);
  assert.equal(report.metrics.falseMeasuredOverclaim.rate, 1);
  assert.ok(report.metricFailures.includes("rust_false_measured_overclaim_above_maximum"));
});

test("incomplete human truth remains blocked and provisional", () => {
  const report = evaluatePoseKeypoints(dataset({
    status: "blocked_incomplete_human_truth",
    stats: { queueItemCount: 120, eligibleItemCount: 0, disagreementCount: 0 },
    examples: [],
    blockedReasons: ["not_all_frozen_pose_frames_reviewed"],
  }));
  assert.equal(report.status, "blocked_incomplete_human_truth");
  assert.equal(report.researchMetricPass, false);
  assert.equal(report.metrics.rustCanonical.pckAtThreshold.rate, null);
  assert.ok(report.blockedReasons.includes("not_all_frozen_pose_frames_have_consensus_truth"));
});
