import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Pool } from "pg";

import {
  ProductionConfigurationError,
  parseMigrationConfig,
} from "./config/production-config.js";
import { applyMigrations } from "./migrations/runner.js";

async function main(): Promise<void> {
  const config = parseMigrationConfig(process.env);
  const pool = new Pool({
    connectionString: config.database.url,
    application_name: "maxpower-migrations",
    max: 2,
  });
  try {
    const result = await applyMigrations({
      pool,
      migrationsDirectory: fileURLToPath(new URL("../migrations/", import.meta.url)),
    });
    process.stdout.write(`${JSON.stringify({
      event: "maxpower_migrations_complete",
      applied: result.applied,
      skipped: result.skipped,
    })}\n`);
  } finally {
    await pool.end();
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    process.stderr.write(error instanceof ProductionConfigurationError
      ? `${error.message}\n`
      : "MaxPower migrations failed.\n");
    process.exitCode = 1;
  });
}
