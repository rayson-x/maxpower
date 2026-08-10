import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXPECTED_MIGRATIONS,
  applyMigrations,
  loadMigrationFiles,
} from "../src/migrations/runner.js";

test("migration loader requires and orders 010 through 050", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-migrations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of [...EXPECTED_MIGRATIONS].reverse()) {
    await writeFile(join(directory, name), "BEGIN;\nSELECT 1;\nCOMMIT;\n", "utf8");
  }

  const migrations = await loadMigrationFiles(directory);
  assert.deepEqual(migrations.map((migration) => migration.name), EXPECTED_MIGRATIONS);
  assert.ok(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum)));
});

test("checked-in release contains the complete reviewed migration chain", async () => {
  const migrations = await loadMigrationFiles(
    new URL("../migrations/", import.meta.url).pathname,
  );
  assert.deepEqual(migrations.map((migration) => migration.name), EXPECTED_MIGRATIONS);
});

test("migration loader refuses a release with a missing numbered migration", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-migrations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of EXPECTED_MIGRATIONS.slice(1)) {
    await writeFile(join(directory, name), "BEGIN;\nSELECT 1;\nCOMMIT;\n", "utf8");
  }

  await assert.rejects(() => loadMigrationFiles(directory), /010-better-auth\.sql.*missing/i);
});

test("migration runner applies each file and its checksum in one transaction", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-migrations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [index, name] of EXPECTED_MIGRATIONS.entries()) {
    await writeFile(
      join(directory, name),
      `BEGIN;\nSELECT ${index + 10} AS migration_marker;\nCOMMIT;\n`,
      "utf8",
    );
  }
  const client = new RecordingMigrationClient();

  const result = await applyMigrations({
    pool: { async connect() { return client; } },
    migrationsDirectory: directory,
  });

  assert.deepEqual(result.applied, EXPECTED_MIGRATIONS);
  assert.deepEqual(result.skipped, []);
  for (const name of EXPECTED_MIGRATIONS) {
    const begin = client.operations.indexOf("BEGIN", client.operations.indexOf(name) - 3);
    const recorded = client.operations.indexOf(name);
    const commit = client.operations.indexOf("COMMIT", recorded);
    assert.ok(begin >= 0 && begin < recorded && recorded < commit, name);
  }
  assert.equal(client.released, true);
  assert.equal(client.operations.at(-2), "SELECT pg_advisory_unlock(hashtextextended($1, 73))");
});

class RecordingMigrationClient {
  readonly operations: string[] = [];
  readonly applied = new Map<string, string>();
  released = false;

  async query<Row = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    const normalized = sql.trim();
    if (normalized.includes("SELECT name, checksum") && normalized.includes("schema_migrations")) {
      return {
        rows: [...this.applied].map(([name, checksum]) => ({ name, checksum })) as Row[],
      };
    }
    if (normalized.includes("INSERT INTO maxpower.schema_migrations")) {
      const name = String(values[0]);
      const checksum = String(values[1]);
      this.applied.set(name, checksum);
      this.operations.push(name);
      return { rows: [] };
    }
    this.operations.push(normalized);
    return { rows: [] };
  }

  release(): void {
    this.released = true;
    this.operations.push("release");
  }
}
