/**
 * Schema-generation entrypoint only.
 *
 * See README.md for the isolated PostgreSQL command used to audit the checked-in
 * migration. Generate to /tmp so the migration runner's outer transaction is
 * not accidentally removed.
 *
 * Never import this file from the production runtime. Its delivery boundary is
 * deliberately unusable and its placeholder credentials exist only so the
 * official Better Auth CLI can inspect the complete schema deterministically.
 */
import { Pool } from "pg";

import { createProductionBetterAuth } from "./production-auth.js";

const schemaOnlyDatabase = new Pool({
  connectionString: process.env.BETTER_AUTH_SCHEMA_DATABASE_URL ??
    "postgres://schema:schema@127.0.0.1:55432/schema",
});

export const auth = createProductionBetterAuth({
  database: schemaOnlyDatabase,
  baseURL: "https://schema.invalid",
  secret: "schema-generation-only-secret-never-use-at-runtime",
  trustedOrigins: ["https://schema-client.invalid"],
  nativeSchemes: ["maxpower://"],
  otpDelivery: {
    async sendEmailOtp() {
      throw new Error("Schema-only auth configuration cannot deliver OTPs.");
    },
    async sendSmsOtp() {
      throw new Error("Schema-only auth configuration cannot deliver OTPs.");
    },
  },
  phoneIdentityDomain: "phone.schema.invalid",
  requiredTermsVersion: "schema-v1",
  serviceJwt: {
    issuer: "https://schema.invalid",
    audience: "maxpower-api",
  },
  google: {
    clientIds: ["schema-google-client"],
    clientSecret: "schema-google-secret",
  },
  apple: {
    clientIds: ["schema-apple-client"],
    clientSecret: "schema-apple-secret",
    appBundleIdentifier: "com.maxpower.app",
  },
});
