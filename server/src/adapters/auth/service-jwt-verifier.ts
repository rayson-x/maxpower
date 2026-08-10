import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

import { unauthorized } from "../../kernel/api-error.js";
import type { AccountStatus, Principal } from "../../kernel/principal.js";
import { SERVICE_JWT_TTL_SECONDS } from "./production-auth.js";

export interface BetterAuthServiceJwtVerifierOptions {
  issuer: string;
  audience: string;
  /** Remote production JWKS URL or an immutable local key set for tests/tools. */
  jwks: URL | JSONWebKeySet;
  maxTokenLifetimeSeconds?: number;
  clockToleranceSeconds?: number;
  /** Service market/data realm. V1 is intentionally global-only. */
  realm?: "global";
}

/**
 * Offline verifier for Better Auth service JWTs. It never accepts Better Auth
 * session tokens or provider tokens, and it fails closed on every custom claim.
 */
export class BetterAuthServiceJwtVerifier {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #jwks: JWTVerifyGetKey;
  readonly #maxTokenLifetimeSeconds: number;
  readonly #clockToleranceSeconds: number;
  readonly #realm: "global";

  constructor(options: BetterAuthServiceJwtVerifierOptions) {
    this.#issuer = required(options.issuer, "issuer");
    this.#audience = required(options.audience, "audience");
    this.#jwks = options.jwks instanceof URL
      ? createRemoteJWKSet(options.jwks)
      : createLocalJWKSet(options.jwks);
    this.#maxTokenLifetimeSeconds = positiveInteger(
      options.maxTokenLifetimeSeconds ?? SERVICE_JWT_TTL_SECONDS,
      "maxTokenLifetimeSeconds",
    );
    this.#clockToleranceSeconds = nonNegativeInteger(
      options.clockToleranceSeconds ?? 5,
      "clockToleranceSeconds",
    );
    this.#realm = options.realm ?? "global";
  }

  async verifyAccessToken(token: string): Promise<Principal> {
    try {
      const normalized = required(token, "token");
      const { payload } = await jwtVerify(normalized, this.#jwks, {
        issuer: this.#issuer,
        audience: this.#audience,
        algorithms: ["EdDSA"],
        clockTolerance: this.#clockToleranceSeconds,
        requiredClaims: [
          "sub",
          "iat",
          "exp",
          "jti",
          "sid",
          "scope",
          "account_status",
          "realm",
        ],
      });

      if (
        typeof payload.sub !== "string" || !payload.sub ||
        typeof payload.sid !== "string" || !payload.sid ||
        typeof payload.jti !== "string" || !payload.jti ||
        typeof payload.scope !== "string" ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number"
      ) {
        throw unauthorized("The access token has invalid claims.");
      }
      if (payload.realm !== this.#realm) {
        throw unauthorized("The access token realm is invalid.");
      }
      const nowSeconds = Math.floor(Date.now() / 1_000);
      if (
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > this.#maxTokenLifetimeSeconds ||
        payload.iat > nowSeconds + this.#clockToleranceSeconds
      ) {
        throw unauthorized("The access token lifetime is invalid.");
      }

      return {
        accountId: payload.sub,
        sessionId: payload.sid,
        status: parseAccountStatus(payload.account_status),
        scopes: parseScopes(payload.scope),
      };
    } catch {
      throw unauthorized("The access token is invalid or expired.");
    }
  }
}

function parseAccountStatus(value: unknown): AccountStatus {
  if (value === "active" || value === "restricted" || value === "pending_deletion") {
    return value;
  }
  throw unauthorized("The access token has an invalid account status.");
}

function parseScopes(value: string): ReadonlySet<string> {
  const scopes = value.split(/\s+/).filter(Boolean);
  if (scopes.some((scope) => !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(scope))) {
    throw unauthorized("The access token has invalid scopes.");
  }
  return new Set(scopes);
}

function required(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}
