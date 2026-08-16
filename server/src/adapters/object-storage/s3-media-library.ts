import { createHash } from "node:crypto";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { PostgresClient, PostgresPool } from "../postgres/client.js";
import { ApiError, conflict, forbidden, notFound } from "../../kernel/api-error.js";
import type { Clock } from "../../kernel/clock.js";
import { SystemClock } from "../../kernel/clock.js";
import type { IdFactory } from "../../kernel/ids.js";
import { randomId } from "../../kernel/ids.js";
import type { Principal } from "../../kernel/principal.js";
import {
  encodeCursor,
  normalizeCursorPageInput,
  type CursorPage,
  type CursorPageInput,
} from "../../kernel/pagination.js";
import type {
  CompleteMediaUploadInput,
  CompleteMediaUploadResult,
  CreateMediaDownloadInput,
  CreateMediaUploadInput,
  CreateMediaUploadResult,
  DeleteMediaAssetInput,
  DeleteMediaAssetResult,
  MediaAsset,
  MediaLibrary,
  MediaTransferTarget,
  MediaUpload,
} from "../../modules/media/model.js";
import { MAX_SINGLE_PUT_BYTES } from "../../modules/media/model.js";

export type PresignableObjectCommand = PutObjectCommand | GetObjectCommand;
export type ObjectPresigner = (
  client: S3Client,
  command: PresignableObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export interface S3MediaLibraryDependencies {
  pool: PostgresPool;
  client: S3Client;
  bucket: string;
  presign?: ObjectPresigner;
  transferExpirySeconds?: number;
  waitUntil?: (timestamp: string) => Promise<void>;
  clock?: Clock;
  ids?: IdFactory;
}

export interface MediaDeletionJobResult {
  jobId: string;
  accountId: string;
  deletedAssetIds: readonly string[];
}

/**
 * Production MediaLibrary Adapter. PostgreSQL owns lifecycle metadata while a
 * private S3-compatible bucket owns bytes; raw object keys never cross the
 * public Interface.
 */
export class S3MediaLibraryAdapter implements MediaLibrary {
  readonly #pool: PostgresPool;
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #presign: ObjectPresigner;
  readonly #transferExpirySeconds: number;
  readonly #clock: Clock;
  readonly #ids: IdFactory;

  constructor(dependencies: S3MediaLibraryDependencies) {
    this.#pool = dependencies.pool;
    this.#client = dependencies.client;
    this.#bucket = requireText(dependencies.bucket, "bucket");
    this.#presign = dependencies.presign ?? defaultPresigner;
    this.#transferExpirySeconds = dependencies.transferExpirySeconds ?? 15 * 60;
    if (!Number.isSafeInteger(this.#transferExpirySeconds) || this.#transferExpirySeconds < 60) {
      throw new ApiError(500, "invalid_media_configuration", "Transfer expiry must be at least 60 seconds.");
    }
    this.#clock = dependencies.clock ?? new SystemClock();
    this.#ids = dependencies.ids ?? randomId;
  }

  createUpload(
    principal: Principal,
    input: CreateMediaUploadInput,
  ): Promise<CreateMediaUploadResult> {
    const fileName = requireText(input.fileName, "fileName");
    const contentType = requireText(input.contentType, "contentType");
    assertByteSize(input.byteSize);
    const sha256 = normalizeSha256(input.sha256);

    return this.#write(principal, "media_upload.create", input.idempotencyKey, input, async (client, now) => {
      if (input.parentAssetId !== undefined) {
        await requireAsset(client, principal.accountId, input.parentAssetId);
      }
      const assetId = this.#ids("media_asset");
      const uploadId = this.#ids("media_upload");
      const objectKey = privateObjectKey(principal.accountId, assetId, fileName);
      const expires = expiresAt(now, this.#transferExpirySeconds);
      const uploadTarget = await this.#presignUpload({
        assetId,
        objectKey,
        contentType,
        byteSize: input.byteSize,
        sha256,
        now,
        expiresAt: expires,
      });
      const asset: MediaAsset = {
        id: assetId,
        accountId: principal.accountId,
        kind: input.kind,
        fileName,
        contentType,
        byteSize: input.byteSize,
        sha256,
        status: "uploading",
        purpose: "personal",
        verification: "unverified_metadata",
        revision: 1,
        createdAt: now,
        readyAt: null,
      };
      const upload: MediaUpload = {
        id: uploadId,
        assetId,
        status: "pending",
        byteTransfer: "presigned_put",
        revision: 1,
        createdAt: now,
        expiresAt: expires,
        completedAt: null,
      };

      await client.query(
        `INSERT INTO maxpower.media_assets
          (account_id, id, kind, file_name, content_type, byte_size, sha256, object_key,
           status, purpose, verification, revision, created_at, ready_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploading', 'personal',
                 'unverified_metadata', 1, $9, NULL, NULL)`,
        [
          principal.accountId,
          assetId,
          input.kind,
          fileName,
          contentType,
          input.byteSize,
          sha256,
          objectKey,
          now,
        ],
      );
      await client.query(
        `INSERT INTO maxpower.media_uploads
          (account_id, id, asset_id, status, byte_transfer, revision, created_at,
           expires_at, completed_at, cancelled_at)
         VALUES ($1, $2, $3, 'pending', 'presigned_put', 1, $4, $5, NULL, NULL)`,
        [principal.accountId, uploadId, assetId, now, expires],
      );
      if (input.parentAssetId !== undefined) {
        await client.query(
          `INSERT INTO maxpower.media_asset_relations
            (account_id, parent_asset_id, child_asset_id, relation_type, created_at)
           VALUES ($1, $2, $3, 'derived_from', $4)`,
          [principal.accountId, input.parentAssetId, assetId, now],
        );
      }
      return { asset, upload, uploadTarget };
    }, async (client, prior, now) => {
      const previous = structuredClone(prior) as Omit<CreateMediaUploadResult, "uploadTarget">;
      const row = await findUploadWithAsset(client, principal.accountId, previous.upload.id);
      if (row === undefined) throw notFound("media_upload");
      if (row.upload_status !== "pending") {
        throw conflict("upload_not_pending", "The media upload is not pending.");
      }
      const expired = Date.parse(now) >= Date.parse(iso(row.expires_at));
      const nextExpiry = expired
        ? expiresAt(now, this.#transferExpirySeconds)
        : iso(row.expires_at);
      let upload = uploadFromRow(row);
      if (expired) {
        await client.query(
          `UPDATE maxpower.media_uploads
              SET expires_at = $3, revision = revision + 1
            WHERE account_id = $1 AND id = $2 AND status = 'pending'`,
          [principal.accountId, row.upload_id, nextExpiry],
        );
        upload = {
          ...upload,
          revision: row.upload_revision + 1,
          expiresAt: nextExpiry,
        };
      }
      const uploadTarget = await this.#presignUpload({
        assetId: row.asset_id,
        objectKey: row.object_key,
        contentType: row.content_type,
        byteSize: toSafeNumber(row.byte_size),
        sha256: row.sha256,
        now,
        expiresAt: nextExpiry,
      });
      return {
        ...previous,
        upload,
        uploadTarget,
      };
    }, stableCreateUploadResult);
  }

  completeUpload(
    principal: Principal,
    input: CompleteMediaUploadInput,
  ): Promise<CompleteMediaUploadResult> {
    assertRevisionNumber(input.expectedRevision);
    return this.#write(
      principal,
      "media_upload.complete",
      input.idempotencyKey,
      input,
      async (client, now) => {
        const row = await requireUploadWithAsset(client, principal.accountId, input.uploadId);
        assertRevision(row.upload_revision, input.expectedRevision, uploadFromRow(row));
        if (row.upload_status !== "pending") {
          throw conflict("upload_not_pending", "The media upload is not pending.");
        }
        if (Date.parse(now) >= Date.parse(iso(row.expires_at))) {
          await this.#deleteObjectVersions(row.object_key);
          throw new ApiError(410, "upload_expired", "The media upload target has expired.");
        }

        const head = await this.#headObject(row.object_key);
        const mismatches: string[] = [];
        if (head.ContentLength !== toSafeNumber(row.byte_size)) mismatches.push("byteSize");
        if (head.ContentType !== row.content_type) mismatches.push("contentType");
        if (head.Metadata?.sha256?.toLowerCase() !== row.sha256) mismatches.push("sha256");
        if (head.Metadata?.["asset-id"] !== row.asset_id) mismatches.push("assetId");
        if (head.ChecksumSHA256 !== hexSha256ToBase64(row.sha256)) mismatches.push("checksum");
        if (mismatches.length > 0) {
          await this.#deleteObjectVersions(row.object_key);
          throw conflict(
            "object_metadata_mismatch",
            "The uploaded object metadata does not match the declaration.",
            { fields: mismatches },
          );
        }

        await client.query(
          `UPDATE maxpower.media_uploads
              SET status = 'completed', completed_at = $3, revision = revision + 1
            WHERE account_id = $1 AND id = $2`,
          [principal.accountId, input.uploadId, now],
        );
        await client.query(
          `UPDATE maxpower.media_assets
              SET status = 'ready', verification = 'object_metadata_verified',
                  object_etag = $3, object_version_id = $4,
                  ready_at = $5, revision = revision + 1
            WHERE account_id = $1 AND id = $2`,
          [principal.accountId, row.asset_id, head.ETag ?? null, head.VersionId ?? null, now],
        );
        return {
          asset: {
            ...assetFromJoinedRow(row),
            status: "ready",
            verification: "object_metadata_verified",
            revision: row.asset_revision + 1,
            readyAt: now,
          },
          upload: {
            ...uploadFromRow(row),
            status: "completed",
            revision: row.upload_revision + 1,
            completedAt: now,
          },
        };
      },
    );
  }

  async listAssets(
    principal: Principal,
    input: CursorPageInput = {},
  ): Promise<CursorPage<MediaAsset>> {
    return this.#read(async (client) => {
      const { limit, position } = normalizeCursorPageInput(input);
      const params: unknown[] = position === null
        ? [principal.accountId, limit + 1]
        : [principal.accountId, position.createdAt, position.id, limit + 1];
      const result = await client.query<AssetRow>(
        `SELECT * FROM maxpower.media_assets
          WHERE account_id = $1 AND deleted_at IS NULL
            ${position === null ? "" : "AND (created_at, id) < ($2::timestamptz, $3::text)"}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length}`,
        params,
      );
      const data = result.rows.slice(0, limit).map(assetFromRow);
      const last = data.at(-1);
      return {
        data,
        nextCursor: result.rows.length > limit && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      };
    });
  }

  async getAsset(principal: Principal, assetId: string): Promise<MediaAsset> {
    return this.#read(async (client) =>
      assetFromRow(await requireAsset(client, principal.accountId, assetId)),
    );
  }

  async createDownload(
    principal: Principal,
    input: CreateMediaDownloadInput,
  ): Promise<MediaTransferTarget> {
    const row = await this.#read((client) =>
      requireAsset(client, principal.accountId, input.assetId),
    );
    if (row.status !== "ready") {
      throw conflict("asset_not_ready", "The media asset is not ready for download.");
    }
    const now = this.#clock.now().toISOString();
    const url = await this.#presign(
      this.#client,
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: row.object_key,
        ResponseContentType: row.content_type,
      }),
      { expiresIn: this.#transferExpirySeconds },
    );
    return {
      kind: "presigned_get",
      url,
      headers: {},
      expiresAt: expiresAt(now, this.#transferExpirySeconds),
    };
  }

  deleteAsset(
    principal: Principal,
    input: DeleteMediaAssetInput,
  ): Promise<DeleteMediaAssetResult> {
    assertRevisionNumber(input.expectedRevision);
    return this.#write(
      principal,
      "media_asset.delete",
      input.idempotencyKey,
      input,
      async (client, now) => {
        const root = await requireAsset(client, principal.accountId, input.assetId);
        assertRevision(root.revision, input.expectedRevision, assetFromRow(root));
        const treeResult = await client.query<AssetTreeRow>(
          `WITH RECURSIVE asset_tree AS (
             SELECT $2::text AS id, 0 AS depth
             UNION ALL
             SELECT relation.child_asset_id, asset_tree.depth + 1
               FROM maxpower.media_asset_relations relation
               JOIN asset_tree ON asset_tree.id = relation.parent_asset_id
              WHERE relation.account_id = $1
           )
           SELECT asset.*, asset_tree.depth
             FROM asset_tree
             JOIN maxpower.media_assets asset
               ON asset.account_id = $1 AND asset.id = asset_tree.id
            WHERE asset.deleted_at IS NULL
            ORDER BY asset_tree.depth, asset.id`,
          [principal.accountId, input.assetId],
        );
        const assets = treeResult.rows;
        const ids = assets.map((asset) => asset.id);
        const expiry = await client.query<{ expires_at: Date | string | null }>(
          `SELECT max(expires_at) AS expires_at
             FROM maxpower.media_uploads
            WHERE account_id = $1 AND asset_id = ANY($2::text[])`,
          [principal.accountId, ids],
        );
        const expires = expiry.rows[0]?.expires_at;
        const notBefore = expires !== null && expires !== undefined && Date.parse(iso(expires)) > Date.parse(now)
          ? iso(expires)
          : now;
        const jobId = this.#ids("media_delete");
        await client.query(
          `INSERT INTO maxpower.media_deletion_jobs
            (id, account_id, root_asset_id, deleted_asset_ids, object_keys, not_before,
             status, attempts, lease_until, last_error_code, created_at, updated_at, completed_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, 'queued', 0, NULL, NULL, $7, $7, NULL)`,
          [
            jobId,
            principal.accountId,
            input.assetId,
            JSON.stringify(ids),
            JSON.stringify(assets.map((asset) => asset.object_key)),
            notBefore,
            now,
          ],
        );
        await client.query(
          `UPDATE maxpower.media_assets
              SET deleted_at = $3, revision = revision + 1
            WHERE account_id = $1 AND id = ANY($2::text[])`,
          [principal.accountId, ids, now],
        );
        await markEvidenceDeleted(client, principal.accountId, ids, now);
        await client.query(
          `UPDATE maxpower.media_uploads
              SET status = 'cancelled', cancelled_at = $3, revision = revision + 1
            WHERE account_id = $1 AND asset_id = ANY($2::text[]) AND status = 'pending'`,
          [principal.accountId, ids, now],
        );
        await client.query(
          `DELETE FROM maxpower.media_asset_relations
            WHERE account_id = $1
              AND (parent_asset_id = ANY($2::text[]) OR child_asset_id = ANY($2::text[]))`,
          [principal.accountId, ids],
        );
        return { deletedAssetIds: ids };
      },
    );
  }

  /** Claims and completes one durable byte-deletion job. Safe across worker restarts. */
  async processNextDeletion(): Promise<MediaDeletionJobResult | undefined> {
    const claimedAt = this.#clock.now().toISOString();
    const job = await this.#claimDeletionJob(claimedAt);
    if (!job) return undefined;
    try {
      for (const objectKey of job.object_keys) await this.#deleteObjectVersions(objectKey);
      await this.#read((client) => client.query(
        `UPDATE maxpower.media_deletion_jobs
            SET status = 'completed', lease_until = NULL, last_error_code = NULL,
                completed_at = $2, updated_at = $2
          WHERE id = $1 AND status = 'running'`,
        [job.id, this.#clock.now().toISOString()],
      ));
      return {
        jobId: job.id,
        accountId: job.account_id,
        deletedAssetIds: job.deleted_asset_ids,
      };
    } catch (error) {
      const failedAt = this.#clock.now().toISOString();
      const retryAt = new Date(Date.parse(failedAt) + deletionRetrySeconds(job.attempts) * 1_000).toISOString();
      await this.#read((client) => client.query(
        `UPDATE maxpower.media_deletion_jobs
            SET status = 'retryable', not_before = $2, lease_until = NULL,
                last_error_code = $3, updated_at = $4
          WHERE id = $1 AND status = 'running'`,
        [job.id, retryAt, mediaDeletionErrorCode(error), failedAt],
      ));
      throw error;
    }
  }

  async #claimDeletionJob(now: string): Promise<MediaDeletionJobRow | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<MediaDeletionJobRow>(
        `WITH candidate AS (
           SELECT id
             FROM maxpower.media_deletion_jobs
            WHERE not_before <= $1
              AND (
                status IN ('queued', 'retryable')
                OR (status = 'running' AND lease_until <= $1)
              )
            ORDER BY not_before, created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE maxpower.media_deletion_jobs job
            SET status = 'running', attempts = attempts + 1,
                lease_until = $1::timestamptz + interval '5 minutes', updated_at = $1
           FROM candidate
          WHERE job.id = candidate.id
         RETURNING job.id, job.account_id, job.deleted_asset_ids,
                   job.object_keys, job.attempts`,
        [now],
      );
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the first error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async #headObject(objectKey: string) {
    try {
      return await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: objectKey, ChecksumMode: "ENABLED" }),
      );
    } catch (error) {
      if (isObjectNotFound(error)) {
        throw conflict("uploaded_object_not_found", "The uploaded object was not found.");
      }
      throw error;
    }
  }

  async #presignUpload(input: {
    assetId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    now: string;
    expiresAt: string;
  }): Promise<MediaTransferTarget> {
    const checksum = hexSha256ToBase64(input.sha256);
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.byteSize,
      ChecksumSHA256: checksum,
      Metadata: { sha256: input.sha256, "asset-id": input.assetId },
    });
    const remainingSeconds = Math.floor(
      (Date.parse(input.expiresAt) - Date.parse(input.now)) / 1_000,
    );
    if (remainingSeconds < 1) {
      throw new ApiError(410, "upload_expired", "The media upload target has expired.");
    }
    const url = await this.#presign(this.#client, command, {
      expiresIn: Math.min(this.#transferExpirySeconds, remainingSeconds),
    });
    return {
      kind: "presigned_put",
      url,
      headers: {
        "content-type": input.contentType,
        "content-length": String(input.byteSize),
        "x-amz-checksum-sha256": checksum,
        "x-amz-meta-sha256": input.sha256,
        "x-amz-meta-asset-id": input.assetId,
      },
      expiresAt: input.expiresAt,
    };
  }

  async #deleteObjectVersions(objectKey: string): Promise<void> {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const page = await this.#client.send(new ListObjectVersionsCommand({
        Bucket: this.#bucket,
        Prefix: objectKey,
        ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
        ...(versionIdMarker === undefined ? {} : { VersionIdMarker: versionIdMarker }),
      }));
      const objects = [
        ...(page.Versions ?? []),
        ...(page.DeleteMarkers ?? []),
      ].flatMap((item) => item.Key !== objectKey
        ? []
        : [{
            Key: objectKey,
            ...(item.VersionId === undefined || item.VersionId === "null"
              ? {}
              : { VersionId: item.VersionId }),
          }]);
      for (let offset = 0; offset < objects.length; offset += 1_000) {
        const deletion = await this.#client.send(new DeleteObjectsCommand({
          Bucket: this.#bucket,
          Delete: { Quiet: false, Objects: objects.slice(offset, offset + 1_000) },
        }));
        if ((deletion.Errors?.length ?? 0) > 0) {
          throw new ApiError(502, "object_delete_failed", "One or more media objects could not be deleted.", {
            count: deletion.Errors?.length ?? 0,
            codes: [...new Set(deletion.Errors?.map((error) => error.Code ?? "unknown") ?? [])],
          });
        }
      }
      if (page.IsTruncated === true) {
        if (page.NextKeyMarker === undefined) {
          throw new ApiError(502, "object_delete_failed", "Object storage returned an invalid cursor.");
        }
        keyMarker = page.NextKeyMarker;
        versionIdMarker = page.NextVersionIdMarker;
      } else {
        keyMarker = undefined;
        versionIdMarker = undefined;
      }
    } while (keyMarker !== undefined);
  }

  async #read<T>(query: (client: PostgresClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      return await query(client);
    } finally {
      client.release();
    }
  }

  async #write<T>(
    principal: Principal,
    operation: string,
    idempotencyKey: string,
    request: unknown,
    mutation: (client: PostgresClient, now: string) => Promise<T>,
    replay?: (client: PostgresClient, prior: unknown, now: string) => Promise<T>,
    persistedResult?: (result: T) => unknown,
  ): Promise<T> {
    assertWritable(principal);
    const key = requireText(idempotencyKey, "idempotencyKey");
    const fingerprint = stableStringify(request);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 11))",
        [principal.accountId],
      );
      await requireActiveAccountForMediaWrite(client, principal.accountId);
      const prior = await client.query<IdempotencyRow>(
        `SELECT operation, fingerprint, result_jsonb
           FROM maxpower.media_idempotency
          WHERE account_id = $1 AND idempotency_key = $2`,
        [principal.accountId, key],
      );
      const existing = prior.rows[0];
      const now = this.#clock.now().toISOString();
      if (existing !== undefined) {
        if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
          throw conflict(
            "idempotency_key_reused",
            "The idempotency key was already used for a different request.",
          );
        }
        if (replay === undefined) {
          await client.query("COMMIT");
          return structuredClone(existing.result_jsonb) as T;
        }
        const result = await replay(client, existing.result_jsonb, now);
        const stored = persistedResult?.(result) ?? result;
        await client.query(
          `UPDATE maxpower.media_idempotency SET result_jsonb = $3
            WHERE account_id = $1 AND idempotency_key = $2`,
          [principal.accountId, key, stored],
        );
        await client.query("COMMIT");
        return structuredClone(result);
      }

      const result = await mutation(client, now);
      const stored = persistedResult?.(result) ?? result;
      await client.query(
        `INSERT INTO maxpower.media_idempotency
          (account_id, idempotency_key, operation, fingerprint, result_jsonb)
         VALUES ($1, $2, $3, $4, $5)`,
        [principal.accountId, key, operation, fingerprint, stored],
      );
      await client.query("COMMIT");
      return structuredClone(result);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the first error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

interface AssetRow {
  account_id: string;
  id: string;
  kind: MediaAsset["kind"];
  file_name: string;
  content_type: string;
  byte_size: number | string;
  sha256: string;
  object_key: string;
  object_version_id: string | null;
  status: MediaAsset["status"];
  purpose: "personal";
  verification: MediaAsset["verification"];
  revision: number;
  created_at: Date | string;
  ready_at: Date | string | null;
  deleted_at: Date | string | null;
}

function stableCreateUploadResult(
  result: CreateMediaUploadResult,
): Omit<CreateMediaUploadResult, "uploadTarget"> {
  return {
    asset: result.asset,
    upload: result.upload,
  };
}

interface AssetTreeRow extends AssetRow {
  depth: number;
}

interface UploadWithAssetRow {
  upload_id: string;
  upload_status: MediaUpload["status"];
  byte_transfer: "presigned_put";
  upload_revision: number;
  upload_created_at: Date | string;
  expires_at: Date | string;
  completed_at: Date | string | null;
  asset_id: string;
  account_id: string;
  kind: MediaAsset["kind"];
  file_name: string;
  content_type: string;
  byte_size: number | string;
  sha256: string;
  object_key: string;
  asset_status: MediaAsset["status"];
  purpose: "personal";
  verification: MediaAsset["verification"];
  asset_revision: number;
  asset_created_at: Date | string;
  ready_at: Date | string | null;
}

interface IdempotencyRow {
  operation: string;
  fingerprint: string;
  result_jsonb: unknown;
}

interface MediaDeletionJobRow {
  id: string;
  account_id: string;
  deleted_asset_ids: string[];
  object_keys: string[];
  attempts: number;
}

async function requireAsset(
  client: PostgresClient,
  accountId: string,
  assetId: string,
): Promise<AssetRow> {
  const result = await client.query<AssetRow>(
    `SELECT * FROM maxpower.media_assets
      WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [accountId, assetId],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound("media_asset");
  return row;
}

async function requireUploadWithAsset(
  client: PostgresClient,
  accountId: string,
  uploadId: string,
): Promise<UploadWithAssetRow> {
  const row = await findUploadWithAsset(client, accountId, uploadId);
  if (row === undefined) throw notFound("media_upload");
  return row;
}

async function findUploadWithAsset(
  client: PostgresClient,
  accountId: string,
  uploadId: string,
): Promise<UploadWithAssetRow | undefined> {
  const result = await client.query<UploadWithAssetRow>(
    `SELECT upload.id AS upload_id, upload.status AS upload_status,
            upload.byte_transfer, upload.revision AS upload_revision,
            upload.created_at AS upload_created_at, upload.expires_at, upload.completed_at,
            asset.id AS asset_id, asset.account_id, asset.kind, asset.file_name,
            asset.content_type, asset.byte_size, asset.sha256, asset.object_key,
            asset.status AS asset_status, asset.purpose, asset.verification,
            asset.revision AS asset_revision, asset.created_at AS asset_created_at,
            asset.ready_at
       FROM maxpower.media_uploads upload
       JOIN maxpower.media_assets asset
         ON asset.account_id = upload.account_id AND asset.id = upload.asset_id
      WHERE upload.account_id = $1 AND upload.id = $2 AND asset.deleted_at IS NULL`,
    [accountId, uploadId],
  );
  return result.rows[0];
}

function assetFromRow(row: AssetRow): MediaAsset {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: toSafeNumber(row.byte_size),
    sha256: row.sha256,
    status: row.status,
    purpose: row.purpose,
    verification: row.verification,
    revision: row.revision,
    createdAt: iso(row.created_at),
    readyAt: nullableIso(row.ready_at),
  };
}

function assetFromJoinedRow(row: UploadWithAssetRow): MediaAsset {
  return {
    id: row.asset_id,
    accountId: row.account_id,
    kind: row.kind,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: toSafeNumber(row.byte_size),
    sha256: row.sha256,
    status: row.asset_status,
    purpose: row.purpose,
    verification: row.verification,
    revision: row.asset_revision,
    createdAt: iso(row.asset_created_at),
    readyAt: nullableIso(row.ready_at),
  };
}

function uploadFromRow(row: UploadWithAssetRow): MediaUpload {
  return {
    id: row.upload_id,
    assetId: row.asset_id,
    status: row.upload_status,
    byteTransfer: row.byte_transfer,
    revision: row.upload_revision,
    createdAt: iso(row.upload_created_at),
    expiresAt: iso(row.expires_at),
    completedAt: nullableIso(row.completed_at),
  };
}

async function requireActiveAccountForMediaWrite(
  client: PostgresClient,
  accountId: string,
): Promise<void> {
  const result = await client.query<{ account_status: string }>(
    `SELECT "accountStatus" AS account_status
       FROM "user"
      WHERE id = $1
      FOR SHARE`,
    [accountId],
  );
  if (result.rows[0]?.account_status !== "active") {
    throw forbidden("account_not_writable", "The account cannot accept writes.");
  }
}

async function markEvidenceDeleted(
  client: PostgresClient,
  accountId: string,
  assetIds: readonly string[],
  deletedAt: string,
): Promise<void> {
  await client.query(
    `WITH changed AS (
       UPDATE maxpower.workout_session_media_references
          SET evidence_status = 'evidence_deleted', evidence_deleted_at = $3
        WHERE account_id = $1 AND asset_id = ANY($2::text[])
          AND evidence_status = 'available'
        RETURNING workout_session_id
     )
     UPDATE maxpower.workout_sessions session
        SET revision = revision + 1, updated_at = $3
      WHERE session.account_id = $1
        AND session.id IN (SELECT workout_session_id FROM changed)`,
    [accountId, assetIds, deletedAt],
  );
  await client.query(
    `WITH changed AS (
       UPDATE maxpower.result_media_references
          SET evidence_status = 'evidence_deleted', evidence_deleted_at = $3
        WHERE account_id = $1 AND asset_id = ANY($2::text[])
          AND evidence_status = 'available'
        RETURNING result_id
     )
     UPDATE maxpower.results result
        SET revision = revision + 1, updated_at = $3
      WHERE result.account_id = $1
        AND result.id IN (SELECT result_id FROM changed)`,
    [accountId, assetIds, deletedAt],
  );
}

const defaultPresigner: ObjectPresigner = (client, command, options) =>
  getSignedUrl(client, command, options);

function hexSha256ToBase64(sha256: string): string {
  return Buffer.from(sha256, "hex").toString("base64");
}

function privateObjectKey(accountId: string, assetId: string, fileName: string): string {
  const accountHash = createHash("sha256").update(accountId).digest("hex").slice(0, 24);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "asset";
  return `accounts/${accountHash}/${encodeURIComponent(assetId)}/${safeName}`;
}

function isObjectNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NotFound"
    || candidate.name === "NoSuchKey"
    || candidate.$metadata?.httpStatusCode === 404;
}

function assertWritable(principal: Principal): void {
  if (principal.status !== "active") {
    throw forbidden("account_not_writable", "The account cannot accept writes.");
  }
}

function assertRevision(actual: number, expected: number, current: unknown): void {
  if (actual !== expected) {
    throw conflict("revision_conflict", "The resource was modified by another request.", {
      expectedRevision: expected,
      actualRevision: actual,
      current,
    });
  }
}

function assertRevisionNumber(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ApiError(400, "invalid_revision", "expectedRevision must be a positive integer.");
  }
}

function assertByteSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, "invalid_request", "byteSize must be a non-negative integer.", {
      field: "byteSize",
    });
  }
  if (value > MAX_SINGLE_PUT_BYTES) {
    throw new ApiError(400, "media_too_large", "byteSize exceeds the five-GiB single-upload limit.", {
      field: "byteSize",
      maxBytes: MAX_SINGLE_PUT_BYTES,
    });
  }
}

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ApiError(400, "invalid_request", "sha256 must contain 64 hexadecimal characters.", {
      field: "sha256",
    });
  }
  return normalized;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, "invalid_request", `${field} must not be empty.`, { field });
  }
  return normalized;
}

function toSafeNumber(value: string | number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ApiError(500, "invalid_media_metadata", "Stored byte size is invalid.");
  }
  return number;
}

function expiresAt(now: string, seconds: number): string {
  return new Date(Date.parse(now) + seconds * 1_000).toISOString();
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function deletionRetrySeconds(attempts: number): number {
  return Math.min(300, 2 ** Math.min(Math.max(attempts, 1), 8));
}

function mediaDeletionErrorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "object_delete_failed";
}
