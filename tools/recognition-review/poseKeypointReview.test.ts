import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { PoseKeypointReviewStore, type PoseKeypointReviewInput } from "./poseKeypointReview";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const requiredJoints = ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip"].map((name, offset) => ({ index: offset + 5, name }));

function input(overrides: Partial<PoseKeypointReviewInput> = {}): PoseKeypointReviewInput {
  return {
    reviewItemId: "pose-keypoint:source-a:frame:100",
    reviewerId: "annotator-a",
    reviewerRole: "vision_annotator",
    reviewStatus: "submitted",
    expectedPriorEventId: null,
    joints: requiredJoints.map((joint, position) => ({ ...joint, status: "visible" as const, x: 0.2 + position * 0.03, y: 0.3 + position * 0.02 })),
    note: "人工逐点校正。",
    ...overrides,
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "maxpower-pose-keypoint-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "images/source-a"), { recursive: true });
  const image = Buffer.from("frozen-pose-frame");
  await writeFile(join(root, "images/source-a/frame-000100.jpg"), image);
  const points = requiredJoints.map((joint, position) => ({ ...joint, x: 0.2 + position * 0.03, y: 0.3 + position * 0.02, score: 0.7, humanTruth: false }));
  const queue = {
    schemaVersion: "maxpower-personal-pose-keypoint-review-queue/v1",
    poseSchema: "halpe26",
    splitPolicy: "capture-disjoint-preserve-personal-tuning-challenge/v1",
    allItemsFrozenTest: true,
    trainerReadable: false,
    productionPromotion: false,
    materialized: true,
    requiredJoints,
    modelFreeze: { pipeline: "test", detectorSha256: "a".repeat(64), poseSha256: "b".repeat(64), rustWasmSha256: "c".repeat(64) },
    acceptance: {
      pckThresholdTorsoRatio: 0.1,
      requiredJointPckMinimum: 0.95,
      requiredJointUsableFrameRateMinimum: 0.95,
      occludedOrAmbiguousMeasuredOverclaimMaximum: 0.01,
      minimumHumanKeypointFramesPerExactContext: 1,
    },
    blockedReasons: ["all_items_require_human_keypoint_review"],
    items: [{
      reviewItemId: "pose-keypoint:source-a:frame:100", sourceCaptureId: "source-a", exerciseId: "barbell_bench_press", capturePosition: "front", equipmentContext: "barbell", mirrorPresent: true, split: "test", frameNumber: 100, timestampMs: 5000, selectionReason: "human_phase_peak", phaseContext: { repIndex: 1, phase: "peak" }, image: "images/source-a/frame-000100.jpg", imageSha256: hash(image),
      rawRtmpose: { timestampMs: 5000, requiredJoints: points, humanTruth: false },
      rustCanonical: { timestampMs: 5000, requiredJoints: points.map((point) => ({ ...point, source: "measured", predicted: false, renderable: true, usable: true })), humanTruth: false }, humanTruth: false,
    }],
  };
  const queuePath = join(root, "queue.json.gz"), eventsPath = join(root, "events.jsonl");
  await writeFile(queuePath, gzipSync(JSON.stringify(queue)));
  return { root, eventsPath, store: await PoseKeypointReviewStore.open({ queuePath, eventsPath, assetRoot: root }) };
}

test("pose review appends frozen test human truth without making it trainer-readable", async (t) => {
  const { store, eventsPath } = await fixture(t);
  const event = await store.save(input());
  assert.equal(event.humanTruth, true);
  assert.equal(event.trainerReadable, false);
  assert.equal(event.productionPromotion, false);
  assert.match(await readFile(eventsPath, "utf8"), /maxpower-personal-pose-keypoint-review-event\/v1/);
  const dataset = store.evaluationDataset();
  assert.equal(dataset.status, "research_evaluable");
  assert.equal(dataset.stats.eligibleItemCount, 1);
  assert.equal(dataset.examples[0]?.joints.length, 8);
  assert.equal(dataset.examples[0]?.trainerReadable, false);
});

test("pose review enforces topology, visibility semantics and optimistic revisions", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.save(input({ joints: input().joints.slice(0, 7) })), /requires all required joints/);
  const invalid = input().joints.map((joint, index) => index === 0 ? { ...joint, status: "occluded" as const } : joint);
  await assert.rejects(store.save(input({ joints: invalid })), /non-visible truth joint cannot retain coordinates/);
  const first = await store.save(input());
  await assert.rejects(store.save(input()), /stale pose keypoint review revision/);
  const revised = await store.save(input({ expectedPriorEventId: first.eventId, note: "复核后保持原始点。" }));
  assert.notEqual(revised.eventId, first.eventId);
});

test("pose review detects independent reviewer coordinate disagreement", async (t) => {
  const { store } = await fixture(t);
  await store.save(input());
  const shifted = input().joints.map((joint) => ({ ...joint, x: joint.x! + 0.03 }));
  await store.save(input({ reviewerId: "annotator-b", joints: shifted }));
  const index = store.index() as { stats: { disagreementItems: number } };
  assert.equal(index.stats.disagreementItems, 1);
  const dataset = store.evaluationDataset();
  assert.equal(dataset.stats.eligibleItemCount, 0);
  assert.equal(dataset.stats.disagreementCount, 1);
});

test("pose keypoint asset remains inside its frozen root", async (t) => {
  const { store, root } = await fixture(t);
  assert.equal(store.asset("pose-keypoint:source-a:frame:100").path, join(root, "images/source-a/frame-000100.jpg"));
  assert.throws(() => store.asset("missing"), /not found/);
});
