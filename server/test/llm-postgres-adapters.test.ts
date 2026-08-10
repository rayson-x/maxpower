import assert from "node:assert/strict";
import test from "node:test";

import {
  PostgresLlmEntitlementAdapter,
  PostgresLlmUsageAdapter,
  type PostgresQueryResult,
  type PostgresQueryable,
} from "../src/adapters/entitlements/index.js";
import type { Principal } from "../src/kernel/principal.js";
import {
  InMemoryLlmProviderAdapter,
  LlmGateway,
} from "../src/modules/llm/index.js";

test("Postgres ledger grants, reserves and settles actual LLM usage through the Gateway", async () => {
  const database = new LedgerPostgres();
  const entitlements = new PostgresLlmEntitlementAdapter(database);
  const usage = new PostgresLlmUsageAdapter(database, {
    routes: {
      "maxpower/coach-v1": {
        providerId: "global-primary",
        providerModel: "internal-coach-model",
        pricingVersionId: "price-coach-2026-08",
      },
      "maxpower/nutrition-vision-v1": {
        providerId: "global-vision",
        providerModel: "internal-vision-model",
        pricingVersionId: "price-vision-2026-08",
      },
    },
  });
  await usage.upsertPricing({
    pricingVersionId: "price-coach-2026-08",
    alias: "maxpower/coach-v1",
    providerId: "global-primary",
    providerModel: "internal-coach-model",
    inputCreditsPerMillionTokens: 2,
    outputCreditsPerMillionTokens: 4,
    inputCostMicrosPerMillionTokens: 10,
    outputCostMicrosPerMillionTokens: 20,
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
  });
  assert.deepEqual(await usage.getPricing("price-coach-2026-08"), {
    pricingVersionId: "price-coach-2026-08",
    alias: "maxpower/coach-v1",
    providerId: "global-primary",
    providerModel: "internal-coach-model",
    inputCreditsPerMillionTokens: 2,
    outputCreditsPerMillionTokens: 4,
    inputCostMicrosPerMillionTokens: 10,
    outputCostMicrosPerMillionTokens: 20,
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
  });
  await entitlements.grant({
    grantId: "grant-free-august",
    accountId: "alice",
    kind: "free_monthly",
    credits: 150,
    resetAt: "2026-09-01T00:00:00.000Z",
    sourceRef: "free-2026-08",
    createdAt: "2026-08-10T00:00:00.000Z",
  });
  const gateway = new LlmGateway({
    provider: new InMemoryLlmProviderAdapter([
      {
        kind: "complete",
        response: {
          id: "upstream-id",
          model: "must-not-leak",
          object: "chat.completion",
          choices: [],
        },
        usage: {
          inputTokens: 7,
          outputTokens: 3,
          totalTokens: 10,
          cachedInputTokens: 2,
          imageTokens: 1,
          credits: 4,
          providerCostMicros: 17,
        },
      },
    ]),
    entitlements,
    usage,
    clock: { now: () => new Date("2026-08-10T00:00:00.000Z") },
    fingerprintSecret: "postgres-test-fingerprint",
  });

  const result = await gateway.invoke(principal("alice"), {
    idempotencyKey: "postgres-ledger-1",
    request: {
      model: "maxpower/coach-v1",
      messages: [{ role: "user", content: "ephemeral only" }],
    },
  });

  assert.equal(result.kind, "complete");
  if (result.kind !== "complete") return;
  assert.equal(result.response.model, "maxpower-cloud");
  assert.deepEqual(await entitlements.getAccount("alice"), {
    availableCredits: 146,
    spentCredits: 4,
    resetAt: "2026-09-01T00:00:00.000Z",
  });
  assert.deepEqual(await usage.getUsage(result.invocationId), {
    invocationId: result.invocationId,
    ownerAccountId: "alice",
    alias: "maxpower/coach-v1",
    usageBasis: "provider_reported",
    providerId: "global-primary",
    providerModel: "internal-coach-model",
    pricingVersionId: "price-coach-2026-08",
    inputTokens: 7,
    outputTokens: 3,
    totalTokens: 10,
    cachedInputTokens: 2,
    imageTokens: 1,
    providerCredits: 4,
    providerCostMicros: 17,
    chargedCredits: 4,
    recordedAt: "2026-08-10T00:00:00.000Z",
  });
  await usage.reconcileProviderUsage({
    reconciliationId: "recon-provider-1",
    invocationId: result.invocationId,
    upstreamUsageId: "upstream-usage-1",
    providerId: "global-primary",
    providerModel: "internal-coach-model",
    pricingVersionId: "price-coach-2026-08",
    inputTokens: 7,
    outputTokens: 3,
    totalTokens: 10,
    providerCostMicros: 17,
    reconciledAt: "2026-08-10T01:00:00.000Z",
  });
  assert.deepEqual(await usage.getProviderReconciliation("recon-provider-1"), {
    reconciliationId: "recon-provider-1",
    invocationId: result.invocationId,
    upstreamUsageId: "upstream-usage-1",
    providerId: "global-primary",
    providerModel: "internal-coach-model",
    pricingVersionId: "price-coach-2026-08",
    inputTokens: 7,
    outputTokens: 3,
    totalTokens: 10,
    providerCostMicros: 17,
    reconciledAt: "2026-08-10T01:00:00.000Z",
  });
  assert.equal(database.serializedState().includes("ephemeral only"), false);
});

test("Postgres ledger release returns the entire reservation without spending it", async () => {
  const database = new LedgerPostgres();
  const entitlements = new PostgresLlmEntitlementAdapter(database);
  await entitlements.grant({
    grantId: "grant-manual",
    accountId: "alice",
    kind: "admin",
    credits: 50,
    resetAt: null,
    sourceRef: "support-case-1",
    createdAt: "2026-08-10T00:00:00.000Z",
  });

  const reservation = await entitlements.reserve({
    accountId: "alice",
    invocationId: "llmi_release",
    credits: 30,
  });
  assert.equal(reservation.granted, true);
  if (!reservation.granted) return;
  assert.equal((await entitlements.getAccount("alice"))?.availableCredits, 20);

  await entitlements.release(reservation.reservationId);
  assert.deepEqual(await entitlements.getAccount("alice"), {
    availableCredits: 50,
    spentCredits: 0,
    resetAt: null,
  });
});

interface AccountRow {
  available_credits: number;
  spent_credits: number;
  reset_at: string | null;
}

interface ReservationRow {
  id: string;
  account_id: string;
  invocation_id: string;
  reserved_credits: number;
  charged_credits: number;
  status: "reserved" | "settled" | "released";
}

class LedgerPostgres implements PostgresQueryable {
  readonly #accounts = new Map<string, AccountRow>();
  readonly #grants = new Set<string>();
  readonly #reservations = new Map<string, ReservationRow>();
  readonly #invocations = new Map<string, Record<string, unknown>>();
  readonly #idempotency = new Map<string, string>();
  readonly #usage = new Map<string, Record<string, unknown>>();
  readonly #reconciliations = new Map<string, Record<string, unknown>>();
  readonly #pricing = new Map<string, Record<string, unknown>>();
  readonly #cancellations = new Set<string>();

  async query<Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    if (sql.includes("llm-entitlement:grant")) {
      const [grantId, accountId, , credits, resetAt] = values as [
        string,
        string,
        string,
        number,
        string | null,
      ];
      if (this.#grants.has(grantId)) return result([]);
      this.#grants.add(grantId);
      const account = this.#accounts.get(accountId) ?? {
        available_credits: 0,
        spent_credits: 0,
        reset_at: resetAt,
      };
      account.available_credits += credits;
      account.reset_at = resetAt;
      this.#accounts.set(accountId, account);
      return result([{ created: true, ...account }] as unknown as Row[]);
    }
    if (sql.includes("llm-entitlement:reserve")) {
      const [reservationId, accountId, invocationId, credits] = values as [
        string,
        string,
        string,
        number,
      ];
      const existing = [...this.#reservations.values()].find(
        (item) => item.invocation_id === invocationId,
      );
      if (existing !== undefined) return result([existing] as unknown as Row[]);
      const account = this.#accounts.get(accountId);
      if (account === undefined || account.available_credits < credits) return result([]);
      account.available_credits -= credits;
      const reservation: ReservationRow = {
        id: reservationId,
        account_id: accountId,
        invocation_id: invocationId,
        reserved_credits: credits,
        charged_credits: 0,
        status: "reserved",
      };
      this.#reservations.set(reservationId, reservation);
      return result([reservation] as unknown as Row[]);
    }
    if (sql.includes("llm-entitlement:settle")) {
      const [reservationId, actualCredits] = values as [string, number];
      const reservation = this.#reservations.get(reservationId);
      if (reservation === undefined) return result([]);
      if (reservation.status === "settled") return result([reservation] as unknown as Row[]);
      const charged = Math.min(actualCredits, reservation.reserved_credits);
      const account = this.#accounts.get(reservation.account_id);
      if (account === undefined) return result([]);
      account.available_credits += reservation.reserved_credits - charged;
      account.spent_credits += charged;
      reservation.charged_credits = charged;
      reservation.status = "settled";
      return result([reservation] as unknown as Row[]);
    }
    if (sql.includes("llm-entitlement:release")) {
      const [reservationId] = values as [string];
      const reservation = this.#reservations.get(reservationId);
      if (reservation === undefined) return result([]);
      if (reservation.status === "reserved") {
        const account = this.#accounts.get(reservation.account_id);
        if (account !== undefined) account.available_credits += reservation.reserved_credits;
        reservation.status = "released";
      }
      return result([reservation] as unknown as Row[]);
    }
    if (sql.includes("llm-entitlement:get-account")) {
      const [accountId] = values as [string];
      const account = this.#accounts.get(accountId);
      return result(account === undefined ? [] : ([account] as unknown as Row[]));
    }
    if (sql.includes("llm-usage:claim")) {
      const [id, owner, alias, stream, idempotency, fingerprint, status, createdAt] = values;
      const key = `${String(owner)}\u0000${String(idempotency)}`;
      const existingId = this.#idempotency.get(key);
      if (existingId !== undefined) return result([]);
      const row = {
        id,
        owner_account_id: owner,
        alias,
        stream,
        idempotency_fingerprint: idempotency,
        request_fingerprint: fingerprint,
        status,
        reserved_credits: 0,
        settled_credits: 0,
        created_at: createdAt,
        updated_at: createdAt,
        error_code: null,
      };
      this.#invocations.set(String(id), row);
      this.#idempotency.set(key, String(id));
      return result([row] as unknown as Row[]);
    }
    if (sql.includes("llm-usage:get-by-idempotency")) {
      const [owner, fingerprint] = values;
      const id = this.#idempotency.get(`${String(owner)}\u0000${String(fingerprint)}`);
      const row = id === undefined ? undefined : this.#invocations.get(id);
      return result(row === undefined ? [] : ([row] as unknown as Row[]));
    }
    if (sql.includes("llm-usage:update-invocation")) {
      const [id, status, reserved, settled, updatedAt, errorCode] = values;
      const row = this.#invocations.get(String(id));
      if (row === undefined) return result([]);
      if (status !== null) row.status = status;
      if (reserved !== null) row.reserved_credits = reserved;
      if (settled !== null) row.settled_credits = settled;
      row.updated_at = updatedAt;
      if (errorCode !== null) row.error_code = errorCode;
      return result([row] as unknown as Row[]);
    }
    if (sql.includes("llm-usage:get-invocation")) {
      const row = this.#invocations.get(String(values[0]));
      return result(row === undefined ? [] : ([row] as unknown as Row[]));
    }
    if (sql.includes("llm-usage:request-cancellation")) {
      const [owner, fingerprint] = values;
      const id = this.#idempotency.get(`${String(owner)}\u0000${String(fingerprint)}`);
      const row = id === undefined ? undefined : this.#invocations.get(id);
      if (row !== undefined && (row.status === "received" || row.status === "running")) {
        this.#cancellations.add(String(row.id));
      }
      return result(row === undefined ? [] : ([row] as unknown as Row[]));
    }
    if (sql.includes("llm-usage:is-cancellation-requested")) {
      return result([{ cancelled: this.#cancellations.has(String(values[0])) }] as unknown as Row[]);
    }
    if (sql.includes("llm-usage:record")) {
      const [
        invocationId,
        owner,
        alias,
        inputTokens,
        outputTokens,
        totalTokens,
        cachedInputTokens,
        imageTokens,
        providerCredits,
        providerCostMicros,
        chargedCredits,
        recordedAt,
        providerId,
        providerModel,
        pricingVersionId,
        usageBasis,
      ] = values;
      const row = {
        invocation_id: invocationId,
        owner_account_id: owner,
        alias,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        cached_input_tokens: cachedInputTokens,
        image_tokens: imageTokens,
        provider_credits: providerCredits,
        provider_cost_micros: providerCostMicros,
        charged_credits: chargedCredits,
        recorded_at: recordedAt,
        provider_id: providerId,
        provider_model: providerModel,
        pricing_version_id: pricingVersionId,
        usage_basis: usageBasis,
      };
      this.#usage.set(String(invocationId), row);
      return result([row] as unknown as Row[]);
    }
    if (sql.includes("llm-usage:reconcile-provider")) {
      const [
        id,
        invocationId,
        upstreamUsageId,
        providerId,
        providerModel,
        pricingVersionId,
        inputTokens,
        outputTokens,
        totalTokens,
        providerCostMicros,
        reconciledAt,
      ] = values;
      const row = {
        id,
        invocation_id: invocationId,
        upstream_usage_id: upstreamUsageId,
        provider_id: providerId,
        provider_model: providerModel,
        pricing_version_id: pricingVersionId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        provider_cost_micros: providerCostMicros,
        reconciled_at: reconciledAt,
      };
      this.#reconciliations.set(String(id), row);
      return result([row] as unknown as Row[]);
    }
    if (sql.includes("llm-usage:get-provider-reconciliation")) {
      const row = this.#reconciliations.get(String(values[0]));
      return result(row === undefined ? [] : ([row] as unknown as Row[]));
    }
    if (sql.includes("llm-pricing:upsert")) {
      const [
        id,
        alias,
        providerId,
        providerModel,
        inputCredits,
        outputCredits,
        inputCostMicros,
        outputCostMicros,
        effectiveFrom,
        effectiveTo,
      ] = values;
      const row = {
        id,
        alias,
        provider_id: providerId,
        provider_model: providerModel,
        input_credits_per_million_tokens: inputCredits,
        output_credits_per_million_tokens: outputCredits,
        input_cost_micros_per_million_tokens: inputCostMicros,
        output_cost_micros_per_million_tokens: outputCostMicros,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
      };
      this.#pricing.set(String(id), row);
      return result([row] as unknown as Row[]);
    }
    if (sql.includes("llm-pricing:get")) {
      const row = this.#pricing.get(String(values[0]));
      return result(row === undefined ? [] : ([row] as unknown as Row[]));
    }
    if (sql.includes("llm-usage:get")) {
      const row = this.#usage.get(String(values[0]));
      return result(row === undefined ? [] : ([row] as unknown as Row[]));
    }
    throw new Error(`Unexpected SQL operation: ${sql.slice(0, 80)}`);
  }

  serializedState(): string {
    return JSON.stringify({
      accounts: [...this.#accounts],
      grants: [...this.#grants],
      reservations: [...this.#reservations],
      invocations: [...this.#invocations],
      usage: [...this.#usage],
      reconciliations: [...this.#reconciliations],
      pricing: [...this.#pricing],
    });
  }
}

function result<Row extends Record<string, unknown>>(
  rows: Row[],
): PostgresQueryResult<Row> {
  return { rows, rowCount: rows.length };
}

function principal(accountId: string): Principal {
  return {
    accountId,
    sessionId: `session-${accountId}`,
    status: "active",
    scopes: new Set(["llm:invoke"]),
  };
}
