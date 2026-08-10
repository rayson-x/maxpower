import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { AccountRuntimeCoordinator } from "../../src/mobile/auth/AccountRuntimeCoordinator";
import type { AccountRuntime } from "../../src/mobile/auth/model";
import {
  CloudProductDataClient,
  CloudProductDataCoordinator,
  InMemoryCloudProductDataCache,
  type CloudCanonicalProjection,
  type CloudJsonObject,
  type CloudPlan,
} from "../../src/mobile/product-data";

interface AcceptanceRuntime extends AccountRuntime {
  application: CoachApplication;
  cloud: CloudProductDataCoordinator;
}

test("A→B→A keeps local Coach conversations and cloud plans inside their account namespaces", async () => {
  const ledgers = new Map<string, InMemoryCoachLedger>();
  const cloudPlans = new Map<string, CloudPlan[]>();
  const sequences = new Map<string, number>();
  const runtimes = new AccountRuntimeCoordinator<AcceptanceRuntime>({
    async create(input) {
      const ledger = ledgers.get(input.accountId) ?? new InMemoryCoachLedger();
      ledgers.set(input.accountId, ledger);
      const application = new CoachApplication({
        ledger,
        authenticatedAccountId: input.accountId,
        runtime: {
          now: () => "2026-08-10T12:00:00.000Z",
          nextId(prefix) {
            const next = (sequences.get(input.accountId) ?? 0) + 1;
            sequences.set(input.accountId, next);
            return `${prefix}-${input.accountId}-${next}`;
          },
        },
      });
      const cloud = new CloudProductDataCoordinator({
        accountId: input.accountId,
        client: new CloudProductDataClient({
          baseUrl: "https://api.maxpower.example",
          accessToken: input.accessToken,
          now: () => "2026-08-10T12:00:00.000Z",
          fetch: cloudBackend(input.accountId, cloudPlans),
        }),
        cache: new InMemoryCloudProductDataCache(),
        signal: input.signal,
      });
      await cloud.bootstrap(input.signal);
      return {
        accountId: input.accountId,
        application,
        cloud,
        async dispose() { cloud.dispose(); },
      };
    },
  });

  const alice = await runtimes.activate({ accountId: "account-a", accessToken: () => "jwt-a" });
  await seedCoach(alice.application, alice.accountId, "Alice plan");
  const aliceSession = await alice.application.startSession({
    userId: alice.accountId,
    context: { kind: "today", ref: "2026-08-10" },
  });
  await alice.application.sendCoachTurn({ sessionId: aliceSession.id, text: "Alice private turn" });
  await alice.cloud.createPlan({
    title: "Alice cloud plan",
    snapshot: { owner: "alice" },
    idempotencyKey: "alice-plan",
  });

  const bob = await runtimes.activate({ accountId: "account-b", accessToken: () => "jwt-b" });
  assert.deepEqual(await bob.application.listCoachSessions({ userId: bob.accountId }), []);
  assert.deepEqual(bob.cloud.currentProjection()?.plans, []);
  await seedCoach(bob.application, bob.accountId, "Bob plan");
  const bobSession = await bob.application.startSession({
    userId: bob.accountId,
    context: { kind: "today", ref: "2026-08-10" },
  });
  await bob.application.sendCoachTurn({ sessionId: bobSession.id, text: "Bob private turn" });

  const restoredAlice = await runtimes.activate({ accountId: "account-a", accessToken: () => "jwt-a-2" });
  const restoredSessions = await restoredAlice.application.listCoachSessions({ userId: "account-a" });
  assert.deepEqual(restoredSessions.map(({ id }) => id), [aliceSession.id]);
  const restoredConversation = await restoredAlice.application.readSessionProjection(aliceSession.id);
  assert.match(JSON.stringify(restoredConversation.messages), /Alice private turn/);
  assert.doesNotMatch(JSON.stringify(restoredConversation.messages), /Bob private turn/);
  assert.deepEqual(restoredAlice.cloud.currentProjection()?.plans.map(({ title }) => title), [
    "Alice cloud plan",
  ]);

  await runtimes.stop();
});

async function seedCoach(application: CoachApplication, userId: string, title: string): Promise<void> {
  await application.seedUserState({
    userId,
    profile: { goal: "strength", trainingExperience: "beginner" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-10",
      title,
      tasks: [],
    },
  });
}

function cloudBackend(
  accountId: string,
  plansByAccount: Map<string, CloudPlan[]>,
): NonNullable<ConstructorParameters<typeof CloudProductDataClient>[0]["fetch"]> {
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const plans = plansByAccount.get(accountId) ?? [];
    if (init.method === "POST" && path === "/v1/plans") {
      const body = JSON.parse(String(init.body)) as { title: string; snapshot: CloudJsonObject };
      const plan: CloudPlan = {
        id: `plan-${accountId}-${plans.length + 1}`,
        accountId,
        title: body.title,
        status: "draft",
        currentVersionId: `plan-version-${accountId}-${plans.length + 1}`,
        publishedVersionId: null,
        revision: 1,
        createdAt: "2026-08-10T12:00:00.000Z",
        updatedAt: "2026-08-10T12:00:00.000Z",
        versions: [{
          id: `plan-version-${accountId}-${plans.length + 1}`,
          planId: `plan-${accountId}-${plans.length + 1}`,
          number: 1,
          snapshot: body.snapshot,
          createdAt: "2026-08-10T12:00:00.000Z",
          publishedAt: null,
        }],
      };
      plansByAccount.set(accountId, [...plans, plan]);
      return json(plan, 201);
    }
    if (path === "/v1/me") return json(profileProjection(accountId).profile);
    if (path === "/v1/plans") return json({ data: plans, nextCursor: null });
    if (path === "/v1/workout-sessions" || path === "/v1/results") {
      return json({ data: [], nextCursor: null });
    }
    return json({ error: { code: "not_found" } }, 404);
  };
}

function profileProjection(accountId: string): CloudCanonicalProjection {
  return {
    accountId,
    profile: {
      accountId,
      data: {},
      displayName: accountId,
      locale: "en-US",
      timeZone: "UTC",
      unitSystem: "metric",
      revision: 1,
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T12:00:00.000Z",
    },
    plans: [],
    workoutSessions: [],
    results: [],
    fetchedAt: "2026-08-10T12:00:00.000Z",
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
