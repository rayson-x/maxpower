import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { EquipmentReviewStore, type EquipmentReviewInput } from "./equipmentReview";

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function input(overrides: Partial<EquipmentReviewInput> = {}): EquipmentReviewInput {
  return {
    reviewItemId: "equipment:capture-train:frame:1",
    reviewerId: "owner-a",
    reviewerRole: "owner_observation",
    reviewStatus: "submitted",
    expectedPriorEventId: null,
    target: "visible_barbell",
    equipmentKind: "barbell_shaft",
    axis: { x1: 0.1, y1: 0.42, x2: 0.9, y2: 0.43 },
    occlusion: "partial",
    truncated: false,
    note: "杠铃杆在手部遮挡下仍可确认。",
    ...overrides,
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "maxpower-equipment-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventsPath = join(root, "events.jsonl");
  const queuePath = join(root, "queue.json.gz");
  const items = [];
  for (const [sourceCaptureId, split, frameIndex] of [
    ["capture-train", "train", 1],
    ["capture-test", "test", 2],
  ] as const) {
    const image = `${sourceCaptureId}.jpg`;
    const preview = `${sourceCaptureId}-preview.jpg`;
    const imageBody = Buffer.from(`image:${sourceCaptureId}`);
    const previewBody = Buffer.from(`preview:${sourceCaptureId}`);
    await writeFile(join(root, image), imageBody);
    await writeFile(join(root, preview), previewBody);
    items.push({
      reviewItemId: `equipment:${sourceCaptureId}:frame:${frameIndex}`,
      sourceCaptureId,
      sourceVideo: `${sourceCaptureId}.mp4`,
      sourceVideoSha256: "a".repeat(64),
      capturePosition: "front",
      analysisView: "front",
      split,
      frameIndex,
      timestampMs: frameIndex * 100,
      sampleKind: "rep-phase",
      repIndex: 1,
      phase: "extreme",
      image,
      imageSha256: digest(imageBody),
      preview,
      previewSha256: digest(previewBody),
      proposal: {
        kind: "barbell_shaft",
        axis: { x1: 0.05, y1: 0.4, x2: 0.95, y2: 0.4 },
        confidenceRatio: 1.2,
        source: "geometry/v1",
        reviewPriority: "normal",
        reviewReason: null,
        humanTruth: false,
      },
    });
  }
  await writeFile(queuePath, gzipSync(JSON.stringify({
    schemaVersion: "maxpower-equipment-review-queue/v1",
    sourceManifestSha256: "b".repeat(64),
    splitPolicy: "capture-disjoint/v1",
    promotionAllowed: false,
    blockedReasons: ["single_person_legacy_subject_group", "all_items_require_human_review"],
    sourceGroups: [
      { sourceCaptureId: "capture-train", split: "train" },
      { sourceCaptureId: "capture-test", split: "test" },
    ],
    items,
  })));
  const store = await EquipmentReviewStore.open({ queuePath, eventsPath, assetRoot: root });
  return { store, eventsPath, queuePath, root };
}

test("equipment review appends source-bound human truth without production promotion", async (t) => {
  const { store, eventsPath } = await fixture(t);
  const event = await store.save(input());
  assert.equal(event.humanTruth, true);
  assert.equal(event.productionPromotion, false);
  assert.equal(event.split, "train");
  assert.match(await readFile(eventsPath, "utf8"), /maxpower-equipment-review-event\/v1/);

  const index = store.index() as { stats: { submittedItems: number; unreviewedItems: number } };
  assert.deepEqual(index.stats, {
    itemCount: 2,
    sourceCount: 2,
    submittedItems: 1,
    disagreementItems: 0,
    draftItems: 0,
    unreviewedItems: 1,
    trainItems: 1,
    validationItems: 0,
    testItems: 1,
    highPriorityItems: 0,
  });
  const training = store.trainingDataset();
  assert.equal(training.status, "blocked_data_quality");
  assert.equal(training.promotionAllowed, false);
  assert.equal(training.stats.eligibleItemCount, 1);
  assert.deepEqual(
    {
      train: training.stats.trainItemCount,
      validation: training.stats.validationItemCount,
      test: training.stats.testItemCount,
    },
    { train: 1, validation: 0, test: 0 },
  );
  assert.deepEqual(training.blockedReasons, ["single_person_legacy_subject_group"]);
  const example = training.examples[0] as { split: string; imageSha256: string } | undefined;
  assert.equal(example?.split, "train");
  assert.match(example?.imageSha256 ?? "", /^[a-f0-9]{64}$/);
});

test("visible equipment requires a bounded shaft axis and optimistic revision", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(
    store.save(input({ axis: null })),
    /requires a reviewed shaft axis/,
  );
  const first = await store.save(input());
  await assert.rejects(store.save(input()), /stale equipment review revision/);
  const revised = await store.save(input({
    expectedPriorEventId: first.eventId,
    target: "no_target_equipment",
    equipmentKind: null,
    axis: null,
    occlusion: "unknown",
    note: "该帧没有真实训练杠铃。",
  }));
  assert.equal(revised.target, "no_target_equipment");
});

test("equipment asset lookup stays inside the frozen asset root", async (t) => {
  const { store, root } = await fixture(t);
  const asset = store.asset("equipment:capture-test:frame:2", "image");
  assert.equal(asset.path, join(root, "capture-test.jpg"));
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => store.asset("missing", "image"), /not found/);
});
