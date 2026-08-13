import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryFixedWindowRateLimiter } from "../src/http/security.js";
import { createMemoryRuntime } from "../src/runtime/memory-runtime.js";
import type { HttpRequestLogEvent } from "../src/http/request-logger.js";

test("HTTP boundary applies security headers and an exact CORS allowlist", async () => {
  const runtime = createMemoryRuntime({
    production: false,
    security: {
      allowedOrigins: ["https://app.maxpower.example"],
      maxRequestBytes: 1_024,
    },
  });

  const allowed = await runtime.app.request("/healthz", {
    headers: { origin: "https://app.maxpower.example" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.maxpower.example");
  assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
  assert.equal(allowed.headers.get("referrer-policy"), "no-referrer");
  assert.equal(allowed.headers.get("cache-control"), "no-store");
  assert.match(allowed.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

  const rejected = await runtime.app.request("/healthz", {
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json() as { error: { code: string } }).error.code, "origin_forbidden");
});

test("HTTP boundary permits an explicit loopback CORS origin for local web development", async () => {
  const runtime = createMemoryRuntime({
    production: false,
    security: {
      allowedOrigins: ["http://localhost:8081"],
      maxRequestBytes: 1_024,
    },
  });

  const allowed = await runtime.app.request("/healthz", {
    headers: { origin: "http://localhost:8081" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:8081");

  const preflight = await runtime.app.request("/v1/auth/config", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:8081",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:8081");

  assert.throws(
    () => createMemoryRuntime({
      production: false,
      security: { allowedOrigins: ["http://app.maxpower.example"], maxRequestBytes: 1_024 },
    }),
    /loopback HTTP origins/,
  );
});

test("HTTP boundary admits only Apple's exact form_post callback without granting CORS", async () => {
  const runtime = createMemoryRuntime({
    production: false,
    security: {
      allowedOrigins: ["https://app.maxpower.example"],
      maxRequestBytes: 1_024,
    },
  });

  const callback = await runtime.app.request("/api/auth/callback/apple", {
    method: "POST",
    headers: { origin: "https://appleid.apple.com" },
  });
  assert.equal(callback.status, 404);
  assert.equal(callback.headers.get("access-control-allow-origin"), null);

  for (const [method, path] of [
    ["GET", "/api/auth/callback/apple"],
    ["POST", "/api/auth/callback/google"],
    ["POST", "/api/auth/callback/apple/extra"],
  ] as const) {
    const rejected = await runtime.app.request(path, {
      method,
      headers: { origin: "https://appleid.apple.com" },
    });
    assert.equal(rejected.status, 403);
    assert.equal(
      (await rejected.json() as { error: { code: string } }).error.code,
      "origin_forbidden",
    );
  }
});

test("HTTP boundary rejects oversized requests before reading their body", async () => {
  const runtime = createMemoryRuntime({
    production: false,
    security: { allowedOrigins: [], maxRequestBytes: 64 },
  });
  const response = await runtime.app.request("/v1/auth/login/password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "1000",
    },
    body: JSON.stringify({ oversized: "body" }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "request_too_large");
});

test("HTTP boundary rejects an oversized streamed body without Content-Length", async () => {
  const runtime = createMemoryRuntime({
    production: false,
    security: { allowedOrigins: [], maxRequestBytes: 64 },
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"identifier":{"kind":"email","value":"'));
      controller.enqueue(new TextEncoder().encode("a".repeat(128)));
      controller.enqueue(new TextEncoder().encode('@example.com"},"password":"secret"}'));
      controller.close();
    },
  });
  const request = new Request("http://localhost/v1/auth/login/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const response = await runtime.app.fetch(request);

  assert.equal(response.status, 413);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "request_too_large");
});

test("HTTP boundary returns a stable 429 when the configured limiter is exhausted", async () => {
  const runtime = createMemoryRuntime({
    production: false,
    security: {
      allowedOrigins: [],
      maxRequestBytes: 1_024,
      rateLimiter: new InMemoryFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 }),
    },
  });
  let tokenCounter = 0;
  const request = () => runtime.app.request("/v1/auth/session", {
    headers: {
      authorization: `Bearer invalid-token-${tokenCounter += 1}`,
      "x-real-ip": "203.0.113.20",
    },
  });

  assert.equal((await request()).status, 401);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal((await limited.json() as { error: { code: string } }).error.code, "rate_limit_exceeded");
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("request logging records operational metadata without credentials or bodies", async () => {
  const events: HttpRequestLogEvent[] = [];
  const runtime = createMemoryRuntime({
    production: false,
    logger: { write(event) { events.push(event); } },
  });
  await runtime.app.request("/v1/auth/login/password", {
    method: "POST",
    headers: {
      authorization: "Bearer do-not-log-this-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      identifier: { kind: "email", value: "private@example.com" },
      password: "do-not-log-this-password",
    }),
  });
  const deviceBinding = "ab".repeat(32);
  await runtime.app.request("/v1/auth/social/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "google",
      callbackUrl: "maxpower://auth/callback",
      deviceBinding,
    }),
  });
  await runtime.app.request(
    "/v1/auth/social/handoff?flow=do-not-log-social-flow-value",
  );

  assert.equal(events.length, 3);
  assert.equal(events[0]?.method, "POST");
  assert.equal(events[0]?.path, "/v1/auth/login/password");
  assert.equal(events[1]?.path, "/v1/auth/social/start");
  assert.equal(events[2]?.path, "/v1/auth/social/handoff");
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("do-not-log"), false);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes(deviceBinding), false);
});
