import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  type DeleteObjectsCommandOutput,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type ListObjectVersionsCommandOutput,
  type PutObjectCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Pool } from "pg";

import {
  S3MediaLibraryAdapter,
  type ObjectPresigner,
} from "../src/adapters/object-storage/s3-media-library.js";
import type { PostgresPool } from "../src/adapters/postgres/client.js";
import { createPostgresProductData } from "../src/adapters/postgres/product-data.js";
import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import type { IdFactory } from "../src/kernel/ids.js";
import type { Principal } from "../src/kernel/principal.js";

const databaseUrl = process.env.MAXPOWER_TEST_POSTGRES_URL;

test("single-PUT media rejects payloads above the S3 five-GiB boundary", async () => {
  const media = new S3MediaLibraryAdapter({
    pool: {
      async connect() {
        throw new Error("validation must happen before PostgreSQL access");
      },
    },
    client: {} as S3Client,
    bucket: "maxpower-private-test",
  });
  await assertApiError(
    Promise.resolve().then(() => media.createUpload(principal("alice"), {
      kind: "video",
      fileName: "too-large.mp4",
      contentType: "video/mp4",
      byteSize: 5 * 1024 * 1024 * 1024 + 1,
      sha256: "a".repeat(64),
      idempotencyKey: "too-large",
    })),
    400,
    "media_too_large",
  );
});

test(
  "S3 media targets are private, verified, owner-only, and recursively deleted",
  { skip: databaseUrl === undefined },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await resetDatabase(pool);
      await applyMigrations(pool);
      await seedAccount(pool, "alice");
      await seedAccount(pool, "bob");
      const objects = new FakeObjectStore();
      const ids = sequentialIds();
      const clock = new MutableClock();
      const waits: string[] = [];
      const media = createMedia(pool, objects, ids, clock, waits);
      const alice = principal("alice");
      const bob = principal("bob");

      const videoRequest = {
        kind: "video",
        fileName: "squat.mp4",
        contentType: "video/mp4",
        byteSize: 1_024,
        sha256: "a".repeat(64),
        idempotencyKey: "video-create",
      } as const;
      const video = await media.createUpload(alice, videoRequest);
      assert.equal(video.upload.byteTransfer, "presigned_put");
      assert.equal(video.uploadTarget.kind, "presigned_put");
      assert.match(video.uploadTarget.url, /^https:\/\/private\.example\/put\//);
      assert.equal(video.uploadTarget.headers["content-type"], "video/mp4");
      assert.equal(video.uploadTarget.headers["x-amz-checksum-sha256"], hexToBase64("a".repeat(64)));
      assert.equal(video.upload.expiresAt, video.uploadTarget.expiresAt);

      const persistedCreate = await pool.query<{ result_jsonb: unknown }>(
        `SELECT result_jsonb FROM maxpower.media_idempotency
          WHERE account_id = $1 AND idempotency_key = $2`,
        [alice.accountId, videoRequest.idempotencyKey],
      );
      assert.doesNotMatch(JSON.stringify(persistedCreate.rows[0]?.result_jsonb), /private\.example|uploadTarget/);

      const restarted = createMedia(pool, objects, ids, clock, waits);
      const replayedVideo = await restarted.createUpload(alice, videoRequest);
      assert.deepEqual(replayedVideo.asset, video.asset);
      assert.deepEqual(replayedVideo.upload, video.upload);
      assert.notEqual(replayedVideo.uploadTarget.url, video.uploadTarget.url);
      await assertApiError(restarted.getAsset(bob, video.asset.id), 404, "not_found");

      objects.acceptUpload(video.uploadTarget.url, { checksumSha256: hexToBase64("f".repeat(64)) });
      await assertApiError(
        restarted.completeUpload(alice, {
          uploadId: video.upload.id,
          expectedRevision: 1,
          idempotencyKey: "video-complete-wrong",
        }),
        409,
        "object_metadata_mismatch",
      );
      assert.equal(objects.versionCountForTarget(video.uploadTarget.url), 0);

      objects.acceptUpload(video.uploadTarget.url);
      const readyVideo = await restarted.completeUpload(alice, {
        uploadId: video.upload.id,
        expectedRevision: 1,
        idempotencyKey: "video-complete",
      });
      assert.equal(readyVideo.asset.status, "ready");
      assert.equal(readyVideo.asset.verification, "object_metadata_verified");

      const download = await restarted.createDownload(alice, { assetId: video.asset.id });
      assert.equal(download.kind, "presigned_get");
      assert.match(download.url, /^https:\/\/private\.example\/get\//);
      await assertApiError(
        restarted.createDownload(bob, { assetId: video.asset.id }),
        404,
        "not_found",
      );

      const packet = await restarted.createUpload(alice, {
        kind: "canonical_packet",
        fileName: "squat.packet.json",
        contentType: "application/json",
        byteSize: 256,
        sha256: "b".repeat(64),
        parentAssetId: video.asset.id,
        idempotencyKey: "packet-create",
      });
      clock.advanceSeconds(61);
      objects.acceptUpload(packet.uploadTarget.url);
      await assertApiError(restarted.completeUpload(alice, {
        uploadId: packet.upload.id,
        expectedRevision: 1,
        idempotencyKey: "packet-expired",
      }), 410, "upload_expired");
      assert.equal(objects.versionCountForTarget(packet.uploadTarget.url), 0);

      await pool.query(`UPDATE "user" SET "accountStatus" = 'pending_deletion' WHERE id = 'alice'`);
      await assertApiError(restarted.createUpload(alice, {
        kind: "canonical_packet",
        fileName: "squat.packet.json",
        contentType: "application/json",
        byteSize: 256,
        sha256: "b".repeat(64),
        parentAssetId: video.asset.id,
        idempotencyKey: "packet-create",
      }), 403, "account_not_writable");
      await pool.query(`UPDATE "user" SET "accountStatus" = 'active' WHERE id = 'alice'`);

      const reissuedPacket = await restarted.createUpload(alice, {
        kind: "canonical_packet",
        fileName: "squat.packet.json",
        contentType: "application/json",
        byteSize: 256,
        sha256: "b".repeat(64),
        parentAssetId: video.asset.id,
        idempotencyKey: "packet-create",
      });
      assert.equal(reissuedPacket.asset.id, packet.asset.id);
      assert.equal(reissuedPacket.upload.id, packet.upload.id);
      assert.equal(reissuedPacket.upload.revision, 2);
      assert.notEqual(reissuedPacket.uploadTarget.url, packet.uploadTarget.url);
      assert.ok(Date.parse(reissuedPacket.upload.expiresAt) > Date.parse(packet.upload.expiresAt));

      objects.acceptUpload(reissuedPacket.uploadTarget.url);
      const readyPacket = await restarted.completeUpload(alice, {
        uploadId: reissuedPacket.upload.id,
        expectedRevision: reissuedPacket.upload.revision,
        idempotencyKey: "packet-complete",
      });

      const productData = createPostgresProductData({ pool, clock, ids });
      const workout = await productData.createWorkoutSession(alice, {
        title: "Squat evidence",
        data: { sets: 3 },
        mediaAssetIds: [readyVideo.asset.id],
        idempotencyKey: "workout-with-video",
      });
      const result = await productData.createResult(alice, {
        kind: "motion_analysis",
        payload: { score: 0.9 },
        provenance: { source: "canonical_packet" },
        mediaAssetIds: [readyPacket.asset.id],
        idempotencyKey: "result-with-packet",
      });

      // A still-live PUT can be replayed, and versioned buckets can also contain
      // delete markers. HTTP deletion hides metadata immediately and queues the
      // byte cleanup until every upload capability has expired.
      objects.acceptUpload(reissuedPacket.uploadTarget.url);
      objects.acceptUpload(reissuedPacket.uploadTarget.url);
      objects.addDeleteMarkerForTarget(reissuedPacket.uploadTarget.url);
      assert.ok(objects.versionCountForTarget(reissuedPacket.uploadTarget.url) >= 4);

      const deleted = await restarted.deleteAsset(alice, {
        assetId: readyVideo.asset.id,
        expectedRevision: readyVideo.asset.revision,
        idempotencyKey: "delete-video-tree",
      });
      assert.deepEqual(deleted.deletedAssetIds, [readyVideo.asset.id, readyPacket.asset.id]);
      assert.deepEqual(waits, []);
      assert.ok(objects.remainingVersionCount > 0);
      assert.deepEqual((await restarted.listAssets(alice)).data, []);
      await assertApiError(restarted.getAsset(alice, readyPacket.asset.id), 404, "not_found");
      assert.equal(
        (await productData.getWorkoutSession(alice, workout.id)).mediaReferences[0]?.evidenceStatus,
        "evidence_deleted",
      );
      assert.equal(
        (await productData.getResult(alice, result.id)).mediaReferences[0]?.evidenceStatus,
        "evidence_deleted",
      );
      assert.equal(await restarted.processNextDeletion(), undefined);
      clock.set(reissuedPacket.upload.expiresAt);
      const cleanup = await restarted.processNextDeletion();
      assert.equal(cleanup?.accountId, alice.accountId);
      assert.deepEqual(cleanup?.deletedAssetIds, [readyVideo.asset.id, readyPacket.asset.id]);
      assert.equal(objects.remainingVersionCount, 0);
    } finally {
      await pool.end();
    }
  },
);

function createMedia(
  pool: Pool,
  objects: FakeObjectStore,
  ids: IdFactory,
  clock: MutableClock,
  waits: string[],
): S3MediaLibraryAdapter {
  return new S3MediaLibraryAdapter({
    pool: pool as unknown as PostgresPool,
    client: objects as unknown as S3Client,
    presign: objects.presign,
    bucket: "maxpower-private-test",
    transferExpirySeconds: 60,
    waitUntil: async (timestamp) => {
      waits.push(timestamp);
      clock.set(timestamp);
    },
    clock,
    ids,
  });
}

interface StoredObject {
  key: string;
  contentLength: number;
  contentType: string;
  metadata: Record<string, string>;
  checksumSha256: string;
  versionId: string;
  deleteMarker: boolean;
}

class FakeObjectStore {
  readonly #pendingPuts = new Map<string, Omit<StoredObject, "versionId" | "deleteMarker">>();
  readonly #objects = new Map<string, StoredObject[]>();
  #presignSequence = 0;
  #versionSequence = 0;

  get remainingVersionCount(): number {
    return [...this.#objects.values()].reduce((sum, entries) => sum + entries.length, 0);
  }

  readonly presign: ObjectPresigner = async (_client, command) => {
    if (command instanceof PutObjectCommand) {
      const key = requiredString(command.input.Key);
      const target = `https://private.example/put/${++this.#presignSequence}/${encodeURIComponent(key)}`;
      this.#pendingPuts.set(target, {
        key,
        contentLength: command.input.ContentLength ?? 0,
        contentType: command.input.ContentType ?? "application/octet-stream",
        metadata: { ...(command.input.Metadata ?? {}) },
        checksumSha256: requiredString(command.input.ChecksumSHA256),
      });
      return target;
    }
    if (command instanceof GetObjectCommand) {
      return `https://private.example/get/${encodeURIComponent(requiredString(command.input.Key))}`;
    }
    throw new Error("unsupported presign command");
  };

  acceptUpload(
    url: string,
    override: { byteSize?: number; checksumSha256?: string } = {},
  ): void {
    const pending = this.#pendingPuts.get(url);
    assert.ok(pending, "presigned upload target must exist");
    this.#append(pending.key, {
      ...pending,
      contentLength: override.byteSize ?? pending.contentLength,
      checksumSha256: override.checksumSha256 ?? pending.checksumSha256,
      versionId: `version-${++this.#versionSequence}`,
      deleteMarker: false,
    });
  }

  addDeleteMarkerForTarget(url: string): void {
    const pending = this.#pendingPuts.get(url);
    assert.ok(pending, "presigned upload target must exist");
    this.#append(pending.key, {
      ...pending,
      versionId: `marker-${++this.#versionSequence}`,
      deleteMarker: true,
    });
  }

  versionCountForTarget(url: string): number {
    const pending = this.#pendingPuts.get(url);
    assert.ok(pending, "presigned upload target must exist");
    return this.#objects.get(pending.key)?.length ?? 0;
  }

  async send(
    command:
      | PutObjectCommand
      | GetObjectCommand
      | HeadObjectCommand
      | ListObjectVersionsCommand
      | DeleteObjectsCommand,
  ): Promise<
    | PutObjectCommandOutput
    | GetObjectCommandOutput
    | HeadObjectCommandOutput
    | ListObjectVersionsCommandOutput
    | DeleteObjectsCommandOutput
  > {
    if (command instanceof HeadObjectCommand) {
      const entries = this.#objects.get(requiredString(command.input.Key)) ?? [];
      const stored = entries.findLast((entry) => !entry.deleteMarker);
      if (stored === undefined || entries.at(-1)?.deleteMarker === true) {
        const error = new Error("not found") as Error & { name: string };
        error.name = "NotFound";
        throw error;
      }
      return {
        ContentLength: stored.contentLength,
        ContentType: stored.contentType,
        Metadata: stored.metadata,
        ChecksumSHA256: stored.checksumSha256,
        VersionId: stored.versionId,
        ETag: `\"etag-${stored.key}\"`,
        $metadata: {},
      };
    }
    if (command instanceof ListObjectVersionsCommand) {
      const versions: NonNullable<ListObjectVersionsCommandOutput["Versions"]> = [];
      const deleteMarkers: NonNullable<ListObjectVersionsCommandOutput["DeleteMarkers"]> = [];
      for (const [key, entries] of this.#objects) {
        if (!key.startsWith(command.input.Prefix ?? "")) continue;
        for (const entry of entries) {
          (entry.deleteMarker ? deleteMarkers : versions).push({
            Key: key,
            VersionId: entry.versionId,
          });
        }
      }
      return { Versions: versions, DeleteMarkers: deleteMarkers, IsTruncated: false, $metadata: {} };
    }
    if (command instanceof DeleteObjectsCommand) {
      for (const object of command.input.Delete?.Objects ?? []) {
        const key = requiredString(object.Key);
        const versionId = object.VersionId;
        if (versionId === undefined) {
          this.#objects.delete(key);
          continue;
        }
        const remaining = (this.#objects.get(key) ?? [])
          .filter((entry) => entry.versionId !== versionId);
        if (remaining.length === 0) this.#objects.delete(key);
        else this.#objects.set(key, remaining);
      }
      return { Deleted: command.input.Delete?.Objects, Errors: [], $metadata: {} };
    }
    throw new Error("Only HEAD and DELETE are sent directly by the adapter.");
  }

  #append(key: string, object: StoredObject): void {
    this.#objects.set(key, [...(this.#objects.get(key) ?? []), object]);
  }
}

function requiredString(value: string | undefined): string {
  assert.ok(value);
  return value;
}

function principal(accountId: string): Principal {
  return {
    accountId,
    sessionId: `session-${accountId}`,
    status: "active",
    scopes: new Set(),
  };
}

class MutableClock implements Clock {
  #current = Date.UTC(2026, 4, 2, 0, 0, 0);

  now(): Date {
    return new Date(this.#current);
  }

  advanceSeconds(seconds: number): void {
    this.#current += seconds * 1_000;
  }

  set(timestamp: string): void {
    this.#current = Date.parse(timestamp);
  }
}

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS maxpower CASCADE");
  await pool.query(
    `DROP TABLE IF EXISTS "rateLimit", "jwks", "verification", "account", "session", "user" CASCADE`,
  );
}

async function applyMigrations(pool: Pool): Promise<void> {
  for (const migration of [
    "010-better-auth.sql",
    "020-product-data.sql",
    "030-media-library.sql",
  ]) {
    await pool.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
}

async function seedAccount(pool: Pool, accountId: string): Promise<void> {
  await pool.query(
    `INSERT INTO "user"
      (id, name, email, "emailVerified", "accountStatus", scopes, "registrationComplete")
     VALUES ($1, $1, $2, true, 'active', 'data:read data:write media:read media:write', true)`,
    [accountId, `${accountId}@example.test`],
  );
}

function hexToBase64(value: string): string {
  return Buffer.from(value, "hex").toString("base64");
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
