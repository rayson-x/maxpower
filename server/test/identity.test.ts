import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import { DefaultAuthorizationModule } from "../src/modules/authorization/index.js";
import {
  InMemoryIdentityAdapter,
  LOCAL_TEST_ONLY_DEBUG_OTP,
  OTP_CHALLENGE_TTL_MS,
  type AuthenticatedIdentity,
} from "../src/modules/identity/index.js";

const DEFAULT_SCOPES = [
  "account:read",
  "account:delete",
  "data:read",
  "data:write",
  "media:read",
  "media:write",
  "llm:invoke",
] as const;

test("new email registration normalizes identity, requires profile fields, and returns a principal", async () => {
  const fixture = createFixture();
  const started = await fixture.identity.startRegistrationOtp({
    identifier: { kind: "email", value: "  Athlete@Example.COM " },
  });

  assert.deepEqual(started.identifier, { kind: "email", value: "athlete@example.com" });
  assert.equal(
    Date.parse(started.expiresAt) - fixture.clock.now().getTime(),
    OTP_CHALLENGE_TTL_MS,
  );
  await rejectsWithCode(
    fixture.identity.verifyRegistrationOtp({ challengeId: started.challengeId, code: "000000" }),
    "invalid_otp",
  );

  const verified = await fixture.identity.verifyRegistrationOtp({
    challengeId: started.challengeId,
    code: LOCAL_TEST_ONLY_DEBUG_OTP,
  });
  assert.equal(verified.status, "registration_required");
  if (verified.status !== "registration_required") return;

  await rejectsWithCode(
    fixture.identity.completeRegistration({
      registrationId: verified.registrationId,
      displayName: "   ",
      password: "correct horse battery staple",
      termsVersion: "terms-v1",
    }),
    "display_name_required",
  );
  await rejectsWithCode(
    fixture.identity.completeRegistration({
      registrationId: verified.registrationId,
      displayName: "Rui",
      password: "short",
      termsVersion: "terms-v1",
    }),
    "invalid_password",
  );
  await rejectsWithCode(
    fixture.identity.completeRegistration({
      registrationId: verified.registrationId,
      displayName: "Rui",
      password: "correct horse battery staple",
      termsVersion: " ",
    }),
    "terms_required",
  );

  const authenticated = await fixture.identity.completeRegistration({
    registrationId: verified.registrationId,
    displayName: " Rui ",
    password: "correct horse battery staple",
    termsVersion: "terms-v1",
  });
  assert.equal(authenticated.displayName, "Rui");
  const principal = await fixture.identity.verifyAccessToken(authenticated.accessToken);
  assert.equal(principal.accountId, authenticated.accountId);
  assert.equal(principal.sessionId, authenticated.sessionId);
  assert.equal(principal.status, "active");
  assert.deepEqual([...principal.scopes], DEFAULT_SCOPES);
});

test("registration OTP for an existing normalized identifier signs in directly", async () => {
  const fixture = createFixture();
  const first = await registerEmail(fixture, "member@example.com");
  const started = await fixture.identity.startRegistrationOtp({
    identifier: { kind: "email", value: "MEMBER@EXAMPLE.COM" },
  });
  const result = await fixture.identity.verifyRegistrationOtp({
    challengeId: started.challengeId,
    code: LOCAL_TEST_ONLY_DEBUG_OTP,
  });

  assert.equal(result.status, "authenticated");
  if (result.status !== "authenticated") return;
  assert.equal(result.accountId, first.accountId);
  assert.notEqual(result.sessionId, first.sessionId);
});

test("login OTP is single-use and an unknown login never creates an account", async () => {
  const fixture = createFixture();
  const registered = await registerEmail(fixture, "known@example.com");
  const known = await fixture.identity.startLoginOtp({
    identifier: { kind: "email", value: "known@example.com" },
  });
  const loggedIn = await fixture.identity.verifyLoginOtp({
    challengeId: known.challengeId,
    code: LOCAL_TEST_ONLY_DEBUG_OTP,
  });
  assert.equal(loggedIn.accountId, registered.accountId);
  await rejectsWithCode(
    fixture.identity.verifyLoginOtp({
      challengeId: known.challengeId,
      code: LOCAL_TEST_ONLY_DEBUG_OTP,
    }),
    "otp_challenge_used",
  );

  const unknownIdentifier = { kind: "email", value: "unknown@example.com" } as const;
  const unknownLogin = await fixture.identity.startLoginOtp({ identifier: unknownIdentifier });
  await rejectsWithCode(
    fixture.identity.verifyLoginOtp({
      challengeId: unknownLogin.challengeId,
      code: LOCAL_TEST_ONLY_DEBUG_OTP,
    }),
    "invalid_credentials",
  );

  const registration = await fixture.identity.startRegistrationOtp({ identifier: unknownIdentifier });
  const result = await fixture.identity.verifyRegistrationOtp({
    challengeId: registration.challengeId,
    code: LOCAL_TEST_ONLY_DEBUG_OTP,
  });
  assert.equal(result.status, "registration_required");
});

test("phone identifiers normalize to E.164 and OTP challenges expire after five minutes", async () => {
  const fixture = createFixture();
  const started = await fixture.identity.startRegistrationOtp({
    identifier: { kind: "phone", value: "0044 7700-900123" },
  });
  assert.deepEqual(started.identifier, { kind: "phone", value: "+447700900123" });

  fixture.clock.advance(OTP_CHALLENGE_TTL_MS);
  await rejectsWithCode(
    fixture.identity.verifyRegistrationOtp({
      challengeId: started.challengeId,
      code: LOCAL_TEST_ONLY_DEBUG_OTP,
    }),
    "otp_challenge_expired",
  );
});

test("password login returns a bearer token and sign-out revokes that session", async () => {
  const fixture = createFixture();
  const registered = await registerEmail(fixture, "password@example.com");
  await rejectsWithCode(
    fixture.identity.loginWithPassword({
      identifier: { kind: "email", value: "password@example.com" },
      password: "wrong password",
    }),
    "invalid_credentials",
  );

  const loggedIn = await fixture.identity.loginWithPassword({
    identifier: { kind: "email", value: "PASSWORD@EXAMPLE.COM" },
    password: "correct horse battery staple",
  });
  assert.equal(loggedIn.accountId, registered.accountId);
  assert.notEqual(loggedIn.sessionToken, loggedIn.accessToken);

  fixture.clock.advance(5 * 60 * 1_000);
  await rejectsWithCode(
    fixture.identity.verifyAccessToken(loggedIn.accessToken),
    "invalid_access_token",
  );
  const refreshed = await fixture.identity.refreshSession(loggedIn.sessionToken);
  assert.equal(refreshed.sessionId, loggedIn.sessionId);
  assert.equal(refreshed.sessionToken, loggedIn.sessionToken);
  assert.notEqual(refreshed.accessToken, loggedIn.accessToken);
  assert.equal(
    (await fixture.identity.verifyAccessToken(refreshed.accessToken)).accountId,
    registered.accountId,
  );
  await fixture.identity.signOut(refreshed.accessToken);
  await rejectsWithCode(
    fixture.identity.refreshSession(loggedIn.sessionToken),
    "invalid_session",
  );

  // Revoking one session does not revoke a different session for the account.
  const registeredRefreshed = await fixture.identity.refreshSession(registered.sessionToken);
  assert.equal(
    (await fixture.identity.verifyAccessToken(registeredRefreshed.accessToken)).accountId,
    registered.accountId,
  );
});

test("authorization requires both an allowed account status and the requested scope", async () => {
  const fixture = createFixture();
  const authenticated = await registerEmail(fixture, "scope@example.com");
  const authorization = new DefaultAuthorizationModule();
  const active = await fixture.identity.verifyAccessToken(authenticated.accessToken);

  assert.equal(authorization.authorize(active, { scope: "llm:invoke" }), active);
  assert.throws(
    () => authorization.authorize(active, { scope: "admin:write" }),
    isApiError("missing_scope", 403),
  );

  fixture.identity.setAccountAuthorizationForLocalTest({
    accountId: authenticated.accountId,
    status: "restricted",
    scopes: ["llm:invoke"],
  });
  const restricted = await fixture.identity.verifyAccessToken(authenticated.accessToken);
  assert.throws(
    () => authorization.authorize(restricted, { scope: "llm:invoke" }),
    isApiError("account_unavailable", 403),
  );
  assert.equal(
    authorization.authorize(restricted, {
      scope: "llm:invoke",
      allowedStatuses: ["active", "restricted"],
    }),
    restricted,
  );

  fixture.identity.setAccountAuthorizationForLocalTest({
    accountId: authenticated.accountId,
    status: "pending_deletion",
  });
  const pendingDeletion = await fixture.identity.verifyAccessToken(authenticated.accessToken);
  assert.throws(
    () => authorization.authorize(pendingDeletion, { scope: "llm:invoke" }),
    isApiError("account_unavailable", 403),
  );
});

class MutableClock implements Clock {
  #nowMs = Date.parse("2026-08-10T00:00:00.000Z");

  now(): Date {
    return new Date(this.#nowMs);
  }

  advance(milliseconds: number): void {
    this.#nowMs += milliseconds;
  }
}

function createFixture(): {
  clock: MutableClock;
  identity: InMemoryIdentityAdapter;
} {
  const clock = new MutableClock();
  let sequence = 0;
  return {
    clock,
    identity: new InMemoryIdentityAdapter({
      clock,
      idFactory: (prefix) => `${prefix}_${++sequence}`,
    }),
  };
}

async function registerEmail(
  fixture: ReturnType<typeof createFixture>,
  email: string,
): Promise<AuthenticatedIdentity> {
  const started = await fixture.identity.startRegistrationOtp({
    identifier: { kind: "email", value: email },
  });
  const verified = await fixture.identity.verifyRegistrationOtp({
    challengeId: started.challengeId,
    code: LOCAL_TEST_ONLY_DEBUG_OTP,
  });
  assert.equal(verified.status, "registration_required");
  if (verified.status !== "registration_required") {
    throw new Error("Expected a new registration.");
  }
  return fixture.identity.completeRegistration({
    registrationId: verified.registrationId,
    displayName: "Athlete",
    password: "correct horse battery staple",
    termsVersion: "terms-v1",
  });
}

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, isApiError(code));
}

function isApiError(code: string, status?: number): (error: unknown) => boolean {
  return (error: unknown): boolean => (
    error instanceof ApiError &&
    error.code === code &&
    (status === undefined || error.status === status)
  );
}
