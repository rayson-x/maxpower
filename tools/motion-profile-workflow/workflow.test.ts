import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { admitSelfCandidateEvidence, buildAdmission, buildSelfCandidateEvidence, buildSplitLock, candidateDestinationIsIsolated, stableRunId, adaptMmFitSequence, CANONICAL_REPLAY_INTERFACE, eligibleSelfTrainingCaptureIds, hashFileSync, inspectMmFitNativeCandidateCorpus, matchSegmentsByPeak, MotionProfileWorkflow, resolveMmFitInitializer, statusForBlockers, summarizeSelfReplayRows, trainOnlySequenceIds, type MotionProfileWorkflowSpec } from "./workflow.js";

const spec: MotionProfileWorkflowSpec = {
  schemaVersion: "maxpower-motion-profile-workflow/v1", workflowId: "test", claim: { exerciseId: "*", variation: "*", equipment: "*", capturePosition: "*", trainingSide: "bilateral", intendedUse: ["rep_count"] }, observationDomains: [{ poseModel: "mmfit-openpose18-mapped", assetHash: "source-dataset", delegate: "offline", landmarkSchema: "blazepose33-adapted" }], sources: [], splitPolicyId: "subject-session-source-video/v1", featureContractId: "test/v1", candidateSearchPolicyId: "rust-profile-conservative-grid/v1", promotionPolicyId: "recognition-profile-evidence-gate/v1", seed: 20260809,
};

test("same spec and source hashes produce deterministic run id", () => {
  assert.equal(stableRunId(spec, { a: "1" }), stableRunId(spec, { a: "1" }));
  assert.notEqual(stableRunId(spec, { a: "1" }), stableRunId(spec, { a: "2" }));
  assert.equal(stableRunId(spec, { a: "1" }), stableRunId({ ...spec, mode: "candidate" }, { a: "1" }));
  assert.notEqual(stableRunId({ ...spec, mode: "inspect" }, { a: "1" }), stableRunId({ ...spec, mode: "candidate" }, { a: "1" }));
});

test("workflow file hashing streams across fixed-size chunks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxpower-workflow-hash-"));
  const file = path.join(root, "larger-than-one-hash-chunk.bin");
  const payload = Buffer.alloc(8 * 1024 * 1024 + 17, 0xab);
  try {
    fs.writeFileSync(file, payload);
    assert.equal(hashFileSync(file, "md5"), createHash("md5").update(payload).digest("hex"));
    assert.equal(hashFileSync(file, "sha256"), createHash("sha256").update(payload).digest("hex"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MM-Fit canonical adapter preserves set-count supervision and unknown joints", () => {
  const sequence = adaptMmFitSequence({ sourceSequenceId: "w01:1", subjectId: "01", split: "train", exerciseId: "push_up", sourceAction: "pushups", expectedCount: 5, frames: [{ timestampMs: 0, landmarks: [{ x: 0, y: 0, z: 0, visibility: 0 }, { x: 1, y: 1, z: 0, visibility: 1 }] }] });
  assert.equal(sequence.supervision.granularity, "set_count");
  assert.deepEqual(sequence.labels.repBounds, []);
  assert.deepEqual(sequence.frames[0].unknownLandmarkIndexes, [0]);
});

test("admission and split lock enumerate every source sequence exactly once", () => {
  const self = { source: { approvalExportSha256: "x" }, records: [{ captureId: "c1", exerciseId: "push_up", capturePosition: "front", segments: [], annotationStatus: "approved", eligibility: { challenge: false, reasons: [] }, source: { keypoints: "x", model: null } }] };
  const mmfit = { clips: [{ clipFile: "clips/w01.json.gz", sourceSequenceId: "w01:1", subjectId: "01", split: "train" as const, sourceAction: "pushups", exerciseId: "push_up", expectedCount: 5, frameCount: 2 }] };
  assert.equal(buildAdmission(self, mmfit).total, 2);
  assert.equal(buildSplitLock(self, mmfit, "r").assignments.length, 2);
});

test("legacy self data is an explicit promotion blocker", () => {
  const self = { source: { approvalExportSha256: "x" }, records: [{ captureId: "c1", exerciseId: "push_up", capturePosition: "front", segments: [], annotationStatus: "approved", eligibility: { challenge: false, reasons: [] }, source: { keypoints: "x", model: null } }] };
  const entry = buildAdmission(self, { clips: [] }).entries[0];
  assert.equal(entry.split, "legacy_unpartitioned");
  assert.match(entry.blockers.join(" "), /missing_subject_id/);
});

test("candidate destination is isolated from published runtime artifact", () => {
  assert.equal(candidateDestinationIsIsolated("data/workflows/motion-profile/test/run/candidates/profile.json", "/Users/Ruihan/Documents/power/maxpower"), true);
  assert.equal(candidateDestinationIsIsolated("public/archives/confirmed-captures/recognition-profiles.json", "/Users/Ruihan/Documents/power/maxpower"), false);
});

test("split lock keeps MM-Fit test and unseen out of train", () => {
  const mmfit = { clips: [{ clipFile: "clips/w01.json.gz", sourceSequenceId: "w01:1", subjectId: "01", split: "train" as const, sourceAction: "pushups", exerciseId: "push_up", expectedCount: 5, frameCount: 2 }, { clipFile: "clips/w09.json.gz", sourceSequenceId: "w09:1", subjectId: "09", split: "test" as const, sourceAction: "pushups", exerciseId: "push_up", expectedCount: 5, frameCount: 2 }] };
  const assignments = buildSplitLock({ source: { approvalExportSha256: "x" }, records: [] }, mmfit, "r").assignments;
  assert.equal(assignments.find((entry) => entry.sequenceId === "mmfit:w09:1")?.split, "test");
  assert.notEqual(assignments.find((entry) => entry.sequenceId === "mmfit:w09:1")?.split, "train");
});

test("workflow requires a complete native Heavy train corpus instead of silently falling back", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxpower-mmfit-native-status-"));
  const mappedRoot = path.join(root, "data/external/mm-fit/normalized");
  const nativeRoot = path.join(root, "data/external/mm-fit/native-mediapipe33-heavy");
  const clip = (sourceSequenceId: string, split: "train" | "validation") => ({
    clipFile: `${sourceSequenceId.replace(":", "-")}.json.gz`,
    sourceSequenceId,
    subjectId: sourceSequenceId.slice(1, 3),
    split,
    sourceAction: "squats",
    exerciseId: "bodyweight_squat",
    expectedCount: 10,
    frameCount: 20,
  });
  fs.mkdirSync(mappedRoot, { recursive: true });
  fs.writeFileSync(path.join(mappedRoot, "manifest.json"), JSON.stringify({ clips: [clip("w01:1", "train"), clip("w14:1", "validation")] }));
  try {
    assert.equal(inspectMmFitNativeCandidateCorpus(root).status, "missing");
    fs.mkdirSync(nativeRoot, { recursive: true });
    const nativePayload = Buffer.from("native-heavy-pose");
    const nativeClip = {
      ...clip("w01:1", "train"),
      clipSha256: createHash("sha256").update(nativePayload).digest("hex"),
    };
    fs.writeFileSync(path.join(nativeRoot, nativeClip.clipFile), nativePayload);
    const nativeManifest = {
      schemaVersion: "maxpower-mmfit-native-pose-manifest/v2",
      complete: true,
      poseDomain: "mmfit_mediapipe33_heavy_cpu",
      modelAssetSha256: "0".repeat(64),
      mediapipeRuntimeVersion: "0.10.21",
      delegate: "CPU",
      extractorVersion: "mmfit-native-mediapipe33/v2",
      requestedSplits: ["train"],
      requestedSessions: null,
      requestedSequences: null,
      clips: [nativeClip],
    };
    fs.writeFileSync(path.join(nativeRoot, "manifest.json"), JSON.stringify(nativeManifest));
    const complete = inspectMmFitNativeCandidateCorpus(root);
    assert.equal(complete.status, "complete");
    assert.equal(complete.clipCount, 1);
    fs.writeFileSync(path.join(nativeRoot, nativeClip.clipFile), "mutated");
    assert.equal(inspectMmFitNativeCandidateCorpus(root).status, "invalid");
    fs.writeFileSync(path.join(nativeRoot, nativeClip.clipFile), nativePayload);
    fs.writeFileSync(path.join(nativeRoot, "manifest.json"), JSON.stringify({
      ...nativeManifest,
      clips: [nativeClip, clip("w14:1", "validation")],
    }));
    assert.equal(inspectMmFitNativeCandidateCorpus(root).status, "invalid");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("published path is never accepted as candidate destination", () => {
  assert.equal(candidateDestinationIsIsolated("public/archives/confirmed-captures/recognition-profiles.json"), false);
});

test("search traces can only include train sequence ids", () => {
  assert.deepEqual(trainOnlySequenceIds([{ sourceSequenceId: "train-1", split: "train" }, { sourceSequenceId: "test-1", split: "test" }, { sourceSequenceId: "unseen-1", split: "unseen_test" }]), ["train-1"]);
});

test("blocked candidate runs have an explicit machine-readable status", () => {
  assert.equal(statusForBlockers("candidate", ["legacy_unpartitioned"]), "not_promotable");
  assert.equal(statusForBlockers("inspect", ["anything"]), "inspected");
});

test("parent and candidate are named against the same canonical Rust replay interface", () => {
  assert.equal(CANONICAL_REPLAY_INTERFACE, "rust-canonical-replay/v1");
});

test("challenge captures are regression-only and never self-training evidence", () => {
  const self = {
    source: { approvalExportSha256: "x" },
    records: [
      { captureId: "train", exerciseId: "push_up", capturePosition: "front", segments: [], annotationStatus: "approved", eligibility: { challenge: false, reasons: [] }, source: { keypoints: "x", model: null } },
      { captureId: "challenge", exerciseId: "push_up", capturePosition: "front", segments: [], annotationStatus: "approved", eligibility: { challenge: true, reasons: ["low_rep_signal_coverage"] }, source: { keypoints: "y", model: null } },
    ],
  };
  const admissions = buildAdmission(self, { clips: [] }).entries;
  assert.equal(admissions.find((entry) => entry.sequenceId === "self:train")?.disposition, "candidate_discovery_and_regression");
  assert.equal(admissions.find((entry) => entry.sequenceId === "self:challenge")?.disposition, "challenge_regression_only");
  assert.deepEqual(eligibleSelfTrainingCaptureIds(self), ["train"]);
});

test("per-rep matching cannot count an unmatched prediction as a match", () => {
  const truth = [
    { startMs: 1_000, peakMs: 2_000, endMs: 3_000 },
    { startMs: 4_000, peakMs: 5_000, endMs: 6_000 },
  ];
  const predicted = [
    { startMs: 900, peakMs: 2_100, endMs: 3_100 },
    { startMs: 3_900, peakMs: 5_200, endMs: 6_100 },
    { startMs: 7_000, peakMs: 7_500, endMs: 8_000 },
  ];
  const match = matchSegmentsByPeak(truth, predicted);
  assert.equal(match.matchedCount, 2);
  assert.deepEqual(match.unmatchedPredictedIndexes, [2]);
  assert.equal(match.meanAbsolutePeakErrorMs, 150);
});

test("checked-in self inventory remains the 11 capture / 89 rep golden corpus", () => {
  const dataset = JSON.parse(fs.readFileSync("data/training/approved-segmentation-v1.json", "utf8")) as { records: { segments: unknown[]; eligibility: { challenge: boolean } }[] };
  assert.equal(dataset.records.length, 11);
  assert.equal(dataset.records.reduce((sum, record) => sum + record.segments.length, 0), 89);
  assert.equal(dataset.records.filter((record) => !record.eligibility.challenge).length, 4);
  assert.equal(dataset.records.filter((record) => record.eligibility.challenge).length, 7);
});

test("checked-in MM-Fit inventory remains the 21 subject / 616 set / 6,160 rep golden corpus", () => {
  const manifest = JSON.parse(fs.readFileSync("data/external/mm-fit/normalized/manifest.json", "utf8")) as {
    clips: { subjectId: string; expectedCount: number }[];
  };
  assert.equal(new Set(manifest.clips.map((clip) => clip.subjectId)).size, 21);
  assert.equal(manifest.clips.length, 616);
  assert.equal(manifest.clips.reduce((sum, clip) => sum + clip.expectedCount, 0), 6_160);
});

test("MM-Fit workflow resolves an initializer at the exercise recommended capture position", () => {
  const squat = resolveMmFitInitializer("bodyweight_squat");
  assert.equal(squat.capturePosition, "left");
  assert.ok(squat.profile);
});

test("self metrics derive precision, recall, and negative-window false positives from matched boundaries", () => {
  const metrics = summarizeSelfReplayRows([
    {
      captureId: "capture",
      challenge: false,
      truthSegments: [
        { startMs: 1_000, peakMs: 2_000, endMs: 3_000 },
        { startMs: 4_000, peakMs: 5_000, endMs: 6_000 },
      ],
      negativeWindows: [{ startMs: 7_000, endMs: 8_000 }],
      replay: {
        confirmed: [
          { startMs: 900, peakMs: 2_100, endMs: 3_100 },
          { startMs: 3_900, peakMs: 5_200, endMs: 6_100 },
          { startMs: 7_100, peakMs: 7_500, endMs: 7_900 },
        ],
        needsReviewCount: 1,
        rejectedCount: 2,
      },
    },
  ]);
  assert.equal(metrics.truthCount, 2);
  assert.equal(metrics.predictedCount, 3);
  assert.equal(metrics.matchedRepCount, 2);
  assert.equal(metrics.falsePositiveRepCount, 1);
  assert.equal(metrics.matchedRecall, 1);
  assert.equal(metrics.matchedPrecision, 2 / 3);
  assert.equal(metrics.negativeWindowFalsePositiveCount, 1);
  assert.equal(metrics.meanAbsolutePeakErrorMs, 150);
  assert.equal(metrics.needsReviewOutcomeCount, 1);
  assert.equal(metrics.rejectedOutcomeCount, 2);
});

test("self end-to-end metrics count unsupported profile contexts as algorithm misses", () => {
  const metrics = summarizeSelfReplayRows([
    {
      captureId: "supported",
      challenge: false,
      truthSegments: [{ startMs: 1_000, peakMs: 2_000, endMs: 3_000 }],
      negativeWindows: [],
      replay: {
        confirmed: [{ startMs: 900, peakMs: 2_050, endMs: 3_100 }],
        needsReviewCount: 0,
        rejectedCount: 0,
      },
    },
    {
      captureId: "unsupported-by-current-profile",
      challenge: true,
      truthSegments: [
        { startMs: 4_000, peakMs: 5_000, endMs: 6_000 },
        { startMs: 7_000, peakMs: 8_000, endMs: 9_000 },
      ],
      negativeWindows: [],
      replay: null,
    },
  ]);
  assert.equal(metrics.sampleCount, 2);
  assert.equal(metrics.truthCount, 3);
  assert.equal(metrics.predictedCount, 1);
  assert.equal(metrics.matchedRepCount, 1);
  assert.equal(metrics.matchedRecall, 1 / 3);
  assert.equal(metrics.matchedPrecision, 1);
  assert.equal(metrics.exactRatio, 0.5);
  assert.equal(metrics.unavailableCaptureCount, 1);
});

test("self candidate evidence is rejected when it contains challenge or undeclared captures", () => {
  const result = admitSelfCandidateEvidence([
    { candidateId: "good", trainingCaptureIds: ["train"] },
    { candidateId: "leaked", trainingCaptureIds: ["train", "challenge"] },
    { candidateId: "empty", trainingCaptureIds: [] },
  ], ["train"]);
  assert.deepEqual(result.accepted.map((entry) => entry.candidateId), ["good"]);
  assert.deepEqual(result.rejected.map((entry) => entry.candidateId), ["leaked", "empty"]);
  assert.match(result.rejected[0].reason, /challenge/);
  assert.match(result.rejected[1].reason, /missing/);
});

test("candidate evidence replaces inherited capture counts with admitted training evidence", () => {
  const evidence = buildSelfCandidateEvidence({
    captureIds: ["eligible", "challenge"],
    captureCount: 2,
    labeledRepCount: 25,
    challengeRepCount: 10,
    notes: ["preserved provenance note"],
  }, [{ captureId: "eligible", segments: Array.from({ length: 15 }, () => ({ startMs: 0, peakMs: 1, endMs: 2 })) }], "approval-sha");
  assert.deepEqual(evidence.captureIds, ["eligible"]);
  assert.deepEqual(evidence.sourceCaptureIds, ["eligible"]);
  assert.equal(evidence.captureCount, 1);
  assert.equal(evidence.labeledRepCount, 15);
  assert.equal(evidence.challengeRepCount, 0);
});

test("inspect and failed candidate modes are isolated and preserve the runtime profile sentinel", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxpower-motion-profile-workflow-"));
  const write = (relative: string, contents: string | Uint8Array) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  try {
    write("data/training/approved-segmentation-v1.json", JSON.stringify({ source: { approvalExportSha256: "fixture" }, records: [] }));
    write("data/external/mm-fit/normalized/manifest.json", JSON.stringify({ clips: [] }));
    write("data/external/mm-fit/rgb/zenodo-record-7672767.json", JSON.stringify({ files: [] }));
    write("public/archives/confirmed-captures/recognition-profiles.json", "sentinel-runtime-profile\n");
    write("public/motion-sdk/maxpower_motion_sdk.wasm", new Uint8Array([0]));
    const workflow = new MotionProfileWorkflow(root);
    const sentinel = fs.readFileSync(path.join(root, "public/archives/confirmed-captures/recognition-profiles.json"));
    const inspected = await workflow.run({ ...spec, mode: "inspect" });
    const failed = await workflow.run({ ...spec, mode: "candidate" });
    assert.equal(inspected.status, "inspected");
    assert.equal(failed.status, "failed");
    assert.notEqual(inspected.runId, failed.runId);
    assert.match(failed.blockers.join(" "), /workflow_error/);
    assert.deepEqual(fs.readFileSync(path.join(root, "public/archives/confirmed-captures/recognition-profiles.json")), sentinel);
    const failedManifest = JSON.parse(fs.readFileSync(path.join(root, "data/workflows/motion-profile/test", failed.runId, "run-manifest.json"), "utf8")) as { status: string };
    assert.equal(failedManifest.status, "failed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
