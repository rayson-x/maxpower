import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import type { EquipmentTrainingDataset, EquipmentTrainingExample } from "./equipmentReview";
import {
  buildEquipmentDetectorCorpus,
  evaluateEquipmentDetector,
  type EquipmentDetectorPredictionDocument,
} from "./equipmentDetectorCorpus";

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

async function corpusFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "maxpower-equipment-corpus-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raw: Omit<EquipmentTrainingExample, "imageSha256">[] = [
    example("train-a", "train", 1, "visible_barbell"),
    example("train-b", "train", 1, "no_target_equipment"),
    example("validation-a", "validation", 1, "visible_barbell"),
    example("test-a", "test", 1, "visible_barbell"),
    example("test-a", "test", 2, "visible_barbell"),
    example("test-a", "test", 3, "static_rack_only"),
  ];
  const examples: EquipmentTrainingExample[] = [];
  for (const candidate of raw) {
    const body = Buffer.concat([jpeg(200, 100), Buffer.from(candidate.reviewItemId)]);
    const image = candidate.image;
    await mkdir(join(root, candidate.sourceCaptureId), { recursive: true });
    await writeFile(join(root, image), body);
    examples.push({ ...candidate, imageSha256: digest(body) });
  }
  const dataset: EquipmentTrainingDataset = {
    schemaVersion: "maxpower-equipment-training-dataset/v1",
    queueSha256: "a".repeat(64),
    sourceManifestSha256: "b".repeat(64),
    splitPolicy: "capture-disjoint/v1",
    status: "research_candidate",
    promotionAllowed: false,
    stats: {
      queueItemCount: examples.length,
      eligibleItemCount: examples.length,
      trainItemCount: 2,
      validationItemCount: 1,
      testItemCount: 3,
      disagreementCount: 0,
    },
    blockedReasons: [],
    examples,
  };
  const corpus = await buildEquipmentDetectorCorpus({ dataset, assetRoot: root });
  return { root, dataset, corpus };
}

function example(
  sourceCaptureId: string,
  split: EquipmentTrainingExample["split"],
  frameIndex: number,
  target: EquipmentTrainingExample["target"],
): Omit<EquipmentTrainingExample, "imageSha256"> {
  const visible = target === "visible_barbell";
  return {
    reviewItemId: `equipment:${sourceCaptureId}:frame:${frameIndex}`,
    sourceCaptureId,
    sourceVideoSha256: digest(`video:${sourceCaptureId}`),
    split,
    frameIndex,
    timestampMs: frameIndex * 100,
    image: `${sourceCaptureId}/frame-${frameIndex}.jpg`,
    target,
    equipmentKind: visible ? "barbell_shaft" : null,
    axis: visible ? { x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5 } : null,
    occlusion: visible ? "partial" : "unknown",
    truncated: false,
    reviewEventRefs: [`equipment_review_event:${sourceCaptureId}-${frameIndex}`],
    humanTruth: true,
  };
}

test("equipment detector corpus exports source-isolated COCO while sealing test truth", async (t) => {
  const { root, dataset, corpus } = await corpusFixture(t);
  assert.equal(corpus.manifest.status, "research_candidate");
  assert.equal(corpus.manifest.productionPromotion, false);
  assert.deepEqual(corpus.manifest.stats, {
    eligibleItemCount: 6,
    positiveItemCount: 4,
    hardNegativeItemCount: 2,
    ambiguousExcludedCount: 0,
    trainItemCount: 2,
    validationItemCount: 1,
    testItemCount: 3,
    trainSourceCount: 2,
    validationSourceCount: 1,
    testSourceCount: 1,
  });
  assert.equal(corpus.train.annotations?.length, 1);
  assert.equal(corpus.validation.annotations?.length, 1);
  assert.equal(corpus.testTruth.annotations?.length, 2);
  assert.equal(corpus.testInput.annotations, undefined);
  assert.ok(corpus.testInput.images.every((image) => image.attributes === undefined));
  assert.deepEqual(corpus.trainingPlan.trainerReadableInputs, [
    "annotations/train.coco.json",
    "annotations/validation.coco.json",
  ]);
  assert.deepEqual(corpus.trainingPlan.forbiddenTrainerInputs, ["evaluation/test-truth.coco.json"]);

  const repeated = await buildEquipmentDetectorCorpus({ dataset, assetRoot: root });
  assert.equal(repeated.manifest.corpusSha256, corpus.manifest.corpusSha256);
  assert.deepEqual(repeated.manifest.documents, corpus.manifest.documents);
});

test("equipment detector corpus rejects source and image leakage", async (t) => {
  const { root, dataset } = await corpusFixture(t);
  const leaking = {
    ...dataset,
    examples: [
      ...dataset.examples,
      { ...dataset.examples[0]!, reviewItemId: "equipment:train-a:frame:99", split: "test" as const, frameIndex: 99 },
    ],
  };
  await assert.rejects(
    buildEquipmentDetectorCorpus({ dataset: leaking, assetRoot: root }),
    /source crosses splits/,
  );
});

test("equipment detector evaluation gates F1, hard negatives, path PCK and track identity", async (t) => {
  const { corpus } = await corpusFixture(t);
  const perfect: EquipmentDetectorPredictionDocument = {
    schemaVersion: "maxpower-equipment-detector-predictions/v1",
    corpusSha256: corpus.manifest.corpusSha256,
    modelSha256: "c".repeat(64),
    detections: [1, 2].map((frameIndex) => ({
      reviewItemId: `equipment:test-a:frame:${frameIndex}`,
      trackId: "barbell-track-1",
      score: 0.99,
      bbox: [0.09, 0.46, 0.82, 0.08],
      axis: { x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5 },
    })),
  };
  const passing = evaluateEquipmentDetector({ corpus: corpus.manifest, testTruth: corpus.testTruth, predictions: perfect });
  assert.equal(passing.status, "pass");
  assert.equal(passing.metrics.f1, 1);
  assert.equal(passing.metrics.endpointPck, 1);
  assert.equal(passing.metrics.identitySwitchCount, 0);
  assert.equal(passing.metrics.hardNegativeFrameFalsePositiveRate, 0);
  assert.throws(
    () => evaluateEquipmentDetector({
      corpus: corpus.manifest,
      testTruth: { ...corpus.testTruth, images: corpus.testTruth.images.slice(1) },
      predictions: perfect,
    }),
    /sealed test truth hash mismatch/,
  );
  assert.throws(
    () => evaluateEquipmentDetector({
      corpus: corpus.manifest,
      testTruth: corpus.testTruth,
      predictions: {
        ...perfect,
        detections: [{ ...perfect.detections[0]!, reviewItemId: "equipment:not-in-test:frame:1" }],
      },
    }),
    /outside frozen test input/,
  );

  const failing = evaluateEquipmentDetector({
    corpus: corpus.manifest,
    testTruth: corpus.testTruth,
    predictions: {
      ...perfect,
      detections: [
        perfect.detections[0]!,
        { ...perfect.detections[1]!, trackId: "barbell-track-2" },
        {
          ...perfect.detections[0]!,
          reviewItemId: "equipment:test-a:frame:3",
          trackId: "static-rack-false-positive",
        },
      ],
    },
  });
  assert.equal(failing.status, "fail");
  assert.equal(failing.metrics.identitySwitchCount, 1);
  assert.equal(failing.metrics.hardNegativeFrameFalsePositiveRate, 1);
  assert.ok(failing.failures.some((failure) => failure.startsWith("identitySwitchCount=")));
  assert.ok(failing.failures.some((failure) => failure.startsWith("hardNegativeFrameFalsePositiveRate=")));
});
