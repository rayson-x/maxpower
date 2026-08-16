import assert from "node:assert/strict";
import test from "node:test";

import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
} from "jose";

import { ApiError } from "../src/kernel/api-error.js";
import { BetterAuthServiceJwtVerifier } from "../src/adapters/auth/service-jwt-verifier.js";

const ISSUER = "https://auth.maxpower.example";
const AUDIENCE = "maxpower-api";

test("service JWT verification returns a kernel Principal from bounded Better Auth claims", async () => {
  const fixture = await createFixture();
  const token = await fixture.sign({
    sub: "account_123",
    sid: "session_123",
    jti: "token_123",
    account_status: "active",
    scope: "account:read account:delete llm:invoke",
    realm: "global",
  });

  const principal = await fixture.verifier.verifyAccessToken(token);
  assert.deepEqual(principal, {
    accountId: "account_123",
    sessionId: "session_123",
    status: "active",
    scopes: new Set([
      "account:read",
      "account:delete",
      "llm:invoke",
    ]),
  });
});

test("service JWT verification fails closed for malformed authorization claims", async () => {
  const fixture = await createFixture();

  await rejectsUnauthorized(fixture.verifier.verifyAccessToken(await fixture.sign({
    sub: "account_123",
    jti: "token_123",
    account_status: "active",
    scope: "llm:invoke",
    realm: "global",
  })));
  await rejectsUnauthorized(fixture.verifier.verifyAccessToken(await fixture.sign({
    sub: "account_123",
    sid: "session_123",
    jti: "token_123",
    account_status: "unexpected-status",
    scope: "llm:invoke",
    realm: "global",
  })));
  await rejectsUnauthorized(fixture.verifier.verifyAccessToken(await fixture.sign({
    sub: "account_123",
    sid: "session_123",
    jti: "token_123",
    account_status: "active",
    scope: "llm:invoke",
    realm: "global",
  }, 301)));
  await rejectsUnauthorized(fixture.verifier.verifyAccessToken(await fixture.sign({
    sub: "account_123",
    sid: "session_123",
    jti: "token_123",
    account_status: "active",
    scope: "llm:invoke",
    realm: "cn",
  })));
});

interface Fixture {
  verifier: BetterAuthServiceJwtVerifier;
  sign(
    claims: Record<string, unknown>,
    lifetimeSeconds?: number,
  ): Promise<string>;
}

async function createFixture(): Promise<Fixture> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const publicJwk = await exportJWK(publicKey);
  const keySet: JSONWebKeySet = {
    keys: [{ ...publicJwk, alg: "EdDSA", kid: "test-key", use: "sig" }],
  };
  return {
    verifier: new BetterAuthServiceJwtVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: keySet,
    }),
    async sign(claims, lifetimeSeconds = 300) {
      const issuedAt = Math.floor(Date.now() / 1_000);
      return signClaims(privateKey, claims, issuedAt, lifetimeSeconds);
    },
  };
}

async function signClaims(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  issuedAt: number,
  lifetimeSeconds: number,
): Promise<string> {
  const subject = typeof claims.sub === "string" ? claims.sub : undefined;
  const payload = { ...claims };
  delete payload.sub;
  let signer = new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetimeSeconds);
  if (subject) signer = signer.setSubject(subject);
  return signer.sign(privateKey);
}

async function rejectsUnauthorized(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
}
