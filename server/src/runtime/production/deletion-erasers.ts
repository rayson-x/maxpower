import { createHash } from "node:crypto";

import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type ListObjectVersionsCommandOutput,
} from "@aws-sdk/client-s3";

import type { PostgresPool } from "../../adapters/postgres/client.js";
import type {
  AccountMediaEraser,
  IdentityEraser,
} from "../../adapters/account-deletion/postgres-account-deletion.js";
import { ApiError } from "../../kernel/api-error.js";

export interface ObjectVersionDeletionClient {
  send(command: unknown): Promise<unknown>;
}

export interface S3AccountMediaEraserOptions {
  bucket: string;
  client: ObjectVersionDeletionClient;
  accountPrefix?: (accountId: string) => string;
  guard: PresignedUploadExpiryGuard;
}

export interface PresignedUploadExpiryGuard {
  assertSafeToErase(accountId: string): Promise<void>;
}

/** Erases current objects, historical versions, and delete markers for one account prefix. */
export class S3AccountMediaEraser implements AccountMediaEraser {
  readonly #bucket: string;
  readonly #client: ObjectVersionDeletionClient;
  readonly #accountPrefix: (accountId: string) => string;
  readonly #guard: PresignedUploadExpiryGuard;

  constructor(options: S3AccountMediaEraserOptions) {
    if (!options.bucket.trim()) throw new Error("Media deletion bucket is required.");
    this.#bucket = options.bucket;
    this.#client = options.client;
    this.#accountPrefix = options.accountPrefix ?? privateAccountPrefix;
    this.#guard = options.guard;
  }

  async eraseAccountMedia(accountId: string): Promise<void> {
    const normalizedAccountId = requireAccountId(accountId);
    await this.#guard.assertSafeToErase(normalizedAccountId);
    const prefix = this.#accountPrefix(normalizedAccountId);
    if (!prefix.startsWith("accounts/") || !prefix.endsWith("/")) {
      throw new Error("Media deletion requires a bounded account prefix.");
    }

    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const page = await this.#client.send(new ListObjectVersionsCommand({
        Bucket: this.#bucket,
        Prefix: prefix,
        ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
        ...(versionIdMarker === undefined ? {} : { VersionIdMarker: versionIdMarker }),
      })) as ListObjectVersionsCommandOutput;
      const objects = [
        ...(page.Versions ?? []),
        ...(page.DeleteMarkers ?? []),
      ].flatMap((item) => item.Key === undefined
        ? []
        : [{
            Key: item.Key,
            ...(item.VersionId === undefined || item.VersionId === "null"
              ? {}
              : { VersionId: item.VersionId }),
          }]);
      for (let offset = 0; offset < objects.length; offset += 1_000) {
        const batch = objects.slice(offset, offset + 1_000);
        const deleted = await this.#client.send(new DeleteObjectsCommand({
          Bucket: this.#bucket,
          Delete: { Objects: batch, Quiet: true },
        })) as { Errors?: readonly unknown[] };
        if ((deleted.Errors?.length ?? 0) > 0) {
          throw new Error("Object storage did not erase all account media.");
        }
      }

      if (page.IsTruncated === true) {
        if (page.NextKeyMarker === undefined) {
          throw new Error("Object storage returned an invalid deletion cursor.");
        }
        keyMarker = page.NextKeyMarker;
        versionIdMarker = page.NextVersionIdMarker;
      } else {
        keyMarker = undefined;
        versionIdMarker = undefined;
      }
    } while (keyMarker !== undefined);
  }
}

export interface PostgresPresignedUploadExpiryGuardOptions {
  pool: PostgresPool;
  transferExpirySeconds: number;
}

/** Prevents a pre-deletion presigned PUT from recreating bytes after the final S3 sweep. */
export class PostgresPresignedUploadExpiryGuard implements PresignedUploadExpiryGuard {
  readonly #pool: PostgresPool;
  readonly #transferExpirySeconds: number;

  constructor(options: PostgresPresignedUploadExpiryGuardOptions) {
    if (!Number.isSafeInteger(options.transferExpirySeconds) || options.transferExpirySeconds < 60) {
      throw new Error("Media transfer expiry must be at least 60 seconds.");
    }
    this.#pool = options.pool;
    this.#transferExpirySeconds = options.transferExpirySeconds;
  }

  async assertSafeToErase(accountId: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query<{ ready: boolean }>(
        `SELECT GREATEST(
                  deletion.requested_at + ($2::integer * interval '1 second'),
                  COALESCE(MAX(upload.expires_at), deletion.requested_at)
                ) <= now() AS ready
           FROM maxpower.account_deletion_jobs deletion
           LEFT JOIN maxpower.media_uploads upload
             ON upload.account_id = deletion.account_id
          WHERE deletion.account_id = $1
          GROUP BY deletion.requested_at`,
        [requireAccountId(accountId), this.#transferExpirySeconds],
      );
      if (result.rows[0]?.ready !== true) {
        throw new ApiError(
          409,
          "presigned_uploads_live",
          "Media cleanup is waiting for active transfer grants to expire.",
          { canRetry: true },
        );
      }
    } finally {
      client.release();
    }
  }
}

/** Deletes Better Auth's user-linked rows; repeated execution is intentionally harmless. */
export class PostgresIdentityEraser implements IdentityEraser {
  readonly #pool: PostgresPool;

  constructor(pool: PostgresPool) {
    this.#pool = pool;
  }

  async eraseIdentity(accountId: string): Promise<void> {
    const id = requireAccountId(accountId);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 91))", [id]);
      await client.query(`DELETE FROM "verification" verification
        USING "user" identity_user
        WHERE identity_user.id = $1
          AND (
            verification.identifier = identity_user.email
            OR verification.identifier = COALESCE(identity_user."phoneNumber", '')
            OR CASE
              WHEN ltrim(verification.value) LIKE '{%'
              THEN (
                ltrim(verification.value)::jsonb ->> 'accountId' = identity_user.id
                OR ltrim(verification.value)::jsonb #>> '{identifier,value}' = identity_user.email
                OR ltrim(verification.value)::jsonb #>> '{identifier,value}' = COALESCE(identity_user."phoneNumber", '')
              )
              ELSE false
            END
          )`, [id]);
      await client.query('DELETE FROM "session" WHERE "userId" = $1', [id]);
      await client.query('DELETE FROM "account" WHERE "userId" = $1', [id]);
      await client.query('DELETE FROM "user" WHERE id = $1', [id]);
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the first cleanup failure for the retryable job.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function privateAccountPrefix(accountId: string): string {
  const hash = createHash("sha256").update(accountId).digest("hex").slice(0, 24);
  return `accounts/${hash}/`;
}

function requireAccountId(value: string): string {
  const accountId = value.trim();
  if (!accountId) throw new Error("Account ID is required for deletion.");
  return accountId;
}
