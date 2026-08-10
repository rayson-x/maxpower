import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Pool } from "pg";

import { PostgresLlmEntitlementAdapter } from "../../adapters/entitlements/postgres-entitlements.js";
import { grantAdministrativeCredits } from "./entitlement-grants.js";

export interface AdminGrantArguments {
  accountId: string;
  credits: number;
  sourceRef: string;
}

export function parseAdminGrantArguments(args: readonly string[]): AdminGrantArguments {
  if (args.length !== 3) {
    throw new Error("Usage: admin:grant <account-id> <credits> <source-ref>");
  }
  const accountId = args[0]?.trim() ?? "";
  const credits = Number(args[1]);
  const sourceRef = args[2]?.trim() ?? "";
  if (!accountId) throw new Error("account-id is required.");
  if (!Number.isSafeInteger(credits) || credits < 1) {
    throw new Error("credits must be a positive integer.");
  }
  if (!sourceRef || sourceRef.length > 160 || !/^[a-zA-Z0-9_.:@/-]+$/.test(sourceRef)) {
    throw new Error("source-ref must be a short operational reference without spaces.");
  }
  return { accountId, credits, sourceRef };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Admin grants require NODE_ENV=production.");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!isTlsPostgresUrl(databaseUrl)) {
    throw new Error("Admin grants require a TLS PostgreSQL DATABASE_URL.");
  }
  const input = parseAdminGrantArguments(process.argv.slice(2));
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "maxpower-admin-grant",
    max: 2,
  });
  try {
    const result = await grantAdministrativeCredits({
      grants: new PostgresLlmEntitlementAdapter(pool),
      ...input,
    });
    process.stdout.write(`${JSON.stringify({
      event: "admin_llm_grant_applied",
      created: result.created,
      accountHash: createHash("sha256").update(input.accountId).digest("hex").slice(0, 12),
    })}\n`);
  } finally {
    await pool.end();
  }
}

function isTlsPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const sslMode = url.searchParams.get("sslmode");
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      (sslMode === "require" || sslMode === "verify-full")
    );
  } catch {
    return false;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  void main().catch(() => {
    process.stderr.write("MaxPower admin grant failed.\n");
    process.exitCode = 1;
  });
}
