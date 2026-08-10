import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import type { IdFactory } from "../src/kernel/ids.js";
import type { Principal } from "../src/kernel/principal.js";
import {
  InMemoryMediaLibraryAdapter,
  MediaLibraryModule,
  type CreateMediaUploadInput,
} from "../src/modules/media/index.js";
import {
  InMemoryProductDataAdapter,
  ProductDataModule,
} from "../src/modules/product-data/index.js";

test("media V1 makes byte-transfer capability explicit and keeps downloads owner-only", async () => {
  const media = createMediaLibrary();
  const alice = principal("alice");
  const bob = principal("bob");
  const request: CreateMediaUploadInput = {
    kind: "video",
    fileName: "squat.mp4",
    contentType: "video/mp4",
    byteSize: 12_345,
    sha256: "a".repeat(64),
    idempotencyKey: "upload-video",
  };

  const created = await media.createUpload(alice, request);
  assert.equal(created.asset.status, "uploading");
  assert.equal(created.asset.purpose, "personal");
  assert.equal(created.asset.verification, "unverified_metadata");
  assert.equal(created.upload.byteTransfer, "local_test");
  assert.equal(created.upload.expiresAt, created.uploadTarget.expiresAt);
  assert.equal(created.uploadTarget.kind, "local_test");
  assert.match(created.uploadTarget.url, /^memory:\/\/uploads\//);
  assert.deepEqual(await media.createUpload(alice, request), created);
  await assertApiError(media.getAsset(bob, created.asset.id), 404, "not_found");

  const completed = await media.completeUpload(alice, {
    uploadId: created.upload.id,
    expectedRevision: 1,
    idempotencyKey: "complete-video",
  });
  assert.equal(completed.asset.status, "ready");
  assert.equal(completed.asset.revision, 2);
  assert.equal(completed.upload.status, "completed");
  assert.deepEqual((await media.listAssets(alice)).data, [completed.asset]);

  const download = await media.createDownload(alice, { assetId: completed.asset.id });
  assert.equal(download.kind, "local_test");
  assert.match(download.url, /^memory:\/\/assets\//);
  await assertApiError(
    media.createDownload(bob, { assetId: completed.asset.id }),
    404,
    "not_found",
  );
});

test("expired idempotent uploads reject completion and reissue one fresh target", async () => {
  const clock = new MutableClock("2026-01-02T00:00:00.000Z");
  const media = new MediaLibraryModule({
    adapter: new InMemoryMediaLibraryAdapter(),
    clock,
    ids: sequentialIds(),
    transferExpirySeconds: 60,
  });
  const alice = principal("alice");
  const request = {
    kind: "nutrition_photo",
    fileName: "meal.jpg",
    contentType: "image/jpeg",
    byteSize: 500,
    sha256: "f".repeat(64),
    idempotencyKey: "expiring-upload",
  } as const;
  const created = await media.createUpload(alice, request);
  clock.advanceSeconds(61);
  await assertApiError(
    media.completeUpload(alice, {
      uploadId: created.upload.id,
      expectedRevision: created.upload.revision,
      idempotencyKey: "expired-completion",
    }),
    410,
    "upload_expired",
  );

  const reissued = await media.createUpload(alice, request);
  assert.equal(reissued.asset.id, created.asset.id);
  assert.equal(reissued.upload.id, created.upload.id);
  assert.equal(reissued.upload.revision, created.upload.revision + 1);
  assert.notEqual(reissued.uploadTarget.expiresAt, created.uploadTarget.expiresAt);
  assert.equal((await media.listAssets(alice)).data.length, 1);
  assert.equal(
    (await media.completeUpload(alice, {
      uploadId: reissued.upload.id,
      expectedRevision: reissued.upload.revision,
      idempotencyKey: "fresh-completion",
    })).asset.status,
    "ready",
  );
});

test("deleting an asset recursively removes descendant metadata", async () => {
  const productData = new ProductDataModule({
    adapter: new InMemoryProductDataAdapter(),
    clock: new StepClock(),
    ids: sequentialIds(),
  });
  const media = createMediaLibrary(productData);
  const alice = principal("alice");
  const video = await createReadyAsset(media, alice, {
    kind: "video",
    fileName: "deadlift.mp4",
    contentType: "video/mp4",
    byteSize: 500,
    sha256: "1".repeat(64),
    idempotencyKey: "video",
  });
  const packet = await createReadyAsset(media, alice, {
    kind: "canonical_packet",
    fileName: "deadlift.packet.json",
    contentType: "application/json",
    byteSize: 100,
    sha256: "2".repeat(64),
    parentAssetId: video.asset.id,
    idempotencyKey: "packet",
  });
  const keypoints = await createReadyAsset(media, alice, {
    kind: "keypoints",
    fileName: "deadlift.keypoints.json",
    contentType: "application/json",
    byteSize: 80,
    sha256: "3".repeat(64),
    parentAssetId: packet.asset.id,
    idempotencyKey: "keypoints",
  });
  const workout = await productData.createWorkoutSession(alice, {
    title: "Deadlift evidence",
    mediaAssetIds: [video.asset.id, keypoints.asset.id],
    idempotencyKey: "workout-evidence",
  });
  const result = await productData.createResult(alice, {
    kind: "motion_analysis",
    workoutSessionId: workout.id,
    payload: { disposition: "confirmed" },
    mediaAssetIds: [packet.asset.id],
    idempotencyKey: "result-evidence",
  });

  await assertApiError(
    media.deleteAsset(alice, {
      assetId: video.asset.id,
      expectedRevision: 1,
      idempotencyKey: "delete-stale",
    }),
    409,
    "revision_conflict",
  );

  const request = {
    assetId: video.asset.id,
    expectedRevision: video.asset.revision,
    idempotencyKey: "delete-tree",
  } as const;
  const deleted = await media.deleteAsset(alice, request);
  assert.deepEqual(deleted.deletedAssetIds, [
    video.asset.id,
    packet.asset.id,
    keypoints.asset.id,
  ]);
  assert.deepEqual(await media.deleteAsset(alice, request), deleted);
  assert.deepEqual((await media.listAssets(alice)).data, []);
  await assertApiError(media.getAsset(alice, video.asset.id), 404, "not_found");
  await assertApiError(media.getAsset(alice, packet.asset.id), 404, "not_found");
  await assertApiError(media.getAsset(alice, keypoints.asset.id), 404, "not_found");
  assert.deepEqual(
    (await productData.getWorkoutSession(alice, workout.id)).mediaReferences.map((reference) =>
      reference.evidenceStatus
    ),
    ["evidence_deleted", "evidence_deleted"],
  );
  assert.equal(
    (await productData.getResult(alice, result.id)).mediaReferences[0]?.evidenceStatus,
    "evidence_deleted",
  );
});

test("all supported media kinds remain personal and account isolated", async () => {
  const media = createMediaLibrary();
  const alice = principal("alice");
  const kinds = ["video", "canonical_packet", "keypoints", "nutrition_photo"] as const;

  for (const [index, kind] of kinds.entries()) {
    const created = await media.createUpload(alice, {
      kind,
      fileName: `${kind}.bin`,
      contentType: "application/octet-stream",
      byteSize: index,
      sha256: String(index).repeat(64),
      idempotencyKey: `kind-${kind}`,
    });
    assert.equal(created.asset.kind, kind);
    assert.equal(created.asset.purpose, "personal");
  }
  const firstPage = await media.listAssets(alice, { limit: 2 });
  assert.equal(firstPage.data.length, 2);
  assert.equal(typeof firstPage.nextCursor, "string");
  const secondPage = await media.listAssets(alice, {
    limit: 2,
    cursor: firstPage.nextCursor ?? undefined,
  });
  assert.equal(secondPage.data.length, 2);
  assert.equal(secondPage.nextCursor, null);
  assert.equal((await media.listAssets(principal("bob"))).data.length, 0);
});

async function createReadyAsset(
  media: MediaLibraryModule,
  owner: Principal,
  input: CreateMediaUploadInput,
) {
  const created = await media.createUpload(owner, input);
  return media.completeUpload(owner, {
    uploadId: created.upload.id,
    expectedRevision: created.upload.revision,
    idempotencyKey: `complete-${input.idempotencyKey}`,
  });
}

function createMediaLibrary(evidenceLifecycle?: ProductDataModule): MediaLibraryModule {
  return new MediaLibraryModule({
    adapter: new InMemoryMediaLibraryAdapter(),
    clock: new StepClock(),
    ids: sequentialIds(),
    ...(evidenceLifecycle === undefined ? {} : { evidenceLifecycle }),
  });
}

function principal(accountId: string): Principal {
  return {
    accountId,
    sessionId: `session-${accountId}`,
    status: "active",
    scopes: new Set(),
  };
}

class StepClock implements Clock {
  #step = 0;

  now(): Date {
    this.#step += 1;
    return new Date(Date.UTC(2026, 0, 2, 0, 0, this.#step));
  }
}

class MutableClock implements Clock {
  #nowMs: number;

  constructor(now: string) {
    this.#nowMs = Date.parse(now);
  }

  now(): Date {
    return new Date(this.#nowMs);
  }

  advanceSeconds(seconds: number): void {
    this.#nowMs += seconds * 1_000;
  }
}

function sequentialIds(): IdFactory {
  let sequence = 0;
  return (prefix) => `${prefix}_${++sequence}`;
}

async function assertApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}
