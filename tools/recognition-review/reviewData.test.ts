import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  aggregateReplayRowsBySource,
  defaultRecognitionReviewOptions,
  RecognitionReviewRepository,
} from "./reviewData";
import { parseByteRange } from "./server";

const playerMath = require(resolve(process.cwd(), "tools/recognition-review/public/playerMath.js")) as {
  nearestFrameWithinAge<T extends { timestampMs: number }>(frames: readonly T[], timestampMs: number, maximumAgeMs: number): T | null;
  nextFrameTimestamp(frames: readonly { timestampMs: number }[], timestampMs: number, clipEndMs: number): number;
};

test("review catalog preserves all 50 personal annotations and all 616 MM-Fit clips", async () => {
  const repository = await RecognitionReviewRepository.open(defaultRecognitionReviewOptions(process.cwd()));
  const index = repository.index();
  assert.equal(index.stats.personalAnnotatedVideos, 50);
  assert.equal(index.stats.personalAnnotatedReps, 465);
  assert.equal(index.stats.personalEvaluatedVideos, 48);
  assert.equal(index.stats.personalExactVideos, 6);
  assert.equal(index.stats.personalCountExactVideos, 18);
  assert.equal(index.stats.personalAlignedReps, 332);
  assert.equal(index.stats.personalTimelineTruthReps, 445);
  assert.equal(index.stats.personalUnevaluatedVideos, 2);
  assert.equal(index.stats.mmfitClips, 616);
  assert.equal(index.stats.mmfitExactClips, 487);
  assert.equal(index.stats.mmfitFailedClips, 129);
  assert.equal(index.stats.mmfitRgbClips, 301);
  assert.equal(index.items.filter((item) => item.source === "personal" && item.exerciseId === null).length, 0);
  assert.equal(index.personalHeldOutAcceptance.overallStatus, "fail");
  assert.equal(index.personalHeldOutAcceptance.productionPromotion, false);
  assert.equal(index.personalHeldOutAcceptance.metrics.candidatePrecision, 0.9243498817966903);
  assert.equal(index.personalHeldOutAcceptance.metrics.candidateRecall, 0.8786516853932584);
  assert.equal(index.personalHeldOutAcceptance.metrics.exactSetSourceRate, 0.375);
  assert.equal(index.personalHeldOutAcceptance.metrics.manualRangeAlignedRate, 0.7460674157303371);
  assert.equal(index.personalHeldOutAcceptance.metrics.exactTimelineSourceRate, 0.125);
  assert.equal(index.personalHeldOutAcceptance.metrics.eligiblePeakTruthCount, 0);
  const randomAudit = index.items.filter((item) => item.auditSelection === "seeded_random_audit");
  assert.equal(randomAudit.length, 1);
  assert.equal(randomAudit[0]?.sequenceId, "b8af1ab860d6bbb43cd3f2cadc71506c");
  assert.equal(index.items.filter((item) => item.auditSelection === "held_out").length, 47);
});

test("train MM-Fit detail binds local RGB to official skeleton timestamps", async () => {
  const repository = await RecognitionReviewRepository.open(defaultRecognitionReviewOptions(process.cwd()));
  const item = repository.index().items.find((candidate) => candidate.source === "mmfit" && candidate.split === "train");
  assert.ok(item);
  const detail = await repository.detail(item.id);
  assert.ok(detail.videoUrl);
  assert.ok(detail.frames.length > 0);
  assert.ok(detail.clipStartMs > 0);
  assert.ok(detail.clipEndMs > detail.clipStartMs);
  assert.equal(detail.predictedSegments.length, detail.item.predictedCount);
});

test("personal review uses Halpe-26 media-PTS observations instead of legacy MediaPipe capture time", async () => {
  const repository = await RecognitionReviewRepository.open(defaultRecognitionReviewOptions(process.cwd()));
  const detail = await repository.detail("personal:field-capture-2026-08-02T19-08-40-178Z");
  const timing = detail as unknown as {
    poseSchema: string;
    posePipeline: string;
    poseTimestampDomain: string;
    poseTiming: {
      maximumOverlayAgeMs: number;
      medianFrameIntervalMs: number;
    };
  };
  assert.equal(detail.item.countExact, false);
  assert.equal(detail.item.status, "failure");
  assert.equal(detail.item.failureCategory, "状态机漏记");
  assert.equal(detail.item.predictedCount, 7);
  assert.equal(detail.item.alignedCount, 7);
  assert.equal(detail.item.timelineTruthCount, 8);
  assert.equal(detail.item.evidenceLevel, "source_held_out_research");
  assert.equal(detail.item.auditSelection, "held_out");
  assert.equal(timing.poseSchema, "halpe26");
  assert.equal(timing.posePipeline, "yolox-nano-humanart+rtmpose-m-halpe26");
  assert.equal(timing.poseTimestampDomain, "media_pts");
  assert.equal(timing.poseTiming.maximumOverlayAgeMs, 150);
  assert.ok(timing.poseTiming.medianFrameIntervalMs > 0);
  assert.equal(detail.rawFrames.length, 228);
  assert.equal(detail.frames.length, detail.rawFrames.length);
  assert.equal(detail.rawFrames[0]?.timestampMs, 0);
  assert.equal(detail.rawFrames.at(-1)?.timestampMs, 25_900);
  assert.equal(detail.clipEndMs, 25_900);
  assert.equal(detail.durationMs, 25_900);
  assert.equal(detail.rawFrames[0]?.landmarks.length, 26);
  assert.equal(detail.frames[0]?.landmarks.length, 26);
  const halpeUpperBody = detail.rawFrames.flatMap((frame) => [5, 6, 7, 8, 9, 10].map((index) => frame.landmarks[index]));
  const expectedUpperBodyRatio = halpeUpperBody.filter((landmark) => (landmark?.visibility ?? 0) >= 0.5).length / halpeUpperBody.length;
  assert.equal(detail.rawPoseDiagnostics.upperBodyVisibleRatio, expectedUpperBodyRatio);
  assert.ok(detail.baselineSegments.length > 0);
  assert.ok(detail.frames.some((frame) => frame.landmarks.some((landmark) => landmark.source === "predicted")));
});

test("source-held-out prediction replaces same-record replay while preserving it as a baseline", async () => {
  const repository = await RecognitionReviewRepository.open(defaultRecognitionReviewOptions(process.cwd()));
  const detail = await repository.detail("personal:field-capture-2026-08-02T18-19-26-633Z");
  assert.equal(detail.item.expectedCount, 10);
  assert.equal(detail.item.predictedCount, 2);
  assert.equal(detail.item.timelineTruthCount, 9);
  assert.equal(detail.item.alignedCount, 0);
  assert.equal(detail.item.evidenceLevel, "source_held_out_research");
  assert.equal(detail.predictedSegments.length, 2);
  assert.equal(detail.baselineSegments.length, 10);
  assert.notDeepEqual(detail.predictedSegments, detail.baselineSegments);
});

test("byte range parsing supports video seeking and rejects unsafe ranges", () => {
  assert.deepEqual(parseByteRange("bytes=100-199", 1000), { start: 100, end: 199 });
  assert.deepEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.throws(() => parseByteRange("bytes=1000-", 1000), /invalid/);
});

test("review player never paints a stale pose and steps by observation timestamps", () => {
  const frames = [{ timestampMs: 0 }, { timestampMs: 100 }, { timestampMs: 420 }];
  assert.equal(playerMath.nearestFrameWithinAge(frames, 245, 150), frames[1]);
  assert.equal(playerMath.nearestFrameWithinAge(frames, 260, 150), null);
  assert.equal(playerMath.nearestFrameWithinAge(frames, 570, 150), frames[2]);
  assert.equal(playerMath.nearestFrameWithinAge(frames, 571, 150), null);
  assert.equal(playerMath.nextFrameTimestamp(frames, 100, 500), 420);
  assert.equal(playerMath.nextFrameTimestamp(frames, 420, 500), 500);
});

test("split context replay rows aggregate back to one source video", () => {
  const rows = aggregateReplayRowsBySource([
    {
      captureId: "capture::front",
      sourceCaptureId: "capture",
      expectedSetCount: 8,
      truthCount: 8,
      predictedCount: 8,
      matchedCount: 8,
      falsePositiveCount: 0,
      needsReviewCount: 1,
      rejectedCount: 2,
      exactAnnotatedBoundaries: true,
      truthSegments: [{ startMs: 100, peakMs: 200, endMs: 300 }],
      predictedSegments: [{ startMs: 110, peakMs: 210, endMs: 310 }],
      evidenceReasonCounts: { incomplete_cycle: 2 },
    },
    {
      captureId: "capture::rear",
      sourceCaptureId: "capture",
      expectedSetCount: 8,
      truthCount: 8,
      predictedCount: 8,
      matchedCount: 8,
      falsePositiveCount: 0,
      needsReviewCount: 2,
      rejectedCount: 3,
      exactAnnotatedBoundaries: true,
      truthSegments: [{ startMs: 1_000, peakMs: 1_100, endMs: 1_200 }],
      predictedSegments: [{ startMs: 1_010, peakMs: 1_110, endMs: 1_210 }],
      evidenceReasonCounts: { incomplete_cycle: 3 },
    },
  ]).get("capture");

  assert.ok(rows);
  assert.equal(rows.expectedSetCount, 16);
  assert.equal(rows.predictedCount, 16);
  assert.equal(rows.matchedCount, 16);
  assert.equal(rows.exact, true);
  assert.equal(rows.needsReviewCount, 3);
  assert.equal(rows.rejectedCount, 5);
  assert.deepEqual(rows.evidenceReasonCounts, { incomplete_cycle: 5 });
  assert.equal((rows.predictedSegments as unknown[]).length, 2);
});
