import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Pool } from "pg";

import {
  PostgresLlmEntitlementAdapter,
  PostgresLlmUsageAdapter,
} from "../src/adapters/entitlements/index.js";
import { ApiError } from "../src/kernel/api-error.js";

const databaseUrl = process.env.MAXPOWER_TEST_POSTGRES_URL;

test(
  "PostgreSQL atomically finalizes usage and recovers expired pre-provider and running reservations",
  { skip: databaseUrl === undefined },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await resetDatabase(pool);
      const ids = sequentialIds();
      const entitlements = new PostgresLlmEntitlementAdapter(
        pool,
        ids,
        { reservationLeaseSeconds: 60 },
      );
      const usage = usageAdapter(pool, "pricing-v1");
      await usage.upsertPricing(pricing("pricing-v1"));
      await entitlements.grant({
        grantId: "grant-1",
        accountId: "alice",
        kind: "admin",
        credits: 300,
        resetAt: null,
        sourceRef: "test-grant",
        createdAt: "2026-08-10T00:00:00.000Z",
      });

      await claim(usage, "durable-cancel", "received");
      await usage.updateInvocation("durable-cancel", {
        status: "running",
        updatedAt: "2026-08-10T00:00:30.000Z",
      });
      const secondNodeUsage = usageAdapter(pool, "pricing-v1");
      assert.equal(await secondNodeUsage.isCancellationRequested("durable-cancel"), false);
      assert.equal((await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-durable-cancel",
        requestedAt: "2026-08-10T00:00:31.000Z",
      })).invocation?.id, "durable-cancel");
      assert.equal(await secondNodeUsage.isCancellationRequested("durable-cancel"), true);

      assert.deepEqual(await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-cancel-before-claim",
        requestedAt: "2026-08-10T00:00:32.000Z",
      }), {});
      await claim(usage, "cancel-before-claim", "received");
      assert.deepEqual(
        pickTerminal(await usage.getInvocation("cancel-before-claim")),
        { status: "failed", errorCode: "client_cancelled" },
      );

      await claim(usage, "cancel-before-reserve", "received");
      await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-cancel-before-reserve",
        requestedAt: "2026-08-10T00:00:33.000Z",
      });
      assert.deepEqual(
        pickTerminal(await usage.getInvocation("cancel-before-reserve")),
        { status: "failed", errorCode: "client_cancelled" },
      );
      const cancelledBeforeProvider = await entitlements.reserve({
        accountId: "alice",
        invocationId: "cancel-before-reserve",
        credits: 100,
      });
      assert.equal(cancelledBeforeProvider.granted, false);
      assert.equal((await entitlements.getAccount("alice"))?.availableCredits, 300);

      await claim(usage, "cancel-after-reserve", "received");
      const reservedBeforeCancellation = await entitlements.reserve({
        accountId: "alice",
        invocationId: "cancel-after-reserve",
        credits: 100,
      });
      assert.equal(reservedBeforeCancellation.granted, true);
      await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-cancel-after-reserve",
        requestedAt: "2026-08-10T00:00:34.000Z",
      });
      assert.deepEqual(
        pickTerminal(await usage.getInvocation("cancel-after-reserve")),
        { status: "received", errorCode: "client_cancelled" },
      );
      await expireAllReservations(pool);
      assert.deepEqual(await usage.recoverExpired({
        recoveredAt: "2026-08-10T00:01:00.000Z",
        limit: 10,
      }), {
        releasedBeforeProvider: 1,
        releasedDispatchPendingReconciliation: 0,
        chargedPendingReconciliation: 0,
      });
      assert.equal(
        (await usage.getInvocation("cancel-after-reserve"))?.errorCode,
        "client_cancelled",
      );
      assert.equal((await entitlements.getAccount("alice"))?.availableCredits, 300);

      await claim(usage, "before-provider", "received");
      await entitlements.reserve({
        accountId: "alice",
        invocationId: "before-provider",
        credits: 100,
      });
      await expireAllReservations(pool);
      assert.deepEqual(await usage.recoverExpired({
        recoveredAt: "2026-08-10T00:02:00.000Z",
        limit: 10,
      }), {
        releasedBeforeProvider: 1,
        releasedDispatchPendingReconciliation: 0,
        chargedPendingReconciliation: 0,
      });
      assert.equal((await entitlements.getAccount("alice"))?.availableCredits, 300);

      await claim(usage, "provider-dispatch-ambiguous", "received");
      const dispatching = await entitlements.reserve({
        accountId: "alice",
        invocationId: "provider-dispatch-ambiguous",
        credits: 100,
      });
      assert.equal(dispatching.granted, true);
      await usage.updateInvocation("provider-dispatch-ambiguous", {
        status: "dispatching",
        reservedCredits: 100,
        updatedAt: "2026-08-10T00:02:30.000Z",
      });
      await expireAllReservations(pool);
      assert.deepEqual(await usage.recoverExpired({
        recoveredAt: "2026-08-10T00:03:00.000Z",
        limit: 10,
      }), {
        releasedBeforeProvider: 0,
        releasedDispatchPendingReconciliation: 1,
        chargedPendingReconciliation: 0,
      });
      assert.equal((await entitlements.getAccount("alice"))?.availableCredits, 300);
      assert.equal(
        (await usage.getInvocation("provider-dispatch-ambiguous"))?.errorCode,
        "provider_dispatch_reconciliation_required",
      );
      assert.equal(
        await scalar(pool, `SELECT count(*) FROM llm_invocation_recovery_events
          WHERE invocation_id = 'provider-dispatch-ambiguous'
            AND resolution = 'released_dispatch_pending_reconciliation'`),
        1,
      );

      await claim(usage, "provider-started", "received");
      const running = await entitlements.reserve({
        accountId: "alice",
        invocationId: "provider-started",
        credits: 100,
      });
      assert.equal(running.granted, true);
      await usage.updateInvocation("provider-started", {
        status: "running",
        reservedCredits: 100,
        updatedAt: "2026-08-10T00:03:00.000Z",
      });
      await expireAllReservations(pool);
      assert.deepEqual(await usage.recoverExpired({
        recoveredAt: "2026-08-10T00:04:00.000Z",
        limit: 10,
      }), {
        releasedBeforeProvider: 0,
        releasedDispatchPendingReconciliation: 0,
        chargedPendingReconciliation: 1,
      });
      assert.deepEqual(await entitlements.getAccount("alice"), {
        availableCredits: 200,
        spentCredits: 100,
        resetAt: null,
      });
      assert.equal(
        await scalar(pool, `SELECT count(*) FROM llm_invocation_recovery_events
          WHERE invocation_id = 'provider-started'
            AND resolution = 'charged_pending_reconciliation'`),
        1,
      );

      await claim(usage, "atomic-finalize", "received");
      const finalReservation = await entitlements.reserve({
        accountId: "alice",
        invocationId: "atomic-finalize",
        credits: 100,
      });
      assert.equal(finalReservation.granted, true);
      if (!finalReservation.granted) return;
      await usage.updateInvocation("atomic-finalize", {
        status: "running",
        reservedCredits: 100,
        updatedAt: "2026-08-10T00:05:00.000Z",
      });

      const wrongPricing = usageAdapter(pool, "missing-pricing-version");
      await assert.rejects(
        wrongPricing.finalizeSuccess(finalizeInput(finalReservation.reservationId)),
      );
      assert.equal(
        await scalar(pool, `SELECT count(*) FROM llm_usage_events
          WHERE invocation_id = 'atomic-finalize'`),
        0,
      );
      assert.equal(
        await textScalar(pool, `SELECT status FROM llm_entitlement_reservations
          WHERE invocation_id = 'atomic-finalize'`),
        "reserved",
      );

      assert.deepEqual(
        await usage.finalizeSuccess(finalizeInput(finalReservation.reservationId)),
        { chargedCredits: 7, terminalStatus: "completed" },
      );
      assert.equal((await usage.getUsage("atomic-finalize"))?.chargedCredits, 7);
      assert.equal((await usage.getInvocation("atomic-finalize"))?.status, "completed");

      await claim(usage, "cancel-finalize-race", "received");
      const cancelledReservation = await entitlements.reserve({
        accountId: "alice",
        invocationId: "cancel-finalize-race",
        credits: 50,
      });
      assert.equal(cancelledReservation.granted, true);
      if (!cancelledReservation.granted) return;
      await usage.updateInvocation("cancel-finalize-race", {
        status: "running",
        reservedCredits: 50,
        updatedAt: "2026-08-10T00:07:00.000Z",
      });
      await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-cancel-finalize-race",
        requestedAt: "2026-08-10T00:07:01.000Z",
      });
      assert.deepEqual(await usage.finalizeSuccess({
        ...finalizeInput(cancelledReservation.reservationId),
        invocationId: "cancel-finalize-race",
      }), {
        chargedCredits: 7,
        terminalStatus: "failed",
        errorCode: "client_cancelled",
      });

      await claim(usage, "cancel-failure-race", "received");
      const failureRaceReservation = await entitlements.reserve({
        accountId: "alice",
        invocationId: "cancel-failure-race",
        credits: 50,
      });
      assert.equal(failureRaceReservation.granted, true);
      if (!failureRaceReservation.granted) return;
      await usage.updateInvocation("cancel-failure-race", {
        status: "running",
        reservedCredits: 50,
        updatedAt: "2026-08-10T00:09:00.000Z",
      });
      await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-cancel-failure-race",
        requestedAt: "2026-08-10T00:09:01.000Z",
      });
      assert.deepEqual(await usage.fail({
        invocationId: "cancel-failure-race",
        reservationId: failureRaceReservation.reservationId,
        failedAt: "2026-08-10T00:09:02.000Z",
        errorCode: "provider_unavailable",
      }), { errorCode: "client_cancelled" });
      assert.equal((await usage.getInvocation("cancel-failure-race"))?.errorCode, "client_cancelled");

      await claim(usage, "received-cancel-failure-race", "received");
      const receivedFailureRaceReservation = await entitlements.reserve({
        accountId: "alice",
        invocationId: "received-cancel-failure-race",
        credits: 50,
      });
      assert.equal(receivedFailureRaceReservation.granted, true);
      if (!receivedFailureRaceReservation.granted) return;
      await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-received-cancel-failure-race",
        requestedAt: "2026-08-10T00:09:03.000Z",
      });
      assert.equal(
        (await usage.getInvocation("received-cancel-failure-race"))?.status,
        "received",
      );
      assert.deepEqual(await usage.fail({
        invocationId: "received-cancel-failure-race",
        reservationId: receivedFailureRaceReservation.reservationId,
        failedAt: "2026-08-10T00:09:04.000Z",
        errorCode: "provider_unavailable",
      }), { errorCode: "client_cancelled" });
      assert.equal(
        (await usage.getInvocation("received-cancel-failure-race"))?.errorCode,
        "client_cancelled",
      );

      await claim(usage, "dispatch-cancel-finalize-race", "received");
      const dispatchCancelReservation = await entitlements.reserve({
        accountId: "alice",
        invocationId: "dispatch-cancel-finalize-race",
        credits: 50,
      });
      assert.equal(dispatchCancelReservation.granted, true);
      if (!dispatchCancelReservation.granted) return;
      await usage.updateInvocation("dispatch-cancel-finalize-race", {
        status: "dispatching",
        reservedCredits: 50,
        updatedAt: "2026-08-10T00:09:05.000Z",
      });
      await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-dispatch-cancel-finalize-race",
        requestedAt: "2026-08-10T00:09:06.000Z",
      });
      assert.equal(
        (await usage.getInvocation("dispatch-cancel-finalize-race"))?.status,
        "dispatching",
      );
      assert.deepEqual(await usage.finalizeSuccess({
        ...finalizeInput(dispatchCancelReservation.reservationId),
        invocationId: "dispatch-cancel-finalize-race",
      }), {
        chargedCredits: 7,
        terminalStatus: "failed",
        errorCode: "client_cancelled",
      });

      await claim(usage, "cancel-policy-race", "received");
      const policyRaceReservation = await entitlements.reserve({
        accountId: "alice",
        invocationId: "cancel-policy-race",
        credits: 50,
      });
      assert.equal(policyRaceReservation.granted, true);
      if (!policyRaceReservation.granted) return;
      await usage.updateInvocation("cancel-policy-race", {
        status: "running",
        reservedCredits: 50,
        updatedAt: "2026-08-10T00:08:00.000Z",
      });
      await usage.requestCancellation({
        ownerAccountId: "alice",
        idempotencyFingerprint: "idem-cancel-policy-race",
        requestedAt: "2026-08-10T00:08:01.000Z",
      });
      assert.deepEqual(await usage.finalizeSuccess({
        ...finalizeInput(policyRaceReservation.reservationId),
        invocationId: "cancel-policy-race",
        terminalStatus: "failed",
        errorCode: "provider_usage_exceeded_limits",
      }), {
        chargedCredits: 7,
        terminalStatus: "failed",
        errorCode: "client_cancelled",
      });
    } finally {
      await pool.end();
    }
  },
);

function usageAdapter(pool: Pool, pricingVersionId: string): PostgresLlmUsageAdapter {
  return new PostgresLlmUsageAdapter(pool, {
    routes: {
      "maxpower/coach-v1": {
        providerId: "provider",
        providerModel: "model",
        pricingVersionId,
      },
    },
  });
}

function pickTerminal(invocation: Awaited<ReturnType<PostgresLlmUsageAdapter["getInvocation"]>>) {
  return invocation === undefined
    ? undefined
    : { status: invocation.status, errorCode: invocation.errorCode };
}

function pricing(pricingVersionId: string) {
  return {
    pricingVersionId,
    alias: "maxpower/coach-v1" as const,
    providerId: "provider",
    providerModel: "model",
    inputCreditsPerMillionTokens: 1,
    outputCreditsPerMillionTokens: 1,
    inputCostMicrosPerMillionTokens: 1,
    outputCostMicrosPerMillionTokens: 1,
    effectiveFrom: "1970-01-01T00:00:00.000Z",
    effectiveTo: null,
  };
}

function finalizeInput(reservationId: string) {
  return {
    reservationId,
    invocationId: "atomic-finalize",
    ownerAccountId: "alice",
    alias: "maxpower/coach-v1" as const,
    usageBasis: "provider_reported" as const,
    inputTokens: 4,
    outputTokens: 3,
    totalTokens: 7,
    cachedInputTokens: 0,
    imageTokens: 0,
    providerCredits: 7,
    providerCostMicros: 3,
    chargedCredits: 7,
    recordedAt: "2026-08-10T00:06:00.000Z",
    terminalStatus: "completed" as const,
  };
}

async function claim(
  usage: PostgresLlmUsageAdapter,
  invocationId: string,
  status: "received",
): Promise<void> {
  await usage.claimInvocation({
    id: invocationId,
    ownerAccountId: "alice",
    alias: "maxpower/coach-v1",
    stream: false,
    idempotencyFingerprint: `idem-${invocationId}`,
    requestFingerprint: `request-${invocationId}`,
    status,
    reservedCredits: 0,
    settledCredits: 0,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  });
}

async function expireAllReservations(pool: Pool): Promise<void> {
  await pool.query(
    `UPDATE llm_entitlement_reservations
        SET lease_expires_at = '2026-08-09T00:00:00.000Z'
      WHERE status = 'reserved'`,
  );
}

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS maxpower CASCADE");
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("GRANT ALL ON SCHEMA public TO public");
  for (const migration of ["010-better-auth.sql", "040-llm-entitlements.sql"]) {
    await pool.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  await pool.query(
    `INSERT INTO "user"
      (id, name, email, "emailVerified", "accountStatus", scopes, "registrationComplete")
     VALUES ('alice', 'Alice', 'alice@example.invalid', true, 'active', 'llm:invoke', true)`,
  );
}

function sequentialIds() {
  let sequence = 0;
  return (prefix: string): string => `${prefix}_${sequence += 1}`;
}

async function scalar(pool: Pool, sql: string): Promise<number> {
  const result = await pool.query<{ value: string }>(`SELECT (${sql})::text AS value`);
  return Number(result.rows[0]?.value);
}

async function textScalar(pool: Pool, sql: string): Promise<string> {
  const result = await pool.query<{ value: string }>(`SELECT (${sql})::text AS value`);
  const value = result.rows[0]?.value;
  if (value === undefined) throw new ApiError(500, "missing_test_value", "Missing test value.");
  return value;
}
