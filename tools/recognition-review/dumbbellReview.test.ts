import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { gzipSync } from "node:zlib";

import { DumbbellReviewStore, type DumbbellReviewInput } from "./dumbbellReview";

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function review(overrides: Partial<DumbbellReviewInput> = {}): DumbbellReviewInput {
  return {
    reviewItemId: "mmfit-equipment:w01:1:frame:100",
    reviewerId: "annotator-a",
    reviewerRole: "vision_annotator",
    reviewStatus: "submitted",
    expectedPriorEventId: null,
    target: "visible_dumbbells",
    instances: [
      { instanceId: "dumbbell-1", bbox: { x1: 0.2, y1: 0.3, x2: 0.3, y2: 0.5 }, imageSide: "image_left", occlusion: "partial", truncated: false },
      { instanceId: "dumbbell-2", bbox: { x1: 0.7, y1: 0.3, x2: 0.8, y2: 0.5 }, imageSide: "image_right", occlusion: "none", truncated: false },
    ],
    note: "两只哑铃均可见。",
    ...overrides,
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "maxpower-dumbbell-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const queuePath = join(root, "queue.json.gz");
  const eventsPath = join(root, "events.jsonl");
  await mkdir(join(root, "images"), { recursive: true });
  const items = [];
  for (const [subjectId, split, frameIndex] of [["01", "train", 100], ["08", "validation", 200], ["17", "test", 300]] as const) {
    const image = `images/w${subjectId}-${frameIndex}.jpg`;
    const body = Buffer.from(`image:w${subjectId}:${frameIndex}`);
    await writeFile(join(root, image), body);
    items.push({
      reviewItemId: `mmfit-equipment:w${subjectId}:1:frame:${frameIndex}`,
      datasetId: "mm-fit",
      sourceSequenceId: `w${subjectId}:1`,
      sourceAction: "dumbbell_shoulder_press",
      exerciseId: "dumbbell_shoulder_press",
      subjectId,
      sessionId: `w${subjectId}`,
      officialSplit: "train",
      split,
      frameIndex,
      timestampMs: frameIndex / 30 * 1000,
      sampleKind: "in_set_q50",
      setCountTruth: 10,
      repBounds: [],
      image,
      imageSha256: digest(body),
      proposal: {
        kind: "dumbbell_instances",
        instances: [{ proposalId: "wrist-roi:left", kind: "dumbbell", hand: "left", bbox: { x1: 0.2, y1: 0.3, x2: 0.3, y2: 0.5 }, source: "wrist-roi/v1", humanTruth: false }],
        source: "annotation_aid_only/v1",
        humanTruth: false,
      },
    });
  }
  await writeFile(queuePath, gzipSync(JSON.stringify({
    schemaVersion: "maxpower-mmfit-dumbbell-review-queue/v1",
    officialSourceSplit: "train",
    excludedOfficialSplits: ["validation", "test", "unseen_test"],
    splitPolicy: "mmfit-official-train-inner-subject-holdout/v1",
    equipmentSplitBySubject: { "01": "train", "08": "validation", "17": "test" },
    promotionAllowed: false,
    blockedReasons: ["all_items_require_human_review"],
    materialized: true,
    items,
  })));
  return {
    store: await DumbbellReviewStore.open({ queuePath, eventsPath, assetRoot: root }),
    root,
    eventsPath,
  };
}

test("MM-Fit dumbbell reviews append multi-box human truth with frozen lineage", async (t) => {
  const { store, eventsPath } = await fixture(t);
  const event = await store.save(review());
  assert.equal(event.humanTruth, true);
  assert.equal(event.productionPromotion, false);
  assert.equal(event.officialSplit, "train");
  assert.equal(event.instances.length, 2);
  assert.match(await readFile(eventsPath, "utf8"), /maxpower-mmfit-dumbbell-review-event\/v1/);
  const index = store.index() as { stats: { itemCount: number; subjectCount: number; submittedItems: number; testItems: number } };
  assert.deepEqual(index.stats.itemCount, 3);
  assert.deepEqual(index.stats.subjectCount, 3);
  assert.deepEqual(index.stats.submittedItems, 1);
  assert.deepEqual(index.stats.testItems, 1);
  const dataset = store.trainingDataset() as { status: string; promotionAllowed: boolean; stats: { eligibleItemCount: number }; examples: Array<{ instances: unknown[]; split: string }> };
  assert.equal(dataset.status, "blocked_data_quality");
  assert.equal(dataset.promotionAllowed, false);
  assert.equal(dataset.stats.eligibleItemCount, 1);
  assert.equal(dataset.examples[0]?.instances.length, 2);
  assert.equal(dataset.examples[0]?.split, "train");
});

test("visible dumbbells require bounded boxes and optimistic revisions", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.save(review({ instances: [] })), /require one to four reviewed boxes/);
  await assert.rejects(store.save(review({ instances: [{ ...review().instances[0]!, bbox: { x1: -0.1, y1: 0.2, x2: 0.3, y2: 0.4 } }] })), /invalid instances\.0\.bbox bounds/);
  const first = await store.save(review());
  await assert.rejects(store.save(review()), /stale dumbbell review revision/);
  const revised = await store.save(review({
    expectedPriorEventId: first.eventId,
    target: "no_target_dumbbell",
    instances: [],
    note: "当前帧没有目标哑铃。",
  }));
  assert.equal(revised.target, "no_target_dumbbell");
});

test("dumbbell assets stay inside the frozen root", async (t) => {
  const { store, root } = await fixture(t);
  const asset = store.asset("mmfit-equipment:w17:1:frame:300");
  assert.equal(asset.path, join(root, "images/w17-300.jpg"));
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => store.asset("missing"), /not found/);
});
