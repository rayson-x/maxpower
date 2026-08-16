import assert from "node:assert/strict";
import test from "node:test";

import { Pool } from "pg";

import {
  createReviewedBetterAuthHandler,
  createProductionBetterAuth,
  type ProductionOtpDelivery,
} from "../src/adapters/auth/production-auth.js";
import { createProductionIdentityStack } from "../src/adapters/auth/better-auth-runtime.js";

const delivery: ProductionOtpDelivery = {
  async sendEmailOtp() {},
  async sendSmsOtp() {},
};

test("production Better Auth configuration keeps account linking explicit and service JWTs minimal", async (t) => {
  const database = new Pool({
    connectionString: "postgres://maxpower:test@localhost:5432/maxpower",
  });
  t.after(async () => database.end());

  const auth = createProductionBetterAuth({
    database,
    baseURL: "https://auth.maxpower.example",
    secret: "production-secret-with-at-least-thirty-two-characters",
    trustedOrigins: ["https://app.maxpower.example"],
    nativeSchemes: ["maxpower://"],
    otpDelivery: delivery,
    phoneIdentityDomain: "phone-id.maxpower.invalid",
    requiredTermsVersion: "terms-v1",
    serviceJwt: {
      issuer: "https://auth.maxpower.example",
      audience: "maxpower-api",
    },
    google: {
      clientIds: ["google-web-client", "google-ios-client", "google-android-client"],
      clientSecret: "google-secret",
    },
    apple: {
      clientIds: ["com.maxpower.service", "com.maxpower.ios"],
      clientSecret: "apple-client-secret-jwt",
      appBundleIdentifier: "com.maxpower.ios",
    },
  });

  assert.equal(auth.options.database, database);
  assert.equal(auth.options.emailAndPassword?.enabled, true);
  assert.equal(auth.options.emailAndPassword?.autoSignIn, false);
  assert.deepEqual(auth.options.account?.accountLinking, {
    enabled: true,
    disableImplicitLinking: true,
    allowDifferentEmails: false,
    trustedProviders: [],
  });

  const plugins = auth.options.plugins ?? [];
  assert.equal(plugins.map((plugin) => String(plugin.id)).includes("expo"), false);
  assert.equal(auth.options.account?.storeStateStrategy, "database");
  assert.notEqual(Reflect.get(auth.options.account ?? {}, "skipStateCookieCheck"), true);
  const emailOtp = requiredPlugin(plugins, "email-otp");
  assert.equal(emailOtp.options?.expiresIn, 300);
  assert.equal(emailOtp.options?.allowedAttempts, 3);
  assert.equal(emailOtp.options?.disableSignUp, true);
  assert.equal(emailOtp.options?.storeOTP, "hashed");

  const phone = requiredPlugin(plugins, "phone-number");
  assert.equal(phone.options?.expiresIn, 300);
  assert.equal(phone.options?.allowedAttempts, 3);
  assert.equal(phone.options?.requireVerification, true);
  const syntheticEmail = phone.options?.signUpOnVerification?.getTempEmail("+447700900123");
  assert.match(syntheticEmail ?? "", /^[a-f0-9]{64}@phone-id\.maxpower\.invalid$/);
  assert.equal(syntheticEmail?.includes("447700900123"), false);

  const bearer = requiredPlugin(plugins, "bearer");
  assert.equal(bearer.options?.requireSignature, false);

  const serviceJwt = requiredPlugin(plugins, "jwt");
  assert.equal(serviceJwt.options?.jwt?.issuer, "https://auth.maxpower.example");
  assert.equal(serviceJwt.options?.jwt?.audience, "maxpower-api");
  assert.equal(serviceJwt.options?.jwt?.expirationTime, "5m");
  assert.deepEqual(serviceJwt.options?.jwks?.keyPairConfig, {
    alg: "EdDSA",
    crv: "Ed25519",
  });
  assert.equal(serviceJwt.options?.jwks?.disablePrivateKeyEncryption, false);

  const payload = await serviceJwt.options?.jwt?.definePayload?.({
    user: {
      id: "account_123",
      email: "private@example.com",
      emailVerified: true,
      name: "Private Name",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
      accountStatus: "active",
      scopes: "account:read account:delete llm:invoke",
    },
    session: {
      id: "session_123",
      userId: "account_123",
      token: "session-token",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
      expiresAt: new Date("2026-09-10T00:00:00.000Z"),
    },
  });
  assert.deepEqual(Object.keys(payload ?? {}).sort(), [
    "account_status",
    "jti",
    "realm",
    "scope",
    "sid",
  ]);
  assert.equal(payload?.sid, "session_123");
  assert.equal(payload?.account_status, "active");
  assert.equal(payload?.realm, "global");
  assert.equal(payload?.scope, "account:read account:delete llm:invoke");
  assert.match(String(payload?.jti), /^[0-9a-f-]{36}$/);

  assert.deepEqual(auth.options.socialProviders?.google, {
    clientId: ["google-web-client", "google-ios-client", "google-android-client"],
    clientSecret: "google-secret",
  });
  assert.deepEqual(auth.options.socialProviders?.apple, {
    clientId: ["com.maxpower.service", "com.maxpower.ios"],
    clientSecret: "apple-client-secret-jwt",
    appBundleIdentifier: "com.maxpower.ios",
  });
  assert.deepEqual(auth.options.trustedOrigins, [
    "https://app.maxpower.example",
    "maxpower://",
    "https://appleid.apple.com",
  ]);
});

test("reviewed Better Auth handler cannot bypass the V1 OTP and password routes", async (t) => {
  const database = new Pool({
    connectionString: "postgres://maxpower:test@localhost:5432/maxpower",
  });
  t.after(async () => database.end());
  const auth = createProductionBetterAuth({
    database,
    baseURL: "https://auth.maxpower.example",
    secret: "production-secret-with-at-least-thirty-two-characters",
    trustedOrigins: ["https://app.maxpower.example"],
    otpDelivery: delivery,
    phoneIdentityDomain: "phone-id.maxpower.invalid",
    requiredTermsVersion: "terms-v1",
    serviceJwt: {
      issuer: "https://auth.maxpower.example",
      audience: "maxpower-api",
    },
    google: { clientIds: ["google-client"], clientSecret: "google-secret" },
    apple: {
      clientIds: ["apple-client"],
      clientSecret: "apple-secret",
      appBundleIdentifier: "com.maxpower.ios",
    },
  });
  const handler = createReviewedBetterAuthHandler(auth);

  for (const path of [
    "/api/auth/email-otp/send-verification-otp",
    "/api/auth/phone-number/send-otp",
    "/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
    "/api/auth/sign-in/social",
    "/api/auth/expo-authorization-proxy",
    "/api/auth/get-session",
    "/api/auth/token",
    "/api/auth/sign-out",
  ]) {
    const response = await handler(new Request(`https://auth.maxpower.example${path}`));
    assert.equal(response.status, 404, path);
  }
});

test("reviewed handler owns the browser bridge and delegates provider callbacks to the device-bound flow", async () => {
  const delegated: string[] = [];
  const socialCallbacks: string[] = [];
  const auth = {
    async handler(request: Request) {
      delegated.push(new URL(request.url).pathname);
      return new Response(null, { status: 204 });
    },
  };
  const handler = createReviewedBetterAuthHandler(auth, {
    socialAuth: {
      authorize(state: string) {
        assert.equal(state, "oauth-state-opaque-value");
        return Promise.resolve(new Response(null, {
          status: 302,
          headers: { location: "https://accounts.example/authorize" },
        }));
      },
      handleProviderCallback(request: Request, provider: "google" | "apple") {
        socialCallbacks.push(`${provider}:${new URL(request.url).pathname}`);
        return Promise.resolve(new Response(null, {
          status: 302,
          headers: {
            location:
              "maxpower://auth/callback?code=single-use-code-value&state=exchange-state-value",
          },
        }));
      },
    },
  });

  const authorize = await handler(new Request(
    "https://auth.maxpower.example/api/auth/social/authorize?state=oauth-state-opaque-value",
  ));
  assert.equal(authorize.status, 302);
  assert.equal(authorize.headers.get("location"), "https://accounts.example/authorize");
  const callback = await handler(new Request(
    "https://auth.maxpower.example/api/auth/callback/google?state=oauth-state-opaque-value",
  ));
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.has("set-cookie"), false);
  assert.deepEqual(socialCallbacks, ["google:/api/auth/callback/google"]);
  assert.deepEqual(delegated, []);
});

test("explicit social linking requires a freshly reauthenticated Better Auth session", async () => {
  let createdAt = new Date("2026-08-09T23:00:00.000Z");
  const delegated: string[] = [];
  const auth = {
    api: {
      async getSession() {
        return { session: { createdAt } };
      },
    },
    async handler(request: Request) {
      delegated.push(new URL(request.url).pathname);
      return new Response(null, { status: 204 });
    },
  };
  const handler = createReviewedBetterAuthHandler(auth, {
    now: () => new Date("2026-08-10T00:00:00.000Z"),
  });
  const request = () => new Request("https://auth.maxpower.example/api/auth/link-social", {
    method: "POST",
  });

  const stale = await handler(request());
  assert.equal(stale.status, 401);
  assert.deepEqual(delegated, []);
  const staleBody = await stale.json() as { error: { code: string } };
  assert.equal(staleBody.error.code, "reauthentication_required");

  createdAt = new Date("2026-08-09T23:58:00.000Z");
  const fresh = await handler(request());
  assert.equal(fresh.status, 204);
  assert.deepEqual(delegated, ["/api/auth/link-social"]);
});

test("production identity stack composes the device-bound V1 social flow", async (t) => {
  const database = new Pool({
    connectionString: "postgres://maxpower:test@localhost:5432/maxpower",
  });
  t.after(async () => database.end());
  const stack = createProductionIdentityStack({
    database,
    baseURL: "https://auth.maxpower.example",
    secret: "production-secret-with-at-least-thirty-two-characters",
    trustedOrigins: ["https://app.maxpower.example"],
    nativeSchemes: ["maxpower://"],
    otpDelivery: delivery,
    phoneIdentityDomain: "phone-id.maxpower.invalid",
    requiredTermsVersion: "terms-v1",
    serviceJwt: {
      issuer: "https://auth.maxpower.example",
      audience: "maxpower-api",
    },
    google: { clientIds: ["google-client"], clientSecret: "google-secret" },
    apple: {
      clientIds: ["apple-client"],
      clientSecret: "apple-secret",
      appBundleIdentifier: "com.maxpower.ios",
    },
  });

  assert.equal(typeof stack.socialAuth.start, "function");
  assert.equal(typeof stack.socialAuth.exchange, "function");
  const rawStart = await stack.authHandler(new Request(
    "https://auth.maxpower.example/api/auth/sign-in/social",
    { method: "POST" },
  ));
  assert.equal(rawStart.status, 404);
});

function requiredPlugin<
  const Plugins extends readonly { id: string }[],
  const Id extends Plugins[number]["id"],
>(
  plugins: Plugins,
  id: Id,
): Extract<Plugins[number], { id: Id }> {
  const plugin = plugins.find((candidate) => candidate.id === id);
  assert.ok(plugin, `Expected the ${id} plugin.`);
  return plugin as Extract<Plugins[number], { id: Id }>;
}
