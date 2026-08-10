import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Pool } from "pg";

export type StagingSmokeResult =
  | { status: "skipped"; reason: "staging_credentials_unset" }
  | { status: "blocked"; reason: "staging_scenario_probe_unset" }
  | { status: "passed"; checks: 9 };

export interface StagingProviderSmokeOptions {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  writeLine?: (line: string) => void;
  timeoutMs?: number;
  usageAudit?: StagingUsageAudit;
  scenarioUsageAudit?: StagingUsageAudit;
}

export interface StagingUsageAudit {
  assertRecorded(invocationId: string): Promise<void>;
}

const SYNTHETIC_MESSAGE = "MAXPOWER_SYNTHETIC_RELEASE_PROBE";
const SYNTHETIC_TOOL_MESSAGE = "MAXPOWER_SYNTHETIC_TOOL_PROBE";
const SYNTHETIC_CANCEL_MESSAGE = "MAXPOWER_SYNTHETIC_CANCEL_PROBE";
const SYNTHETIC_TIMEOUT_MESSAGE = "MAXPOWER_SYNTHETIC_TIMEOUT_PROBE";
const SYNTHETIC_OUTAGE_MESSAGE = "MAXPOWER_SYNTHETIC_OUTAGE_PROBE";
const MAX_RESPONSE_BYTES = 1_048_576;

/**
 * Optional release smoke against the deployed Gateway. It uses fixed synthetic
 * content and emits status metadata only; credentials and response content are never logged.
 */
export async function runStagingProviderSmoke(
  options: StagingProviderSmokeOptions = {},
): Promise<StagingSmokeResult> {
  const environment = options.env ?? process.env;
  const baseUrlValue = environment.MAXPOWER_STAGING_BASE_URL?.trim();
  const accessToken = environment.MAXPOWER_STAGING_ACCESS_TOKEN?.trim();
  const scenarioBaseUrlValue = environment.MAXPOWER_STAGING_SCENARIO_BASE_URL?.trim();
  const scenarioAccessToken = environment.MAXPOWER_STAGING_SCENARIO_ACCESS_TOKEN?.trim();
  const stagingDatabaseUrl = environment.MAXPOWER_STAGING_DATABASE_URL?.trim();
  const scenarioDatabaseUrl = environment.MAXPOWER_STAGING_SCENARIO_DATABASE_URL?.trim();
  const writeLine = options.writeLine ?? ((line) => process.stdout.write(`${line}\n`));
  if (!baseUrlValue || !accessToken) {
    const result = { status: "skipped", reason: "staging_credentials_unset" } as const;
    writeLine(JSON.stringify({ event: "maxpower_staging_provider_smoke", ...result }));
    return result;
  }
  const baseUrl = exactHttpsOrigin(baseUrlValue);
  if (
    !scenarioBaseUrlValue
    || !scenarioAccessToken
    || (options.usageAudit === undefined && !stagingDatabaseUrl)
    || (options.scenarioUsageAudit === undefined && !scenarioDatabaseUrl)
  ) {
    const result = { status: "blocked", reason: "staging_scenario_probe_unset" } as const;
    writeLine(JSON.stringify({ event: "maxpower_staging_provider_smoke", ...result }));
    return result;
  }

  const scenarioBaseUrl = exactHttpsOrigin(scenarioBaseUrlValue);
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Staging smoke timeout must be a positive integer.");
  }

  const ownedUsageAudit = options.usageAudit === undefined;
  const ownedScenarioUsageAudit = options.scenarioUsageAudit === undefined;
  const usageAudit = options.usageAudit
    ?? new PostgresStagingUsageAudit(requireStagingDatabaseUrl(stagingDatabaseUrl));
  const scenarioUsageAudit = options.scenarioUsageAudit
    ?? new PostgresStagingUsageAudit(requireStagingDatabaseUrl(scenarioDatabaseUrl));
  try {
    await assertStatusJson(fetch, baseUrl, "/healthz", "status", "ok", timeoutMs);
    await assertStatusJson(fetch, baseUrl, "/readyz", "status", "ready", timeoutMs);
    await assertStatusJson(fetch, baseUrl, "/openapi.json", "openapi", "3.1.0", timeoutMs);
    await usageAudit.assertRecorded(
      await assertJsonCompletion(fetch, baseUrl, accessToken, timeoutMs),
    );
    await assertSseCompletion(fetch, baseUrl, accessToken, timeoutMs);
    await scenarioUsageAudit.assertRecorded(
      await assertToolCall(fetch, scenarioBaseUrl, scenarioAccessToken, timeoutMs),
    );
    await assertExplicitCancellation(fetch, scenarioBaseUrl, scenarioAccessToken, timeoutMs);
    await assertProviderFailure(
      fetch,
      scenarioBaseUrl,
      scenarioAccessToken,
      SYNTHETIC_TIMEOUT_MESSAGE,
      timeoutMs,
    );
    await assertProviderFailure(
      fetch,
      scenarioBaseUrl,
      scenarioAccessToken,
      SYNTHETIC_OUTAGE_MESSAGE,
      timeoutMs,
    );
  } finally {
    if (ownedUsageAudit) await (usageAudit as PostgresStagingUsageAudit).close();
    if (ownedScenarioUsageAudit) {
      await (scenarioUsageAudit as PostgresStagingUsageAudit).close();
    }
  }

  const result = { status: "passed", checks: 9 } as const;
  writeLine(JSON.stringify({ event: "maxpower_staging_provider_smoke", ...result }));
  return result;
}

async function assertStatusJson(
  fetch: typeof globalThis.fetch,
  baseUrl: URL,
  path: string,
  field: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const response = await smokeFetch(fetch, new URL(path, baseUrl), { method: "GET" }, timeoutMs);
  if (!response.ok) throw contractFailure();
  const body = await readBoundedJson(response, timeoutMs);
  if (!isObject(body) || body[field] !== expected) throw contractFailure();
}

async function assertJsonCompletion(
  fetch: typeof globalThis.fetch,
  baseUrl: URL,
  accessToken: string,
  timeoutMs: number,
): Promise<string> {
  const response = await completionRequest(fetch, baseUrl, accessToken, false, timeoutMs);
  const invocationId = response.headers.get("x-maxpower-invocation-id");
  if (!response.ok || !invocationId) throw contractFailure();
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw contractFailure();
  }
  const body = await readBoundedJson(response, timeoutMs);
  if (
    !isObject(body) ||
    body.model !== "maxpower-cloud" ||
    !Array.isArray(body.choices) ||
    "usage" in body ||
    exposesProviderIdentity(body)
  ) {
    throw contractFailure();
  }
  return invocationId;
}

async function assertSseCompletion(
  fetch: typeof globalThis.fetch,
  baseUrl: URL,
  accessToken: string,
  timeoutMs: number,
): Promise<void> {
  const response = await completionRequest(fetch, baseUrl, accessToken, true, timeoutMs);
  if (!response.ok || !response.headers.get("x-maxpower-invocation-id")) throw contractFailure();
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
    throw contractFailure();
  }
  const body = await readBoundedText(response, timeoutMs);
  if (!body.split(/\r?\n/).some((line) => line.trim() === "data: [DONE]")) {
    throw contractFailure();
  }
  if (/(?:^|\n)event:\s*error(?:\r?\n|$)/i.test(body)) throw contractFailure();
  const chunks = body.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((data) => data !== "[DONE]");
  if (chunks.length === 0) throw contractFailure();
  for (const data of chunks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw contractFailure();
    }
    if (!isObject(parsed) || parsed.model !== "maxpower-cloud" || exposesProviderIdentity(parsed)) {
      throw contractFailure();
    }
  }
}

async function assertToolCall(
  fetch: typeof globalThis.fetch,
  baseUrl: URL,
  accessToken: string,
  timeoutMs: number,
): Promise<string> {
  const response = await completionRequest(fetch, baseUrl, accessToken, false, timeoutMs, {
    message: SYNTHETIC_TOOL_MESSAGE,
    tools: [{
      type: "function",
      function: {
        name: "release_probe",
        description: "Return the fixed staging release-probe result.",
        parameters: {
          type: "object",
          properties: { status: { type: "string", enum: ["ok"] } },
          required: ["status"],
          additionalProperties: false,
        },
      },
    }],
  });
  const invocationId = response.headers.get("x-maxpower-invocation-id");
  if (!response.ok || !invocationId) throw contractFailure();
  const body = await readBoundedJson(response, timeoutMs);
  if (!isObject(body) || "usage" in body || !Array.isArray(body.choices)) {
    throw contractFailure();
  }
  const firstChoice = body.choices[0];
  if (!isObject(firstChoice) || !isObject(firstChoice.message)) throw contractFailure();
  const toolCalls = firstChoice.message.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length !== 1) throw contractFailure();
  const toolCall = toolCalls[0];
  if (!isObject(toolCall) || !isObject(toolCall.function)) throw contractFailure();
  if (toolCall.function.name !== "release_probe") throw contractFailure();
  return invocationId;
}

async function assertExplicitCancellation(
  fetch: typeof globalThis.fetch,
  baseUrl: URL,
  accessToken: string,
  timeoutMs: number,
): Promise<void> {
  const idempotencyKey = `release-smoke-${randomUUID()}`;
  const response = await completionRequest(fetch, baseUrl, accessToken, true, timeoutMs, {
    message: SYNTHETIC_CANCEL_MESSAGE,
    idempotencyKey,
    maxTokens: 256,
  });
  if (!response.ok || !response.headers.get("x-maxpower-invocation-id")) {
    throw contractFailure();
  }
  const cancellation = await smokeFetch(fetch, new URL("/v1/invocations/cancel", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ idempotencyKey }),
  }, timeoutMs);
  if (cancellation.status !== 202) throw contractFailure();
  const cancellationBody = await readBoundedJson(cancellation, timeoutMs);
  if (!isObject(cancellationBody) || cancellationBody.status !== "cancel_requested") {
    throw contractFailure();
  }
  const streamBody = await readBoundedText(response, timeoutMs);
  if (!/(?:^|\n)event:\s*error(?:\r?\n|$)/i.test(streamBody)) throw contractFailure();
  if (!streamBody.includes('"code":"client_cancelled"')) throw contractFailure();
}

async function assertProviderFailure(
  fetch: typeof globalThis.fetch,
  baseUrl: URL,
  accessToken: string,
  message: string,
  timeoutMs: number,
): Promise<void> {
  const response = await completionRequest(fetch, baseUrl, accessToken, false, timeoutMs, {
    message,
    maxTokens: 8,
  });
  if (response.status !== 503) throw contractFailure();
  const body = await readBoundedJson(response, timeoutMs);
  if (!isObject(body) || !isObject(body.error) || body.error.code !== "provider_unavailable") {
    throw contractFailure();
  }
}

async function completionRequest(
  fetch: typeof globalThis.fetch,
  baseUrl: URL,
  accessToken: string,
  stream: boolean,
  timeoutMs: number,
  options: {
    message?: string;
    idempotencyKey?: string;
    maxTokens?: number;
    tools?: readonly unknown[];
  } = {},
): Promise<Response> {
  const idempotencyKey = options.idempotencyKey ?? `release-smoke-${randomUUID()}`;
  return smokeFetch(fetch, new URL("/v1/chat/completions", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json",
      "idempotency-key": idempotencyKey,
      "x-client-run-id": `release-smoke-${randomUUID()}`,
    },
    body: JSON.stringify({
      model: "maxpower/coach-v1",
      messages: [{ role: "user", content: options.message ?? SYNTHETIC_MESSAGE }],
      stream,
      max_tokens: options.maxTokens ?? 8,
      ...(options.tools === undefined ? {} : {
        tools: options.tools,
        parallel_tool_calls: false,
      }),
    }),
  }, timeoutMs);
}

async function smokeFetch(
  fetch: typeof globalThis.fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw contractFailure();
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedJson(response: Response, timeoutMs: number): Promise<unknown> {
  const text = await readBoundedText(response, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw contractFailure();
  }
}

async function readBoundedText(response: Response, timeoutMs: number): Promise<string> {
  if (response.body === null) throw contractFailure();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, timeoutMs);
  timeout.unref();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw contractFailure();
      }
      text += decoder.decode(value, { stream: true });
    }
    if (timedOut) throw contractFailure();
    text += decoder.decode();
    return text;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

function exactHttpsOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Staging smoke base URL must be an exact HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/" ||
    url.origin !== value.replace(/\/$/, "")
  ) {
    throw new Error("Staging smoke base URL must be an exact HTTPS origin.");
  }
  return url;
}

function exposesProviderIdentity(value: Record<string, unknown>): boolean {
  return ["provider", "provider_name", "system_fingerprint", "cost", "usage_cost"]
    .some((field) => field in value);
}

class PostgresStagingUsageAudit implements StagingUsageAudit {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({
      connectionString,
      application_name: "maxpower-staging-provider-smoke",
      max: 1,
    });
  }

  async assertRecorded(invocationId: string): Promise<void> {
    const result = await this.#pool.query<{
      input_tokens: string;
      output_tokens: string;
      total_tokens: string;
      usage_basis: string;
    }>(
      `SELECT input_tokens::text, output_tokens::text, total_tokens::text, usage_basis
         FROM llm_usage_events
        WHERE invocation_id = $1`,
      [invocationId],
    );
    const row = result.rows[0];
    if (row === undefined || row.usage_basis !== "provider_reported") throw contractFailure();
    const inputTokens = nonNegativeInteger(row.input_tokens);
    const outputTokens = nonNegativeInteger(row.output_tokens);
    const totalTokens = nonNegativeInteger(row.total_tokens);
    if (totalTokens !== inputTokens + outputTokens) throw contractFailure();
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}

function requireStagingDatabaseUrl(value: string | undefined): string {
  if (!value) throw contractFailure();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Staging usage audit requires a PostgreSQL TLS URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || url.searchParams.get("sslmode") !== "verify-full"
  ) {
    throw new Error("Staging usage audit requires a PostgreSQL TLS URL.");
  }
  return value;
}

function nonNegativeInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw contractFailure();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw contractFailure();
  return parsed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractFailure(): Error {
  return new Error("Staging provider smoke contract failed.");
}

async function main(): Promise<void> {
  const result = await runStagingProviderSmoke();
  if (result.status === "blocked") process.exitCode = 2;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  void main().catch(() => {
    process.stderr.write(`${JSON.stringify({
      event: "maxpower_staging_provider_smoke",
      status: "failed",
      reason: "contract_failed",
    })}\n`);
    process.exitCode = 1;
  });
}
