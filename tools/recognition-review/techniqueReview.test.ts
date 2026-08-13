import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { TechniqueReviewStore, type TechniqueReviewInput } from "./techniqueReview";

function input(overrides: Partial<TechniqueReviewInput> = {}): TechniqueReviewInput {
  return {
    reviewItemId: "capture-1#rep-1",
    reviewerId: "coach-a",
    reviewerRole: "coach",
    reviewStatus: "submitted",
    expectedPriorEventId: null,
    techniqueAdherence: "observed_deviation",
    compensation: "observed",
    stimulusCompatibility: "possible_strategy_shift",
    movementStrategies: ["momentum_assistance"],
    independentFeatureGroups: ["torso_pelvis", "body_joint_path"],
    note: "向心阶段躯干后摆，同时腕部轨迹突然向后偏移。",
    ...overrides,
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "maxpower-technique-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const queuePath = join(root, "queue.json.gz");
  const eventsPath = join(root, "events.jsonl");
  await writeFile(queuePath, gzipSync(JSON.stringify({
    schemaVersion: "maxpower-training-execution-review-queue/v1",
    items: [1, 2].map((repIndex) => ({
      reviewItemId: `capture-1#rep-${repIndex}`,
      captureId: "capture-1",
      sourceCaptureId: "capture-1",
      sourceVideo: "public/example.mp4",
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      repIndex,
      startMs: repIndex * 1_000,
      peakMs: repIndex * 1_000 + 400,
      endMs: repIndex * 1_000 + 900,
    })),
  })));
  return { store: await TechniqueReviewStore.open({ queuePath, eventsPath }), eventsPath };
}

test("technique review appends provenance-bearing labels without promoting personal reps to standard references", async (t) => {
  const { store, eventsPath } = await fixture(t);
  const event = await store.save(input());
  assert.equal(event.standardFormReference, false);
  assert.equal(event.captureId, "capture-1");
  assert.deepEqual(event.evidenceTimeRange, { startMs: 1_000, peakMs: 1_400, endMs: 1_900 });
  assert.match(await readFile(eventsPath, "utf8"), /maxpower-technique-review-event\/v1/);

  const capture = store.capture("capture-1");
  assert.equal(capture.totalReps, 2);
  assert.equal(capture.submittedReps, 1);
  assert.equal(capture.items[0]?.adjudicationStatus, "single_review");
  assert.equal(store.trainingDataset().status, "blocked_no_gold_labels");
  assert.equal(store.trainingDataset().stats.eligibleRepCount, 0);
});

test("confirmed compensation requires two independent feature groups", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(
    store.save(input({ independentFeatureGroups: ["torso_pelvis"] })),
    /two independent feature groups/,
  );
  assert.equal(store.capture("capture-1").submittedReps, 0);
});

test("review writes use optimistic revision and expose independent-review agreement", async (t) => {
  const { store } = await fixture(t);
  const first = await store.save(input());
  await assert.rejects(store.save(input()), /stale technique review revision/);
  await store.save(input({
    reviewerId: "biomechanics-b",
    reviewerRole: "biomechanics_reviewer",
  }));
  assert.equal(store.capture("capture-1").items[0]?.adjudicationStatus, "agreement");
  const agreed = store.trainingDataset();
  assert.equal(agreed.status, "research_candidate");
  assert.equal(agreed.promotionAllowed, false);
  assert.equal(agreed.stats.eligibleRepCount, 1);
  assert.equal(agreed.examples[0]?.standardFormReference, false);
  assert.deepEqual(agreed.examples[0]?.reviewEventRefs.length, 2);

  const revised = await store.save(input({
    expectedPriorEventId: first.eventId,
    compensation: "possible",
    independentFeatureGroups: ["torso_pelvis"],
    note: "只能确认躯干变化，第二个独立证据组不足，因此降为可能。",
  }));
  assert.equal(revised.compensation, "possible");
  assert.equal(store.capture("capture-1").items[0]?.adjudicationStatus, "disagreement");
  assert.equal(store.trainingDataset().stats.disagreementCount, 1);
  assert.equal(store.trainingDataset().stats.eligibleRepCount, 0);
});

test("the frozen personal queue exposes all 464 phase-labelled reps", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-technique-read-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await TechniqueReviewStore.open({
    queuePath: join(process.cwd(), "data/workflows/action-trajectory-database/halpe26-v1/technique-review-queue.json.gz"),
    eventsPath: join(root, "events.jsonl"),
  });
  const captureIds = new Set<string>();
  let reps = 0;
  const dataset = JSON.parse(gunzipSync(await readFile(
    join(process.cwd(), "data/workflows/action-trajectory-database/halpe26-v1/technique-review-queue.json.gz"),
  )).toString("utf8")) as { items: { captureId: string }[] };
  for (const item of dataset.items) captureIds.add(item.captureId);
  for (const captureId of captureIds) reps += store.capture(captureId).totalReps;
  assert.equal(reps, 464);
  const training = store.trainingDataset();
  assert.equal(training.status, "blocked_no_gold_labels");
  assert.deepEqual(training.stats, {
    queueRepCount: 464,
    eligibleRepCount: 0,
    pendingOrSingleReviewCount: 464,
    disagreementCount: 0,
  });
});
