import { createHash } from "node:crypto";

import type { PostgresClient, PostgresPool } from "../postgres/client.js";
import { ApiError, conflict, notFound } from "../../kernel/api-error.js";
import type { IdFactory } from "../../kernel/ids.js";
import { randomId } from "../../kernel/ids.js";
import type {
  AccountDeletionAdapter,
  AccountDeletionJob,
  BeginAccountDeletionInput,
} from "../../modules/account-deletion/model.js";

export interface IdentityEraser {
  /** Must erase the Better Auth identity and be safe when it is already absent. */
  eraseIdentity(accountId: string): Promise<void>;
}

export interface PostgresAccountDeletionDependencies {
  pool: PostgresPool;
  identity: IdentityEraser;
  ids?: IdFactory;
  claimLeaseSeconds?: number;
}

type CleanupStage =
  | "requested"
  | "access_blocked"
  | "metadata_erased"
  | "identity_erased";

interface DeletionJobRow {
  id: string;
  account_id: string;
  request_key_hash: string;
  deletion_receipt_hash: string;
  status: AccountDeletionJob["status"];
  cleanup_stage: CleanupStage;
  attempts: number;
  requested_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  last_error_code: string | null;
}

/** Durable, staged cleanup behind the existing AccountDeletion Adapter seam. */
export class PostgresAccountDeletionAdapter implements AccountDeletionAdapter {
  readonly #pool: PostgresPool;
  readonly #identity: IdentityEraser;
  readonly #ids: IdFactory;
  readonly #claimLeaseSeconds: number;

  constructor(dependencies: PostgresAccountDeletionDependencies) {
    this.#pool = dependencies.pool;
    this.#identity = dependencies.identity;
    this.#ids = dependencies.ids ?? randomId;
    this.#claimLeaseSeconds = dependencies.claimLeaseSeconds ?? 5 * 60;
    if (!Number.isSafeInteger(this.#claimLeaseSeconds) || this.#claimLeaseSeconds < 30) {
      throw new ApiError(
        500,
        "invalid_deletion_configuration",
        "Account deletion claim lease must be at least 30 seconds.",
      );
    }
  }

  async request(input: BeginAccountDeletionInput): Promise<AccountDeletionJob> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await lockAccount(client, input.accountId);
      const existing = await findForAccount(client, input.accountId, true);
      if (existing !== undefined) {
        if (existing.request_key_hash !== receiptHash(input.idempotencyKey)) {
          throw conflict("deletion_already_requested", "Account deletion is already requested.");
        }
        await blockAccessInTransaction(client, input.accountId);
        await client.query("COMMIT");
        return jobFromRow(existing);
      }

      const account = await client.query<{ id: string }>(
        `UPDATE "user"
            SET "accountStatus" = 'pending_deletion', "updatedAt" = $2
          WHERE id = $1
          RETURNING id`,
        [input.accountId, input.requestedAt],
      );
      if (account.rows[0] === undefined) throw notFound("account");

      const jobId = this.#ids("deletion");
      const result = await client.query<DeletionJobRow>(
        `INSERT INTO maxpower.account_deletion_jobs
          (id, account_id, request_key_hash, deletion_receipt_hash, status, cleanup_stage, attempts,
           requested_at, updated_at, completed_at, last_error_code, lease_expires_at)
         VALUES ($1, $2, $3, $4, 'pending', 'requested', 0, $5, $5, NULL, NULL, NULL)
         RETURNING *`,
        [jobId, input.accountId, receiptHash(input.idempotencyKey), receiptHash(jobId), input.requestedAt],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new ApiError(500, "deletion_job_not_created", "Account deletion job was not created.");
      }
      await blockAccessInTransaction(client, input.accountId);
      await client.query("COMMIT");
      return jobFromRow(row);
    } catch (error) {
      await rollbackPreservingOriginal(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getForAccount(accountId: string): Promise<AccountDeletionJob | undefined> {
    const client = await this.#pool.connect();
    try {
      const row = await findForAccount(client, accountId, false);
      return row === undefined ? undefined : jobFromRow(row);
    } finally {
      client.release();
    }
  }

  async getForReceipt(receipt: string): Promise<AccountDeletionJob | undefined> {
    const result = await this.#query<DeletionJobRow>(
      "SELECT * FROM maxpower.account_deletion_jobs WHERE deletion_receipt_hash = $1",
      [receiptHash(receipt)],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : jobFromRow(row);
  }

  async getForRequest(idempotencyKey: string): Promise<AccountDeletionJob | undefined> {
    const result = await this.#query<DeletionJobRow>(
      "SELECT * FROM maxpower.account_deletion_jobs WHERE request_key_hash = $1",
      [receiptHash(idempotencyKey)],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : jobFromRow(row);
  }

  async claimNext(updatedAt: string): Promise<AccountDeletionJob | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<DeletionJobRow>(
        `WITH candidate AS (
           SELECT id
             FROM maxpower.account_deletion_jobs
            WHERE status IN ('pending', 'retryable')
               OR (status = 'running' AND lease_expires_at <= $1)
            ORDER BY requested_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE maxpower.account_deletion_jobs job
            SET status = 'running',
                attempts = attempts + 1,
                updated_at = $1,
                lease_expires_at = $1::timestamptz + ($2::integer * interval '1 second')
           FROM candidate
          WHERE job.id = candidate.id
          RETURNING job.*`,
        [updatedAt, this.#claimLeaseSeconds],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return row === undefined ? undefined : jobFromRow(row);
    } catch (error) {
      await rollbackPreservingOriginal(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async eraseOwnedData(accountId: string): Promise<void> {
    let stage = await this.#requireStage(accountId);
    if (stage === "requested") {
      await this.#blockAccess(accountId);
      stage = "access_blocked";
    }
    if (stage === "access_blocked") {
      await this.#eraseMetadata(accountId);
      stage = "metadata_erased";
    }
    if (stage === "metadata_erased") {
      await this.#identity.eraseIdentity(accountId);
      await this.#advanceStage(accountId, "metadata_erased", "identity_erased");
    }
  }

  async complete(jobId: string, completedAt: string): Promise<AccountDeletionJob> {
    const result = await this.#query<DeletionJobRow>(
      `UPDATE maxpower.account_deletion_jobs
          SET status = 'completed', completed_at = $2, updated_at = $2,
              last_error_code = NULL, lease_expires_at = NULL
        WHERE id = $1 AND cleanup_stage = 'identity_erased'
        RETURNING *`,
      [jobId, completedAt],
    );
    const row = result.rows[0];
    if (row === undefined) {
      const existing = await this.#getById(jobId);
      if (existing === undefined) throw notFound("account_deletion");
      if (existing.status === "completed") return jobFromRow(existing);
      throw conflict("deletion_cleanup_incomplete", "Account cleanup has not completed.");
    }
    return jobFromRow(row);
  }

  async retry(
    jobId: string,
    errorCode: string,
    updatedAt: string,
  ): Promise<AccountDeletionJob> {
    const result = await this.#query<DeletionJobRow>(
      `UPDATE maxpower.account_deletion_jobs
          SET status = 'retryable', last_error_code = $2,
              updated_at = $3, lease_expires_at = NULL
        WHERE id = $1 AND status <> 'completed'
        RETURNING *`,
      [jobId, errorCode, updatedAt],
    );
    const row = result.rows[0];
    if (row === undefined) {
      const existing = await this.#getById(jobId);
      if (existing === undefined) throw notFound("account_deletion");
      return jobFromRow(existing);
    }
    return jobFromRow(row);
  }

  async #blockAccess(accountId: string): Promise<void> {
    await this.#transaction(accountId, async (client) => {
      await blockAccessInTransaction(client, accountId);
    });
  }

  async #eraseMetadata(accountId: string): Promise<void> {
    await this.#transaction(accountId, async (client) => {
      const stage = await requireStage(client, accountId);
      if (stage !== "access_blocked") return;
      await client.query(
        `DELETE FROM llm_provider_usage_reconciliations
          WHERE invocation_id IN (
            SELECT id FROM llm_gateway_invocations WHERE owner_account_id = $1
          )`,
        [accountId],
      );
      await client.query(`DELETE FROM llm_usage_events WHERE owner_account_id = $1`, [accountId]);
      await client.query(`DELETE FROM llm_invocation_recovery_events WHERE account_id = $1`, [accountId]);
      await client.query(`DELETE FROM llm_entitlement_ledger_entries WHERE account_id = $1`, [accountId]);
      await client.query(`DELETE FROM llm_entitlement_reservations WHERE account_id = $1`, [accountId]);
      await client.query(`DELETE FROM llm_entitlement_grants WHERE account_id = $1`, [accountId]);
      await client.query(`DELETE FROM llm_entitlement_accounts WHERE account_id = $1`, [accountId]);
      await client.query(`DELETE FROM llm_invocation_cancellations WHERE owner_account_id = $1`, [accountId]);
      await client.query(`DELETE FROM llm_gateway_invocations WHERE owner_account_id = $1`, [accountId]);
      await updateStage(client, accountId, "access_blocked", "metadata_erased");
    });
  }

  async #advanceStage(
    accountId: string,
    expected: CleanupStage,
    next: CleanupStage,
  ): Promise<void> {
    await this.#transaction(accountId, async (client) => {
      const current = await requireStage(client, accountId);
      if (current === next || stageOrder(current) > stageOrder(next)) return;
      if (current !== expected) {
        throw conflict("deletion_stage_conflict", "Account deletion stage changed unexpectedly.");
      }
      await updateStage(client, accountId, expected, next);
    });
  }

  async #requireStage(accountId: string): Promise<CleanupStage> {
    const client = await this.#pool.connect();
    try {
      return await requireStage(client, accountId);
    } finally {
      client.release();
    }
  }

  async #transaction(
    accountId: string,
    operation: (client: PostgresClient) => Promise<void>,
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await lockAccount(client, accountId);
      await operation(client);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackPreservingOriginal(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #query<Row>(sql: string, values: unknown[]) {
    const client = await this.#pool.connect();
    try {
      return await client.query<Row>(sql, values);
    } finally {
      client.release();
    }
  }

  async #getById(jobId: string): Promise<DeletionJobRow | undefined> {
    const result = await this.#query<DeletionJobRow>(
      "SELECT * FROM maxpower.account_deletion_jobs WHERE id = $1",
      [jobId],
    );
    return result.rows[0];
  }
}

async function findForAccount(
  client: PostgresClient,
  accountId: string,
  forUpdate: boolean,
): Promise<DeletionJobRow | undefined> {
  const result = await client.query<DeletionJobRow>(
    `SELECT * FROM maxpower.account_deletion_jobs
      WHERE account_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [accountId],
  );
  return result.rows[0];
}

async function requireStage(client: PostgresClient, accountId: string): Promise<CleanupStage> {
  const row = await findForAccount(client, accountId, false);
  if (row === undefined) throw notFound("account_deletion");
  return row.cleanup_stage;
}

async function updateStage(
  client: PostgresClient,
  accountId: string,
  expected: CleanupStage,
  next: CleanupStage,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `UPDATE maxpower.account_deletion_jobs
        SET cleanup_stage = $3
      WHERE account_id = $1 AND cleanup_stage = $2
      RETURNING id`,
    [accountId, expected, next],
  );
  if (result.rows[0] === undefined) {
    throw conflict("deletion_stage_conflict", "Account deletion stage changed unexpectedly.");
  }
}

async function lockAccount(client: PostgresClient, accountId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 11))", [accountId]);
}

async function blockAccessInTransaction(
  client: PostgresClient,
  accountId: string,
): Promise<void> {
  const stage = await requireStage(client, accountId);
  if (stage !== "requested") return;
  await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [accountId]);
  const account = await client.query<{ available_credits: number | string }>(
    `SELECT available_credits
       FROM llm_entitlement_accounts
      WHERE account_id = $1
      FOR UPDATE`,
    [accountId],
  );
  const released = await client.query<{ released_credits: number | string }>(
    `WITH released AS (
       UPDATE llm_entitlement_reservations
          SET status = 'released', updated_at = now(), lease_expires_at = NULL
        WHERE account_id = $1 AND status = 'reserved'
        RETURNING id, account_id, invocation_id, reserved_credits
     ), ledger AS (
       INSERT INTO llm_entitlement_ledger_entries
         (account_id, invocation_id, reservation_id, kind, available_delta,
          reserved_delta, spent_delta, created_at)
       SELECT account_id, invocation_id, id, 'release', reserved_credits,
              -reserved_credits, 0, now()
         FROM released
     )
     SELECT COALESCE(sum(reserved_credits), 0)::bigint AS released_credits
       FROM released`,
    [accountId],
  );
  const availableCredits = integer(account.rows[0]?.available_credits ?? 0);
  const releasedCredits = integer(released.rows[0]?.released_credits ?? 0);
  await client.query(
    `UPDATE llm_entitlement_accounts
        SET available_credits = 0, updated_at = now()
      WHERE account_id = $1`,
    [accountId],
  );
  if (availableCredits + releasedCredits > 0) {
    await client.query(
      `INSERT INTO llm_entitlement_ledger_entries
        (account_id, kind, available_delta, reserved_delta, spent_delta, created_at)
       VALUES ($1, 'adjustment', $2, 0, 0, now())`,
      [accountId, -(availableCredits + releasedCredits)],
    );
  }
  await updateStage(client, accountId, "requested", "access_blocked");
}

async function rollbackPreservingOriginal(client: PostgresClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the first failure.
  }
}

function jobFromRow(row: DeletionJobRow): AccountDeletionJob {
  return {
    id: row.id,
    accountId: row.account_id,
    deletionReceipt: row.id,
    status: row.status,
    requestedAt: iso(row.requested_at),
    updatedAt: iso(row.updated_at),
    attempts: row.attempts,
    completedAt: nullableIso(row.completed_at),
    lastErrorCode: row.last_error_code,
  };
}

function stageOrder(stage: CleanupStage): number {
  return [
    "requested",
    "access_blocked",
    "metadata_erased",
    "identity_erased",
  ].indexOf(stage);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function receiptHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function integer(value: number | string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(500, "invalid_database_value", "Stored credits are invalid.");
  }
  return parsed;
}
