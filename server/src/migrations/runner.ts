import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const EXPECTED_MIGRATIONS = [
  "010-better-auth.sql",
  "020-product-data.sql",
  "030-media-library.sql",
  "040-llm-entitlements.sql",
  "050-account-deletion.sql",
] as const;

export interface MigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export interface ApplyMigrationsOptions {
  pool: MigrationPool;
  migrationsDirectory: string;
}

export interface ApplyMigrationsResult {
  applied: string[];
  skipped: string[];
}

export async function loadMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const present = new Set(await readdir(directory));
  for (const name of EXPECTED_MIGRATIONS) {
    if (!present.has(name)) {
      throw new Error(`Required migration ${name} is missing.`);
    }
  }
  const unexpected = [...present]
    .filter((name) => /^\d{3}-.+\.sql$/.test(name))
    .filter((name) => !EXPECTED_MIGRATIONS.includes(name as never));
  if (unexpected.length > 0) {
    throw new Error(`Unreviewed numbered migrations are present: ${unexpected.sort().join(", ")}.`);
  }

  return Promise.all(EXPECTED_MIGRATIONS.map(async (name) => {
    const source = await readFile(join(directory, name), "utf8");
    return {
      name,
      checksum: createHash("sha256").update(source).digest("hex"),
      sql: migrationBody(source, name),
    };
  }));
}

/** Applies reviewed migrations under one PostgreSQL session lock. */
export async function applyMigrations(
  options: ApplyMigrationsOptions,
): Promise<ApplyMigrationsResult> {
  const migrations = await loadMigrationFiles(options.migrationsDirectory);
  const client = await options.pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 73))", [
      "maxpower-schema-migrations",
    ]);
    locked = true;
    await client.query("CREATE SCHEMA IF NOT EXISTS maxpower");
    await client.query(`CREATE TABLE IF NOT EXISTS maxpower.schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL
    )`);
    const existing = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM maxpower.schema_migrations ORDER BY name",
    );
    const checksums = new Map(existing.rows.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const previousChecksum = checksums.get(migration.name);
      if (previousChecksum !== undefined) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(`Applied migration ${migration.name} has a checksum mismatch.`);
        }
        skipped.push(migration.name);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO maxpower.schema_migrations (name, checksum, applied_at)
           VALUES ($1, $2, now())`,
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        applied.push(migration.name);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the migration failure as the actionable error.
        }
        throw error;
      }
    }
    return { applied, skipped };
  } finally {
    try {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 73))", [
          "maxpower-schema-migrations",
        ]);
      }
    } finally {
      client.release();
    }
  }
}

function migrationBody(source: string, name: string): string {
  const match = /^\s*BEGIN\s*;([\s\S]*?)COMMIT\s*;\s*$/i.exec(source);
  if (match === null || match[1] === undefined || !match[1].trim()) {
    throw new Error(`${name} must contain one outer BEGIN/COMMIT transaction.`);
  }
  return match[1].trim();
}
