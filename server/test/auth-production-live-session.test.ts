import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveSessionAccessTokenVerifier,
  type LiveIdentitySessionStore,
  type LiveIdentitySession,
} from "../src/adapters/auth/live-session-access-token-verifier.js";
import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import type { Principal } from "../src/kernel/principal.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");

test("live verifier validates the signature first and returns current session authorization", async () => {
  const calls: string[] = [];
  const signedPrincipal: Principal = {
    accountId: "account_123",
    sessionId: "session_123",
    status: "active",
    scopes: new Set(["stale:scope"]),
  };
  const store = new FakeLiveSessionStore({
    accountId: "account_123",
    sessionId: "session_123",
    expiresAt: new Date("2026-08-11T00:00:00.000Z"),
    accountStatus: "active",
    scopes: new Set(["data:read", "llm:invoke"]),
  }, calls);
  const verifier = new LiveSessionAccessTokenVerifier({
    signedTokens: {
      async verifyAccessToken(token) {
        calls.push(`signed:${token}`);
        return signedPrincipal;
      },
    },
    sessions: store,
    clock: fixedClock(),
  });

  const principal = await verifier.verifyAccessToken("signed-service-jwt");

  assert.deepEqual(calls, [
    "signed:signed-service-jwt",
    "session:account_123:session_123",
  ]);
  assert.deepEqual(principal, {
    accountId: "account_123",
    sessionId: "session_123",
    status: "active",
    scopes: new Set(["data:read", "llm:invoke"]),
  });
});

test("live verifier rejects a removed, expired or mismatched Better Auth session", async () => {
  await rejects(
    createVerifier(null).verifyAccessToken("token"),
    401,
    "invalid_access_token",
  );
  await rejects(
    createVerifier({
      accountId: "account_123",
      sessionId: "session_123",
      expiresAt: NOW,
      accountStatus: "active",
      scopes: new Set(["llm:invoke"]),
    }).verifyAccessToken("token"),
    401,
    "invalid_access_token",
  );
  await rejects(
    createVerifier({
      accountId: "other_account",
      sessionId: "session_123",
      expiresAt: new Date("2026-08-11T00:00:00.000Z"),
      accountStatus: "active",
      scopes: new Set(["llm:invoke"]),
    }).verifyAccessToken("token"),
    401,
    "invalid_access_token",
  );
});

test("live verifier rejects an account that is no longer active", async () => {
  await rejects(
    createVerifier({
      accountId: "account_123",
      sessionId: "session_123",
      expiresAt: new Date("2026-08-11T00:00:00.000Z"),
      accountStatus: "restricted",
      scopes: new Set(["llm:invoke"]),
    }).verifyAccessToken("token"),
    403,
    "account_unavailable",
  );
});

function createVerifier(session: LiveIdentitySession | null): LiveSessionAccessTokenVerifier {
  return new LiveSessionAccessTokenVerifier({
    signedTokens: {
      async verifyAccessToken() {
        return {
          accountId: "account_123",
          sessionId: "session_123",
          status: "active",
          scopes: new Set(["stale:scope"]),
        };
      },
    },
    sessions: new FakeLiveSessionStore(session),
    clock: fixedClock(),
  });
}

class FakeLiveSessionStore implements LiveIdentitySessionStore {
  readonly #session: LiveIdentitySession | null;
  readonly #calls: string[] | undefined;

  constructor(session: LiveIdentitySession | null, calls?: string[]) {
    this.#session = session;
    this.#calls = calls;
  }

  async findLiveSession(input: {
    accountId: string;
    sessionId: string;
  }): Promise<LiveIdentitySession | null> {
    this.#calls?.push(`session:${input.accountId}:${input.sessionId}`);
    return this.#session;
  }
}

function fixedClock(): Clock {
  return { now: () => new Date(NOW) };
}

async function rejects(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof ApiError && error.status === status && error.code === code,
  );
}
