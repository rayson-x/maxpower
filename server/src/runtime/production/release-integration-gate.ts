import { Pool } from "pg";

const databaseUrl = process.env.MAXPOWER_TEST_POSTGRES_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "release_integration_database_required: set MAXPOWER_TEST_POSTGRES_URL and rerun release:check",
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
  application_name: "maxpower-release-integration-gate",
  max: 1,
});
try {
  const result = await pool.query<{ server_version_num: string }>(
    "SELECT current_setting('server_version_num') AS server_version_num",
  );
  const version = Number(result.rows[0]?.server_version_num);
  if (!Number.isSafeInteger(version) || version < 170_000) {
    throw new Error("release_integration_postgres_17_required");
  }
  process.stdout.write(`${JSON.stringify({
    event: "release_integration_database_ready",
    postgresMajor: Math.floor(version / 10_000),
  })}\n`);
} finally {
  await pool.end();
}
