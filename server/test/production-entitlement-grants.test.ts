import assert from "node:assert/strict";
import test from "node:test";

import type { Principal } from "../src/kernel/principal.js";
import {
  MonthlyFreeGrantLlmGateway,
  grantAdministrativeCredits,
} from "../src/runtime/production/entitlement-grants.js";

const principal: Principal = {
  accountId: "account_123",
  sessionId: "session_123",
  status: "active",
  scopes: new Set(["llm:invoke"]),
};

test("monthly free credits are granted idempotently before the first LLM operation", async () => {
  const grants: unknown[] = [];
  const calls: string[] = [];
  const gateway = new MonthlyFreeGrantLlmGateway({
    gateway: {
      async invoke() {
        calls.push("invoke");
        return { kind: "complete", invocationId: "llmi_1", response: {} };
      },
      async resume() { throw new Error("not used"); },
      async cancel() { return { status: "cancel_requested", invocationId: "llmi_1" }; },
      async getEntitlement() {
        calls.push("entitlement");
        return { availableCredits: 250, spentCredits: 0, resetAt: null };
      },
    },
    grants: {
      async grant(input) {
        grants.push(input);
        return {
          created: grants.length === 1,
          account: { availableCredits: 250, spentCredits: 0, resetAt: null },
        };
      },
    },
    monthlyCredits: 250,
    now: () => new Date("2026-08-10T12:34:56.000Z"),
  });

  await gateway.getEntitlement(principal);
  await gateway.invoke(principal, {
    idempotencyKey: "invoke-1",
    request: { model: "maxpower/coach-v1", messages: [] },
  });

  assert.equal(grants.length, 2);
  assert.deepEqual(grants[0], grants[1]);
  const firstGrant = grants[0] as Record<string, unknown>;
  assert.deepEqual(firstGrant, {
    grantId: firstGrant.grantId,
    accountId: "account_123",
    kind: "free_monthly",
    credits: 250,
    resetAt: "2026-09-01T00:00:00.000Z",
    sourceRef: "monthly-free:2026-08",
    createdAt: "2026-08-10T12:34:56.000Z",
  });
  assert.match(String(firstGrant.grantId), /^llmgrant_[a-f0-9]{32}$/);
  assert.deepEqual(calls, ["entitlement", "invoke"]);
});

test("invalid principals do not receive credits before authorization rejects them", async () => {
  let grantCount = 0;
  const gateway = new MonthlyFreeGrantLlmGateway({
    gateway: {
      async invoke() { throw new Error("unauthorized"); },
      async resume() { throw new Error("unauthorized"); },
      async cancel() { throw new Error("unauthorized"); },
      async getEntitlement() { throw new Error("unauthorized"); },
    },
    grants: {
      async grant() {
        grantCount += 1;
        throw new Error("must not grant");
      },
    },
    monthlyCredits: 250,
  });

  await assert.rejects(() => gateway.getEntitlement(undefined));
  await assert.rejects(() => gateway.invoke({ ...principal, status: "pending_deletion" }, {
    idempotencyKey: "x",
    request: { model: "maxpower/coach-v1", messages: [] },
  }));
  assert.equal(grantCount, 0);
});

test("admin grants use a deterministic idempotency key and are not an HTTP surface", async () => {
  const grants: unknown[] = [];
  const result = await grantAdministrativeCredits({
    grants: {
      async grant(input) {
        grants.push(input);
        return {
          created: true,
          account: { availableCredits: 900, spentCredits: 0, resetAt: null },
        };
      },
    },
    accountId: "account_123",
    credits: 900,
    sourceRef: "support-case-456",
    now: new Date("2026-08-10T12:34:56.000Z"),
  });

  assert.equal(result.created, true);
  const firstGrant = grants[0] as Record<string, unknown>;
  assert.deepEqual(firstGrant, {
    grantId: firstGrant.grantId,
    accountId: "account_123",
    kind: "admin",
    credits: 900,
    resetAt: null,
    sourceRef: "admin:support-case-456",
    createdAt: "2026-08-10T12:34:56.000Z",
  });
  assert.match(String(firstGrant.grantId), /^llmgrant_[a-f0-9]{32}$/);
});
