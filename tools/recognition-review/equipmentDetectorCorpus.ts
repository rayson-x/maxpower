import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type {
  EquipmentAxis,
  EquipmentTrainingDataset,
  EquipmentTrainingExample,
} from "./equipmentReview";

const SPLITS = ["train", "validation", "test"] as const;
type EquipmentSplit = typeof SPLITS[number];

export interface CocoEquipmentImage {
  readonly id: number;
  readonly file_name: string;
  readonly width: number;
  readonly height: number;
  readonly review_item_id: string;
  readonly source_capture_id: string;
  readonly source_video_sha256: string;
  readonly image_sha256: string;
  readonly frame_index: number;
  readonly timestamp_ms: number;
  readonly attributes?: {
    readonly target: EquipmentTrainingExample["target"];
    readonly hard_negative: boolean;
    readonly review_event_refs: readonly string[];
  };
}

export interface CocoEquipmentAnnotation {
  readonly id: number;
  readonly image_id: number;
  readonly category_id: 1;
  readonly bbox: readonly [number, number, number, number];
  readonly area: number;
  readonly iscrowd: 0;
  readonly keypoints: readonly [number, number, 2, number, number, 2];
  readonly num_keypoints: 2;
  readonly attributes: {
    readonly occlusion: EquipmentTrainingExample["occlusion"];
    readonly truncated: boolean;
    readonly human_truth: true;
    readonly review_event_refs: readonly string[];
  };
}

export interface CocoEquipmentDocument {
  readonly info: {
    readonly description: string;
    readonly schema_version: "maxpower-equipment-coco-video/v1";
    readonly split: EquipmentSplit;
    readonly labels_revealed: boolean;
  };
  readonly images: readonly CocoEquipmentImage[];
  readonly annotations?: readonly CocoEquipmentAnnotation[];
  readonly categories: readonly [{
    readonly id: 1;
    readonly name: "barbell_shaft";
    readonly supercategory: "equipment";
    readonly keypoints: readonly ["endpoint_a", "endpoint_b"];
    readonly skeleton: readonly [readonly [1, 2]];
  }];
}

export interface EquipmentDetectorTrainingPlan {
  readonly schemaVersion: "maxpower-yolox-equipment-training-plan/v1";
  readonly researchOnly: true;
  readonly productionPromotion: false;
  readonly randomSeed: "maxpower-yolox-equipment-v1";
  readonly modelFamily: "yolox-nano-equipment/v1";
  readonly inputSize: readonly [416, 416];
  readonly categories: readonly ["barbell_shaft"];
  readonly modelOutput: "class + axis-aligned bbox + score";
  readonly endpointTruthUse: "postprocess calibration and frozen path evaluation; not a standard YOLOX output head";
  readonly shaftAxisPostprocess: "fit visible line inside detected bbox; fallback to bbox long-side centerline as derived_geometry";
  readonly trainAnnotations: "annotations/train.coco.json";
  readonly validationAnnotations: "annotations/validation.coco.json";
  readonly testInput: "evaluation/test-input.coco.json";
  readonly sealedTestTruth: "evaluation/test-truth.coco.json";
  readonly trainerReadableInputs: readonly [
    "annotations/train.coco.json",
    "annotations/validation.coco.json",
  ];
  readonly forbiddenTrainerInputs: readonly ["evaluation/test-truth.coco.json"];
  readonly expectedOnnxOutput: "models/yolox-nano-barbell-shaft-416.onnx";
  readonly runtimeOutputContract: "normalized bbox + score from detector; optional derived_geometry shaft axis; Rust owns track and subject association";
}

export interface EquipmentDetectorCorpusManifest {
  readonly schemaVersion: "maxpower-equipment-detector-corpus/v1";
  readonly sourceDatasetSha256: string;
  readonly queueSha256: string;
  readonly sourceManifestSha256: string;
  readonly splitPolicy: string;
  readonly status: "blocked_no_human_labels" | "blocked_data_quality" | "research_candidate";
  readonly researchOnly: true;
  readonly productionPromotion: false;
  readonly corpusSha256: string;
  readonly documents: Readonly<Record<string, { readonly sha256: string }>>;
  readonly stats: {
    readonly eligibleItemCount: number;
    readonly positiveItemCount: number;
    readonly hardNegativeItemCount: number;
    readonly ambiguousExcludedCount: number;
    readonly trainItemCount: number;
    readonly validationItemCount: number;
    readonly testItemCount: number;
    readonly trainSourceCount: number;
    readonly validationSourceCount: number;
    readonly testSourceCount: number;
  };
  readonly blockedReasons: readonly string[];
}

export interface EquipmentDetectorCorpus {
  readonly manifest: EquipmentDetectorCorpusManifest;
  readonly trainingPlan: EquipmentDetectorTrainingPlan;
  readonly train: CocoEquipmentDocument;
  readonly validation: CocoEquipmentDocument;
  readonly testInput: CocoEquipmentDocument;
  readonly testTruth: CocoEquipmentDocument;
}

export interface EquipmentDetectorPrediction {
  readonly reviewItemId: string;
  readonly trackId: string;
  readonly score: number;
  readonly bbox: readonly [number, number, number, number];
  readonly axis: EquipmentAxis;
}

export interface EquipmentDetectorPredictionDocument {
  readonly schemaVersion: "maxpower-equipment-detector-predictions/v1";
  readonly corpusSha256: string;
  readonly modelSha256: string;
  readonly detections: readonly EquipmentDetectorPrediction[];
}

export interface EquipmentDetectorEvaluation {
  readonly schemaVersion: "maxpower-equipment-detector-evaluation/v1";
  readonly status: "pass" | "fail" | "blocked_no_test_truth";
  readonly productionPromotion: false;
  readonly corpusSha256: string;
  readonly modelSha256: string;
  readonly thresholds: {
    readonly minimumScore: number;
    readonly minimumBboxIou: number;
    readonly endpointPckNormalizedDiagonal: number;
    readonly minimumF1: number;
    readonly minimumTrackCoverage: number;
    readonly minimumEndpointPck: number;
    readonly maximumHardNegativeFrameFalsePositiveRate: number;
    readonly maximumIdentitySwitchCount: 0;
  };
  readonly metrics: {
    readonly positiveFrameCount: number;
    readonly hardNegativeFrameCount: number;
    readonly truePositiveCount: number;
    readonly falsePositiveCount: number;
    readonly falseNegativeCount: number;
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
    readonly trackCoverage: number;
    readonly endpointPck: number;
    readonly hardNegativeFrameFalsePositiveRate: number;
    readonly identitySwitchCount: number;
  };
  readonly failures: readonly string[];
}

const CATEGORIES: CocoEquipmentDocument["categories"] = [{
  id: 1,
  name: "barbell_shaft",
  supercategory: "equipment",
  keypoints: ["endpoint_a", "endpoint_b"],
  skeleton: [[1, 2]],
}];

export async function buildEquipmentDetectorCorpus(input: {
  readonly dataset: EquipmentTrainingDataset;
  readonly assetRoot: string;
  readonly shaftBoxHalfHeightRatio?: number;
}): Promise<EquipmentDetectorCorpus> {
  assertDataset(input.dataset);
  const assetRoot = resolve(input.assetRoot);
  const halfHeightRatio = input.shaftBoxHalfHeightRatio ?? 0.0125;
  if (!(halfHeightRatio > 0 && halfHeightRatio <= 0.05)) {
    throw new Error("invalid shaft box half-height ratio");
  }

  const examples = [...input.dataset.examples].sort((left, right) => (
    SPLITS.indexOf(left.split) - SPLITS.indexOf(right.split)
    || left.sourceCaptureId.localeCompare(right.sourceCaptureId)
    || left.frameIndex - right.frameIndex
    || left.reviewItemId.localeCompare(right.reviewItemId)
  ));
  assertSourceIsolation(examples);

  const accepted = examples.filter((example) => example.target !== "ambiguous");
  const documents = new Map<EquipmentSplit, { images: CocoEquipmentImage[]; annotations: CocoEquipmentAnnotation[] }>(
    SPLITS.map((split) => [split, { images: [], annotations: [] }]),
  );
  const imageSplitBySha = new Map<string, EquipmentSplit>();
  let imageId = 1;
  let annotationId = 1;
  for (const example of accepted) {
    const previousSplit = imageSplitBySha.get(example.imageSha256);
    if (previousSplit && previousSplit !== example.split) {
      throw new Error(`equipment image crosses splits: ${example.imageSha256}`);
    }
    imageSplitBySha.set(example.imageSha256, example.split);
    const imagePath = safeAssetPath(assetRoot, example.image);
    const body = await readFile(imagePath);
    if (sha256(body) !== example.imageSha256) {
      throw new Error(`equipment image hash mismatch: ${example.reviewItemId}`);
    }
    const dimensions = imageDimensions(body);
    const hardNegative = example.target !== "visible_barbell";
    const image: CocoEquipmentImage = {
      id: imageId++,
      file_name: example.image,
      width: dimensions.width,
      height: dimensions.height,
      review_item_id: example.reviewItemId,
      source_capture_id: example.sourceCaptureId,
      source_video_sha256: example.sourceVideoSha256,
      image_sha256: example.imageSha256,
      frame_index: example.frameIndex,
      timestamp_ms: example.timestampMs,
      attributes: {
        target: example.target,
        hard_negative: hardNegative,
        review_event_refs: [...example.reviewEventRefs].sort(),
      },
    };
    documents.get(example.split)!.images.push(image);
    if (!hardNegative) {
      if (example.equipmentKind !== "barbell_shaft" || !example.axis) {
        throw new Error(`visible barbell is missing human shaft geometry: ${example.reviewItemId}`);
      }
      documents.get(example.split)!.annotations.push(axisAnnotation({
        id: annotationId++,
        imageId: image.id,
        width: image.width,
        height: image.height,
        axis: example.axis,
        halfHeightRatio,
        example,
      }));
    }
  }

  const train = cocoDocument("train", documents.get("train")!, true);
  const validation = cocoDocument("validation", documents.get("validation")!, true);
  const testTruth = cocoDocument("test", documents.get("test")!, true);
  const testInput = labelFreeTestInput(testTruth);
  const trainingPlan: EquipmentDetectorTrainingPlan = {
    schemaVersion: "maxpower-yolox-equipment-training-plan/v1",
    researchOnly: true,
    productionPromotion: false,
    randomSeed: "maxpower-yolox-equipment-v1",
    modelFamily: "yolox-nano-equipment/v1",
    inputSize: [416, 416],
    categories: ["barbell_shaft"],
    modelOutput: "class + axis-aligned bbox + score",
    endpointTruthUse: "postprocess calibration and frozen path evaluation; not a standard YOLOX output head",
    shaftAxisPostprocess: "fit visible line inside detected bbox; fallback to bbox long-side centerline as derived_geometry",
    trainAnnotations: "annotations/train.coco.json",
    validationAnnotations: "annotations/validation.coco.json",
    testInput: "evaluation/test-input.coco.json",
    sealedTestTruth: "evaluation/test-truth.coco.json",
    trainerReadableInputs: ["annotations/train.coco.json", "annotations/validation.coco.json"],
    forbiddenTrainerInputs: ["evaluation/test-truth.coco.json"],
    expectedOnnxOutput: "models/yolox-nano-barbell-shaft-416.onnx",
    runtimeOutputContract: "normalized bbox + score from detector; optional derived_geometry shaft axis; Rust owns track and subject association",
  };
  const sourceDatasetSha256 = sha256(Buffer.from(stableJson(input.dataset)));
  const serializedDocuments: Record<string, string> = {
    "annotations/train.coco.json": stableJson(train),
    "annotations/validation.coco.json": stableJson(validation),
    "evaluation/test-input.coco.json": stableJson(testInput),
    "evaluation/test-truth.coco.json": stableJson(testTruth),
    "training-plan.json": stableJson(trainingPlan),
  };
  const documentHashes = Object.fromEntries(
    Object.entries(serializedDocuments).map(([path, body]) => [path, { sha256: sha256(Buffer.from(body)) }]),
  );
  const stats = corpusStats(input.dataset, examples, accepted, documents);
  const blockedReasons = corpusBlockers(input.dataset.blockedReasons, stats);
  const status: EquipmentDetectorCorpusManifest["status"] = input.dataset.status === "blocked_no_human_labels"
    ? "blocked_no_human_labels"
    : blockedReasons.length > 0 ? "blocked_data_quality" : "research_candidate";
  const corpusSha256 = sha256(Buffer.from(stableJson({
    sourceDatasetSha256,
    queueSha256: input.dataset.queueSha256,
    sourceManifestSha256: input.dataset.sourceManifestSha256,
    splitPolicy: input.dataset.splitPolicy,
    documents: documentHashes,
  })));
  const manifest: EquipmentDetectorCorpusManifest = {
    schemaVersion: "maxpower-equipment-detector-corpus/v1",
    sourceDatasetSha256,
    queueSha256: input.dataset.queueSha256,
    sourceManifestSha256: input.dataset.sourceManifestSha256,
    splitPolicy: input.dataset.splitPolicy,
    status,
    researchOnly: true,
    productionPromotion: false,
    corpusSha256,
    documents: documentHashes,
    stats,
    blockedReasons,
  };
  return { manifest, trainingPlan, train, validation, testInput, testTruth };
}

export function evaluateEquipmentDetector(input: {
  readonly corpus: EquipmentDetectorCorpusManifest;
  readonly testTruth: CocoEquipmentDocument;
  readonly predictions: EquipmentDetectorPredictionDocument;
  readonly minimumScore?: number;
}): EquipmentDetectorEvaluation {
  if (input.predictions.schemaVersion !== "maxpower-equipment-detector-predictions/v1") {
    throw new Error("unsupported equipment detector prediction document");
  }
  if (input.predictions.corpusSha256 !== input.corpus.corpusSha256) {
    throw new Error("equipment detector prediction corpus mismatch");
  }
  const expectedTruthHash = input.corpus.documents["evaluation/test-truth.coco.json"]?.sha256;
  if (!expectedTruthHash || sha256(Buffer.from(stableJson(input.testTruth))) !== expectedTruthHash) {
    throw new Error("equipment detector sealed test truth hash mismatch");
  }
  if (!/^[a-f0-9]{64}$/.test(input.predictions.modelSha256)) {
    throw new Error("invalid equipment detector model hash");
  }
  const thresholds = {
    minimumScore: input.minimumScore ?? 0.25,
    minimumBboxIou: 0.3,
    endpointPckNormalizedDiagonal: 0.05,
    minimumF1: 0.95,
    minimumTrackCoverage: 0.95,
    minimumEndpointPck: 0.95,
    maximumHardNegativeFrameFalsePositiveRate: 0.01,
    maximumIdentitySwitchCount: 0 as const,
  };
  const truthByImage = new Map((input.testTruth.annotations ?? []).map((annotation) => [annotation.image_id, annotation]));
  const testReviewItemIds = new Set(input.testTruth.images.map((image) => image.review_item_id));
  const predictionsByItem = new Map<string, EquipmentDetectorPrediction[]>();
  for (const detection of input.predictions.detections) {
    validatePrediction(detection);
    if (!testReviewItemIds.has(detection.reviewItemId)) {
      throw new Error(`equipment detector prediction is outside frozen test input: ${detection.reviewItemId}`);
    }
    if (detection.score < thresholds.minimumScore) continue;
    predictionsByItem.set(detection.reviewItemId, [...(predictionsByItem.get(detection.reviewItemId) ?? []), detection]);
  }
  for (const detections of predictionsByItem.values()) detections.sort((left, right) => right.score - left.score);

  const positiveImages = input.testTruth.images.filter((image) => truthByImage.has(image.id));
  const negativeImages = input.testTruth.images.filter((image) => !truthByImage.has(image.id));
  if (positiveImages.length === 0) {
    return blockedEvaluation(input, thresholds, negativeImages.length);
  }
  let truePositiveCount = 0;
  let falsePositiveCount = 0;
  let falseNegativeCount = 0;
  let endpointHits = 0;
  let hardNegativeFramesWithFalsePositive = 0;
  const matchedTracks = new Map<string, { timestampMs: number; trackId: string }[]>();
  for (const image of positiveImages) {
    const truth = truthByImage.get(image.id)!;
    const detections = predictionsByItem.get(image.review_item_id) ?? [];
    const best = detections[0];
    if (!best) {
      falseNegativeCount += 1;
      continue;
    }
    const endpointResult = endpointMatches(image, truth, best.axis, thresholds.endpointPckNormalizedDiagonal);
    const matched = bboxIou(truth.bbox, normalizedBboxToPixels(best.bbox, image)) >= thresholds.minimumBboxIou
      && endpointResult.hits === 2;
    if (matched) {
      truePositiveCount += 1;
      endpointHits += endpointResult.hits;
      matchedTracks.set(image.source_capture_id, [
        ...(matchedTracks.get(image.source_capture_id) ?? []),
        { timestampMs: image.timestamp_ms, trackId: best.trackId },
      ]);
    } else {
      falseNegativeCount += 1;
      endpointHits += endpointResult.hits;
      falsePositiveCount += 1;
    }
    falsePositiveCount += Math.max(0, detections.length - 1);
  }
  for (const image of negativeImages) {
    const detections = predictionsByItem.get(image.review_item_id) ?? [];
    if (detections.length > 0) hardNegativeFramesWithFalsePositive += 1;
    falsePositiveCount += detections.length;
  }
  const precision = ratio(truePositiveCount, truePositiveCount + falsePositiveCount);
  const recall = ratio(truePositiveCount, truePositiveCount + falseNegativeCount);
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const trackCoverage = ratio(truePositiveCount, positiveImages.length);
  const endpointPck = ratio(endpointHits, positiveImages.length * 2);
  const hardNegativeFrameFalsePositiveRate = ratio(hardNegativeFramesWithFalsePositive, negativeImages.length);
  let identitySwitchCount = 0;
  for (const entries of matchedTracks.values()) {
    entries.sort((left, right) => left.timestampMs - right.timestampMs);
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index]!.trackId !== entries[index - 1]!.trackId) identitySwitchCount += 1;
    }
  }
  const failures = [
    ...(f1 < thresholds.minimumF1 ? [`f1=${f1.toFixed(4)} < ${thresholds.minimumF1.toFixed(4)}`] : []),
    ...(trackCoverage < thresholds.minimumTrackCoverage ? [`trackCoverage=${trackCoverage.toFixed(4)} < ${thresholds.minimumTrackCoverage.toFixed(4)}`] : []),
    ...(endpointPck < thresholds.minimumEndpointPck ? [`endpointPck=${endpointPck.toFixed(4)} < ${thresholds.minimumEndpointPck.toFixed(4)}`] : []),
    ...(hardNegativeFrameFalsePositiveRate > thresholds.maximumHardNegativeFrameFalsePositiveRate
      ? [`hardNegativeFrameFalsePositiveRate=${hardNegativeFrameFalsePositiveRate.toFixed(4)} > ${thresholds.maximumHardNegativeFrameFalsePositiveRate.toFixed(4)}`]
      : []),
    ...(identitySwitchCount > thresholds.maximumIdentitySwitchCount ? [`identitySwitchCount=${identitySwitchCount} > 0`] : []),
  ];
  return {
    schemaVersion: "maxpower-equipment-detector-evaluation/v1",
    status: failures.length ? "fail" : "pass",
    productionPromotion: false,
    corpusSha256: input.corpus.corpusSha256,
    modelSha256: input.predictions.modelSha256,
    thresholds,
    metrics: {
      positiveFrameCount: positiveImages.length,
      hardNegativeFrameCount: negativeImages.length,
      truePositiveCount,
      falsePositiveCount,
      falseNegativeCount,
      precision,
      recall,
      f1,
      trackCoverage,
      endpointPck,
      hardNegativeFrameFalsePositiveRate,
      identitySwitchCount,
    },
    failures,
  };
}

function assertDataset(dataset: EquipmentTrainingDataset): void {
  if (
    dataset.schemaVersion !== "maxpower-equipment-training-dataset/v1"
    || dataset.promotionAllowed !== false
    || !/^[a-f0-9]{64}$/.test(dataset.queueSha256)
    || !/^[a-f0-9]{64}$/.test(dataset.sourceManifestSha256)
  ) {
    throw new Error("unsupported equipment training dataset");
  }
}

function assertSourceIsolation(examples: readonly EquipmentTrainingExample[]): void {
  const splitBySource = new Map<string, EquipmentSplit>();
  for (const example of examples) {
    if (example.humanTruth !== true || !SPLITS.includes(example.split)) {
      throw new Error(`invalid equipment training example: ${example.reviewItemId}`);
    }
    const previous = splitBySource.get(example.sourceCaptureId);
    if (previous && previous !== example.split) {
      throw new Error(`equipment source crosses splits: ${example.sourceCaptureId}`);
    }
    splitBySource.set(example.sourceCaptureId, example.split);
  }
}

function safeAssetPath(root: string, relative: string): string {
  const path = resolve(root, relative);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("equipment asset escapes frozen root");
  return path;
}

function imageDimensions(body: Buffer): { width: number; height: number } {
  if (body.length >= 24 && body.subarray(1, 4).toString("ascii") === "PNG") {
    return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
  }
  if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) throw new Error("unsupported equipment image format");
  let offset = 2;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < body.length) {
    if (body[offset] !== 0xff) { offset += 1; continue; }
    while (body[offset] === 0xff) offset += 1;
    const marker = body[offset++]!;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > body.length) break;
    const length = body.readUInt16BE(offset);
    if (length < 2 || offset + length > body.length) break;
    if (sofMarkers.has(marker)) {
      const height = body.readUInt16BE(offset + 3);
      const width = body.readUInt16BE(offset + 5);
      if (width > 0 && height > 0) return { width, height };
    }
    offset += length;
  }
  throw new Error("equipment image dimensions are unavailable");
}

function axisAnnotation(input: {
  id: number;
  imageId: number;
  width: number;
  height: number;
  axis: EquipmentAxis;
  halfHeightRatio: number;
  example: EquipmentTrainingExample;
}): CocoEquipmentAnnotation {
  const x1 = input.axis.x1 * input.width;
  const y1 = input.axis.y1 * input.height;
  const x2 = input.axis.x2 * input.width;
  const y2 = input.axis.y2 * input.height;
  const padX = Math.max(2, input.width * 0.005);
  const padY = Math.max(4, input.height * input.halfHeightRatio);
  const left = Math.max(0, Math.min(x1, x2) - padX);
  const top = Math.max(0, Math.min(y1, y2) - padY);
  const right = Math.min(input.width, Math.max(x1, x2) + padX);
  const bottom = Math.min(input.height, Math.max(y1, y2) + padY);
  const bbox = [round6(left), round6(top), round6(right - left), round6(bottom - top)] as const;
  return {
    id: input.id,
    image_id: input.imageId,
    category_id: 1,
    bbox,
    area: round6(bbox[2] * bbox[3]),
    iscrowd: 0,
    keypoints: [round6(x1), round6(y1), 2, round6(x2), round6(y2), 2],
    num_keypoints: 2,
    attributes: {
      occlusion: input.example.occlusion,
      truncated: input.example.truncated,
      human_truth: true,
      review_event_refs: [...input.example.reviewEventRefs].sort(),
    },
  };
}

function cocoDocument(
  split: EquipmentSplit,
  values: { readonly images: readonly CocoEquipmentImage[]; readonly annotations: readonly CocoEquipmentAnnotation[] },
  labelsRevealed: boolean,
): CocoEquipmentDocument {
  return {
    info: {
      description: `MaxPower human-reviewed barbell shaft ${split} split`,
      schema_version: "maxpower-equipment-coco-video/v1",
      split,
      labels_revealed: labelsRevealed,
    },
    images: values.images,
    annotations: values.annotations,
    categories: CATEGORIES,
  };
}

function labelFreeTestInput(truth: CocoEquipmentDocument): CocoEquipmentDocument {
  return {
    info: { ...truth.info, description: "MaxPower frozen equipment detector test input", labels_revealed: false },
    images: truth.images.map(({ attributes: _attributes, ...image }) => image),
    categories: truth.categories,
  };
}

function corpusStats(
  dataset: EquipmentTrainingDataset,
  examples: readonly EquipmentTrainingExample[],
  accepted: readonly EquipmentTrainingExample[],
  documents: ReadonlyMap<EquipmentSplit, { readonly images: readonly CocoEquipmentImage[]; readonly annotations: readonly CocoEquipmentAnnotation[] }>,
): EquipmentDetectorCorpusManifest["stats"] {
  const sources = (split: EquipmentSplit) => new Set(accepted.filter((example) => example.split === split).map((example) => example.sourceCaptureId)).size;
  const items = (split: EquipmentSplit) => documents.get(split)?.images.length ?? 0;
  return {
    eligibleItemCount: dataset.stats.eligibleItemCount,
    positiveItemCount: accepted.filter((example) => example.target === "visible_barbell").length,
    hardNegativeItemCount: accepted.filter((example) => example.target !== "visible_barbell").length,
    ambiguousExcludedCount: examples.filter((example) => example.target === "ambiguous").length,
    trainItemCount: items("train"),
    validationItemCount: items("validation"),
    testItemCount: items("test"),
    trainSourceCount: sources("train"),
    validationSourceCount: sources("validation"),
    testSourceCount: sources("test"),
  };
}

function corpusBlockers(
  inherited: readonly string[],
  stats: EquipmentDetectorCorpusManifest["stats"],
): string[] {
  return [...new Set([
    ...inherited,
    ...(stats.positiveItemCount === 0 ? ["no_visible_barbell_human_truth"] : []),
    ...(stats.hardNegativeItemCount === 0 ? ["no_human_reviewed_hard_negatives"] : []),
    ...(stats.trainSourceCount < 2 ? ["fewer_than_two_training_source_captures"] : []),
    ...(stats.validationSourceCount < 1 ? ["no_source_disjoint_validation_capture"] : []),
    ...(stats.testSourceCount < 1 ? ["no_frozen_test_capture"] : []),
  ])].sort();
}

function validatePrediction(value: EquipmentDetectorPrediction): void {
  if (
    !value.reviewItemId
    || !value.trackId
    || !Number.isFinite(value.score)
    || value.score < 0
    || value.score > 1
    || value.bbox.length !== 4
    || value.bbox.some((coordinate) => !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1)
    || value.bbox[2] <= 0
    || value.bbox[3] <= 0
    || value.bbox[0] + value.bbox[2] > 1
    || value.bbox[1] + value.bbox[3] > 1
    || Object.values(value.axis).some((coordinate) => !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1)
  ) {
    throw new Error(`invalid equipment detector prediction: ${value.reviewItemId || "unknown"}`);
  }
}

function endpointMatches(
  image: CocoEquipmentImage,
  truth: CocoEquipmentAnnotation,
  predicted: EquipmentAxis,
  tolerance: number,
): { hits: number } {
  const diagonal = Math.hypot(image.width, image.height);
  const truthPoints = [
    { x: truth.keypoints[0], y: truth.keypoints[1] },
    { x: truth.keypoints[3], y: truth.keypoints[4] },
  ];
  const predictedPoints = [
    { x: predicted.x1 * image.width, y: predicted.y1 * image.height },
    { x: predicted.x2 * image.width, y: predicted.y2 * image.height },
  ];
  const direct = truthPoints.map((truthPoint, index) => Math.hypot(
    truthPoint.x - predictedPoints[index]!.x,
    truthPoint.y - predictedPoints[index]!.y,
  ));
  const reversed = truthPoints.map((truthPoint, index) => Math.hypot(
    truthPoint.x - predictedPoints[1 - index]!.x,
    truthPoint.y - predictedPoints[1 - index]!.y,
  ));
  const distances = direct[0]! + direct[1]! <= reversed[0]! + reversed[1]! ? direct : reversed;
  return { hits: distances.filter((distance) => distance / diagonal <= tolerance).length };
}

function normalizedBboxToPixels(
  bbox: EquipmentDetectorPrediction["bbox"],
  image: CocoEquipmentImage,
): [number, number, number, number] {
  return [bbox[0] * image.width, bbox[1] * image.height, bbox[2] * image.width, bbox[3] * image.height];
}

function bboxIou(left: readonly number[], right: readonly number[]): number {
  const x1 = Math.max(left[0]!, right[0]!);
  const y1 = Math.max(left[1]!, right[1]!);
  const x2 = Math.min(left[0]! + left[2]!, right[0]! + right[2]!);
  const y2 = Math.min(left[1]! + left[3]!, right[1]! + right[3]!);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left[2]! * left[3]! + right[2]! * right[3]! - intersection;
  return union > 0 ? intersection / union : 0;
}

function blockedEvaluation(
  input: { readonly corpus: EquipmentDetectorCorpusManifest; readonly predictions: EquipmentDetectorPredictionDocument },
  thresholds: EquipmentDetectorEvaluation["thresholds"],
  hardNegativeFrameCount: number,
): EquipmentDetectorEvaluation {
  return {
    schemaVersion: "maxpower-equipment-detector-evaluation/v1",
    status: "blocked_no_test_truth",
    productionPromotion: false,
    corpusSha256: input.corpus.corpusSha256,
    modelSha256: input.predictions.modelSha256,
    thresholds,
    metrics: {
      positiveFrameCount: 0,
      hardNegativeFrameCount,
      truePositiveCount: 0,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      trackCoverage: 0,
      endpointPck: 0,
      hardNegativeFrameFalsePositiveRate: 0,
      identitySwitchCount: 0,
    },
    failures: ["no_positive_human_test_truth"],
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}
