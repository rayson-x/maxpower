import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production container is multi-stage, non-root, and health checked", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS build/);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /CMD \["node", "dist\/index\.js"\]/);
});

test("compose publishes the reviewed API port and runs API, migrations, and deletion worker from one image", async () => {
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.match(compose, /api:/);
  assert.match(compose, /worker:/);
  assert.match(compose, /migrate:/);
  assert.match(compose, /expose:\s*\n\s*- "8787"/);
  assert.match(compose, /ports:\s*\n\s*- "\$\{MAXPOWER_BIND_ADDRESS:-0\.0\.0\.0\}:\$\{MAXPOWER_HOST_PORT:-3000\}:8787"/);
  assert.match(compose, /NODE_EXTRA_CA_CERTS=\/etc\/maxpower\/pki\/ca\.crt/);
  assert.match(compose, /\$\{MAXPOWER_CA_CERT_PATH:-\.\.\/maxpower-infra\/pki\/ca\.crt\}:\/etc\/maxpower\/pki\/ca\.crt:ro/);
  assert.match(compose, /external: true/);
  assert.match(compose, /name: \$\{MAXPOWER_PRIVATE_NETWORK:-maxpower-private\}/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /STREAM_REDIS_PERSISTENCE=disabled/);
});

test("package exposes build, operations, release scans, and optional staging smoke commands", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string>; dependencies?: Record<string, string> };
  assert.equal(manifest.scripts?.migrate, "tsx src/migrate.ts");
  assert.equal(manifest.scripts?.["migrate:prod"], "node dist/migrate.js");
  assert.equal(manifest.scripts?.worker, "tsx src/worker.ts");
  assert.equal(manifest.scripts?.["worker:prod"], "node dist/worker.js");
  assert.equal(
    manifest.scripts?.["admin:grant"],
    "tsx src/runtime/production/admin-grant.ts",
  );
  assert.equal(
    manifest.scripts?.["release:privacy"],
    "node --import tsx --test test/auth-production-social-exchange.test.ts test/http-security.test.ts test/llm.test.ts test/production-otp-delivery.test.ts test/production-worker.test.ts",
  );
  assert.equal(manifest.dependencies?.["@better-auth/expo"], undefined);
  assert.equal(
    manifest.scripts?.["release:scan"],
    "node dist/runtime/production/release-scan.js",
  );
  assert.equal(
    manifest.scripts?.["release:provider-smoke"],
    "node dist/runtime/production/staging-provider-smoke.js",
  );
  assert.equal(
    manifest.scripts?.["release:check"],
    "npm run check && npm run release:integration && npm run build && npm run release:scan",
  );
  assert.equal(
    manifest.scripts?.["release:verify"],
    "npm run release:check && npm run release:provider-smoke",
  );
});

test("identity operations document the device-bound OAuth exchange instead of the raw Expo cookie bridge", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const identityReadme = await readFile(
    new URL("../src/adapters/auth/README.md", import.meta.url),
    "utf8",
  );
  const documentation = `${readme}\n${identityReadme}`;
  assert.match(documentation, /\/v1\/auth\/social\/start/);
  assert.match(documentation, /deviceBinding/);
  assert.match(documentation, /code.*state/i);
  assert.doesNotMatch(documentation, /Expo authorization proxy/i);
  assert.doesNotMatch(documentation, /\/api\/auth\/get-session/);
});

test("release documentation declares synthetic-only staging smoke and artifact scan inputs", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const environment = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(readme, /MAXPOWER_SYNTHETIC_RELEASE_PROBE/);
  assert.match(readme, /release:provider-smoke/);
  assert.match(readme, /release:scan/);
  assert.match(readme, /staging_credentials_unset/);
  assert.match(environment, /MAXPOWER_STAGING_BASE_URL=https:/);
  assert.match(environment, /MAXPOWER_STAGING_ACCESS_TOKEN=/);
  assert.match(environment, /MAXPOWER_STAGING_DATABASE_URL=postgresql:/);
  assert.match(environment, /MAXPOWER_STAGING_SCENARIO_BASE_URL=https:/);
  assert.match(environment, /MAXPOWER_STAGING_SCENARIO_ACCESS_TOKEN=/);
  assert.match(environment, /MAXPOWER_STAGING_SCENARIO_DATABASE_URL=postgresql:/);
  assert.match(environment, /MAXPOWER_RELEASE_SCAN_PATHS=/);
});
