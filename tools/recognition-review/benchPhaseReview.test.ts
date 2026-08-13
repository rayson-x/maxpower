import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { BenchPhaseReviewStore, type BenchPhaseReviewInput } from "./benchPhaseReview";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "maxpower-bench-phase-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const observationsDir = join(root, "observations");
  const videoRoot = join(root, "videos");
  await mkdir(observationsDir, { recursive: true });
  await mkdir(join(videoRoot, "chest"), { recursive: true });
  await writeFile(join(videoRoot, "chest/source-a.mp4"), "video");
  const datasetPath = join(root, "dataset.json");
  const predictionsPath = join(root, "predictions.json");
  const rustCanonicalPath = join(root, "rust-canonical.json");
  const eventsPath = join(root, "events.jsonl");
  const rawLandmarks = Array.from({ length: 26 }, (_, index) => ({ x: 0.2 + index * 0.01, y: 0.3 + index * 0.01, visibility: 0.8 }));
  await writeFile(datasetPath, JSON.stringify({
    records: [{
      captureId: "source-a", exerciseId: "barbell_bench_press", capturePosition: "front", segments: [
        { repIndex: 1, startMs: 1000, peakMs: 2000, endMs: 3000 },
        { repIndex: 2, startMs: 3500, peakMs: 4500, endMs: 5500 },
      ], source: { video: "chest/source-a.mp4", durationMs: 6000 },
    }],
  }));
  await writeFile(predictionsPath, JSON.stringify({
    randomizedCaptureOrder: ["source-a"],
    rows: [{ captureId: "source-a", predictedSegments: [
      { startMs: 900, peakMs: 2200, endMs: 3100, rawStartMs: 1100, rawEndMs: 3000, meanAxisConfidence: 0.9 },
      { startMs: 3400, peakMs: 4700, endMs: 5600, rawStartMs: 3600, rawEndMs: 5500, meanAxisConfidence: 0.8 },
    ] }],
  }));
  await writeFile(join(observationsDir, "source-a.barbell-pose-alignment.json.gz"), gzipSync(JSON.stringify({
    captureId: "source-a", frames: [
      { timestampMs: 0, axis: null, fusion: { status: "pose_wrist_unavailable" }, landmarks: rawLandmarks },
      { timestampMs: 100, axis: { source: "measured", confidence: 0.9, x1: 0.1, y1: 0.3, x2: 0.9, y2: 0.31, centerY: 0.305 }, fusion: { status: "aligned" }, landmarks: rawLandmarks },
    ],
  })));
  await writeFile(rustCanonicalPath, JSON.stringify({
    captures: {
      "chest/source-a.json": {
        sourceCaptureId: "source-a",
        poses: [{
          timestampMs: 100,
          landmarks: rawLandmarks.map((point, index) => ({
            ...point,
            observationScore: point.visibility,
            source: index === 9 ? "predicted" : "measured",
            predicted: index === 9,
            renderable: true,
            usable: index !== 9,
          })),
        }],
      },
    },
  }));
  return {
    root,
    eventsPath,
    store: await BenchPhaseReviewStore.open({ datasetPath, predictionsPath, observationsDir, rustCanonicalPath, eventsPath, videoRoot }),
  };
}

function input(overrides: Partial<BenchPhaseReviewInput> = {}): BenchPhaseReviewInput {
  return {
    captureId: "source-a",
    reviewerId: "owner",
    reviewStatus: "draft",
    expectedPriorEventId: null,
    reps: [
      { repIndex: 1, startMs: 1000, turnaroundMs: 2200, endMs: 3000, turnaroundSource: "algorithm_candidate", note: "" },
      { repIndex: 2, startMs: 3500, turnaroundMs: 4700, endMs: 5500, turnaroundSource: "algorithm_candidate", note: "" },
    ],
    note: "",
    ...overrides,
  };
}

test("bench phase detail never exposes legacy midpoint as human turnaround truth", async (t) => {
  const { store } = await fixture(t);
  const detail = store.detail("source-a") as {
    humanRanges: { startMs: number; turnaroundMs: null; endMs: number; humanTruth: true }[];
    algorithmSegments: { turnaroundMs: number; humanTruth: false; provenance: string }[];
    axisFrames: { landmarks: { visibility: number }[]; fusionStatus: string }[];
    rustCanonicalFrames: { landmarks: { source: string; predicted: boolean; usable: boolean }[] }[];
    poseLayers: { schema: string; raw: { humanTruth: false }; rustCanonical: { humanTruth: false } };
  };
  assert.deepEqual(detail.humanRanges.map(({ startMs, turnaroundMs, endMs }) => ({ startMs, turnaroundMs, endMs })), [
    { startMs: 1000, turnaroundMs: null, endMs: 3000 },
    { startMs: 3500, turnaroundMs: null, endMs: 5500 },
  ]);
  assert.equal(detail.algorithmSegments[0]?.turnaroundMs, 2200);
  assert.equal(detail.algorithmSegments[0]?.humanTruth, false);
  assert.equal(detail.algorithmSegments[0]?.provenance, "algorithm_bar_axis");
  assert.equal(detail.poseLayers.schema, "halpe26");
  assert.equal(detail.poseLayers.raw.humanTruth, false);
  assert.equal(detail.poseLayers.rustCanonical.humanTruth, false);
  assert.equal(detail.axisFrames[1]?.landmarks.length, 26);
  assert.equal(detail.axisFrames[1]?.fusionStatus, "aligned");
  assert.equal(detail.rustCanonicalFrames[0]?.landmarks[9]?.source, "predicted");
});

test("algorithm candidates can be drafts but cannot be submitted as human truth", async (t) => {
  const { store } = await fixture(t);
  const draft = await store.save(input());
  assert.equal(draft.humanPeakTruth, false);
  assert.equal(draft.trainerReadable, false);
  await assert.rejects(store.save(input({
    reviewStatus: "submitted",
    expectedPriorEventId: draft.eventId,
  })), /requires every turnaround to be human confirmed/);
});

test("human-adjusted turnarounds append trainable truth and enforce optimistic revisions", async (t) => {
  const { store, eventsPath } = await fixture(t);
  const submitted = await store.save(input({
    reviewStatus: "submitted",
    reps: [
      { repIndex: 1, startMs: 1000, turnaroundMs: 2150, endMs: 3000, turnaroundSource: "human_adjusted", note: "底部换向" },
      { repIndex: 2, startMs: 3550, turnaroundMs: 4650, endMs: 5500, turnaroundSource: "human_adjusted", note: "" },
    ],
  }));
  assert.equal(submitted.humanPeakTruth, true);
  assert.equal(submitted.trainerReadable, true);
  assert.equal(submitted.productionPromotion, false);
  assert.equal(submitted.reps[1]?.startSource, "human_adjusted");
  await assert.rejects(store.save(input()), /stale bench phase review revision/);
  const lines = (await readFile(eventsPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
});

test("bench phase video remains inside the configured archive root", async (t) => {
  const { store, root } = await fixture(t);
  assert.equal(store.video("source-a").path, join(root, "videos/chest/source-a.mp4"));
  assert.throws(() => store.video("missing"), /not found/);
});
