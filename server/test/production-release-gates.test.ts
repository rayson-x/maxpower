import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  configuredRuntimeSecrets,
  scanReleaseArtifacts,
} from "../src/runtime/production/release-scan.js";
import { runStagingProviderSmoke } from "../src/runtime/production/staging-provider-smoke.js";

test("release artifact scan finds credential shapes and configured secrets without echoing them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-release-scan-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const configuredSecret = "private-runtime-credential-123456789";
  await writeFile(join(directory, "clean.js"), "export const endpoint = 'https://api.example';\n");
  await writeFile(
    join(directory, "unsafe.js"),
    `export const a = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';\n` +
      `export const b = '${configuredSecret}';\n`,
  );

  const findings = await scanReleaseArtifacts({
    roots: [directory],
    forbiddenValues: [configuredSecret],
  });

  assert.deepEqual(
    findings.map(({ rule }) => rule).sort(),
    ["configured_secret", "openai_api_key"],
  );
  assert.equal(JSON.stringify(findings).includes(configuredSecret), false);
  assert.equal(JSON.stringify(findings).includes("sk-proj-"), false);
});

test("release artifact scan accepts a clean bundle", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-release-clean-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const bundle = join(directory, "index.js");
  await writeFile(bundle, "export const model = 'maxpower-cloud';\n");

  assert.deepEqual(await scanReleaseArtifacts({ roots: [directory] }), []);
  assert.deepEqual(await scanReleaseArtifacts({ roots: [bundle] }), []);
});

test("release artifact scan covers database and Redis credentials", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-release-runtime-secrets-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "unsafe.js"),
    "export const leaked = ['database-password-123', 'redis-password-456'];\n",
  );

  const forbiddenValues = configuredRuntimeSecrets({
    DATABASE_URL: "postgresql://service:database-password-123@db.example/maxpower?sslmode=verify-full",
    RATE_LIMIT_REDIS_URL: "rediss://service:redis-password-456@redis.example:6380/0",
  });
  const findings = await scanReleaseArtifacts({ roots: [directory], forbiddenValues });

  assert.deepEqual(findings.map(({ rule }) => rule), ["configured_secret"]);
  assert.equal(JSON.stringify(findings).includes("password"), false);
});

test("release artifact scan does not ignore short configured secrets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-release-short-secret-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "unsafe.js"), "export const leaked = 'tiny-key';\n");
  const findings = await scanReleaseArtifacts({ roots: [directory], forbiddenValues: ["tiny-key"] });
  assert.deepEqual(findings.map(({ rule }) => rule), ["configured_secret"]);
});

test("staging Provider smoke explicitly skips when credentials are absent", async () => {
  const lines: string[] = [];
  const result = await runStagingProviderSmoke({
    env: {},
    async fetch() {
      throw new Error("fetch must not run without staging credentials");
    },
    writeLine(line) {
      lines.push(line);
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "staging_credentials_unset" });
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{
    event: "maxpower_staging_provider_smoke",
    status: "skipped",
    reason: "staging_credentials_unset",
  }]);
});

test("staging Provider smoke blocks release when deterministic scenario probes are absent", async () => {
  const result = await runStagingProviderSmoke({
    env: {
      MAXPOWER_STAGING_BASE_URL: "https://staging.maxpower.example",
      MAXPOWER_STAGING_ACCESS_TOKEN: "ephemeral-staging-token",
    },
    async fetch() {
      throw new Error("fetch must not run without scenario probe credentials");
    },
    writeLine() {},
  });
  assert.deepEqual(result, { status: "blocked", reason: "staging_scenario_probe_unset" });
});

test("staging Provider smoke exercises usage, tools, cancellation, timeout and outage", async () => {
  const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
  const responses = [
    Response.json({ status: "ok" }),
    Response.json({ status: "ready" }),
    Response.json({ openapi: "3.1.0" }),
    new Response(JSON.stringify({
      id: "chatcmpl_smoke-json",
      object: "chat.completion",
      model: "maxpower-cloud",
      choices: [{ index: 0, message: { role: "assistant", content: "READY" } }],
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-maxpower-invocation-id": "smoke-json",
      },
    }),
    new Response(
      'id: 1\ndata: {"id":"chatcmpl_smoke-sse","object":"chat.completion.chunk","model":"maxpower-cloud","choices":[]}\n\ndata: [DONE]\n\n',
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=UTF-8",
          "x-maxpower-invocation-id": "smoke-sse",
        },
      },
    ),
    new Response(JSON.stringify({
      id: "chatcmpl_smoke-tool",
      object: "chat.completion",
      model: "maxpower-cloud",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_release_probe",
            type: "function",
            function: { name: "release_probe", arguments: '{"status":"ok"}' },
          }],
        },
      }],
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-maxpower-invocation-id": "smoke-tool",
      },
    }),
    new Response(
      'event: error\ndata: {"error":{"code":"client_cancelled","message":"cancelled"}}\n\n',
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=UTF-8",
          "x-maxpower-invocation-id": "smoke-cancel",
        },
      },
    ),
    Response.json({ status: "cancel_requested", invocationId: "smoke-cancel" }, { status: 202 }),
    Response.json({
      error: { code: "provider_unavailable", message: "temporarily unavailable" },
    }, { status: 503 }),
    Response.json({
      error: { code: "provider_unavailable", message: "temporarily unavailable" },
    }, { status: 503 }),
  ];
  const lines: string[] = [];
  const auditedPrimaryInvocations: string[] = [];
  const auditedScenarioInvocations: string[] = [];
  const result = await runStagingProviderSmoke({
    env: {
      MAXPOWER_STAGING_BASE_URL: "https://staging.maxpower.example",
      MAXPOWER_STAGING_ACCESS_TOKEN: "do-not-log-staging-token",
      MAXPOWER_STAGING_SCENARIO_BASE_URL: "https://staging-scenarios.maxpower.example",
      MAXPOWER_STAGING_SCENARIO_ACCESS_TOKEN: "do-not-log-scenario-token",
    },
    async fetch(input, init) {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : "",
      });
      const response = responses.shift();
      assert.ok(response, "unexpected smoke request");
      return response;
    },
    writeLine(line) {
      lines.push(line);
    },
    usageAudit: {
      async assertRecorded(invocationId) {
        auditedPrimaryInvocations.push(invocationId);
      },
    },
    scenarioUsageAudit: {
      async assertRecorded(invocationId) {
        auditedScenarioInvocations.push(invocationId);
      },
    },
  });

  assert.deepEqual(result, { status: "passed", checks: 9 });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/healthz",
    "/readyz",
    "/openapi.json",
    "/v1/chat/completions",
    "/v1/chat/completions",
    "/v1/chat/completions",
    "/v1/chat/completions",
    "/v1/invocations/cancel",
    "/v1/chat/completions",
    "/v1/chat/completions",
  ]);
  assert.equal(calls[3]?.authorization, "Bearer do-not-log-staging-token");
  assert.equal(calls[4]?.authorization, "Bearer do-not-log-staging-token");
  assert.deepEqual(auditedPrimaryInvocations, ["smoke-json"]);
  assert.deepEqual(auditedScenarioInvocations, ["smoke-tool"]);
  for (const body of [calls[3], calls[4]].map((call) => JSON.parse(call?.body ?? "{}") as {
    model: string;
    messages: Array<{ content: string }>;
    stream: boolean;
  })) {
    assert.equal(body.model, "maxpower/coach-v1");
    assert.equal(body.messages[0]?.content, "MAXPOWER_SYNTHETIC_RELEASE_PROBE");
  }
  assert.equal((JSON.parse(calls[3]?.body ?? "{}") as { stream?: boolean }).stream, false);
  assert.equal((JSON.parse(calls[4]?.body ?? "{}") as { stream?: boolean }).stream, true);
  const serializedOutput = lines.join("\n");
  assert.equal(serializedOutput.includes("do-not-log-staging-token"), false);
  assert.equal(serializedOutput.includes("do-not-log-scenario-token"), false);
  assert.equal(serializedOutput.includes("MAXPOWER_SYNTHETIC_RELEASE_PROBE"), false);
  assert.equal(serializedOutput.includes("MAXPOWER_SYNTHETIC_TOOL_PROBE"), false);
  assert.equal(serializedOutput.includes("READY"), false);
});

test("staging smoke refuses a non-HTTPS boundary before sending credentials", async () => {
  await assert.rejects(
    () => runStagingProviderSmoke({
      env: {
        MAXPOWER_STAGING_BASE_URL: "http://staging.maxpower.example",
        MAXPOWER_STAGING_ACCESS_TOKEN: "do-not-send-token",
      },
      async fetch() {
        throw new Error("must not send credentials over HTTP");
      },
      writeLine() {},
    }),
    /HTTPS/,
  );
});

test("staging smoke bounds a response body that never finishes", async () => {
  const hangingBody = new ReadableStream<Uint8Array>({
    cancel() {},
  });
  await assert.rejects(
    Promise.race([
      runStagingProviderSmoke({
        env: {
          MAXPOWER_STAGING_BASE_URL: "https://staging.maxpower.example",
          MAXPOWER_STAGING_ACCESS_TOKEN: "ephemeral-staging-token",
          MAXPOWER_STAGING_SCENARIO_BASE_URL: "https://staging-scenarios.maxpower.example",
          MAXPOWER_STAGING_SCENARIO_ACCESS_TOKEN: "ephemeral-scenario-token",
        },
        async fetch() {
          return new Response(hangingBody, { status: 200 });
        },
        writeLine() {},
        timeoutMs: 5,
        usageAudit: { async assertRecorded() {} },
        scenarioUsageAudit: { async assertRecorded() {} },
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("smoke body timeout was not enforced")), 100);
      }),
    ]),
    /contract failed/,
  );
});
