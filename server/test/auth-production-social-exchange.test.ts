import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";

import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import { renderError } from "../src/http/response.js";
import { createIdentityRoutes } from "../src/http/routes/identity.js";
import {
  BetterAuthSocialAuthFlow,
  BetterAuthSocialBridgeAdapter,
  BetterAuthVerificationSocialAuthStateStore,
  type BetterAuthSocialBridge,
  type SocialAuthExchangeRecord,
  type SocialAuthHandoffRecord,
  type SocialAuthStartRecord,
  type SocialAuthStateStore,
} from "../src/adapters/auth/better-auth-social-flow.js";
import { InMemoryIdentityAdapter } from "../src/modules/identity/in-memory-adapter.js";
import type {
  SocialAuthFlow,
  SocialAuthProvider,
} from "../src/modules/identity/model.js";

const DEVICE_BINDING = "a1".repeat(32);

test("V1 social login exchanges a device-bound one-time code without putting a session in a URL", async () => {
  const socialAuth = new FakeSocialAuthFlow();
  const app = new Hono();
  app.onError((error, context) => renderError(context, error));
  app.route("/v1", createIdentityRoutes({
    identity: new InMemoryIdentityAdapter(),
    socialAuth,
  }));

  const started = await app.request("/v1/auth/social/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "google",
      callbackUrl: "maxpower://auth/callback",
      deviceBinding: DEVICE_BINDING,
    }),
  });
  assert.equal(started.status, 200);
  assert.deepEqual(await started.json(), {
    authorizationUrl: "https://identity.example/authorize?flow=opaque",
    exchangeState: "exchange-state-opaque-value",
  });
  assert.deepEqual(socialAuth.started, [{
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: DEVICE_BINDING,
  }]);

  const exchanged = await app.request("/v1/auth/social/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "one-time-code-opaque-value",
      state: "exchange-state-opaque-value",
      callbackUrl: "maxpower://auth/callback",
      deviceBinding: DEVICE_BINDING,
    }),
  });
  assert.equal(exchanged.status, 200);
  assert.deepEqual(await exchanged.json(), { sessionToken: "server-session-token" });
  assert.deepEqual(socialAuth.exchanged, [{
    code: "one-time-code-opaque-value",
    state: "exchange-state-opaque-value",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: DEVICE_BINDING,
  }]);

  const handoff = await app.request("/v1/auth/social/handoff?flow=opaque-flow-value");
  assert.equal(handoff.status, 302);
  assert.equal(
    handoff.headers.get("location"),
    "maxpower://auth/callback?code=opaque-code-value&state=opaque-state-value",
  );
  const failed = await app.request("/v1/auth/social/error?flow=opaque-flow-value");
  assert.equal(failed.status, 302);
  assert.equal(
    failed.headers.get("location"),
    "maxpower://auth/callback?error=social_callback_failed&state=opaque-state-value",
  );
});

test("social start persists only the device digest and uses an HTTPS browser bridge", async () => {
  const bridge = new FakeBetterAuthSocialBridge();
  const store = new MemorySocialAuthStateStore();
  const tokens = ["handoff-id-opaque-value", "exchange-state-opaque-value"];
  const flow = new BetterAuthSocialAuthFlow({
    bridge,
    store,
    baseUrl: "https://api.example",
    allowedCallbackUrls: ["maxpower://auth/callback"],
    clock: new FixedClock(),
    randomToken: () => tokens.shift() ?? "unexpected-token",
  });

  const started = await flow.start({
    provider: "apple",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: DEVICE_BINDING,
  });

  assert.deepEqual(started, {
    authorizationUrl:
      "https://api.example/api/auth/social/authorize?state=oauth-state-opaque-value",
    exchangeState: "exchange-state-opaque-value",
  });
  assert.equal(JSON.stringify(store.starts).includes(DEVICE_BINDING), false);
  assert.equal(store.starts[0]?.expiresAt, "2026-08-10T00:10:00.000Z");
  assert.equal(started.authorizationUrl.includes(DEVICE_BINDING), false);
  assert.deepEqual(bridge.started, [{
    provider: "apple",
    callbackUrl:
      "https://api.example/v1/auth/social/handoff?flow=handoff-id-opaque-value",
    errorCallbackUrl:
      "https://api.example/v1/auth/social/error?flow=handoff-id-opaque-value",
  }]);

  const authorize = await flow.authorize("oauth-state-opaque-value");
  assert.equal(authorize.status, 302);
  assert.equal(authorize.headers.get("location"), bridge.providerAuthorizationUrl);
  assert.equal(authorize.headers.has("set-cookie"), false);

  await assert.rejects(
    flow.start({
      provider: "google",
      callbackUrl: "maxpower://attacker/callback",
      deviceBinding: DEVICE_BINDING,
    }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "social_callback_not_allowed",
  );
});

test("HTTPS handoff keeps Better Auth credentials off the native code-and-state redirect", async () => {
  const bridge = new FakeBetterAuthSocialBridge();
  const store = new MemorySocialAuthStateStore();
  const tokens = [
    "handoff-id-opaque-value",
    "exchange-state-opaque-value",
    "single-use-exchange-code-value",
  ];
  const flow = new BetterAuthSocialAuthFlow({
    bridge,
    store,
    baseUrl: "https://api.example",
    allowedCallbackUrls: ["maxpower://auth/callback"],
    clock: new FixedClock(),
    randomToken: () => tokens.shift() ?? "unexpected-token",
  });
  await flow.start({
    provider: "apple",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: DEVICE_BINDING,
  });

  await assert.rejects(
    flow.handleBrowserHandoff(new Request(
      "https://api.example/v1/auth/social/handoff?flow=handoff-id-opaque-value",
      { headers: { cookie: "__Secure-better-auth.session_token=attacker-session" } },
    )),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "social_handoff_used",
  );

  const callback = await flow.handleProviderCallback(
    new Request("https://api.example/api/auth/callback/apple", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "__Secure-better-auth.session_token=attacker-session",
      },
      body: "code=provider-code&state=oauth-state-opaque-value",
    }),
    "apple",
  );

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), bridge.started[0]?.callbackUrl);
  assert.equal(callback.headers.has("set-cookie"), false);
  assert.doesNotMatch(callback.headers.get("location") ?? "", /session|cookie/i);
  assert.equal(
    bridge.callbackCookies[0],
    bridge.stateCookie,
  );
  assert.equal(store.handoffs[0]?.expiresAt, "2026-08-10T00:02:00.000Z");

  const handoff = await flow.handleBrowserHandoff(new Request(
    assertRequired(callback.headers.get("location")),
  ));
  assert.equal(handoff.status, 302);
  assert.equal(handoff.headers.has("set-cookie"), false);
  const redirect = new URL(assertRequired(handoff.headers.get("location")));
  assert.equal(`${redirect.protocol}//${redirect.host}${redirect.pathname}`, "maxpower://auth/callback");
  assert.deepEqual([...redirect.searchParams.keys()].sort(), ["code", "state"]);
  assert.equal(redirect.searchParams.get("code"), "single-use-exchange-code-value");
  assert.equal(redirect.searchParams.get("state"), "exchange-state-opaque-value");
  assert.equal(redirect.toString().includes("server-session-token"), false);
  assert.equal(redirect.toString().includes(DEVICE_BINDING), false);
  assert.equal(JSON.stringify(store.exchanges).includes("single-use-exchange-code-value"), false);
  assert.equal(JSON.stringify(store.exchanges).includes(DEVICE_BINDING), false);
  assert.equal(store.exchanges[0]?.sessionToken, "server-session-token");
  assert.equal(store.exchanges[0]?.expiresAt, "2026-08-10T00:02:00.000Z");
  assert.equal(store.handoffs.length, 0);
  assert.equal(bridge.callbackBodies[0], "code=provider-code&state=oauth-state-opaque-value");

  const wrongProviderBridge = new FakeBetterAuthSocialBridge();
  const wrongProviderStore = new MemorySocialAuthStateStore();
  const wrongProviderFlow = new BetterAuthSocialAuthFlow({
    bridge: wrongProviderBridge,
    store: wrongProviderStore,
    baseUrl: "https://api.example",
    allowedCallbackUrls: ["maxpower://auth/callback"],
    clock: new FixedClock(),
    randomToken: (() => {
      const values = ["handoff-id-opaque-value", "exchange-state-opaque-value"];
      return () => values.shift() ?? "unexpected-token";
    })(),
  });
  await wrongProviderFlow.start({
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: DEVICE_BINDING,
  });
  await assert.rejects(
    wrongProviderFlow.handleProviderCallback(
      new Request(
        "https://api.example/api/auth/callback/apple?state=oauth-state-opaque-value",
      ),
      "apple",
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "invalid_social_callback",
  );
  assert.equal(wrongProviderBridge.callbackBodies.length, 0);
});

test("social exchange binds device, state and callback then rejects replay with 409", async () => {
  const bridge = new FakeBetterAuthSocialBridge();
  const store = new MemorySocialAuthStateStore();
  const tokens = [
    "handoff-id-opaque-value",
    "exchange-state-opaque-value",
    "single-use-exchange-code-value",
  ];
  const flow = new BetterAuthSocialAuthFlow({
    bridge,
    store,
    baseUrl: "https://api.example",
    allowedCallbackUrls: ["maxpower://auth/callback"],
    clock: new FixedClock(),
    randomToken: () => tokens.shift() ?? "unexpected-token",
  });
  await flow.start({
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: DEVICE_BINDING,
  });
  const callback = await flow.handleProviderCallback(
    new Request(
      "https://api.example/api/auth/callback/google?code=provider-code&state=oauth-state-opaque-value",
    ),
    "google",
  );
  const handoff = await flow.handleBrowserHandoff(new Request(
    assertRequired(callback.headers.get("location")),
  ));
  const redirect = new URL(assertRequired(handoff.headers.get("location")));
  const code = assertRequired(redirect.searchParams.get("code"));
  const state = assertRequired(redirect.searchParams.get("state"));

  for (const changed of [
    { deviceBinding: "b2".repeat(32) },
    { state: "different-exchange-state-value" },
    { callbackUrl: "maxpower://attacker/callback" },
  ]) {
    await assert.rejects(
      flow.exchange({
        code,
        state,
        callbackUrl: "maxpower://auth/callback",
        deviceBinding: DEVICE_BINDING,
        ...changed,
      }),
      (error: unknown) =>
        error instanceof ApiError && error.code === "invalid_social_exchange",
    );
  }

  assert.deepEqual(await flow.exchange({
    code,
    state,
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: DEVICE_BINDING,
  }), { sessionToken: "server-session-token" });
  await assert.rejects(
    flow.exchange({
      code,
      state,
      callbackUrl: "maxpower://auth/callback",
      deviceBinding: DEVICE_BINDING,
    }),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "social_exchange_used",
  );
});

test("social browser failures return immediately to the exact native callback without credentials", async () => {
  const bridge = new FakeBetterAuthSocialBridge();
  const store = new MemorySocialAuthStateStore();
  const values = ["handoff-id-opaque-value", "exchange-state-opaque-value"];
  const flow = new BetterAuthSocialAuthFlow({
    bridge,
    store,
    baseUrl: "https://api.example",
    allowedCallbackUrls: ["maxpower://auth/callback"],
    clock: new FixedClock(),
    randomToken: () => values.shift() ?? "unexpected-token",
  });
  await flow.start({
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
    deviceBinding: DEVICE_BINDING,
  });
  bridge.callbackStatus = 401;

  const providerFailure = await flow.handleProviderCallback(new Request(
    "https://api.example/api/auth/callback/google?error=access_denied&state=oauth-state-opaque-value",
  ), "google");
  assert.equal(providerFailure.status, 302);
  assert.equal(
    providerFailure.headers.get("location"),
    "https://api.example/v1/auth/social/error?flow=handoff-id-opaque-value",
  );
  assert.equal(providerFailure.headers.has("set-cookie"), false);

  const nativeFailure = await flow.handleBrowserError(new Request(
    assertRequired(providerFailure.headers.get("location")),
  ));
  assert.equal(nativeFailure.status, 302);
  const redirect = new URL(assertRequired(nativeFailure.headers.get("location")));
  assert.equal(`${redirect.protocol}//${redirect.host}${redirect.pathname}`, "maxpower://auth/callback");
  assert.deepEqual([...redirect.searchParams.keys()].sort(), ["error", "state"]);
  assert.equal(redirect.searchParams.get("error"), "social_callback_failed");
  assert.equal(redirect.searchParams.get("state"), "exchange-state-opaque-value");
  assert.doesNotMatch(redirect.toString(), /session|cookie|device/i);
  await assert.rejects(
    flow.handleBrowserError(new Request(
      "https://api.example/v1/auth/social/error?flow=handoff-id-opaque-value",
    )),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "social_handoff_used",
  );
});

test("Better Auth bridge keeps OAuth cookies server-side and resolves the callback session", async () => {
  const server = new FakeBetterAuthServer();
  const bridge = new BetterAuthSocialBridgeAdapter(server);

  assert.deepEqual(await bridge.start({
    provider: "google",
    callbackUrl: "https://api.example/v1/auth/social/handoff?flow=opaque",
    errorCallbackUrl: "https://api.example/v1/auth/social/error?flow=opaque",
  }), {
    authorizationUrl:
      "https://accounts.google.example/authorize?state=oauth-state-opaque-value",
    stateCookie:
      "__Secure-better-auth.state=signed-oauth-state; Path=/; HttpOnly; Secure; SameSite=Lax",
  });
  assert.deepEqual(server.startBodies, [{
    provider: "google",
    callbackURL: "https://api.example/v1/auth/social/handoff?flow=opaque",
    errorCallbackURL: "https://api.example/v1/auth/social/error?flow=opaque",
    disableRedirect: true,
  }]);

  const callbackResponse = new Response(null, {
    status: 302,
    headers: {
      location: "https://api.example/v1/auth/social/handoff?flow=opaque",
      "set-cookie":
        "__Secure-better-auth.session_token=signed-session-cookie; Path=/; HttpOnly; Secure",
    },
  });
  assert.equal(
    await bridge.sessionTokenFromCallback(callbackResponse),
    "resolved-session-token",
  );
  assert.equal(
    server.sessionCookieHeaders[0],
    "__Secure-better-auth.session_token=signed-session-cookie",
  );
  await bridge.handle(
    new Request("https://api.example/api/auth/callback/apple", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "__Secure-better-auth.session_token=attacker-session",
      },
      body: "code=provider-code&state=oauth-state-opaque-value",
    }),
    "__Secure-better-auth.state=signed-oauth-state; Path=/; HttpOnly; Secure; SameSite=Lax",
  );
  assert.equal(
    server.callbackCookieHeaders[0],
    "__Secure-better-auth.state=signed-oauth-state",
  );
});

test("verification store persists only digests and atomically consumes an exchange record once", async () => {
  const verification = new FakeVerificationServer();
  const store = new BetterAuthVerificationSocialAuthStateStore(verification);
  const start: SocialAuthStartRecord = {
    oauthStateDigest: "1a".repeat(32),
    handoffIdDigest: "5e".repeat(32),
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
    deviceBindingDigest: "2b".repeat(32),
    exchangeState: "exchange-state-opaque-value",
    providerAuthorizationUrl:
      "https://accounts.google.example/authorize?state=oauth-state-opaque-value",
    stateCookie:
      "__Secure-better-auth.state=signed-oauth-state; Path=/; HttpOnly; Secure",
    handoffUrl: "https://api.example/v1/auth/social/handoff?flow=opaque-flow",
    errorCallbackUrl: "https://api.example/v1/auth/social/error?flow=opaque-flow",
    expiresAt: "2026-08-10T00:10:00.000Z",
  };
  const exchange: SocialAuthExchangeRecord = {
    codeDigest: "3c".repeat(32),
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
    deviceBindingDigest: "2b".repeat(32),
    exchangeStateDigest: "4d".repeat(32),
    sessionToken: "server-session-token",
    expiresAt: "2026-08-10T00:02:00.000Z",
  };
  const handoff: SocialAuthHandoffRecord = {
    handoffIdDigest: "5e".repeat(32),
    provider: "google",
    callbackUrl: "maxpower://auth/callback",
    deviceBindingDigest: "2b".repeat(32),
    exchangeState: "exchange-state-opaque-value",
    sessionToken: "server-session-token",
    expiresAt: "2026-08-10T00:02:00.000Z",
  };

  await store.saveStart(start);
  await store.consumeStart(start.oauthStateDigest);
  await store.saveHandoff(handoff);
  await store.saveExchange(exchange);
  assert.deepEqual(await store.findExchange(exchange.codeDigest), exchange);
  assert.equal(verification.serialized().includes(DEVICE_BINDING), false);
  assert.equal(verification.serialized().includes("single-use-exchange-code-value"), false);

  const consumed = await Promise.all([
    store.consumeExchange(exchange.codeDigest),
    store.consumeExchange(exchange.codeDigest),
  ]);
  assert.equal(consumed.filter((value) => value !== null).length, 1);
  assert.equal(consumed.filter((value) => value === null).length, 1);

  const consumedHandoffs = await Promise.all([
    store.consumeHandoff(handoff.handoffIdDigest),
    store.consumeHandoff(handoff.handoffIdDigest),
  ]);
  assert.equal(consumedHandoffs.filter((value) => value !== null).length, 1);
  assert.equal(consumedHandoffs.filter((value) => value === null).length, 1);
});

class FakeSocialAuthFlow implements SocialAuthFlow {
  readonly started: Array<{
    provider: SocialAuthProvider;
    callbackUrl: string;
    deviceBinding: string;
  }> = [];
  readonly exchanged: Array<{
    code: string;
    state: string;
    callbackUrl: string;
    deviceBinding: string;
  }> = [];

  async start(input: {
    provider: SocialAuthProvider;
    callbackUrl: string;
    deviceBinding: string;
  }): Promise<{ authorizationUrl: string; exchangeState: string }> {
    this.started.push(input);
    return {
      authorizationUrl: "https://identity.example/authorize?flow=opaque",
      exchangeState: "exchange-state-opaque-value",
    };
  }

  async exchange(input: {
    code: string;
    state: string;
    callbackUrl: string;
    deviceBinding: string;
  }): Promise<{ sessionToken: string }> {
    this.exchanged.push(input);
    return { sessionToken: "server-session-token" };
  }

  handleBrowserHandoff(_request: Request): Promise<Response> {
    return Promise.resolve(new Response(null, {
      status: 302,
      headers: {
        location:
          "maxpower://auth/callback?code=opaque-code-value&state=opaque-state-value",
      },
    }));
  }

  handleBrowserError(_request: Request): Promise<Response> {
    return Promise.resolve(new Response(null, {
      status: 302,
      headers: {
        location:
          "maxpower://auth/callback?error=social_callback_failed&state=opaque-state-value",
      },
    }));
  }
}

class FakeBetterAuthSocialBridge implements BetterAuthSocialBridge {
  readonly providerAuthorizationUrl =
    "https://appleid.apple.com/auth/authorize?state=oauth-state-opaque-value";
  readonly stateCookie =
    "__Secure-better-auth.state=signed-oauth-state; Path=/; HttpOnly; Secure; SameSite=Lax";
  readonly started: Array<{
    provider: SocialAuthProvider;
    callbackUrl: string;
    errorCallbackUrl: string;
  }> = [];
  readonly callbackBodies: string[] = [];
  readonly callbackCookies: string[] = [];
  callbackStatus = 302;

  async start(input: {
    provider: SocialAuthProvider;
    callbackUrl: string;
    errorCallbackUrl: string;
  }): Promise<{ authorizationUrl: string; stateCookie: string }> {
    this.started.push(input);
    return {
      authorizationUrl: this.providerAuthorizationUrl,
      stateCookie: this.stateCookie,
    };
  }

  async handle(request: Request, stateCookie?: string): Promise<Response> {
    this.callbackBodies.push(await request.clone().text());
    this.callbackCookies.push(stateCookie ?? request.headers.get("cookie") ?? "");
    const callbackUrl = this.started.at(-1)?.callbackUrl;
    assert.ok(callbackUrl);
    return new Response(null, {
      status: this.callbackStatus,
      headers: {
        location: callbackUrl,
        "set-cookie":
          "__Secure-better-auth.session_token=signed-session; Path=/; HttpOnly; Secure",
      },
    });
  }

  sessionTokenFromCallback(_response: Response): Promise<string | null> {
    return Promise.resolve("server-session-token");
  }

}

class MemorySocialAuthStateStore implements SocialAuthStateStore {
  readonly starts: SocialAuthStartRecord[] = [];
  readonly handoffs: SocialAuthHandoffRecord[] = [];
  readonly exchanges: SocialAuthExchangeRecord[] = [];

  async saveStart(record: SocialAuthStartRecord): Promise<void> {
    this.starts.push(structuredClone(record));
  }

  async findStart(oauthStateDigest: string): Promise<SocialAuthStartRecord | null> {
    return this.starts.find((record) => record.oauthStateDigest === oauthStateDigest) ?? null;
  }

  async consumeStart(oauthStateDigest: string): Promise<SocialAuthStartRecord | null> {
    const index = this.starts.findIndex(
      (record) => record.oauthStateDigest === oauthStateDigest,
    );
    return index < 0 ? null : this.starts.splice(index, 1)[0] ?? null;
  }

  async findStartByHandoff(handoffIdDigest: string): Promise<SocialAuthStartRecord | null> {
    return this.starts.find((record) => record.handoffIdDigest === handoffIdDigest) ?? null;
  }

  async consumeStartByHandoff(handoffIdDigest: string): Promise<SocialAuthStartRecord | null> {
    const index = this.starts.findIndex(
      (record) => record.handoffIdDigest === handoffIdDigest,
    );
    return index < 0 ? null : this.starts.splice(index, 1)[0] ?? null;
  }

  async saveHandoff(record: SocialAuthHandoffRecord): Promise<void> {
    this.handoffs.push(structuredClone(record));
  }

  async consumeHandoff(handoffIdDigest: string): Promise<SocialAuthHandoffRecord | null> {
    const index = this.handoffs.findIndex(
      (record) => record.handoffIdDigest === handoffIdDigest,
    );
    return index < 0 ? null : this.handoffs.splice(index, 1)[0] ?? null;
  }

  async saveExchange(record: SocialAuthExchangeRecord): Promise<void> {
    this.exchanges.push(structuredClone(record));
  }

  async findExchange(codeDigest: string): Promise<SocialAuthExchangeRecord | null> {
    return this.exchanges.find((record) => record.codeDigest === codeDigest) ?? null;
  }

  async consumeExchange(codeDigest: string): Promise<SocialAuthExchangeRecord | null> {
    const index = this.exchanges.findIndex(
      (record) => record.codeDigest === codeDigest,
    );
    return index < 0 ? null : this.exchanges.splice(index, 1)[0] ?? null;
  }
}

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-08-10T00:00:00.000Z");
  }
}

class FakeBetterAuthServer {
  readonly startBodies: unknown[] = [];
  readonly sessionCookieHeaders: string[] = [];
  readonly callbackCookieHeaders: string[] = [];
  readonly api = {
    signInSocial: async (input: {
      body: Record<string, unknown>;
      returnHeaders: true;
    }) => {
      this.startBodies.push(structuredClone(input.body));
      return {
        response: {
          redirect: false,
          url: "https://accounts.google.example/authorize?state=oauth-state-opaque-value",
        },
        headers: new Headers({
          "set-cookie":
            "__Secure-better-auth.state=signed-oauth-state; Path=/; HttpOnly; Secure; SameSite=Lax",
        }),
      };
    },
    getSession: async (input: { headers: Headers }) => {
      this.sessionCookieHeaders.push(input.headers.get("cookie") ?? "");
      return { session: { token: "resolved-session-token" } };
    },
  };

  handler(request: Request): Promise<Response> {
    this.callbackCookieHeaders.push(request.headers.get("cookie") ?? "");
    return Promise.resolve(new Response(null, { status: 204 }));
  }
}

class FakeVerificationServer {
  readonly #values = new Map<string, { value: string; expiresAt: Date }>();
  readonly $context = Promise.resolve({
    internalAdapter: {
      reserveVerificationValue: async (input: {
        identifier: string;
        value: string;
        expiresAt: Date;
      }) => {
        if (this.#values.has(input.identifier)) return null;
        const stored = { value: input.value, expiresAt: input.expiresAt };
        this.#values.set(input.identifier, stored);
        return stored;
      },
      findVerificationValue: async (identifier: string) =>
        this.#values.get(identifier) ?? null,
      consumeVerificationValue: async (identifier: string) => {
        const value = this.#values.get(identifier) ?? null;
        this.#values.delete(identifier);
        return value;
      },
    },
  });

  serialized(): string {
    return JSON.stringify([...this.#values]);
  }
}

function assertRequired(value: string | null): string {
  assert.ok(value);
  return value;
}
