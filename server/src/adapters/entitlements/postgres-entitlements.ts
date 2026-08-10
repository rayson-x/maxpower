import { ApiError } from "../../kernel/api-error.js";
import { randomId, type IdFactory } from "../../kernel/ids.js";
import type { LlmEntitlementView } from "../../modules/llm/model.js";
import type {
  LlmEntitlementAdapter,
  ReserveEntitlementInput,
  ReserveEntitlementResult,
  SettleEntitlementResult,
} from "../../modules/llm/ports.js";
import type { PostgresQueryable } from "./postgres-types.js";

export type EntitlementGrantKind = "free_monthly" | "admin" | "subscription";

export interface GrantEntitlementInput {
  grantId: string;
  accountId: string;
  kind: EntitlementGrantKind;
  credits: number;
  resetAt: string | null;
  sourceRef: string;
  createdAt: string;
}

export interface GrantEntitlementResult {
  created: boolean;
  account: LlmEntitlementView;
}

type AccountRow = Record<string, unknown> & {
  available_credits: number | string;
  spent_credits: number | string;
  reset_at: Date | string | null;
};

type ReservationRow = Record<string, unknown> & {
  id: string;
  reserved_credits: number | string;
  charged_credits: number | string;
  status: "reserved" | "settled" | "released";
};

/**
 * PostgreSQL entitlement ledger. Each mutation is one data-modifying CTE, so
 * admission and its audit entry commit atomically even when many Gateway nodes race.
 */
export class PostgresLlmEntitlementAdapter implements LlmEntitlementAdapter {
  readonly #database: PostgresQueryable;
  readonly #ids: IdFactory;
  readonly #reservationLeaseSeconds: number;

  constructor(
    database: PostgresQueryable,
    ids: IdFactory = randomId,
    options: { reservationLeaseSeconds?: number } = {},
  ) {
    this.#database = database;
    this.#ids = ids;
    this.#reservationLeaseSeconds = options.reservationLeaseSeconds ?? 2 * 60;
    if (!Number.isSafeInteger(this.#reservationLeaseSeconds) || this.#reservationLeaseSeconds < 60) {
      throw new ApiError(
        500,
        "invalid_reservation_lease",
        "LLM reservation lease must be at least 60 seconds.",
      );
    }
  }

  async grant(input: GrantEntitlementInput): Promise<GrantEntitlementResult> {
    assertPositiveCredits(input.credits, "credits");
    const result = await this.#database.query<AccountRow & { created: boolean }>(
      GRANT_SQL,
      [
        input.grantId,
        input.accountId,
        input.kind,
        input.credits,
        input.resetAt,
        input.sourceRef,
        input.createdAt,
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return { created: true, account: accountFromRow(row) };
    }
    const account = await this.getAccount(input.accountId);
    if (account === undefined) {
      throw new ApiError(500, "grant_inconsistent", "The entitlement grant was not applied.");
    }
    return { created: false, account };
  }

  async reserve(input: ReserveEntitlementInput): Promise<ReserveEntitlementResult> {
    assertPositiveCredits(input.credits, "credits");
    const reservationId = this.#ids("llmres");
    const now = new Date().toISOString();
    const result = await this.#database.query<ReservationRow>(RESERVE_SQL, [
      reservationId,
      input.accountId,
      input.invocationId,
      input.credits,
      now,
      this.#reservationLeaseSeconds,
    ]);
    const row = result.rows[0];
    if (row !== undefined && row.status !== "released") {
      return {
        granted: true,
        reservationId: row.id,
        reservedCredits: integer(row.reserved_credits, "reserved_credits"),
      };
    }
    const account = await this.getAccount(input.accountId);
    return account?.resetAt === null || account === undefined
      ? { granted: false }
      : { granted: false, resetAt: account.resetAt };
  }

  async settle(
    reservationId: string,
    actualCredits: number,
  ): Promise<SettleEntitlementResult> {
    assertCredits(actualCredits, "actualCredits");
    const result = await this.#database.query<ReservationRow>(SETTLE_SQL, [
      reservationId,
      actualCredits,
      new Date().toISOString(),
    ]);
    const row = result.rows[0];
    if (row === undefined || row.status === "released") {
      throw new ApiError(409, "reservation_closed", "The entitlement reservation is unavailable.");
    }
    return { chargedCredits: integer(row.charged_credits, "charged_credits") };
  }

  async release(reservationId: string): Promise<void> {
    const result = await this.#database.query<ReservationRow>(RELEASE_SQL, [
      reservationId,
      new Date().toISOString(),
    ]);
    if (result.rows[0] === undefined) {
      throw new ApiError(409, "reservation_closed", "The entitlement reservation is unavailable.");
    }
  }

  async getAccount(accountId: string): Promise<LlmEntitlementView | undefined> {
    const result = await this.#database.query<AccountRow>(GET_ACCOUNT_SQL, [accountId]);
    const row = result.rows[0];
    return row === undefined ? undefined : accountFromRow(row);
  }
}

const GRANT_SQL = `
/* llm-entitlement:grant */
WITH account_lock AS MATERIALIZED (
  SELECT pg_advisory_xact_lock(hashtextextended($2, 11))
), active_user AS MATERIALIZED (
  SELECT "user".id
    FROM "user", account_lock
   WHERE "user".id = $2 AND "user"."accountStatus" = 'active'
), inserted_grant AS (
  INSERT INTO llm_entitlement_grants
    (id, account_id, kind, credits, reset_at, source_ref, created_at)
  SELECT $1, id, $3, $4, $5, $6, $7 FROM active_user
  ON CONFLICT DO NOTHING
  RETURNING account_id, credits, reset_at
), upserted_account AS (
  INSERT INTO llm_entitlement_accounts
    (account_id, available_credits, spent_credits, reset_at, updated_at)
  SELECT account_id, credits, 0, reset_at, $7 FROM inserted_grant
  ON CONFLICT (account_id) DO UPDATE SET
    available_credits = llm_entitlement_accounts.available_credits + EXCLUDED.available_credits,
    reset_at = COALESCE(EXCLUDED.reset_at, llm_entitlement_accounts.reset_at),
    updated_at = EXCLUDED.updated_at
  RETURNING account_id, available_credits, spent_credits, reset_at
), ledger AS (
  INSERT INTO llm_entitlement_ledger_entries
    (account_id, grant_id, kind, available_delta, reserved_delta, spent_delta, created_at)
  SELECT account_id, $1, 'grant', credits, 0, 0, $7 FROM inserted_grant
)
SELECT true AS created, available_credits, spent_credits, reset_at
FROM upserted_account;
`;

const RESERVE_SQL = `
/* llm-entitlement:reserve */
WITH account_lock AS MATERIALIZED (
  SELECT pg_advisory_xact_lock(hashtextextended($2, 11))
), active_user AS MATERIALIZED (
  SELECT "user".id
    FROM "user", account_lock
   WHERE "user".id = $2 AND "user"."accountStatus" = 'active'
), invocation_lock AS MATERIALIZED (
  SELECT invocation.id
    FROM llm_gateway_invocations invocation, account_lock
   WHERE invocation.id = $3
     AND invocation.owner_account_id = $2
     AND invocation.status = 'received'
   FOR UPDATE
), existing AS (
  SELECT reservation.id, reservation.account_id, reservation.invocation_id,
         reservation.reserved_credits, reservation.charged_credits, reservation.status
    FROM llm_entitlement_reservations reservation
    JOIN active_user ON active_user.id = reservation.account_id
   WHERE reservation.invocation_id = $3
), debited AS (
  UPDATE llm_entitlement_accounts account
  SET available_credits = account.available_credits - $4, updated_at = $5
  FROM active_user, invocation_lock
  WHERE account.account_id = active_user.id
    AND account.available_credits >= $4
    AND NOT EXISTS (SELECT 1 FROM existing)
  RETURNING account.account_id
), inserted AS (
  INSERT INTO llm_entitlement_reservations
    (id, account_id, invocation_id, reserved_credits, charged_credits, status,
     created_at, updated_at, lease_expires_at)
  SELECT $1, account_id, $3, $4, 0, 'reserved', $5, $5,
         $5::timestamptz + ($6::integer * interval '1 second')
    FROM debited
  RETURNING id, account_id, invocation_id, reserved_credits, charged_credits, status
), ledger AS (
  INSERT INTO llm_entitlement_ledger_entries
    (account_id, invocation_id, reservation_id, kind, available_delta,
     reserved_delta, spent_delta, created_at)
  SELECT account_id, invocation_id, id, 'reserve', -reserved_credits,
         reserved_credits, 0, $5
  FROM inserted
)
SELECT * FROM existing
UNION ALL
SELECT * FROM inserted;
`;

const SETTLE_SQL = `
/* llm-entitlement:settle */
WITH target AS (
  SELECT id, account_id, invocation_id, reserved_credits, charged_credits, status
  FROM llm_entitlement_reservations
  WHERE id = $1
  FOR UPDATE
), calculated AS (
  SELECT *, LEAST($2::bigint, reserved_credits) AS actual_charge
  FROM target
  WHERE status = 'reserved'
), account_update AS (
  UPDATE llm_entitlement_accounts account
  SET available_credits = account.available_credits
        + calculated.reserved_credits - calculated.actual_charge,
      spent_credits = account.spent_credits + calculated.actual_charge,
      updated_at = $3
  FROM calculated
  WHERE account.account_id = calculated.account_id
  RETURNING account.account_id
), updated AS (
  UPDATE llm_entitlement_reservations reservation
  SET charged_credits = calculated.actual_charge,
      status = 'settled',
      updated_at = $3,
      lease_expires_at = NULL
  FROM calculated, account_update
  WHERE reservation.id = calculated.id
  RETURNING reservation.id, reservation.account_id, reservation.invocation_id,
            reservation.reserved_credits, reservation.charged_credits, reservation.status
), ledger AS (
  INSERT INTO llm_entitlement_ledger_entries
    (account_id, invocation_id, reservation_id, kind, available_delta,
     reserved_delta, spent_delta, created_at)
  SELECT account_id, invocation_id, id, 'settle',
         reserved_credits - charged_credits, -reserved_credits, charged_credits, $3
  FROM updated
)
SELECT * FROM updated
UNION ALL
SELECT * FROM target WHERE status = 'settled';
`;

const RELEASE_SQL = `
/* llm-entitlement:release */
WITH target AS (
  SELECT id, account_id, invocation_id, reserved_credits, charged_credits, status
  FROM llm_entitlement_reservations
  WHERE id = $1
  FOR UPDATE
), account_update AS (
  UPDATE llm_entitlement_accounts account
  SET available_credits = account.available_credits + target.reserved_credits,
      updated_at = $2
  FROM target
  WHERE account.account_id = target.account_id AND target.status = 'reserved'
  RETURNING account.account_id
), updated AS (
  UPDATE llm_entitlement_reservations reservation
  SET status = 'released', updated_at = $2, lease_expires_at = NULL
  FROM target, account_update
  WHERE reservation.id = target.id
  RETURNING reservation.id, reservation.account_id, reservation.invocation_id,
            reservation.reserved_credits, reservation.charged_credits, reservation.status
), ledger AS (
  INSERT INTO llm_entitlement_ledger_entries
    (account_id, invocation_id, reservation_id, kind, available_delta,
     reserved_delta, spent_delta, created_at)
  SELECT account_id, invocation_id, id, 'release', reserved_credits,
         -reserved_credits, 0, $2
  FROM updated
)
SELECT * FROM updated
UNION ALL
SELECT * FROM target WHERE status IN ('released', 'settled');
`;

const GET_ACCOUNT_SQL = `
/* llm-entitlement:get-account */
SELECT available_credits, spent_credits, reset_at
FROM llm_entitlement_accounts
WHERE account_id = $1;
`;

function accountFromRow(row: AccountRow): LlmEntitlementView {
  return {
    availableCredits: integer(row.available_credits, "available_credits"),
    spentCredits: integer(row.spent_credits, "spent_credits"),
    resetAt: timestamp(row.reset_at),
  };
}

function assertCredits(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(500, "invalid_credit_amount", `${name} must be a non-negative integer.`);
  }
}

function assertPositiveCredits(value: number, name: string): void {
  assertCredits(value, name);
  if (value === 0) {
    throw new ApiError(500, "invalid_credit_amount", `${name} must be greater than zero.`);
  }
}

function integer(value: number | string, name: string): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(500, "invalid_database_value", `${name} is not a safe non-negative integer.`);
  }
  return parsed;
}

function timestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ApiError(500, "invalid_database_value", "reset_at is not a timestamp.");
  }
  return date.toISOString();
}
