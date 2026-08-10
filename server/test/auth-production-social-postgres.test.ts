import assert from "node:assert/strict";
import test from "node:test";

import { Pool } from "pg";

import { ApiError } from "../src/kernel/api-error.js";
import {
  BetterAuthRuntime,
} from "../src/adapters/auth/better-auth-runtime.js";
import {
  createProductionBetterAuth,
  type ProductionOtpDelivery,
} from "../src/adapters/auth/production-auth.js";
import {
  BetterAuthVerificationSocialAuthStateStore,
  type SocialAuthExchangeRecord,
} from "../src/adapters/auth/better-auth-social-flow.js";
import { applyMigrations } from "../src/migrations/runner.js";

const databaseUrl = process.env.MAXPOWER_TEST_POSTGRES_URL;
const delivery: ProductionOtpDelivery = {
  async sendEmailOtp() {},
  async sendSmsOtp() {},
};

test(
  "PostgreSQL verification state atomically consumes a social exchange across server instances",
  { skip: databaseUrl === undefined },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await prepareDatabase(pool);
      await pool.query(
        `DELETE FROM "verification" WHERE identifier LIKE 'maxpower:social:%'`,
      );
      const first = new BetterAuthVerificationSocialAuthStateStore(createAuth(pool));
      const second = new BetterAuthVerificationSocialAuthStateStore(createAuth(pool));
      const exchange: SocialAuthExchangeRecord = {
        codeDigest: "a1".repeat(32),
        provider: "google",
        callbackUrl: "maxpower://auth/callback",
        deviceBindingDigest: "b2".repeat(32),
        exchangeStateDigest: "c3".repeat(32),
        sessionToken: "opaque-server-session-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      await first.saveExchange(exchange);

      const durable = await pool.query<{ identifier: string; value: string }>(
        `SELECT identifier, value FROM "verification"
         WHERE identifier LIKE 'maxpower:social:exchange:%'`,
      );
      assert.equal(durable.rows.length, 1);
      assert.match(durable.rows[0]?.identifier ?? "", /^[^:]+:[^:]+:[^:]+:[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(durable.rows).includes("device-binding-plaintext"), false);
      assert.equal(JSON.stringify(durable.rows).includes("one-time-code-plaintext"), false);

      const consumed = await Promise.all([
        first.consumeExchange(exchange.codeDigest),
        second.consumeExchange(exchange.codeDigest),
      ]);
      assert.equal(consumed.filter((value) => value !== null).length, 1);
      assert.equal(consumed.filter((value) => value === null).length, 1);
    } finally {
      await pool.query(
        `DELETE FROM "verification" WHERE identifier LIKE 'maxpower:social:%'`,
      ).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "social onboarding cannot reactivate an account after deletion wins the account row race",
  { skip: databaseUrl === undefined },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const accountId = "social-pending-deletion-test";
    const sessionToken = "social-pending-deletion-session-token";
    try {
      await prepareDatabase(pool);
      await pool.query(`DELETE FROM "user" WHERE id = $1`, [accountId]);
      await pool.query(
        `INSERT INTO "user"
          (id, name, email, "emailVerified", "createdAt", "updatedAt",
           "accountStatus", scopes, "registrationComplete")
         VALUES ($1, 'Pending social user', $2, true, now(), now(),
                 'restricted', '', false)`,
        [accountId, `${accountId}@example.invalid`],
      );
      await pool.query(
        `INSERT INTO "account"
          (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
         VALUES ($1, $2, 'google', $2, now(), now())`,
        [`account-${accountId}`, accountId],
      );
      await pool.query(
        `INSERT INTO "session"
          (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
         VALUES ($1, now() + interval '1 hour', $2, now(), now(), $3)`,
        [`session-${accountId}`, sessionToken, accountId],
      );

      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      await blocker.query(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`, [accountId]);
      const runtime = new BetterAuthRuntime(createAuth(pool), delivery);
      const onboarding = runtime.completeSocialOnboarding({
        sessionToken,
        displayName: "Must not revive",
        termsVersion: "2026-08-10",
        scopes: ["llm:invoke"],
      });
      await blocker.query(
        `UPDATE "user"
            SET "accountStatus" = 'pending_deletion', "updatedAt" = now()
          WHERE id = $1`,
        [accountId],
      );
      await blocker.query("COMMIT");
      blocker.release();

      await assert.rejects(onboarding, (error: unknown) =>
        error instanceof ApiError && error.code === "social_onboarding_unavailable"
      );
      const status = await pool.query<{ accountStatus: string; registrationComplete: boolean }>(
        `SELECT "accountStatus", "registrationComplete" FROM "user" WHERE id = $1`,
        [accountId],
      );
      assert.deepEqual(status.rows[0], {
        accountStatus: "pending_deletion",
        registrationComplete: false,
      });
    } finally {
      await pool.query(`DELETE FROM "user" WHERE id = $1`, [accountId]).catch(() => undefined);
      await pool.end();
    }
  },
);

async function prepareDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS maxpower CASCADE");
  await pool.query(
    `DROP TABLE IF EXISTS "rateLimit", "jwks", "verification", "account", "session", "user" CASCADE`,
  );
  await applyMigrations({
    pool,
    migrationsDirectory: new URL("../migrations/", import.meta.url).pathname,
  });
}

function createAuth(pool: Pool) {
  return createProductionBetterAuth({
    database: pool,
    baseURL: "https://api.maxpower.example",
    secret: "production-test-secret-that-is-at-least-32-characters",
    trustedOrigins: ["https://app.maxpower.example"],
    nativeSchemes: ["maxpower://"],
    otpDelivery: {
      sendEmailOtp: delivery.sendEmailOtp,
      sendSmsOtp: delivery.sendSmsOtp,
    },
    phoneIdentityDomain: "phone.maxpower.example",
    requiredTermsVersion: "2026-08-10",
    serviceJwt: {
      issuer: "https://api.maxpower.example",
      audience: "maxpower-client",
    },
    google: {
      clientIds: ["google-client-id"],
      clientSecret: "google-client-secret",
    },
    apple: {
      clientIds: ["apple-client-id"],
      clientSecret: "apple-client-secret",
      appBundleIdentifier: "com.maxpower.app",
    },
  });
}
