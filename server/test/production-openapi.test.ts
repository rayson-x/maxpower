import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "../src/openapi.js";
import { createMemoryRuntime } from "../src/runtime/memory-runtime.js";

type Operation = {
  operationId?: string;
  parameters?: readonly {
    name?: string;
    in?: string;
    required?: boolean;
    schema?: Record<string, unknown>;
  }[];
  security?: readonly Record<string, readonly string[]>[];
  responses?: Record<string, {
    headers?: Record<string, unknown>;
    content?: Record<string, { schema?: unknown; [key: string]: unknown }>;
  }>;
};

type PathItem = Partial<Record<"get" | "post" | "patch" | "delete", Operation>>;

const paths = openApiDocument.paths as unknown as Record<string, PathItem>;
const schemas = openApiDocument.components.schemas as unknown as Record<string, unknown>;

test("OpenAPI 3.1 covers every mounted versioned and operational HTTP route", () => {
  assert.equal(openApiDocument.openapi, "3.1.0");
  assert.equal(
    (openApiDocument as { jsonSchemaDialect?: string }).jsonSchemaDialect,
    "https://json-schema.org/draft/2020-12/schema",
  );

  const runtime = createMemoryRuntime({ production: false });
  for (const route of runtime.app.routes) {
    const method = route.method.toLowerCase();
    if (!isDocumentedMethod(method)) continue;
    const path = route.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
    assert.ok(paths[path]?.[method], `${route.method} ${path} is missing from OpenAPI`);
  }

  const operationIds = Object.values(paths).flatMap((path) =>
    Object.values(path).flatMap((operation) => operation?.operationId ?? []),
  );
  assert.equal(new Set(operationIds).size, operationIds.length, "operationId values must be unique");
});

test("OpenAPI documents reviewed Better Auth routes and account deletion receipts", () => {
  for (const [method, path] of [
    ["get", "/api/auth/social/authorize"],
    ["get", "/api/auth/callback/google"],
    ["post", "/api/auth/callback/google"],
    ["get", "/api/auth/callback/apple"],
    ["post", "/api/auth/callback/apple"],
    ["post", "/api/auth/link-social"],
    ["get", "/api/auth/list-accounts"],
    ["post", "/api/auth/unlink-account"],
    ["get", "/api/auth/.well-known/jwks.json"],
    ["get", "/api/auth/error"],
    ["post", "/v1/auth/social/start"],
    ["post", "/v1/auth/social/exchange"],
    ["get", "/v1/auth/social/handoff"],
    ["get", "/v1/auth/social/error"],
  ] as const) {
    assert.ok(paths[path]?.[method], `${method.toUpperCase()} ${path} is missing`);
  }
  for (const [method, path] of [
    ["post", "/api/auth/sign-in/social"],
    ["get", "/api/auth/get-session"],
    ["get", "/api/auth/token"],
    ["post", "/api/auth/sign-out"],
    ["get", "/api/auth/expo-authorization-proxy"],
  ] as const) {
    assert.equal(paths[path]?.[method], undefined, `${method.toUpperCase()} ${path} must stay private`);
  }

  const startSchema = requestSchema("/v1/auth/social/start", "post");
  assert.deepEqual(startSchema, { $ref: "#/components/schemas/StartSocialAuthRequest" });
  const exchangeSchema = requestSchema("/v1/auth/social/exchange", "post");
  assert.deepEqual(exchangeSchema, { $ref: "#/components/schemas/ExchangeSocialAuthRequest" });
  const callback = requireOperation("/api/auth/callback/google", "get");
  assert.match(JSON.stringify(callback.responses?.["302"]), /HTTPS.*handoff/i);
  assert.doesNotMatch(JSON.stringify(callback), /sessionToken|deviceBinding/i);
  const handoff = requireOperation("/v1/auth/social/handoff", "get");
  assert.match(
    handoff.responses?.["302"]?.headers?.Location
      ? JSON.stringify(handoff.responses["302"]?.headers?.Location)
      : "",
    /code.*state/i,
  );
  assert.doesNotMatch(JSON.stringify(handoff), /sessionToken|set-cookie|deviceBinding/i);
  const failedHandoff = requireOperation("/v1/auth/social/error", "get");
  assert.match(
    failedHandoff.responses?.["302"]?.headers?.Location
      ? JSON.stringify(failedHandoff.responses["302"]?.headers?.Location)
      : "",
    /error.*state/i,
  );
  assert.doesNotMatch(
    JSON.stringify(failedHandoff),
    /sessionToken|set-cookie|deviceBinding/i,
  );

  const request = requireOperation("/v1/me/deletion", "post");
  const deletionKey = header(request, "Idempotency-Key");
  assert.ok(deletionKey?.required);
  assert.equal((deletionKey?.schema as { pattern?: string } | undefined)?.pattern, "^[a-f0-9]{64}$");
  assert.deepEqual(request.security, [{ bearerAuth: [] }, { deletionRecoveryKey: [] }]);
  assert.ok(request.responses?.["202"]);
  const status = requireOperation("/v1/me/deletion", "get");
  assert.equal(header(status, "Deletion-Receipt")?.required, false);
});

test("OpenAPI publishes concurrency, location, invocation, SSE and error contracts", () => {
  assert.equal(paths["/v1/me"], undefined);
  assert.equal(paths["/v1/plans"], undefined);
  assert.equal(paths["/v1/media"], undefined);

  for (const [path, method] of Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => [path, method, operation] as const)
  )) {
    const operation = paths[path]?.[method as keyof PathItem];
    if (operation === undefined || path.startsWith("/healthz") || path.startsWith("/readyz")) {
      continue;
    }
    const errorSchema = path.startsWith("/api/auth/")
      ? "#/components/schemas/BetterAuthError"
      : "#/components/schemas/Error";
    assert.equal(
      operation.responses?.default?.content?.["application/json"]?.schema &&
        JSON.stringify(operation.responses.default.content["application/json"]?.schema),
      JSON.stringify({ $ref: errorSchema }),
      `${method.toUpperCase()} ${path} must document its error envelope`,
    );
  }

  const completion = requireOperation("/v1/chat/completions", "post");
  const completionOk = completion.responses?.["200"];
  assert.ok(completionOk?.headers?.["X-MaxPower-Invocation-Id"]);
  assert.deepEqual(completionOk?.content?.["application/json"]?.schema, {
    $ref: "#/components/schemas/OpenAiChatCompletion",
  });
  assert.deepEqual(completionOk?.content?.["text/event-stream"]?.schema, {
    $ref: "#/components/schemas/LlmEventStream",
  });

  const resume = requireOperation("/v1/invocations/{invocationId}/events", "get");
  assert.equal(header(resume, "Last-Event-ID")?.required, false);
  assert.ok(resume.responses?.["200"]?.headers?.["X-MaxPower-Invocation-Id"]);
  assert.deepEqual(resume.responses?.["200"]?.content?.["text/event-stream"]?.schema, {
    $ref: "#/components/schemas/LlmEventStream",
  });
  assert.ok(schemas.OpenAiChatCompletion);
  assert.ok(schemas.OpenAiChatCompletionChunk);
  assert.ok(schemas.LlmStreamErrorEvent);
  assert.ok(schemas.Error);
  assert.ok(schemas.BetterAuthError);
});

function requireOperation(path: string, method: keyof PathItem): Operation {
  const operation = paths[path]?.[method];
  assert.ok(operation, `${method.toUpperCase()} ${path} must be documented`);
  return operation;
}

function header(operation: Operation, name: string) {
  return operation.parameters?.find((parameter) =>
    parameter.in === "header" && parameter.name?.toLowerCase() === name.toLowerCase()
  );
}

function requestSchema(path: string, method: keyof PathItem): unknown {
  return (requireOperation(path, method) as Operation & {
    requestBody?: { content?: Record<string, { schema?: unknown }> };
  }).requestBody?.content?.["application/json"]?.schema;
}

function isDocumentedMethod(value: string): value is keyof PathItem {
  return value === "get" || value === "post" || value === "patch" || value === "delete";
}
