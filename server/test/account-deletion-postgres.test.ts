import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Pool } from "pg";

import {
  PostgresAccountDeletionAdapter,
  type AccountMediaEraser,
  type IdentityEraser,
} from "../src/adapters/account-deletion/index.js";
import { PostgresLlmEntitlementAdapter } from "../src/adapters/entitlements/index.js";
import type { PostgresPool } from "../src/adapters/postgres/client.js";
import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import type { IdFactory } from "../src/kernel/ids.js";
import type { Principal } from "../src/kernel/principal.js";
import { AccountDeletionModule } from "../src/modules/account-deletion/index.js";

const databaseUrl = process.env.MAXPOWER_TEST_POSTGRES_URL;

test(
  "production deletion persists the job and erases account data in dependency order",
  { skip: databaseUrl === undefined },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await resetDatabase(pool);
      await seedAccount(pool, "alice");
      await seedAccount(pool, "bob");
      const events: string[] = [];
      const media = new CheckingMediaEraser(pool, events);
      const identity = new CheckingIdentityEraser(pool, events);
      const ids = sequentialIds();
      const deletionSql: string[] = [];
      const deletionPool = recordingPool(pool, deletionSql);
      const deletion = createDeletion(deletionPool, media, identity, ids);
      const alice = principal("alice");

      const requested = await deletion.request(alice, {
        idempotencyKey: "a".repeat(64),
        confirmation: "DELETE",
      });
      assert.equal(requested.status, "pending");
      assert.equal(
        await scalar(pool, `SELECT count(*) FROM "session" WHERE "userId" = 'alice'`),
        0,
        "the deletion response must not race ahead of session revocation",
      );
      assert.equal(
        await scalar(
          pool,
          `SELECT available_credits FROM llm_entitlement_accounts WHERE account_id = 'alice'`,
        ),
        0,
        "the deletion response must not race ahead of entitlement blocking",
      );
      assert.equal(
        await scalar(
          pool,
          `SELECT count(*) FROM maxpower.account_deletion_jobs
            WHERE account_id = 'alice' AND cleanup_stage = 'access_blocked'`,
        ),
        1,
      );
      const entitlements = new PostgresLlmEntitlementAdapter(pool);
      const lateGrant = await entitlements.grant({
        grantId: "grant-after-deletion",
        accountId: "alice",
        kind: "admin",
        credits: 100,
        resetAt: null,
        sourceRef: "must-not-apply",
        createdAt: "2026-06-01T00:00:10.000Z",
      });
      assert.equal(lateGrant.created, false);
      assert.equal(
        await scalar(
          pool,
          `SELECT count(*) FROM llm_entitlement_grants WHERE id = 'grant-after-deletion'`,
        ),
        0,
      );
      assert.deepEqual(await entitlements.reserve({
        accountId: "alice",
        invocationId: "invocation-after-deletion",
        credits: 1,
      }), { granted: false });

      const restarted = createDeletion(deletionPool, media, identity, ids);
      assert.equal((await restarted.get(alice)).id, requested.id);
      assert.equal((await restarted.request(alice, {
        idempotencyKey: "a".repeat(64),
        confirmation: "DELETE",
      })).id, requested.id);
      await assertApiError(
        restarted.request(alice, {
          idempotencyKey: "c".repeat(64),
          confirmation: "DELETE",
        }),
        409,
        "deletion_already_requested",
      );

      const completed = await restarted.processNext();
      assert.equal(completed?.status, "completed");
      assert.deepEqual(events, ["media:alice", "identity:alice"]);
      assert.equal((await restarted.get(alice)).attempts, 1);

      const workoutReferences = deletionSql.findIndex((sql) =>
        sql.includes("DELETE FROM maxpower.workout_session_media_references")
      );
      const resultReferences = deletionSql.findIndex((sql) =>
        sql.includes("DELETE FROM maxpower.result_media_references")
      );
      const results = deletionSql.findIndex((sql) =>
        sql.includes("DELETE FROM maxpower.results")
      );
      const workouts = deletionSql.findIndex((sql) =>
        sql.includes("DELETE FROM maxpower.workout_sessions")
      );
      assert.ok(workoutReferences >= 0 && workoutReferences < workouts);
      assert.ok(resultReferences >= 0 && resultReferences < results);

      const bob = principal("bob");
      await assertApiError(restarted.get(bob), 404, "not_found");
      assert.equal(await scalar(pool, `SELECT count(*) FROM "user" WHERE id = 'bob'`), 1);
      assert.equal(await scalar(pool, `SELECT count(*) FROM maxpower.profiles WHERE account_id = 'bob'`), 1);
    } finally {
      await pool.end();
    }
  },
);

test(
  "production deletion resumes from the last durable stage after identity erasure fails",
  { skip: databaseUrl === undefined },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await resetDatabase(pool);
      await seedAccount(pool, "alice");
      const events: string[] = [];
      const media = new CheckingMediaEraser(pool, events);
      const identity = new CheckingIdentityEraser(pool, events, 1);
      const deletion = createDeletion(pool, media, identity, sequentialIds());
      const alice = principal("alice");
      await deletion.request(alice, {
        idempotencyKey: "b".repeat(64),
        confirmation: "DELETE",
      });

      await assert.rejects(() => deletion.processNext(), /identity cleanup failed/i);
      const retryable = await deletion.get(alice);
      assert.equal(retryable.status, "retryable");
      assert.equal(retryable.attempts, 1);

      await deletion.processNext();
      const completed = await deletion.get(alice);
      assert.equal(completed.status, "completed");
      assert.equal(completed.attempts, 2);
      assert.deepEqual(events, ["media:alice", "identity:alice", "identity:alice"]);
    } finally {
      await pool.end();
    }
  },
);

function createDeletion(
  pool: PostgresPool,
  media: AccountMediaEraser,
  identity: IdentityEraser,
  ids: IdFactory,
): AccountDeletionModule {
  return new AccountDeletionModule({
    adapter: new PostgresAccountDeletionAdapter({
      pool,
      media,
      identity,
      ids,
      claimLeaseSeconds: 60,
    }),
    clock: new StepClock(),
  });
}

function recordingPool(pool: Pool, statements: string[]): PostgresPool {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row = Record<string, unknown>>(sql: string, values?: unknown[]) {
          statements.push(sql);
          const result = await client.query(sql, values);
          return { rows: result.rows as Row[] };
        },
        release() {
          client.release();
        },
      };
    },
  };
}

class CheckingMediaEraser implements AccountMediaEraser {
  readonly #pool: Pool;
  readonly #events: string[];

  constructor(pool: Pool, events: string[]) {
    this.#pool = pool;
    this.#events = events;
  }

  async eraseAccountMedia(accountId: string): Promise<void> {
    assert.equal(
      await scalar(this.#pool, `SELECT count(*) FROM "session" WHERE "userId" = $1`, [accountId]),
      0,
      "sessions must be revoked before object erasure",
    );
    assert.equal(
      await scalar(
        this.#pool,
        "SELECT available_credits FROM llm_entitlement_accounts WHERE account_id = $1",
        [accountId],
      ),
      0,
      "entitlement must be blocked before object erasure",
    );
    assert.equal(
      await scalar(
        this.#pool,
        `SELECT count(*) FROM llm_entitlement_ledger_entries
          WHERE account_id = $1 AND kind = 'release'`,
        [accountId],
      ),
      1,
      "reservation release must be recorded before cleanup",
    );
    this.#events.push(`media:${accountId}`);
  }
}

class CheckingIdentityEraser implements IdentityEraser {
  readonly #pool: Pool;
  readonly #events: string[];
  #failuresRemaining: number;

  constructor(pool: Pool, events: string[], failures = 0) {
    this.#pool = pool;
    this.#events = events;
    this.#failuresRemaining = failures;
  }

  async eraseIdentity(accountId: string): Promise<void> {
    assert.equal(
      await scalar(this.#pool, "SELECT count(*) FROM maxpower.profiles WHERE account_id = $1", [accountId]),
      0,
      "ProductData metadata must be erased before identity",
    );
    assert.equal(
      await scalar(this.#pool, "SELECT count(*) FROM maxpower.media_assets WHERE account_id = $1", [accountId]),
      0,
      "media metadata must be erased before identity",
    );
    for (const [table, ownerColumn] of [
      ["llm_entitlement_accounts", "account_id"],
      ["llm_entitlement_grants", "account_id"],
      ["llm_entitlement_reservations", "account_id"],
      ["llm_entitlement_ledger_entries", "account_id"],
      ["llm_gateway_invocations", "owner_account_id"],
      ["llm_usage_events", "owner_account_id"],
      ["llm_invocation_recovery_events", "account_id"],
    ] as const) {
      assert.equal(
        await scalar(this.#pool, `SELECT count(*) FROM ${table} WHERE ${ownerColumn} = $1`, [accountId]),
        0,
        `${table} must be erased before identity`,
      );
    }
    assert.equal(
      await scalar(
        this.#pool,
        `SELECT count(*)
           FROM llm_provider_usage_reconciliations reconciliation
           JOIN llm_gateway_invocations invocation ON invocation.id = reconciliation.invocation_id
          WHERE invocation.owner_account_id = $1`,
        [accountId],
      ),
      0,
      "provider reconciliation must not retain the deleted account",
    );
    this.#events.push(`identity:${accountId}`);
    if (this.#failuresRemaining > 0) {
      this.#failuresRemaining -= 1;
      throw new Error("Identity cleanup failed.");
    }
    await this.#pool.query(`DELETE FROM "user" WHERE id = $1`, [accountId]);
  }
}

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS maxpower CASCADE");
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("GRANT ALL ON SCHEMA public TO public");
  await pool.query(`
    CREATE TABLE "user" (
      id text PRIMARY KEY,
      "accountStatus" text NOT NULL,
      "updatedAt" timestamptz NOT NULL
    );
    CREATE TABLE "session" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );
  `);
  for (const migration of [
    "020-product-data.sql",
    "030-media-library.sql",
    "040-llm-entitlements.sql",
    "050-account-deletion.sql",
  ]) {
    await pool.query(
      await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"),
    );
  }
}

async function seedAccount(pool: Pool, accountId: string): Promise<void> {
  await pool.query(
    `INSERT INTO "user" (id, "accountStatus", "updatedAt") VALUES ($1, 'active', now())`,
    [accountId],
  );
  await pool.query(
    `INSERT INTO llm_entitlement_accounts
      (account_id, available_credits, spent_credits, reset_at, updated_at)
     VALUES ($1, 100, 0, NULL, now())`,
    [accountId],
  );
  await pool.query(
    `INSERT INTO llm_pricing_versions
      (id, alias, provider_id, provider_model, input_credits_per_million_tokens,
       output_credits_per_million_tokens, input_cost_micros_per_million_tokens,
       output_cost_micros_per_million_tokens, effective_from, effective_to)
     VALUES ('deletion-test-pricing', 'maxpower/coach-v1', 'provider', 'model',
             1, 1, 1, 1, now(), NULL)
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO llm_entitlement_grants
      (id, account_id, kind, credits, reset_at, source_ref, created_at)
     VALUES ($2, $1, 'admin', 100, NULL, $3, now())`,
    [accountId, `grant-${accountId}`, `seed-${accountId}`],
  );
  await pool.query(
    `INSERT INTO llm_gateway_invocations
      (id, owner_account_id, alias, stream, idempotency_fingerprint,
       request_fingerprint, status, reserved_credits, settled_credits, created_at, updated_at)
     VALUES ($2, $1, 'maxpower/coach-v1', false, $3, $4, 'running', 20, 0, now(), now())`,
    [accountId, `invocation-${accountId}`, `idem-${accountId}`, `request-${accountId}`],
  );
  await pool.query(
    `INSERT INTO llm_entitlement_reservations
      (id, account_id, invocation_id, reserved_credits, charged_credits,
       status, created_at, updated_at, lease_expires_at)
     VALUES ($2, $1, $3, 20, 0, 'reserved', now(), now(), now() + interval '2 minutes')`,
    [accountId, `reservation-${accountId}`, `invocation-${accountId}`],
  );
  await pool.query(
    `INSERT INTO llm_entitlement_ledger_entries
      (account_id, grant_id, kind, available_delta, reserved_delta, spent_delta, created_at)
     VALUES ($1, $2, 'grant', 100, 0, 0, now())`,
    [accountId, `grant-${accountId}`],
  );
  await pool.query(
    `INSERT INTO llm_entitlement_ledger_entries
      (account_id, invocation_id, reservation_id, kind, available_delta,
       reserved_delta, spent_delta, created_at)
     VALUES ($1, $2, $3, 'reserve', -20, 20, 0, now())`,
    [accountId, `invocation-${accountId}`, `reservation-${accountId}`],
  );
  await pool.query(
    `INSERT INTO llm_usage_events
      (invocation_id, owner_account_id, alias, provider_id, provider_model,
       pricing_version_id, input_tokens, output_tokens, total_tokens,
       cached_input_tokens, image_tokens, provider_credits, provider_cost_micros,
       charged_credits, usage_basis, recorded_at)
     VALUES ($2, $1, 'maxpower/coach-v1', 'provider', 'model',
             'deletion-test-pricing', 1, 1, 2, 0, 0, 1, 1, 1,
             'provider_reported', now())`,
    [accountId, `invocation-${accountId}`],
  );
  await pool.query(
    `INSERT INTO llm_provider_usage_reconciliations
      (id, invocation_id, upstream_usage_id, provider_id, provider_model,
       pricing_version_id, input_tokens, output_tokens, total_tokens,
       provider_cost_micros, reconciled_at)
     VALUES ($1, $2, $3, 'provider', 'model', 'deletion-test-pricing',
             1, 1, 2, 1, now())`,
    [`reconciliation-${accountId}`, `invocation-${accountId}`, `upstream-${accountId}`],
  );
  await pool.query(
    `INSERT INTO "session" (id, "userId") VALUES ($2, $1)`,
    [accountId, `session-${accountId}`],
  );
  await pool.query(
    `INSERT INTO maxpower.profiles
      (account_id, display_name, locale, time_zone, unit_system, revision, created_at, updated_at)
     VALUES ($1, 'Athlete', 'en', 'UTC', 'metric', 1, now(), now())`,
    [accountId],
  );
  await pool.query(
    `INSERT INTO maxpower.media_assets
      (account_id, id, kind, file_name, content_type, byte_size, sha256, object_key,
       status, purpose, verification, revision, created_at)
     VALUES ($1, $2, 'video', 'workout.mp4', 'video/mp4', 100, $3, $4,
             'ready', 'personal', 'object_metadata_verified', 1, now())`,
    [
      accountId,
      `asset-${accountId}`,
      accountId === "alice" ? "a".repeat(64) : "b".repeat(64),
      `accounts/${accountId}/asset`,
    ],
  );
  await pool.query(
    `INSERT INTO maxpower.workout_sessions
      (account_id, id, plan_id, plan_version_id, plan_snapshot, title, status,
       data, summary, notes, started_at, completed_at, revision, created_at, updated_at, deleted_at)
     VALUES ($1, $2, NULL, NULL, NULL, 'Workout', 'completed', '{}', '{}', NULL,
             now(), now(), 1, now(), now(), NULL)`,
    [accountId, `workout-${accountId}`],
  );
  await pool.query(
    `INSERT INTO maxpower.results
      (account_id, id, kind, workout_session_id, payload, provenance, occurred_at,
       revision, created_at, updated_at, deleted_at)
     VALUES ($1, $2, 'analysis', $3, '{}', '{}', now(), 1, now(), now(), NULL)`,
    [accountId, `result-${accountId}`, `workout-${accountId}`],
  );
  await pool.query(
    `INSERT INTO maxpower.workout_session_media_references
      (account_id, workout_session_id, asset_id, evidence_status, linked_at, evidence_deleted_at)
     VALUES ($1, $2, $3, 'available', now(), NULL)`,
    [accountId, `workout-${accountId}`, `asset-${accountId}`],
  );
  await pool.query(
    `INSERT INTO maxpower.result_media_references
      (account_id, result_id, asset_id, evidence_status, linked_at, evidence_deleted_at)
     VALUES ($1, $2, $3, 'available', now(), NULL)`,
    [accountId, `result-${accountId}`, `asset-${accountId}`],
  );
}

function principal(accountId: string): Principal {
  return {
    accountId,
    sessionId: `session-${accountId}`,
    status: "active",
    scopes: new Set(["account:delete"]),
  };
}

class StepClock implements Clock {
  #step = 0;

  now(): Date {
    this.#step += 1;
    return new Date(Date.UTC(2026, 5, 1, 0, 0, this.#step));
  }
}

function sequentialIds(): IdFactory {
  let sequence = 0;
  return (prefix) => `${prefix}_${++sequence}`;
}

async function scalar(
  pool: Pool,
  sql: string,
  values: unknown[] = [],
): Promise<number> {
  const result = await pool.query<{ value: string }>(`SELECT (${sql})::text AS value`, values);
  return Number(result.rows[0]?.value);
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
