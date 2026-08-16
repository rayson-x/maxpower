import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";

import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import type { Principal } from "../src/kernel/principal.js";
import {
  BetterAuthIdentityAdapter,
  type AuthFlowChallenge,
  type AuthFlowRegistration,
  type AuthFlowStore,
  type BetterAuthAccount,
  type BetterAuthIdentityRuntime,
  type BetterAuthRuntimeSession,
} from "../src/adapters/auth/better-auth-identity-adapter.js";
import type { IdentityIdentifier } from "../src/modules/identity/model.js";
import { createIdentityRoutes } from "../src/http/routes/identity.js";

test("production identity completes an OTP-proven registration before issuing a service JWT", async () => {
  const fixture = createFixture();
  const started = await fixture.identity.startRegistrationOtp({
    identifier: { kind: "email", value: "  Athlete@Example.COM " },
  });
  assert.deepEqual(started.identifier, {
    kind: "email",
    value: "athlete@example.com",
  });
  assert.deepEqual(fixture.runtime.sentOtp, [started.identifier]);

  const verified = await fixture.identity.verifyRegistrationOtp({
    challengeId: started.challengeId,
    code: "123456",
  });
  assert.equal(verified.status, "registration_required");
  if (verified.status !== "registration_required") return;

  await rejectsWithCode(fixture.identity.completeRegistration({
    registrationId: verified.registrationId,
    displayName: "Athlete",
    password: "short",
    termsVersion: "terms-v1",
  }), "invalid_password");

  await rejectsWithCode(fixture.identity.completeRegistration({
    registrationId: verified.registrationId,
    displayName: "Athlete",
    password: "correct horse battery staple",
    termsVersion: "old-terms",
  }), "terms_version_outdated");

  const authenticated = await fixture.identity.completeRegistration({
    registrationId: verified.registrationId,
    displayName: " Athlete ",
    password: "correct horse battery staple",
    termsVersion: "terms-v1",
  });
  assert.equal(authenticated.status, "authenticated");
  assert.equal(authenticated.displayName, "Athlete");
  assert.equal(authenticated.accessToken, "service.account_1.session_1");
  assert.equal(authenticated.sessionToken, "session-token-1");
  assert.deepEqual(fixture.runtime.completed, [{
    accountId: "account_1",
    sessionToken: "session-token-1",
    displayName: "Athlete",
    password: "correct horse battery staple",
    termsVersion: "terms-v1",
    scopes: [
      "account:read",
      "account:delete",
      "llm:invoke",
    ],
  }]);
  await rejectsWithCode(fixture.identity.completeRegistration({
    registrationId: verified.registrationId,
    displayName: "Athlete",
    password: "correct horse battery staple",
    termsVersion: "terms-v1",
  }), "registration_used");
});

test("production login OTP keeps unknown accounts indistinguishable and never auto-registers", async () => {
  const fixture = createFixture();
  const started = await fixture.identity.startLoginOtp({
    identifier: { kind: "phone", value: "+44 7700-900123" },
  });
  assert.deepEqual(started.identifier, {
    kind: "phone",
    value: "+447700900123",
  });
  assert.deepEqual(fixture.runtime.sentOtp, []);

  await rejectsWithCode(fixture.identity.verifyLoginOtp({
    challengeId: started.challengeId,
    code: "123456",
  }), "invalid_credentials");
  assert.equal(fixture.runtime.accounts.size, 0);
  assert.equal(fixture.runtime.verifyCalls.length, 0);
});

test("production password login and sign-out use the service token and Better Auth session seams", async () => {
  const fixture = createFixture();
  fixture.runtime.accounts.set("email:member@example.com", activeAccount("account_7", "Member"));

  const authenticated = await fixture.identity.loginWithPassword({
    identifier: { kind: "email", value: "MEMBER@EXAMPLE.COM" },
    password: "correct horse battery staple",
  });
  assert.equal(authenticated.accountId, "account_7");
  assert.equal(authenticated.sessionId, "password-session");
  assert.equal(authenticated.sessionToken, "password-session-token");

  const refreshed = await fixture.identity.refreshSession(authenticated.sessionToken);
  assert.equal(refreshed.accountId, "account_7");
  assert.equal(refreshed.sessionId, "password-session");
  assert.equal(refreshed.sessionToken, authenticated.sessionToken);

  await rejectsWithCode(
    fixture.identity.refreshSession("unknown-session-token"),
    "invalid_session",
  );

  await fixture.identity.signOut(authenticated.accessToken);
  assert.deepEqual(fixture.runtime.revoked, [{
    accountId: "account_7",
    sessionId: "password-session",
  }]);
});

test("new Google or Apple accounts complete terms onboarding without a password", async () => {
  const fixture = createFixture();
  const authenticated = await fixture.identity.completeSocialOnboarding({
    sessionToken: "social-session-token",
    displayName: " Social Athlete ",
    termsVersion: "terms-v1",
  });

  assert.equal(authenticated.accountId, "social-account");
  assert.equal(authenticated.displayName, "Social Athlete");
  assert.equal(authenticated.sessionToken, "social-session-token");
  assert.deepEqual(fixture.runtime.socialOnboarded, [{
    sessionToken: "social-session-token",
    displayName: "Social Athlete",
    termsVersion: "terms-v1",
    scopes: [
      "account:read",
      "account:delete",
      "llm:invoke",
    ],
  }]);
});

test("V1 auth returns the opaque session credential and refreshes a service JWT", async () => {
  const fixture = createFixture();
  fixture.runtime.accounts.set("email:member@example.com", activeAccount("account_7", "Member"));
  const signedIn = await fixture.identity.loginWithPassword({
    identifier: { kind: "email", value: "member@example.com" },
    password: "correct horse battery staple",
  });
  const app = new Hono();
  app.route("/v1", createIdentityRoutes({ identity: fixture.identity }));

  const refresh = await app.request("/v1/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionToken: signedIn.sessionToken }),
  });
  assert.equal(refresh.status, 200);
  const refreshed = await refresh.json() as {
    sessionToken: string;
    accessToken: string;
  };
  assert.equal(refreshed.sessionToken, signedIn.sessionToken);
  assert.equal(refreshed.accessToken, "service.account_7.password-session");

  const social = await app.request("/v1/auth/social/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: "social-session-token",
      displayName: "Social Athlete",
      termsVersion: "terms-v1",
    }),
  });
  assert.equal(social.status, 201);
  assert.equal(
    (await social.json() as { sessionToken: string }).sessionToken,
    "social-session-token",
  );
});

function createFixture(): {
  identity: BetterAuthIdentityAdapter;
  runtime: FakeRuntime;
} {
  const runtime = new FakeRuntime();
  const tokens = new FakeTokenVerifier();
  return {
    runtime,
    identity: new BetterAuthIdentityAdapter({
      runtime,
      flows: new MemoryFlowStore(),
      tokens,
      requiredTermsVersion: "terms-v1",
      clock: new FixedClock(),
      idFactory: (() => {
        let sequence = 0;
        return (prefix) => `${prefix}_${++sequence}`;
      })(),
    }),
  };
}

class FakeRuntime implements BetterAuthIdentityRuntime {
  readonly accounts = new Map<string, BetterAuthAccount>();
  readonly sentOtp: IdentityIdentifier[] = [];
  readonly verifyCalls: Array<{ identifier: IdentityIdentifier; allowCreate: boolean }> = [];
  readonly completed: Array<{
    accountId: string;
    sessionToken: string;
    displayName: string;
    password: string;
    termsVersion: string;
    scopes: readonly string[];
  }> = [];
  readonly revoked: Array<{ accountId: string; sessionId: string }> = [];
  readonly socialOnboarded: Array<{
    sessionToken: string;
    displayName: string;
    termsVersion: string;
    scopes: readonly string[];
  }> = [];

  async findAccount(identifier: IdentityIdentifier): Promise<BetterAuthAccount | null> {
    return this.accounts.get(identifierKey(identifier)) ?? null;
  }

  async sendOtp(identifier: IdentityIdentifier): Promise<void> {
    this.sentOtp.push({ ...identifier });
  }

  async verifyOtp(input: {
    identifier: IdentityIdentifier;
    code: string;
    allowCreate: boolean;
  }): Promise<BetterAuthRuntimeSession> {
    this.verifyCalls.push({ identifier: input.identifier, allowCreate: input.allowCreate });
    if (input.code !== "123456") throw new ApiError(401, "invalid_otp", "Invalid OTP.");
    let account = await this.findAccount(input.identifier);
    if (!account && input.allowCreate) {
      account = {
        accountId: "account_1",
        displayName: "Pending registration",
        registrationComplete: false,
        status: "restricted",
        scopes: new Set(),
      };
      this.accounts.set(identifierKey(input.identifier), account);
    }
    if (!account) throw new ApiError(401, "invalid_credentials", "Invalid credentials.");
    return {
      account,
      sessionId: "session_1",
      sessionToken: "session-token-1",
    };
  }

  async completeRegistration(input: {
    accountId: string;
    sessionToken: string;
    displayName: string;
    password: string;
    termsVersion: string;
    scopes: readonly string[];
  }): Promise<BetterAuthRuntimeSession> {
    this.completed.push(input);
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.accountId === input.accountId,
    );
    assert.ok(account);
    const completed = activeAccount(account.accountId, input.displayName);
    for (const [key, value] of this.accounts) {
      if (value.accountId === input.accountId) this.accounts.set(key, completed);
    }
    return {
      account: completed,
      sessionId: "session_1",
      sessionToken: input.sessionToken,
    };
  }

  async loginWithPassword(input: {
    identifier: IdentityIdentifier;
    password: string;
  }): Promise<BetterAuthRuntimeSession> {
    const account = await this.findAccount(input.identifier);
    if (!account || input.password !== "correct horse battery staple") {
      throw new ApiError(401, "invalid_credentials", "Invalid credentials.");
    }
    return {
      account,
      sessionId: "password-session",
      sessionToken: "password-session-token",
    };
  }

  async findSessionByToken(sessionToken: string): Promise<BetterAuthRuntimeSession | null> {
    if (sessionToken !== "password-session-token") return null;
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.accountId === "account_7",
    );
    return account ? {
      account,
      sessionId: "password-session",
      sessionToken,
    } : null;
  }

  async completeSocialOnboarding(input: {
    sessionToken: string;
    displayName: string;
    termsVersion: string;
    scopes: readonly string[];
  }): Promise<BetterAuthRuntimeSession> {
    this.socialOnboarded.push(input);
    return {
      account: activeAccount("social-account", input.displayName),
      sessionId: "social-session",
      sessionToken: input.sessionToken,
    };
  }

  async issueServiceToken(session: BetterAuthRuntimeSession): Promise<{
    token: string;
    expiresAt: string;
  }> {
    return {
      token: `service.${session.account.accountId}.${session.sessionId}`,
      expiresAt: "2026-08-10T00:05:00.000Z",
    };
  }

  async revokeSession(input: { accountId: string; sessionId: string }): Promise<void> {
    this.revoked.push(input);
  }
}

class FakeTokenVerifier {
  async verifyAccessToken(token: string): Promise<Principal> {
    const [, accountId, sessionId] = token.split(".");
    if (!accountId || !sessionId) {
      throw new ApiError(401, "invalid_access_token", "Invalid token.");
    }
    return {
      accountId,
      sessionId,
      status: "active",
      scopes: new Set(["llm:invoke"]),
    };
  }
}

class MemoryFlowStore implements AuthFlowStore {
  readonly #challenges = new Map<string, AuthFlowChallenge>();
  readonly #registrations = new Map<string, AuthFlowRegistration>();
  readonly #usedRegistrations = new Set<string>();

  async saveChallenge(challenge: AuthFlowChallenge): Promise<void> {
    this.#challenges.set(challenge.id, challenge);
  }

  async findChallenge(id: string): Promise<AuthFlowChallenge | null> {
    return this.#challenges.get(id) ?? null;
  }

  async consumeChallenge(id: string): Promise<boolean> {
    return this.#challenges.delete(id);
  }

  async saveRegistration(registration: AuthFlowRegistration): Promise<void> {
    this.#registrations.set(registration.id, registration);
  }

  async consumeRegistration(id: string): Promise<AuthFlowRegistration | "used" | null> {
    if (this.#usedRegistrations.has(id)) return "used";
    const registration = this.#registrations.get(id);
    if (!registration) return null;
    this.#registrations.delete(id);
    this.#usedRegistrations.add(id);
    return registration;
  }
}

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-08-10T00:00:00.000Z");
  }
}

function activeAccount(accountId: string, displayName: string): BetterAuthAccount {
  return {
    accountId,
    displayName,
    registrationComplete: true,
    status: "active",
    scopes: new Set(["llm:invoke"]),
  };
}

function identifierKey(identifier: IdentityIdentifier): string {
  return `${identifier.kind}:${identifier.value}`;
}

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof ApiError && error.code === code,
  );
}
