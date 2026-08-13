import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { AccountRuntimeCoordinator } from "../../src/mobile/auth/AccountRuntimeCoordinator";
import { OnlineAuthController } from "../../src/mobile/auth/OnlineAuthController";
import {
  SecureSessionVault,
  DeletionRecoveryVault,
  MemoryServiceAccessTokenStore,
  SocialExchangeBindingVault,
  activeSessionCredentialKey,
  socialExchangeBindingCredentialKey,
  accountDeletionRecoveryCredentialKey,
} from "../../src/mobile/auth/SecureSessionVault";
import { ServerAuthClient } from "../../src/mobile/auth/ServerAuthClient";
import {
  OnlineAuthError,
  availableSocialProviders,
  type AccountRuntime,
  type AuthenticatedIdentity,
  type OnlineAuthApi,
  type SocialAuthorizationPort,
} from "../../src/mobile/auth/model";
import { accountDatabaseName } from "../../src/mobile/native/accountDatabaseName";
import { assertAccountDatabaseOwner } from "../../src/mobile/native/accountDatabaseOwner";
import {
  legacySecureCredentialStorageKey,
  secureCredentialStorageKey,
} from "../../src/mobile/security/credentialNamespace";
import type { SecureCredentialKey, SecureCredentialPort, SecureCredentialReadResult } from "../../src/privacy/model";

const ALICE: AuthenticatedIdentity = {
  status: "authenticated",
  accountId: "account-alice",
  sessionId: "session-alice",
  displayName: "Alice",
  sessionToken: "opaque-session-alice",
  accessToken: "service-jwt-alice",
  expiresAt: "2026-08-10T12:05:00.000Z",
};

const BOB: AuthenticatedIdentity = {
  status: "authenticated",
  accountId: "account-bob",
  sessionId: "session-bob",
  displayName: "Bob",
  sessionToken: "opaque-session-bob",
  accessToken: "service-jwt-bob",
  expiresAt: "2026-08-10T12:05:00.000Z",
};

test("custom auth client calls only stable HTTPS server routes", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    new Response(JSON.stringify({
      realm: "global",
      requiredTermsVersion: "terms-2026-08",
      socialProviders: ["google", "apple"],
    }), { status: 200 }),
    new Response(JSON.stringify({
      realm: "global",
      requiredTermsVersion: "terms-2026-08",
      socialProviders: ["google", "apple"],
    }), { status: 200 }),
    new Response(JSON.stringify(ALICE), { status: 200 }),
    new Response(JSON.stringify(ALICE), { status: 200 }),
    new Response(null, { status: 204 }),
  ];
  const client = new ServerAuthClient({
    baseUrl: "https://api.maxpower.example/base/path",
    fetch: async (url, init) => {
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      const response = responses.shift();
      if (!response) throw new Error("unexpected_request");
      return response;
    },
  });

  await client.assertReachable();
  assert.deepEqual(await client.getPublicConfiguration(), {
    realm: "global",
    requiredTermsVersion: "terms-2026-08",
    socialProviders: ["google", "apple"],
  });
  assert.deepEqual(
    await client.loginWithPassword({
      identifier: { kind: "email", value: " Alice@Example.COM " },
      password: "correct horse battery staple",
    }),
    ALICE,
  );
  await client.refreshSession("opaque-session-alice");
  await client.signOut("opaque-session-alice");

  assert.deepEqual(requests.map(({ url }) => url), [
    "https://api.maxpower.example/v1/auth/config",
    "https://api.maxpower.example/v1/auth/config",
    "https://api.maxpower.example/v1/auth/login/password",
    "https://api.maxpower.example/v1/auth/refresh",
    "https://api.maxpower.example/v1/auth/logout",
  ]);
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
    identifier: { kind: "email", value: "alice@example.com" },
    password: "correct horse battery staple",
  });
  assert.deepEqual(JSON.parse(String(requests[3]?.init?.body)), {
    sessionToken: "opaque-session-alice",
  });
  assert.equal(new Headers(requests[3]?.init?.headers).has("authorization"), false);
  assert.deepEqual(JSON.parse(String(requests[4]?.init?.body)), {
    sessionToken: "opaque-session-alice",
  });
  assert.equal(new Headers(requests[4]?.init?.headers).has("authorization"), false);
  assert.throws(
    () => new ServerAuthClient({ baseUrl: "http://api.maxpower.example", fetch: async () => new Response() }),
    /https/i,
  );
});

test("custom auth client allows an HTTP origin only when debug transport is explicitly enabled", async () => {
  const requests: string[] = [];
  const client = new ServerAuthClient({
    baseUrl: "http://54.151.241.139:3000",
    allowInsecureHttp: true,
    fetch: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify({
        realm: "global",
        requiredTermsVersion: "terms-v1",
        socialProviders: ["google", "apple"],
      }), { status: 200 });
    },
  });

  await client.assertReachable();
  assert.deepEqual(requests, ["http://54.151.241.139:3000/v1/auth/config"]);
});

test("custom social auth exchanges a one-time code and never puts a reusable credential in the deep link", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let exchangeAttempts = 0;
  const client = new ServerAuthClient({
    baseUrl: "https://api.maxpower.example",
    socialExchangeBinding: async () => "a".repeat(64),
    fetch: async (url, init) => {
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      if (url.endsWith("/v1/auth/social/start")) {
        return new Response(JSON.stringify({
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=provider-state",
          exchangeState: "app-bound-exchange-state",
        }), { status: 200 });
      }
      if (url.endsWith("/v1/auth/social/exchange")) {
        const body = JSON.parse(String(init?.body)) as { deviceBinding?: string };
        if (body.deviceBinding !== "a".repeat(64)) {
          return new Response(JSON.stringify({
            error: { code: "social_exchange_invalid", message: "Exchange binding is invalid." },
          }), { status: 409 });
        }
        exchangeAttempts += 1;
        return exchangeAttempts === 1
          ? new Response(JSON.stringify({ sessionToken: "opaque-social-session" }), { status: 200 })
          : new Response(JSON.stringify({
              error: { code: "social_exchange_consumed", message: "Exchange code is invalid or already consumed." },
            }), { status: 409 });
      }
      throw new Error("unexpected_request");
    },
  });

  const started = await client.startSocialSignIn({
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
  });
  assert.deepEqual(started, {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=provider-state",
    exchangeState: "app-bound-exchange-state",
  });

  const callbackUrl = new URL("maxpower://auth/callback");
  callbackUrl.searchParams.set("code", "single-use-exchange-code");
  callbackUrl.searchParams.set("state", started.exchangeState);
  assert.deepEqual(await client.exchangeSocialCallback({
    callbackUrl: callbackUrl.toString(),
    expectedCallbackUrl: "maxpower://auth/callback",
    expectedExchangeState: started.exchangeState,
  }), { sessionToken: "opaque-social-session" });

  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: "a".repeat(64),
  });
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    code: "single-use-exchange-code",
    state: "app-bound-exchange-state",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: "a".repeat(64),
  });
  assert.doesNotMatch(callbackUrl.toString(), /cookie|session|token/i);
  assert.equal(new Headers(requests[1]?.init?.headers).has("cookie"), false);

  await assert.rejects(
    () => client.exchangeSocialCallback({
      callbackUrl: callbackUrl.toString(),
      expectedCallbackUrl: "maxpower://auth/callback",
      expectedExchangeState: started.exchangeState,
    }),
    /already consumed/i,
  );
  await assert.rejects(
    () => client.exchangeSocialCallback({
      callbackUrl: "maxpower://evil/callback?code=x&state=app-bound-exchange-state",
      expectedCallbackUrl: "maxpower://auth/callback",
      expectedExchangeState: started.exchangeState,
    }),
    /unexpected callback/i,
  );
  await assert.rejects(
    () => client.exchangeSocialCallback({
      callbackUrl: "maxpower://auth/callback?code=x&state=wrong-state",
      expectedCallbackUrl: "maxpower://auth/callback",
      expectedExchangeState: started.exchangeState,
    }),
    /state/i,
  );
  await assert.rejects(
    () => client.exchangeSocialCallback({
      callbackUrl: "maxpower://auth/callback?code=x&state=app-bound-exchange-state&cookie=forbidden",
      expectedCallbackUrl: "maxpower://auth/callback",
      expectedExchangeState: started.exchangeState,
    }),
    /unexpected callback parameter/i,
  );
  const hijackingClient = new ServerAuthClient({
    baseUrl: "https://api.maxpower.example",
    socialExchangeBinding: async () => "b".repeat(64),
    fetch: async (url, init) => {
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      const body = JSON.parse(String(init?.body)) as { deviceBinding?: string };
      return body.deviceBinding === "a".repeat(64)
        ? new Response(JSON.stringify({ sessionToken: "must-not-happen" }))
        : new Response(JSON.stringify({
            error: { code: "social_exchange_invalid", message: "Exchange binding is invalid." },
          }), { status: 409 });
    },
  });
  await assert.rejects(
    () => hijackingClient.exchangeSocialCallback({
      callbackUrl: callbackUrl.toString(),
      expectedCallbackUrl: "maxpower://auth/callback",
      expectedExchangeState: started.exchangeState,
    }),
    /binding is invalid/i,
  );
});

test("authenticated account controls link identities and use a high-entropy deletion recovery key", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ServerAuthClient({
    baseUrl: "https://api.maxpower.example",
    fetch: async (url, init) => {
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      if (url.endsWith("/api/auth/list-accounts")) {
        return Response.json([{ id: "identity-google", providerId: "google", accountId: "google-sub", userId: ALICE.accountId, scopes: [] }]);
      }
      if (url.endsWith("/api/auth/link-social")) {
        return Response.json({ url: "https://accounts.google.com/link", redirect: true });
      }
      if (url.endsWith("/api/auth/unlink-account")) return Response.json({ status: true });
      if (url.endsWith("/v1/me/deletion") && init?.method === "POST") {
        return Response.json({
          id: "delete-job",
          deletionReceipt: "server-generated-receipt",
          status: "pending",
          requestedAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z",
          attempts: 0,
          completedAt: null,
          lastErrorCode: null,
        }, { status: 202 });
      }
      if (url.endsWith("/v1/me/deletion")) {
        return Response.json({
          id: "delete-job",
          status: "completed",
          requestedAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:01:00.000Z",
          attempts: 1,
          completedAt: "2026-08-10T00:01:00.000Z",
          lastErrorCode: null,
        });
      }
      throw new Error("unexpected_request");
    },
  });

  assert.equal((await client.listLinkedIdentities(ALICE.sessionToken))[0]?.providerId, "google");
  assert.equal((await client.startSocialIdentityLink({
    sessionToken: ALICE.sessionToken,
    provider: "google",
    callbackUrl: "maxpower://auth/link-callback",
  })).authorizationUrl, "https://accounts.google.com/link");
  await client.unlinkIdentity({ sessionToken: ALICE.sessionToken, providerId: "google", accountId: "google-sub" });
  const requestKey = "d".repeat(64);
  const deletion = await client.requestAccountDeletion({
    accessToken: ALICE.accessToken,
    idempotencyKey: requestKey,
  });
  assert.equal(deletion.deletionReceipt, "server-generated-receipt");
  assert.equal((await client.getAccountDeletion("server-generated-receipt")).status, "completed");

  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
    "/api/auth/list-accounts",
    "/api/auth/link-social",
    "/api/auth/unlink-account",
    "/v1/me/deletion",
    "/v1/me/deletion",
  ]);
  for (const request of requests.slice(0, 3)) {
    assert.equal(new Headers(request.init?.headers).get("authorization"), `Bearer ${ALICE.sessionToken}`);
  }
  assert.equal(new Headers(requests[3]?.init?.headers).get("authorization"), `Bearer ${ALICE.accessToken}`);
  assert.equal(new Headers(requests[3]?.init?.headers).get("idempotency-key"), requestKey);
  assert.equal(new Headers(requests[4]?.init?.headers).get("deletion-receipt"), "server-generated-receipt");
});

test("deletion recovery vault persists only a random request capability and server receipt", async () => {
  const credentials = new InMemorySecureCredentialPort();
  const vault = new DeletionRecoveryVault(credentials, () => new Uint8Array(32).fill(0xab));
  const started = await vault.start();
  assert.equal(started.requestKey, "ab".repeat(32));
  assert.equal(started.receipt, null);
  await vault.saveReceipt("server-receipt");
  assert.deepEqual(await vault.read(), {
    requestKey: "ab".repeat(32),
    receipt: "server-receipt",
  });
  assert.equal((await credentials.get({ key: accountDeletionRecoveryCredentialKey })).status, "available");
  await vault.clear();
  assert.equal(await vault.read(), null);
});

test("SecureSessionVault persists only the opaque session credential", async () => {
  const credentials = new InMemorySecureCredentialPort();
  const vault = new SecureSessionVault(credentials);

  await vault.write({ accountId: ALICE.accountId, sessionToken: ALICE.sessionToken });

  assert.deepEqual(await vault.read(), {
    accountId: ALICE.accountId,
    sessionToken: ALICE.sessionToken,
  });
  const stored = await credentials.get({ key: activeSessionCredentialKey });
  assert.equal(stored.status, "available");
  if (stored.status !== "available") return;
  assert.doesNotMatch(stored.value, /service-jwt|accessToken|expiresAt/);

  await vault.clear();
  assert.equal(await vault.read(), null);
});

test("social exchange device binding is random, SecureStore-only, and stable for the install", async () => {
  const credentials = new InMemorySecureCredentialPort();
  let randomCalls = 0;
  const vault = new SocialExchangeBindingVault(credentials, (bytes) => {
    randomCalls += 1;
    return Uint8Array.from({ length: bytes }, (_, index) => index);
  });

  const first = await vault.readOrCreate();
  const second = await vault.readOrCreate();

  assert.equal(first, "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  assert.equal(second, first);
  assert.equal(randomCalls, 1);
  const stored = await credentials.get({ key: socialExchangeBindingCredentialKey });
  assert.deepEqual(stored, { status: "available", value: first });
});

test("offline bootstrap never restores a session or creates product runtime", async () => {
  const events: string[] = [];
  const credentials = new InMemorySecureCredentialPort();
  const vault = new SecureSessionVault(credentials);
  await vault.write({ accountId: ALICE.accountId, sessionToken: ALICE.sessionToken });
  const controller = createController({
    vault,
    reachability: async () => {
      events.push("reachability");
      throw new TypeError("network down");
    },
    refresh: async () => {
      events.push("refresh");
      return ALICE;
    },
    createRuntime: async ({ accountId }) => {
      events.push(`create:${accountId}`);
      return runtime(accountId, events);
    },
  });

  await controller.bootstrap();

  assert.equal(controller.currentState().status, "offline");
  assert.deepEqual(events, ["reachability"]);
  assert.equal(controller.serviceAccessTokens.current(), null);
});

test("signed-out bootstrap does not create a product runtime", async () => {
  const events: string[] = [];
  const controller = createController({
    vault: new SecureSessionVault(new InMemorySecureCredentialPort()),
    reachability: async () => {
      events.push("reachability");
    },
    refresh: async () => {
      events.push("refresh");
      return ALICE;
    },
    createRuntime: async ({ accountId }) => {
      events.push(`create:${accountId}`);
      return runtime(accountId, events);
    },
  });

  await controller.bootstrap();

  assert.equal(controller.currentState().status, "signed_out");
  assert.deepEqual(events, ["reachability"]);
});

test("online bootstrap refreshes SecureStore session, keeps JWT in memory, and scopes runtime to accountId", async () => {
  const events: string[] = [];
  const credentials = new InMemorySecureCredentialPort();
  const vault = new SecureSessionVault(credentials);
  await vault.write({ accountId: ALICE.accountId, sessionToken: ALICE.sessionToken });
  const controller = createController({
    vault,
    reachability: async () => {
      events.push("reachability");
    },
    refresh: async (sessionToken) => {
      events.push(`refresh:${sessionToken}`);
      return ALICE;
    },
    createRuntime: async ({ accountId, accessToken }) => {
      events.push(`create:${accountId}:${accessToken()}`);
      return runtime(accountId, events);
    },
  });

  await controller.bootstrap();

  const state = controller.currentState();
  assert.equal(state.status, "authenticated");
  if (state.status !== "authenticated") return;
  assert.equal(state.identity.accountId, ALICE.accountId);
  assert.equal(state.runtime.accountId, ALICE.accountId);
  assert.equal(controller.serviceAccessTokens.current()?.accessToken, ALICE.accessToken);
  assert.deepEqual(events, [
    "reachability",
    `refresh:${ALICE.sessionToken}`,
    `create:${ALICE.accountId}:${ALICE.accessToken}`,
  ]);
  const raw = await credentials.get({ key: activeSessionCredentialKey });
  assert.equal(raw.status, "available");
  if (raw.status === "available") assert.doesNotMatch(raw.value, /service-jwt/);
});

test("account switch disposes the old runtime before publishing the new account", async () => {
  const events: string[] = [];
  const vault = new SecureSessionVault(new InMemorySecureCredentialPort());
  let passwordLogin = ALICE;
  const controller = createController({
    vault,
    reachability: async () => {
      events.push("reachability");
    },
    login: async () => passwordLogin,
    createRuntime: async ({ accountId, accessToken }) => {
      events.push(`create:${accountId}:${accessToken()}`);
      return runtime(accountId, events);
    },
  });

  await controller.loginWithPassword({
    identifier: { kind: "email", value: "alice@example.com" },
    password: "password-alice",
  });
  passwordLogin = BOB;
  await controller.loginWithPassword({
    identifier: { kind: "phone", value: "+14155550123" },
    password: "password-bob",
  });

  assert.deepEqual(events, [
    "reachability",
    `create:${ALICE.accountId}:${ALICE.accessToken}`,
    "reachability",
    `dispose:${ALICE.accountId}`,
    `create:${BOB.accountId}:${BOB.accessToken}`,
  ]);
  assert.equal(controller.currentState().status, "authenticated");
  assert.equal(controller.serviceAccessTokens.current()?.accountId, BOB.accountId);
  assert.deepEqual(await vault.read(), { accountId: BOB.accountId, sessionToken: BOB.sessionToken });
});

test("social login activates an existing account after the browser callback exchange", async () => {
  const events: string[] = [];
  const controller = createController({
    vault: new SecureSessionVault(new InMemorySecureCredentialPort()),
    reachability: async () => {
      events.push("reachability");
    },
    socialStart: async ({ provider, callbackUrl }) => {
      events.push(`start:${provider}:${callbackUrl}`);
      return {
        authorizationUrl: "https://accounts.google.example/authorize",
        exchangeState: "exchange-state",
      };
    },
    socialExchange: async ({ callbackUrl, expectedExchangeState }) => {
      events.push(`exchange:${callbackUrl}:${expectedExchangeState}`);
      return { sessionToken: "opaque-social-session" };
    },
    refresh: async (sessionToken) => {
      events.push(`refresh:${sessionToken}`);
      return ALICE;
    },
    createRuntime: async ({ accountId }) => {
      events.push(`create:${accountId}`);
      return runtime(accountId, events);
    },
  });

  assert.deepEqual(
    await controller.signInWithSocial("google", socialAuthorizationStub(events)),
    { status: "authenticated" },
  );
  assert.equal(controller.currentState().status, "authenticated");
  assert.deepEqual(events, [
    "reachability",
    "start:google:maxpower://auth/callback",
    "authorize:https://accounts.google.example/authorize",
    "exchange:maxpower://auth/callback?code=callback-code&state=exchange-state:exchange-state",
    "refresh:opaque-social-session",
    `create:${ALICE.accountId}`,
  ]);
});

test("first social login returns onboarding state, then accepts nickname and server terms", async () => {
  const events: string[] = [];
  let completed: Parameters<OnlineAuthApi["completeSocialOnboarding"]>[0] | undefined;
  const controller = createController({
    vault: new SecureSessionVault(new InMemorySecureCredentialPort()),
    reachability: async () => undefined,
    socialStart: async () => ({
      authorizationUrl: "https://accounts.apple.example/authorize",
      exchangeState: "exchange-state",
    }),
    socialExchange: async () => ({ sessionToken: "new-social-session" }),
    refresh: async () => {
      throw new OnlineAuthError("not_authenticated");
    },
    socialComplete: async (input) => {
      completed = input;
      return ALICE;
    },
    createRuntime: async ({ accountId }) => runtime(accountId, events),
  });

  const result = await controller.signInWithSocial("apple", socialAuthorizationStub(events));
  assert.deepEqual(result, { status: "onboarding_required", sessionToken: "new-social-session" });
  assert.equal(controller.currentState().status, "signed_out");
  assert.equal(controller.serviceAccessTokens.current(), null);
  await controller.completeSocialOnboarding({
    sessionToken: result.status === "onboarding_required" ? result.sessionToken : "",
    displayName: "Alice",
    termsVersion: "terms-from-server-config",
  });
  assert.deepEqual(completed, {
    sessionToken: "new-social-session",
    displayName: "Alice",
    termsVersion: "terms-from-server-config",
  });
  assert.equal(controller.currentState().status, "authenticated");
});

test("network loss removes an authenticated product runtime but retains the opaque session for retry", async () => {
  const events: string[] = [];
  const vault = new SecureSessionVault(new InMemorySecureCredentialPort());
  let online = true;
  const controller = createController({
    vault,
    login: async () => ALICE,
    reachability: async () => {
      events.push("reachability");
      if (!online) throw new TypeError("offline");
    },
    createRuntime: async ({ accountId }) => {
      events.push(`create:${accountId}`);
      return runtime(accountId, events);
    },
  });
  await controller.loginWithPassword({
    identifier: { kind: "email", value: "alice@example.com" },
    password: "password-alice",
  });

  online = false;
  await controller.ensureReachable();

  assert.equal(controller.currentState().status, "offline");
  assert.equal(controller.serviceAccessTokens.current(), null);
  assert.deepEqual(await vault.read(), { accountId: ALICE.accountId, sessionToken: ALICE.sessionToken });
  assert.deepEqual(events, [
    "reachability",
    `create:${ALICE.accountId}`,
    "reachability",
    `dispose:${ALICE.accountId}`,
  ]);
});

test("expiring service JWT refreshes in memory without rebuilding the account runtime", async () => {
  const events: string[] = [];
  const expired = { ...ALICE, accessToken: "expired-service-jwt", expiresAt: "2000-01-01T00:00:00.000Z" };
  const refreshed = { ...ALICE, accessToken: "fresh-service-jwt", expiresAt: "2099-01-01T00:00:00.000Z" };
  const controller = createController({
    vault: new SecureSessionVault(new InMemorySecureCredentialPort()),
    login: async () => expired,
    refresh: async (sessionToken) => {
      events.push(`refresh:${sessionToken}`);
      return refreshed;
    },
    reachability: async () => {
      events.push("reachability");
    },
    createRuntime: async ({ accountId, accessToken }) => {
      events.push(`create:${accountId}:${accessToken()}`);
      return runtime(accountId, events);
    },
  });
  await controller.loginWithPassword({
    identifier: { kind: "email", value: "alice@example.com" },
    password: "password-alice",
  });

  await controller.ensureReachable();

  assert.equal(controller.serviceAccessTokens.current()?.accessToken, refreshed.accessToken);
  assert.deepEqual(events, [
    "reachability",
    `create:${ALICE.accountId}:${expired.accessToken}`,
    "reachability",
    `refresh:${ALICE.sessionToken}`,
  ]);
});

test("logout stops account work, receives server revocation ACK, then clears both token stores", async () => {
  const events: string[] = [];
  const vault = new SecureSessionVault(new InMemorySecureCredentialPort());
  const controller = createController({
    vault,
    login: async () => ALICE,
    reachability: async () => undefined,
    signOut: async (token) => {
      events.push(`revoke:${token}`);
    },
    createRuntime: async ({ accountId }) => runtime(accountId, events),
  });
  await controller.loginWithPassword({
    identifier: { kind: "email", value: "alice@example.com" },
    password: "password-alice",
  });

  await controller.logout();

  assert.deepEqual(events, [`dispose:${ALICE.accountId}`, `revoke:${ALICE.sessionToken}`]);
  assert.equal(controller.currentState().status, "signed_out");
  assert.equal(controller.serviceAccessTokens.current(), null);
  assert.equal(await vault.read(), null);
});

test("failed logout keeps the opaque session for reliable revocation retry", async () => {
  const events: string[] = [];
  const vault = new SecureSessionVault(new InMemorySecureCredentialPort());
  const controller = createController({
    vault,
    login: async () => ALICE,
    reachability: async () => undefined,
    signOut: async () => {
      throw new TypeError("network down");
    },
    createRuntime: async ({ accountId }) => runtime(accountId, events),
  });
  await controller.loginWithPassword({
    identifier: { kind: "email", value: "alice@example.com" },
    password: "password-alice",
  });

  await controller.logout();

  assert.equal(controller.currentState().status, "offline");
  assert.deepEqual(await vault.read(), {
    accountId: ALICE.accountId,
    sessionToken: ALICE.sessionToken,
  });
  assert.equal(controller.serviceAccessTokens.current(), null);
  assert.deepEqual(events, [`dispose:${ALICE.accountId}`]);
});

test("a superseded account runtime can never become current and is disposed when it eventually resolves", async () => {
  const events: string[] = [];
  let resolveAlice: ((value: AccountRuntime) => void) | undefined;
  const coordinator = new AccountRuntimeCoordinator({
    create: async ({ accountId }) => {
      events.push(`create:${accountId}`);
      if (accountId === ALICE.accountId) {
        return await new Promise<AccountRuntime>((resolve) => {
          resolveAlice = resolve;
        });
      }
      return runtime(accountId, events);
    },
  });

  const aliceActivation = coordinator.activate({
    accountId: ALICE.accountId,
    accessToken: () => ALICE.accessToken,
  });
  await Promise.resolve();
  const bobRuntime = await coordinator.activate({
    accountId: BOB.accountId,
    accessToken: () => BOB.accessToken,
  });
  resolveAlice?.(runtime(ALICE.accountId, events));

  await assert.rejects(aliceActivation, /superseded/);
  assert.equal(bobRuntime.accountId, BOB.accountId);
  assert.equal(coordinator.current()?.accountId, BOB.accountId);
  assert.deepEqual(events, [
    `create:${ALICE.accountId}`,
    `create:${BOB.accountId}`,
    `dispose:${ALICE.accountId}`,
  ]);
});

test("a refreshed session can never cross the persisted account namespace", async () => {
  const events: string[] = [];
  const vault = new SecureSessionVault(new InMemorySecureCredentialPort());
  await vault.write({ accountId: ALICE.accountId, sessionToken: ALICE.sessionToken });
  const controller = createController({
    vault,
    reachability: async () => undefined,
    refresh: async () => BOB,
    createRuntime: async ({ accountId }) => {
      events.push(`create:${accountId}`);
      return runtime(accountId, events);
    },
  });

  await controller.bootstrap();

  assert.equal(controller.currentState().status, "signed_out");
  assert.equal(await vault.read(), null);
  assert.equal(controller.serviceAccessTokens.current(), null);
  assert.deepEqual(events, []);
});

test("account database names are deterministic, distinct, and never reveal raw account ids", () => {
  const alice = accountDatabaseName("account-alice@example.com");
  const aliceAgain = accountDatabaseName("account-alice@example.com");
  const bob = accountDatabaseName("account-bob@example.com");

  assert.equal(alice, aliceAgain);
  assert.notEqual(alice, bob);
  assert.match(alice, /^maxpower-account-[a-z0-9_-]+\.db$/);
  assert.doesNotMatch(alice, /alice|@|example/);
  assert.notEqual(
    accountDatabaseName("acct_awsin9_5f1yf4"),
    accountDatabaseName("acct_1bp67p5_l4yft0"),
    "known legacy FNV collision must not share a database",
  );
});

test("account database owner sentinel fails closed on a mismatched namespace", async () => {
  let owner: string | null = null;
  const database = {
    async execAsync() {},
    async getFirstAsync<T>() {
      return owner === null ? null : ({ account_id: owner } as T);
    },
    async runAsync(_sql: string, accountId: string) {
      owner = accountId;
      return { lastInsertRowId: 1, changes: 1 };
    },
  };
  await assertAccountDatabaseOwner(database, ALICE.accountId);
  await assertAccountDatabaseOwner(database, ALICE.accountId);
  await assert.rejects(
    assertAccountDatabaseOwner(database, BOB.accountId),
    /account_database_owner_mismatch/,
  );
});

test("secure credential labels use SHA-256 and preserve the exact legacy migration key", () => {
  const key = { accountId: "account-alice", scope: "device" as const, name: "active-session" };
  const current = secureCredentialStorageKey(key);
  assert.match(current, /^mp\.v2\.device\.[a-f0-9]{64}$/);
  assert.doesNotMatch(current, /account-alice|active-session/);
  assert.equal(
    legacySecureCredentialStorageKey(key),
    "mp.device.fnv1a-70a95fbb",
  );
});

test("social provider buttons follow runtime capability and Apple stays iOS-only", () => {
  assert.deepEqual(availableSocialProviders("ios", true), ["google", "apple"]);
  assert.deepEqual(availableSocialProviders("ios", false), ["apple"]);
  assert.deepEqual(availableSocialProviders("android", true), ["google"]);
  assert.deepEqual(availableSocialProviders("android", false), []);
  assert.deepEqual(availableSocialProviders("web", true), []);
});

test("controller confirms account deletion before unloading and restores progress from its receipt", async () => {
  const credentials = new InMemorySecureCredentialPort();
  const sessionVault = new SecureSessionVault(credentials);
  const deletionRecovery = new DeletionRecoveryVault(credentials, () => new Uint8Array(32).fill(0xcd));
  const events: string[] = [];
  const requestedAt = "2026-08-10T12:00:00.000Z";
  const controller = createController({
    vault: sessionVault,
    deletionRecovery,
    reachability: async () => undefined,
    login: async () => ALICE,
    requestAccountDeletion: async (input) => {
      assert.equal(input.accessToken, ALICE.accessToken);
      assert.equal(input.idempotencyKey, "cd".repeat(32));
      return {
        id: "deletion-1",
        deletionReceipt: "receipt-1",
        status: "pending",
        requestedAt,
        updatedAt: requestedAt,
        attempts: 0,
        completedAt: null,
        lastErrorCode: null,
      };
    },
    getAccountDeletion: async (receipt) => {
      assert.equal(receipt, "receipt-1");
      return {
        id: "deletion-1",
        status: "completed",
        requestedAt,
        updatedAt: "2026-08-10T12:01:00.000Z",
        attempts: 1,
        completedAt: "2026-08-10T12:01:00.000Z",
        lastErrorCode: null,
      };
    },
    createRuntime: async ({ accountId }) => runtime(accountId, events),
  });

  await controller.loginWithPassword({ identifier: { kind: "email", value: "alice@example.com" }, password: "secret" });
  await controller.deleteAccount();
  assert.equal(controller.currentState().status, "deleting");
  assert.equal(await sessionVault.read(), null);
  assert.equal((await deletionRecovery.read())?.receipt, "receipt-1");
  assert.deepEqual(events, ["dispose:account-alice"]);

  await controller.refreshDeletionStatus();
  const completed = controller.currentState();
  assert.equal(completed.status, "deleting");
  if (completed.status === "deleting") assert.equal(completed.deletion.status, "completed");
  await controller.acknowledgeCompletedDeletion();
  assert.equal(controller.currentState().status, "signed_out");
  assert.equal(await deletionRecovery.read(), null);
});

test("controller links and unlinks a social identity through the authenticated session", async () => {
  const credentials = new InMemorySecureCredentialPort();
  let linked = false;
  const controller = createController({
    vault: new SecureSessionVault(credentials),
    reachability: async () => undefined,
    login: async () => ALICE,
    listLinkedIdentities: async (sessionToken) => {
      assert.equal(sessionToken, ALICE.sessionToken);
      return linked
        ? [
            { id: "credential-1", providerId: "credential", accountId: ALICE.accountId },
            { id: "google-1", providerId: "google", accountId: ALICE.accountId },
          ]
        : [{ id: "credential-1", providerId: "credential", accountId: ALICE.accountId }];
    },
    startSocialIdentityLink: async (input) => {
      assert.equal(input.provider, "google");
      linked = true;
      return { authorizationUrl: "https://auth.example.test/link/google" };
    },
    unlinkIdentity: async (input) => {
      assert.equal(input.providerId, "google");
      linked = false;
    },
    createRuntime: async ({ accountId }) => runtime(accountId, []),
  });
  await controller.loginWithPassword({ identifier: { kind: "email", value: "alice@example.com" }, password: "secret" });
  assert.equal(await controller.linkSocialIdentity("google", socialAuthorizationStub([])), "linked");
  const identities = await controller.listLinkedIdentities();
  assert.equal(identities.length, 2);
  const google = identities.find((identity) => identity.providerId === "google");
  assert.ok(google);
  assert.equal((await controller.unlinkIdentity(google)).length, 1);
});

test("mobile composition gates ProductShell and background work by the authenticated account", () => {
  const root = process.cwd();
  const composition = readFileSync(resolve(root, "src/mobile/ui/MaxPowerApp.tsx"), "utf8");
  const authRoot = readFileSync(resolve(root, "src/mobile/auth/AuthRoot.tsx"), "utf8");
  const background = readFileSync(resolve(root, "src/mobile/native/BackgroundRecipeWorker.ts"), "utf8");

  assert.match(composition, /<AuthRoot/);
  assert.match(composition, /userId=\{accountId\}/);
  assert.doesNotMatch(composition, /LOCAL_PRIMARY_USER_ID|maxpower-local\.db/);
  assert.match(authRoot, /termsVersion: configuration\.requiredTermsVersion/);
  assert.match(authRoot, /signInWithSocial/);
  assert.match(authRoot, /socialSessionToken/);
  assert.match(authRoot, /linkSocialIdentity/);
  assert.match(authRoot, /deleteAccount/);
  assert.match(authRoot, /refreshDeletionStatus/);
  assert.doesNotMatch(authRoot, /termsVersion:\s*["'`]/);
  assert.match(background, /SecureSessionVault/);
  assert.match(background, /userId: session\.accountId/);
  assert.doesNotMatch(background, /LOCAL_PRIMARY_USER_ID|maxpower-local\.db/);
});

function runtime(accountId: string, events: string[]): AccountRuntime {
  return {
    accountId,
    async dispose() {
      events.push(`dispose:${accountId}`);
    },
  };
}

function createController(input: {
  vault: SecureSessionVault;
  deletionRecovery?: DeletionRecoveryVault;
  reachability: (signal?: AbortSignal) => Promise<void>;
  refresh?: (sessionToken: string, signal?: AbortSignal) => Promise<AuthenticatedIdentity>;
  login?: OnlineAuthApi["loginWithPassword"];
  signOut?: (accessToken: string, signal?: AbortSignal) => Promise<void>;
  socialStart?: OnlineAuthApi["startSocialSignIn"];
  socialExchange?: OnlineAuthApi["exchangeSocialCallback"];
  socialComplete?: OnlineAuthApi["completeSocialOnboarding"];
  listLinkedIdentities?: OnlineAuthApi["listLinkedIdentities"];
  startSocialIdentityLink?: OnlineAuthApi["startSocialIdentityLink"];
  unlinkIdentity?: OnlineAuthApi["unlinkIdentity"];
  requestAccountDeletion?: OnlineAuthApi["requestAccountDeletion"];
  getAccountDeletion?: OnlineAuthApi["getAccountDeletion"];
  createRuntime: ConstructorParameters<typeof AccountRuntimeCoordinator>[0]["create"];
}) {
  const auth = authStub({
    ...(input.refresh ? { refreshSession: input.refresh } : {}),
    ...(input.login ? { loginWithPassword: input.login } : {}),
    ...(input.signOut ? { signOut: input.signOut } : {}),
    ...(input.socialStart ? { startSocialSignIn: input.socialStart } : {}),
    ...(input.socialExchange ? { exchangeSocialCallback: input.socialExchange } : {}),
    ...(input.socialComplete ? { completeSocialOnboarding: input.socialComplete } : {}),
    ...(input.listLinkedIdentities ? { listLinkedIdentities: input.listLinkedIdentities } : {}),
    ...(input.startSocialIdentityLink ? { startSocialIdentityLink: input.startSocialIdentityLink } : {}),
    ...(input.unlinkIdentity ? { unlinkIdentity: input.unlinkIdentity } : {}),
    ...(input.requestAccountDeletion ? { requestAccountDeletion: input.requestAccountDeletion } : {}),
    ...(input.getAccountDeletion ? { getAccountDeletion: input.getAccountDeletion } : {}),
  });
  return new OnlineAuthController({
    reachability: { assertReachable: input.reachability },
    auth,
    sessionVault: input.vault,
    ...(input.deletionRecovery ? { deletionRecovery: input.deletionRecovery } : {}),
    serviceAccessTokens: new MemoryServiceAccessTokenStore(),
    runtimes: new AccountRuntimeCoordinator({ create: input.createRuntime }),
  });
}

function authStub(overrides: Partial<OnlineAuthApi>): OnlineAuthApi {
  const unavailable = async (): Promise<never> => {
    throw new Error("auth_method_not_stubbed");
  };
  return {
    getPublicConfiguration: async () => ({
      realm: "global",
      requiredTermsVersion: "terms-test",
      socialProviders: ["google", "apple"],
    }),
    startSocialSignIn: unavailable,
    exchangeSocialCallback: unavailable,
    startRegistrationOtp: unavailable,
    verifyRegistrationOtp: unavailable,
    completeRegistration: unavailable,
    startLoginOtp: unavailable,
    verifyLoginOtp: unavailable,
    loginWithPassword: unavailable,
    refreshSession: unavailable,
    completeSocialOnboarding: unavailable,
    listLinkedIdentities: unavailable,
    startSocialIdentityLink: unavailable,
    unlinkIdentity: unavailable,
    requestAccountDeletion: unavailable,
    getAccountDeletion: unavailable,
    signOut: async () => undefined,
    ...overrides,
  };
}

function socialAuthorizationStub(events: string[]): SocialAuthorizationPort {
  return {
    callbackUrl: "maxpower://auth/callback",
    availableProviders: () => ["google", "apple"],
    async authorize(input) {
      events.push(`authorize:${input.authorizationUrl}`);
      return {
        status: "success",
        callbackUrl: "maxpower://auth/callback?code=callback-code&state=exchange-state",
      };
    },
  };
}

class InMemorySecureCredentialPort implements SecureCredentialPort {
  private readonly values = new Map<string, string>();

  async put(input: { key: SecureCredentialKey; value: string }): Promise<void> {
    this.values.set(credentialKey(input.key), input.value);
  }

  async get(input: { key: SecureCredentialKey }): Promise<SecureCredentialReadResult> {
    const value = this.values.get(credentialKey(input.key));
    return value === undefined ? { status: "missing_or_invalidated" } : { status: "available", value };
  }

  async delete(input: { key: SecureCredentialKey }): Promise<void> {
    this.values.delete(credentialKey(input.key));
  }

  async rotate(input: { key: SecureCredentialKey; value: string }): Promise<void> {
    await this.put(input);
  }
}

function credentialKey(key: SecureCredentialKey): string {
  return `${key.accountId}\u0000${key.scope}\u0000${key.name}`;
}
