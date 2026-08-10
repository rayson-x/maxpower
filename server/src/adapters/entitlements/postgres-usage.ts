import { ApiError } from "../../kernel/api-error.js";
import type { ProductAlias } from "../../modules/llm/model.js";
import type {
  ClaimInvocationResult,
  FailLlmInvocationInput,
  FinalizeLlmInvocationInput,
  FinalizeLlmInvocationResult,
  InvocationMetadata,
  InvocationMetadataUpdate,
  LlmInvocationLifecycleAdapter,
  LlmRecoveryResult,
  LlmUsageAdapter,
  UsageMetadata,
} from "../../modules/llm/ports.js";
import type { PostgresQueryable } from "./postgres-types.js";

export interface UsageRouteMetadata {
  providerId: string;
  providerModel: string;
  pricingVersionId: string;
}

export interface PostgresLlmUsageAdapterOptions {
  routes: Readonly<Record<ProductAlias, UsageRouteMetadata>>;
}

export interface PersistedLlmUsage extends UsageMetadata, UsageRouteMetadata {}

export interface PricingVersionInput extends UsageRouteMetadata {
  alias: ProductAlias;
  inputCreditsPerMillionTokens: number;
  outputCreditsPerMillionTokens: number;
  inputCostMicrosPerMillionTokens: number;
  outputCostMicrosPerMillionTokens: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type PricingVersion = PricingVersionInput;

export interface ProviderUsageReconciliation {
  reconciliationId: string;
  invocationId: string;
  upstreamUsageId: string;
  providerId: string;
  providerModel: string;
  pricingVersionId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerCostMicros: number;
  reconciledAt: string;
}

type InvocationRow = Record<string, unknown> & {
  id: string;
  owner_account_id: string;
  alias: ProductAlias;
  stream: boolean;
  idempotency_fingerprint: string;
  request_fingerprint: string;
  status: InvocationMetadata["status"];
  reserved_credits: number | string;
  settled_credits: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  error_code: string | null;
};

type UsageRow = Record<string, unknown> & {
  invocation_id: string;
  owner_account_id: string;
  alias: ProductAlias;
  usage_basis: UsageMetadata["usageBasis"];
  provider_id: string;
  provider_model: string;
  pricing_version_id: string;
  input_tokens: number | string;
  output_tokens: number | string;
  total_tokens: number | string;
  cached_input_tokens: number | string;
  image_tokens: number | string;
  provider_credits: number | string;
  provider_cost_micros: number | string;
  charged_credits: number | string;
  recorded_at: Date | string;
};

type ReconciliationRow = Record<string, unknown> & {
  id: string;
  invocation_id: string;
  upstream_usage_id: string;
  provider_id: string;
  provider_model: string;
  pricing_version_id: string;
  input_tokens: number | string;
  output_tokens: number | string;
  total_tokens: number | string;
  provider_cost_micros: number | string;
  reconciled_at: Date | string;
};

type PricingRow = Record<string, unknown> & {
  id: string;
  alias: ProductAlias;
  provider_id: string;
  provider_model: string;
  input_credits_per_million_tokens: number | string;
  output_credits_per_million_tokens: number | string;
  input_cost_micros_per_million_tokens: number | string;
  output_cost_micros_per_million_tokens: number | string;
  effective_from: Date | string;
  effective_to: Date | string | null;
};

/** PostgreSQL content-free invocation, route, pricing and normalized usage audit. */
export class PostgresLlmUsageAdapter implements LlmUsageAdapter, LlmInvocationLifecycleAdapter {
  readonly #database: PostgresQueryable;
  readonly #routes: Readonly<Record<ProductAlias, UsageRouteMetadata>>;

  constructor(database: PostgresQueryable, options: PostgresLlmUsageAdapterOptions) {
    this.#database = database;
    this.#routes = options.routes;
  }

  async claimInvocation(metadata: InvocationMetadata): Promise<ClaimInvocationResult> {
    const inserted = await this.#database.query<InvocationRow>(CLAIM_SQL, [
      metadata.id,
      metadata.ownerAccountId,
      metadata.alias,
      metadata.stream,
      metadata.idempotencyFingerprint,
      metadata.requestFingerprint,
      metadata.status,
      metadata.createdAt,
    ]);
    const created = inserted.rows[0];
    if (created !== undefined) {
      return { created: true, invocation: invocationFromRow(created) };
    }
    const existing = await this.#database.query<InvocationRow>(GET_BY_IDEMPOTENCY_SQL, [
      metadata.ownerAccountId,
      metadata.idempotencyFingerprint,
    ]);
    const row = existing.rows[0];
    if (row === undefined) {
      throw new ApiError(500, "invocation_claim_failed", "Invocation metadata was not claimed.");
    }
    return { created: false, invocation: invocationFromRow(row) };
  }

  async updateInvocation(id: string, update: InvocationMetadataUpdate): Promise<void> {
    const result = await this.#database.query<InvocationRow>(UPDATE_INVOCATION_SQL, [
      id,
      update.status ?? null,
      update.reservedCredits ?? null,
      update.settledCredits ?? null,
      update.updatedAt,
      update.errorCode ?? null,
    ]);
    if (result.rows[0] === undefined) {
      throw new ApiError(500, "invocation_not_found", "Invocation metadata was not found.");
    }
  }

  async getInvocation(id: string): Promise<InvocationMetadata | undefined> {
    const result = await this.#database.query<InvocationRow>(GET_INVOCATION_SQL, [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : invocationFromRow(row);
  }

  async requestCancellation(input: {
    ownerAccountId: string;
    idempotencyFingerprint: string;
    requestedAt: string;
  }): Promise<{ invocation?: InvocationMetadata }> {
    const result = await this.#database.query<InvocationRow & { id: string | null }>(REQUEST_CANCELLATION_SQL, [
      input.ownerAccountId,
      input.idempotencyFingerprint,
      input.requestedAt,
    ]);
    const row = result.rows[0];
    return row === undefined || row.id === null
      ? {}
      : { invocation: invocationFromRow(row as InvocationRow) };
  }

  async isCancellationRequested(invocationId: string): Promise<boolean> {
    const result = await this.#database.query<{ cancelled: boolean }>(IS_CANCELLATION_REQUESTED_SQL, [
      invocationId,
    ]);
    return result.rows[0]?.cancelled === true;
  }

  async recordUsage(metadata: UsageMetadata): Promise<void> {
    const route = this.#routes[metadata.alias];
    const result = await this.#database.query<UsageRow>(RECORD_USAGE_SQL, [
      metadata.invocationId,
      metadata.ownerAccountId,
      metadata.alias,
      metadata.inputTokens,
      metadata.outputTokens,
      metadata.totalTokens,
      metadata.cachedInputTokens,
      metadata.imageTokens,
      metadata.providerCredits,
      metadata.providerCostMicros,
      metadata.chargedCredits,
      metadata.recordedAt,
      route.providerId,
      route.providerModel,
      route.pricingVersionId,
      metadata.usageBasis,
    ]);
    if (result.rows[0] === undefined) {
      throw new ApiError(500, "usage_not_recorded", "Normalized LLM usage was not recorded.");
    }
  }

  async finalizeSuccess(input: FinalizeLlmInvocationInput): Promise<FinalizeLlmInvocationResult> {
    const route = this.#routes[input.alias];
    const result = await this.#database.query<{
      charged_credits: number | string;
      terminal_status: "completed" | "failed";
      error_code: string | null;
    }>(
      FINALIZE_SUCCESS_SQL,
      [
        input.reservationId,
        input.invocationId,
        input.ownerAccountId,
        input.alias,
        input.chargedCredits,
        input.inputTokens,
        input.outputTokens,
        input.totalTokens,
        input.cachedInputTokens,
        input.imageTokens,
        input.providerCredits,
        input.providerCostMicros,
        input.recordedAt,
        route.providerId,
        route.providerModel,
        route.pricingVersionId,
        input.terminalStatus,
        input.errorCode ?? null,
        input.usageBasis,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ApiError(409, "reservation_closed", "The entitlement reservation is unavailable.");
    }
    return {
      chargedCredits: integer(row.charged_credits, "charged_credits"),
      terminalStatus: row.terminal_status,
      ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    };
  }

  async fail(input: FailLlmInvocationInput): Promise<{ errorCode: string }> {
    const result = await this.#database.query<{ id: string; error_code: string }>(FAIL_INVOCATION_SQL, [
      input.reservationId,
      input.invocationId,
      input.failedAt,
      input.errorCode,
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new ApiError(409, "reservation_closed", "The entitlement reservation is unavailable.");
    }
    return { errorCode: row.error_code };
  }

  async recoverExpired(input: {
    recoveredAt: string;
    limit: number;
  }): Promise<LlmRecoveryResult> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new ApiError(500, "invalid_recovery_limit", "LLM recovery limit is invalid.");
    }
    const result = await this.#database.query<{ resolution: string }>(RECOVER_EXPIRED_SQL, [
      input.recoveredAt,
      input.limit,
    ]);
    return {
      releasedBeforeProvider: result.rows.filter(
        (row) => row.resolution === "released_before_provider",
      ).length,
      releasedDispatchPendingReconciliation: result.rows.filter(
        (row) => row.resolution === "released_dispatch_pending_reconciliation",
      ).length,
      chargedPendingReconciliation: result.rows.filter(
        (row) => row.resolution === "charged_pending_reconciliation",
      ).length,
    };
  }

  async getUsage(invocationId: string): Promise<PersistedLlmUsage | undefined> {
    const result = await this.#database.query<UsageRow>(GET_USAGE_SQL, [invocationId]);
    const row = result.rows[0];
    return row === undefined ? undefined : usageFromRow(row);
  }

  async reconcileProviderUsage(input: ProviderUsageReconciliation): Promise<void> {
    for (const [name, value] of [
      ["inputTokens", input.inputTokens],
      ["outputTokens", input.outputTokens],
      ["totalTokens", input.totalTokens],
      ["providerCostMicros", input.providerCostMicros],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ApiError(400, "invalid_provider_reconciliation", `${name} is invalid.`);
      }
    }
    if (input.totalTokens !== input.inputTokens + input.outputTokens) {
      throw new ApiError(
        400,
        "invalid_provider_reconciliation",
        "Provider reconciliation token totals are inconsistent.",
      );
    }
    await this.#database.query<ReconciliationRow>(RECONCILE_PROVIDER_USAGE_SQL, [
      input.reconciliationId,
      input.invocationId,
      input.upstreamUsageId,
      input.providerId,
      input.providerModel,
      input.pricingVersionId,
      input.inputTokens,
      input.outputTokens,
      input.totalTokens,
      input.providerCostMicros,
      input.reconciledAt,
    ]);
  }

  async getProviderReconciliation(
    reconciliationId: string,
  ): Promise<ProviderUsageReconciliation | undefined> {
    const result = await this.#database.query<ReconciliationRow>(GET_RECONCILIATION_SQL, [
      reconciliationId,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : reconciliationFromRow(row);
  }

  async upsertPricing(input: PricingVersionInput): Promise<void> {
    for (const credits of [
      input.inputCreditsPerMillionTokens,
      input.outputCreditsPerMillionTokens,
      input.inputCostMicrosPerMillionTokens,
      input.outputCostMicrosPerMillionTokens,
    ]) {
      if (!Number.isSafeInteger(credits) || credits < 0) {
        throw new ApiError(400, "invalid_pricing", "Pricing credits must be non-negative integers.");
      }
    }
    const inserted = await this.#database.query<PricingRow>(UPSERT_PRICING_SQL, [
      input.pricingVersionId,
      input.alias,
      input.providerId,
      input.providerModel,
      input.inputCreditsPerMillionTokens,
      input.outputCreditsPerMillionTokens,
      input.inputCostMicrosPerMillionTokens,
      input.outputCostMicrosPerMillionTokens,
      input.effectiveFrom,
      input.effectiveTo,
    ]);
    const stored = inserted.rows[0] === undefined
      ? await this.getPricing(input.pricingVersionId)
      : pricingFromRow(inserted.rows[0]);
    if (stored === undefined || !samePricing(stored, input)) {
      throw new ApiError(
        409,
        "pricing_version_conflict",
        "The pricing version ID already refers to different immutable pricing.",
      );
    }
  }

  async getPricing(pricingVersionId: string): Promise<PricingVersion | undefined> {
    const result = await this.#database.query<PricingRow>(GET_PRICING_SQL, [
      pricingVersionId,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : pricingFromRow(row);
  }
}

const CLAIM_SQL = `
/* llm-usage:claim */
INSERT INTO llm_gateway_invocations
  (id, owner_account_id, alias, stream, idempotency_fingerprint,
   request_fingerprint, status, reserved_credits, settled_credits, error_code,
   created_at, updated_at)
VALUES (
  $1, $2, $3, $4, $5, $6,
  CASE WHEN EXISTS (
    SELECT 1 FROM llm_invocation_cancellations cancellation
     WHERE cancellation.owner_account_id = $2
       AND cancellation.idempotency_fingerprint = $5
  ) THEN 'failed' ELSE $7 END,
  0, 0,
  CASE WHEN EXISTS (
    SELECT 1 FROM llm_invocation_cancellations cancellation
     WHERE cancellation.owner_account_id = $2
       AND cancellation.idempotency_fingerprint = $5
  ) THEN 'client_cancelled' ELSE NULL END,
  $8, $8
)
ON CONFLICT (owner_account_id, idempotency_fingerprint) DO NOTHING
RETURNING *;
`;

const REQUEST_CANCELLATION_SQL = `
/* llm-usage:request-cancellation */
WITH inserted AS (
  INSERT INTO llm_invocation_cancellations
    (owner_account_id, idempotency_fingerprint, requested_at)
  VALUES ($1, $2, $3)
  ON CONFLICT (owner_account_id, idempotency_fingerprint) DO UPDATE
    SET requested_at = LEAST(llm_invocation_cancellations.requested_at, EXCLUDED.requested_at)
  RETURNING owner_account_id, idempotency_fingerprint
), target AS (
  UPDATE llm_gateway_invocations invocation
     SET status = CASE
           WHEN invocation.status = 'received'
            AND NOT EXISTS (
              SELECT 1
                FROM llm_entitlement_reservations reservation
               WHERE reservation.invocation_id = invocation.id
                 AND reservation.status = 'reserved'
            ) THEN 'failed'
           WHEN invocation.status IN ('running', 'cancel_requested') THEN 'cancel_requested'
           ELSE invocation.status
         END,
         updated_at = $3,
         error_code = 'client_cancelled'
    FROM inserted
   WHERE invocation.owner_account_id = inserted.owner_account_id
     AND invocation.idempotency_fingerprint = inserted.idempotency_fingerprint
     AND invocation.status IN ('received', 'dispatching', 'running', 'cancel_requested')
  RETURNING invocation.*
), existing AS (
  SELECT invocation.*
    FROM llm_gateway_invocations invocation, inserted
   WHERE invocation.owner_account_id = inserted.owner_account_id
     AND invocation.idempotency_fingerprint = inserted.idempotency_fingerprint
)
SELECT * FROM target
UNION ALL
SELECT * FROM existing WHERE NOT EXISTS (SELECT 1 FROM target)
UNION ALL
SELECT NULL::text AS id, NULL::text AS owner_account_id,
       NULL::text AS alias, NULL::boolean AS stream,
       NULL::text AS idempotency_fingerprint, NULL::text AS request_fingerprint,
       NULL::text AS status, NULL::bigint AS reserved_credits,
       NULL::bigint AS settled_credits, NULL::text AS error_code,
       NULL::timestamptz AS created_at, NULL::timestamptz AS updated_at
 WHERE NOT EXISTS (SELECT 1 FROM existing)
LIMIT 1;
`;

const IS_CANCELLATION_REQUESTED_SQL = `
/* llm-usage:is-cancellation-requested */
SELECT EXISTS (
  SELECT 1
    FROM llm_gateway_invocations invocation
    JOIN llm_invocation_cancellations cancellation
      ON cancellation.owner_account_id = invocation.owner_account_id
     AND cancellation.idempotency_fingerprint = invocation.idempotency_fingerprint
   WHERE invocation.id = $1
) AS cancelled;
`;

const GET_BY_IDEMPOTENCY_SQL = `
/* llm-usage:get-by-idempotency */
SELECT * FROM llm_gateway_invocations
WHERE owner_account_id = $1 AND idempotency_fingerprint = $2;
`;

const UPDATE_INVOCATION_SQL = `
/* llm-usage:update-invocation */
UPDATE llm_gateway_invocations
SET status = CASE
      WHEN status = 'failed' AND error_code = 'client_cancelled' THEN status
      WHEN $2 IN ('received', 'dispatching', 'running') AND (
        status = 'cancel_requested'
        OR EXISTS (
          SELECT 1 FROM llm_invocation_cancellations cancellation
           WHERE cancellation.owner_account_id = llm_gateway_invocations.owner_account_id
             AND cancellation.idempotency_fingerprint = llm_gateway_invocations.idempotency_fingerprint
        )
      ) THEN status
      ELSE COALESCE($2, status)
    END,
    reserved_credits = COALESCE($3, reserved_credits),
    settled_credits = COALESCE($4, settled_credits),
    updated_at = $5,
    error_code = CASE
      WHEN status = 'failed' AND error_code = 'client_cancelled' THEN error_code
      ELSE COALESCE($6, error_code)
    END
WHERE id = $1
RETURNING *;
`;

const GET_INVOCATION_SQL = `
/* llm-usage:get-invocation */
SELECT * FROM llm_gateway_invocations WHERE id = $1;
`;

const RECORD_USAGE_SQL = `
/* llm-usage:record */
INSERT INTO llm_usage_events
  (invocation_id, owner_account_id, alias, input_tokens, output_tokens,
   total_tokens, cached_input_tokens, image_tokens, provider_credits,
   provider_cost_micros, charged_credits, recorded_at,
   provider_id, provider_model, pricing_version_id, usage_basis)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
ON CONFLICT (invocation_id) DO UPDATE SET
  invocation_id = llm_usage_events.invocation_id
RETURNING *;
`;

const GET_USAGE_SQL = `
/* llm-usage:get */
SELECT * FROM llm_usage_events WHERE invocation_id = $1;
`;

const FINALIZE_SUCCESS_SQL = `
/* llm-lifecycle:finalize-success */
WITH target AS MATERIALIZED (
  SELECT reservation.id, reservation.account_id, reservation.invocation_id,
         reservation.reserved_credits, reservation.charged_credits, reservation.status,
         invocation.status AS invocation_status,
         EXISTS (
           SELECT 1 FROM llm_invocation_cancellations cancellation
            WHERE cancellation.owner_account_id = invocation.owner_account_id
              AND cancellation.idempotency_fingerprint = invocation.idempotency_fingerprint
         ) AS cancellation_requested
    FROM llm_entitlement_reservations reservation
    JOIN llm_gateway_invocations invocation
      ON invocation.id = reservation.invocation_id
    JOIN "user" active_user
      ON active_user.id = reservation.account_id
     AND active_user."accountStatus" = 'active'
   WHERE reservation.id = $1
     AND invocation.id = $2
     AND invocation.owner_account_id = $3
     AND invocation.alias = $4
   FOR UPDATE OF reservation, invocation, active_user
), calculated AS (
  SELECT *, LEAST($5::bigint, reserved_credits) AS actual_charge
    FROM target
   WHERE status = 'reserved'
), account_update AS (
  UPDATE llm_entitlement_accounts account
     SET available_credits = account.available_credits
           + calculated.reserved_credits - calculated.actual_charge,
         spent_credits = account.spent_credits + calculated.actual_charge,
         updated_at = $13
    FROM calculated
   WHERE account.account_id = calculated.account_id
   RETURNING account.account_id
), reservation_update AS (
  UPDATE llm_entitlement_reservations reservation
     SET charged_credits = calculated.actual_charge,
         status = 'settled', updated_at = $13, lease_expires_at = NULL
    FROM calculated, account_update
   WHERE reservation.id = calculated.id
   RETURNING reservation.*
), ledger AS (
  INSERT INTO llm_entitlement_ledger_entries
    (account_id, invocation_id, reservation_id, kind, available_delta,
     reserved_delta, spent_delta, created_at)
  SELECT account_id, invocation_id, id, 'settle',
         reserved_credits - charged_credits, -reserved_credits, charged_credits, $13
    FROM reservation_update
), usage_insert AS (
  INSERT INTO llm_usage_events
    (invocation_id, owner_account_id, alias, input_tokens, output_tokens,
     total_tokens, cached_input_tokens, image_tokens, provider_credits,
     provider_cost_micros, charged_credits, recorded_at,
     provider_id, provider_model, pricing_version_id, usage_basis)
  SELECT $2, $3, $4, $6, $7, $8, $9, $10, $11, $12,
         charged_credits, $13, $14, $15, $16, $19
    FROM reservation_update
  ON CONFLICT (invocation_id) DO NOTHING
  RETURNING invocation_id
), invocation_update AS (
  UPDATE llm_gateway_invocations invocation
     SET status = CASE
           WHEN target.cancellation_requested THEN 'failed'
           ELSE $17
         END,
         reserved_credits = reservation_update.reserved_credits,
         settled_credits = reservation_update.charged_credits,
         updated_at = $13,
         error_code = CASE
           WHEN target.cancellation_requested THEN 'client_cancelled'
           ELSE $18
         END
    FROM reservation_update, usage_insert, target
   WHERE invocation.id = $2
   RETURNING invocation.id, invocation.status, invocation.error_code
)
SELECT reservation_update.charged_credits,
       invocation_update.status AS terminal_status,
       invocation_update.error_code
  FROM reservation_update, invocation_update
UNION ALL
SELECT target.charged_credits,
       invocation.status AS terminal_status,
       invocation.error_code
  FROM target
  JOIN llm_gateway_invocations invocation ON invocation.id = target.invocation_id
 WHERE target.status = 'settled'
   AND EXISTS (SELECT 1 FROM llm_usage_events WHERE invocation_id = $2)
LIMIT 1;
`;

const FAIL_INVOCATION_SQL = `
/* llm-lifecycle:fail */
WITH target AS MATERIALIZED (
  SELECT reservation.*,
         invocation.status AS invocation_status,
         EXISTS (
           SELECT 1 FROM llm_invocation_cancellations cancellation
            WHERE cancellation.owner_account_id = invocation.owner_account_id
              AND cancellation.idempotency_fingerprint = invocation.idempotency_fingerprint
         ) AS cancellation_requested
    FROM llm_entitlement_reservations reservation
    JOIN llm_gateway_invocations invocation ON invocation.id = reservation.invocation_id
   WHERE reservation.id = $1 AND invocation.id = $2
   FOR UPDATE OF reservation, invocation
), account_update AS (
  UPDATE llm_entitlement_accounts account
     SET available_credits = account.available_credits + target.reserved_credits,
         updated_at = $3
    FROM target
   WHERE account.account_id = target.account_id AND target.status = 'reserved'
   RETURNING account.account_id
), reservation_update AS (
  UPDATE llm_entitlement_reservations reservation
     SET status = 'released', updated_at = $3, lease_expires_at = NULL
    FROM target, account_update
   WHERE reservation.id = target.id
   RETURNING reservation.*
), ledger AS (
  INSERT INTO llm_entitlement_ledger_entries
    (account_id, invocation_id, reservation_id, kind, available_delta,
     reserved_delta, spent_delta, created_at)
  SELECT account_id, invocation_id, id, 'release', reserved_credits,
         -reserved_credits, 0, $3
    FROM reservation_update
), closable AS (
  SELECT id FROM reservation_update
  UNION ALL
  SELECT id FROM target WHERE status = 'released'
), invocation_update AS (
  UPDATE llm_gateway_invocations invocation
     SET status = 'failed',
         updated_at = $3,
         error_code = CASE
           WHEN target.cancellation_requested THEN 'client_cancelled'
           ELSE $4
         END
    FROM target
   WHERE invocation.id = $2
     AND invocation.status NOT IN ('completed', 'rejected')
     AND EXISTS (SELECT 1 FROM closable)
   RETURNING invocation.id, invocation.error_code
), recovery_insert AS (
  INSERT INTO llm_invocation_recovery_events
    (invocation_id, account_id, reservation_id, resolution,
     reserved_credits, recovered_at)
  SELECT target.invocation_id, target.account_id, target.id,
         'released_dispatch_pending_reconciliation', target.reserved_credits, $3
    FROM target, reservation_update
   WHERE target.invocation_status = 'dispatching'
  ON CONFLICT (invocation_id) DO NOTHING
)
SELECT id, error_code FROM invocation_update;
`;

const RECOVER_EXPIRED_SQL = `
/* llm-lifecycle:recover-expired */
WITH candidates AS MATERIALIZED (
  SELECT reservation.id, reservation.account_id, reservation.invocation_id,
         reservation.reserved_credits, invocation.status AS invocation_status,
         EXISTS (
           SELECT 1 FROM llm_invocation_cancellations cancellation
            WHERE cancellation.owner_account_id = invocation.owner_account_id
              AND cancellation.idempotency_fingerprint = invocation.idempotency_fingerprint
         ) AS cancellation_requested
    FROM llm_entitlement_reservations reservation
    JOIN llm_gateway_invocations invocation ON invocation.id = reservation.invocation_id
   WHERE reservation.status = 'reserved'
     AND reservation.lease_expires_at <= $1
     AND invocation.status IN ('received', 'dispatching', 'running', 'cancel_requested')
   ORDER BY reservation.lease_expires_at, reservation.id
   FOR UPDATE OF reservation, invocation SKIP LOCKED
   LIMIT $2
), account_deltas AS (
  SELECT account_id,
         sum(CASE WHEN invocation_status IN ('received', 'dispatching')
                  THEN reserved_credits ELSE 0 END)::bigint
           AS released_credits,
         sum(CASE WHEN invocation_status IN ('running', 'cancel_requested') THEN reserved_credits ELSE 0 END)::bigint
           AS charged_credits
    FROM candidates
   GROUP BY account_id
), account_update AS (
  UPDATE llm_entitlement_accounts account
     SET available_credits = account.available_credits + account_deltas.released_credits,
         spent_credits = account.spent_credits + account_deltas.charged_credits,
         updated_at = $1
    FROM account_deltas
   WHERE account.account_id = account_deltas.account_id
   RETURNING account.account_id
), reservation_update AS (
  UPDATE llm_entitlement_reservations reservation
     SET status = CASE
           WHEN candidates.invocation_status IN ('received', 'dispatching') THEN 'released'
           ELSE 'settled'
         END,
         charged_credits = CASE
           WHEN candidates.invocation_status IN ('running', 'cancel_requested') THEN candidates.reserved_credits
           ELSE 0
         END,
         updated_at = $1,
         lease_expires_at = NULL
    FROM candidates
   WHERE reservation.id = candidates.id
     AND EXISTS (
       SELECT 1 FROM account_update WHERE account_id = candidates.account_id
     )
   RETURNING reservation.id, reservation.account_id, reservation.invocation_id,
             reservation.reserved_credits, reservation.charged_credits,
             reservation.status
), ledger AS (
  INSERT INTO llm_entitlement_ledger_entries
    (account_id, invocation_id, reservation_id, kind, available_delta,
     reserved_delta, spent_delta, created_at)
  SELECT account_id, invocation_id, id,
         CASE WHEN status = 'released' THEN 'release' ELSE 'settle' END,
         CASE WHEN status = 'released' THEN reserved_credits ELSE 0 END,
         -reserved_credits,
         charged_credits,
         $1
    FROM reservation_update
), invocation_update AS (
  UPDATE llm_gateway_invocations invocation
     SET status = 'failed',
         reserved_credits = reservation_update.reserved_credits,
         settled_credits = reservation_update.charged_credits,
         updated_at = $1,
         error_code = CASE
           WHEN candidates.cancellation_requested THEN 'client_cancelled'
           WHEN reservation_update.status = 'released'
             THEN CASE
               WHEN candidates.invocation_status = 'dispatching'
                 THEN 'provider_dispatch_reconciliation_required'
               ELSE 'invocation_recovered_before_provider'
             END
           ELSE 'provider_usage_reconciliation_required'
         END
    FROM reservation_update, candidates
   WHERE invocation.id = reservation_update.invocation_id
     AND candidates.invocation_id = reservation_update.invocation_id
   RETURNING invocation.id
), recovery_insert AS (
  INSERT INTO llm_invocation_recovery_events
    (invocation_id, account_id, reservation_id, resolution,
     reserved_credits, recovered_at)
  SELECT reservation_update.invocation_id, reservation_update.account_id,
         reservation_update.id,
         CASE WHEN reservation_update.status = 'released'
           THEN CASE
             WHEN candidates.invocation_status = 'dispatching'
               THEN 'released_dispatch_pending_reconciliation'
             ELSE 'released_before_provider'
           END
           ELSE 'charged_pending_reconciliation'
         END,
         reservation_update.reserved_credits,
         $1
    FROM reservation_update, candidates
   WHERE EXISTS (
     SELECT 1 FROM invocation_update WHERE id = reservation_update.invocation_id
   )
     AND candidates.invocation_id = reservation_update.invocation_id
  ON CONFLICT (invocation_id) DO NOTHING
  RETURNING resolution
)
SELECT resolution FROM recovery_insert;
`;

const RECONCILE_PROVIDER_USAGE_SQL = `
/* llm-usage:reconcile-provider */
INSERT INTO llm_provider_usage_reconciliations
  (id, invocation_id, upstream_usage_id, provider_id, provider_model,
   pricing_version_id, input_tokens, output_tokens, total_tokens,
   provider_cost_micros, reconciled_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT DO NOTHING
RETURNING *;
`;

const GET_RECONCILIATION_SQL = `
/* llm-usage:get-provider-reconciliation */
SELECT * FROM llm_provider_usage_reconciliations WHERE id = $1;
`;

const UPSERT_PRICING_SQL = `
/* llm-pricing:upsert */
INSERT INTO llm_pricing_versions
  (id, alias, provider_id, provider_model, input_credits_per_million_tokens,
   output_credits_per_million_tokens, input_cost_micros_per_million_tokens,
   output_cost_micros_per_million_tokens, effective_from, effective_to)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (id) DO NOTHING
RETURNING *;
`;

const GET_PRICING_SQL = `
/* llm-pricing:get */
SELECT * FROM llm_pricing_versions WHERE id = $1;
`;

function invocationFromRow(row: InvocationRow): InvocationMetadata {
  return {
    id: row.id,
    ownerAccountId: row.owner_account_id,
    alias: row.alias,
    stream: row.stream,
    idempotencyFingerprint: row.idempotency_fingerprint,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    reservedCredits: integer(row.reserved_credits, "reserved_credits"),
    settledCredits: integer(row.settled_credits, "settled_credits"),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
  };
}

function usageFromRow(row: UsageRow): PersistedLlmUsage {
  return {
    invocationId: row.invocation_id,
    ownerAccountId: row.owner_account_id,
    alias: row.alias,
    usageBasis: row.usage_basis,
    providerId: row.provider_id,
    providerModel: row.provider_model,
    pricingVersionId: row.pricing_version_id,
    inputTokens: integer(row.input_tokens, "input_tokens"),
    outputTokens: integer(row.output_tokens, "output_tokens"),
    totalTokens: integer(row.total_tokens, "total_tokens"),
    cachedInputTokens: integer(row.cached_input_tokens, "cached_input_tokens"),
    imageTokens: integer(row.image_tokens, "image_tokens"),
    providerCredits: integer(row.provider_credits, "provider_credits"),
    providerCostMicros: integer(row.provider_cost_micros, "provider_cost_micros"),
    chargedCredits: integer(row.charged_credits, "charged_credits"),
    recordedAt: timestamp(row.recorded_at),
  };
}

function reconciliationFromRow(row: ReconciliationRow): ProviderUsageReconciliation {
  return {
    reconciliationId: row.id,
    invocationId: row.invocation_id,
    upstreamUsageId: row.upstream_usage_id,
    providerId: row.provider_id,
    providerModel: row.provider_model,
    pricingVersionId: row.pricing_version_id,
    inputTokens: integer(row.input_tokens, "input_tokens"),
    outputTokens: integer(row.output_tokens, "output_tokens"),
    totalTokens: integer(row.total_tokens, "total_tokens"),
    providerCostMicros: integer(row.provider_cost_micros, "provider_cost_micros"),
    reconciledAt: timestamp(row.reconciled_at),
  };
}

function pricingFromRow(row: PricingRow): PricingVersion {
  return {
    pricingVersionId: row.id,
    alias: row.alias,
    providerId: row.provider_id,
    providerModel: row.provider_model,
    inputCreditsPerMillionTokens: integer(
      row.input_credits_per_million_tokens,
      "input_credits_per_million_tokens",
    ),
    outputCreditsPerMillionTokens: integer(
      row.output_credits_per_million_tokens,
      "output_credits_per_million_tokens",
    ),
    inputCostMicrosPerMillionTokens: integer(
      row.input_cost_micros_per_million_tokens,
      "input_cost_micros_per_million_tokens",
    ),
    outputCostMicrosPerMillionTokens: integer(
      row.output_cost_micros_per_million_tokens,
      "output_cost_micros_per_million_tokens",
    ),
    effectiveFrom: timestamp(row.effective_from),
    effectiveTo: row.effective_to === null ? null : timestamp(row.effective_to),
  };
}

function samePricing(left: PricingVersion, right: PricingVersionInput): boolean {
  return left.pricingVersionId === right.pricingVersionId &&
    left.alias === right.alias &&
    left.providerId === right.providerId &&
    left.providerModel === right.providerModel &&
    left.inputCreditsPerMillionTokens === right.inputCreditsPerMillionTokens &&
    left.outputCreditsPerMillionTokens === right.outputCreditsPerMillionTokens &&
    left.inputCostMicrosPerMillionTokens === right.inputCostMicrosPerMillionTokens &&
    left.outputCostMicrosPerMillionTokens === right.outputCostMicrosPerMillionTokens &&
    left.effectiveFrom === new Date(right.effectiveFrom).toISOString() &&
    left.effectiveTo === (right.effectiveTo === null ? null : new Date(right.effectiveTo).toISOString());
}

function integer(value: number | string, name: string): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(500, "invalid_database_value", `${name} is not a safe non-negative integer.`);
  }
  return parsed;
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ApiError(500, "invalid_database_value", "Stored timestamp is invalid.");
  }
  return date.toISOString();
}
