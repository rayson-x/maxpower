import assert from "node:assert/strict";
import test from "node:test";

import { OpenAiCompatibleLlmProviderAdapter } from "../src/adapters/llm-provider/index.js";
import type { Principal } from "../src/kernel/principal.js";
import {
  InMemoryLlmEntitlementAdapter,
  InMemoryLlmUsageAdapter,
  LlmGateway,
  type OpenAiObject,
} from "../src/modules/llm/index.js";

test("Gateway routes a product alias upstream, normalizes usage and hides provider identity", async () => {
  let observedUrl = "";
  let observedAuthorization = "";
  let observedBody: Record<string, unknown> = {};
  const provider = new OpenAiCompatibleLlmProviderAdapter({
    routes: routes(),
    fetch: async (input, init) => {
      observedUrl = String(input);
      observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: "vendor-request-id",
        object: "chat.completion",
        model: "vendor-coach-model",
        system_fingerprint: "vendor-fingerprint",
        choices: [{ index: 0, message: { role: "assistant", content: "answer" } }],
        usage: {
          prompt_tokens: 500_000,
          completion_tokens: 250_000,
          total_tokens: 750_000,
          prompt_tokens_details: { cached_tokens: 100_000, image_tokens: 25_000 },
          cost: 99,
          provider_breakdown: { vendor: "must-not-leak" },
        },
      });
    },
  });
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 100 },
  });
  const usage = new InMemoryLlmUsageAdapter();
  const gateway = new LlmGateway({
    provider,
    entitlements,
    usage,
    fingerprintSecret: "provider-test-fingerprint",
    requestPolicies: {
      "maxpower/coach-v1": {
        maxInputBytes: 64 * 1_024,
        maxInputTokens: 600_000,
        maxOutputTokens: 300_000,
        maxImages: 4,
        maxImageBytes: 5 * 1_024 * 1_024,
        reservationCredits: 100,
      },
      "maxpower/nutrition-vision-v1": {
        maxInputBytes: 6 * 1_024 * 1_024,
        maxInputTokens: 8 * 1_024 * 1_024,
        maxOutputTokens: 2_048,
        maxImages: 4,
        maxImageBytes: 5 * 1_024 * 1_024,
        reservationCredits: 100,
      },
    },
  });

  const result = await gateway.invoke(principal("alice"), {
    idempotencyKey: "provider-nonstream-1",
    request: {
      model: "maxpower/coach-v1",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    },
  });

  assert.equal(result.kind, "complete");
  if (result.kind !== "complete") return;
  assert.equal(observedUrl, "https://provider.example/v1/chat/completions");
  assert.equal(observedAuthorization, "Bearer provider-secret");
  assert.equal(observedBody.model, "vendor-coach-model");
  assert.equal(observedBody.stream, false);
  assert.equal(observedBody.store, false);
  assert.equal(result.response.model, "maxpower-cloud");
  assert.equal(result.response.id, `chatcmpl_${result.invocationId}`);
  assert.equal("system_fingerprint" in result.response, false);
  assert.equal("usage" in result.response, false);
  assert.equal(JSON.stringify(result.response).includes("must-not-leak"), false);
  assert.equal(usage.usage[0]?.inputTokens, 500_000);
  assert.equal(usage.usage[0]?.cachedInputTokens, 100_000);
  assert.equal(usage.usage[0]?.imageTokens, 25_000);
  assert.equal(usage.usage[0]?.outputTokens, 250_000);
  assert.equal(usage.usage[0]?.providerCostMicros, 10);
  assert.equal(usage.usage[0]?.chargedCredits, 2);
  assert.equal(entitlements.account("alice")?.availableCredits, 98);
});

test("Gateway consumes OpenAI SSE chunks and settles usage from the terminal usage chunk", async () => {
  const encoder = new TextEncoder();
  let upstreamBody: Record<string, unknown> = {};
  const provider = new OpenAiCompatibleLlmProviderAdapter({
    routes: routes(),
    fetch: async (_url, init) => {
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"id":"vendor","model":"vendor-coach-model","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'data: {"id":"vendor","model":"vendor-coach-model","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]}}]}\n\ndata: {"id":"vendor","model":"vendor-coach-model","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 100 },
  });
  const usage = new InMemoryLlmUsageAdapter();
  const gateway = new LlmGateway({
    provider,
    entitlements,
    usage,
    fingerprintSecret: "provider-stream-fingerprint",
  });

  const result = await gateway.invoke(principal("alice"), {
    idempotencyKey: "provider-stream-1",
    request: {
      model: "maxpower/coach-v1",
      stream: true,
      tools: [{ type: "function", function: { name: "read_plan", parameters: {} } }],
      tool_choice: { type: "function", function: { name: "read_plan" } },
      messages: [],
    },
  });
  assert.equal(result.kind, "stream");
  if (result.kind !== "stream") return;

  const chunks = await collect(result.chunks);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.model === "maxpower-cloud"));
  assert.equal(JSON.stringify(chunks).includes("tool_calls"), true);
  assert.deepEqual(upstreamBody.tool_choice, { type: "function", function: { name: "read_plan" } });
  assert.equal(usage.usage[0]?.totalTokens, 15);
  assert.equal(usage.usage[0]?.chargedCredits, 1);
  assert.equal(entitlements.account("alice")?.availableCredits, 99);
});

test("OpenAI transport aborts a cancelled stream and records a bounded partial estimate", async () => {
  const encoder = new TextEncoder();
  let upstreamAborted = false;
  let emitted!: () => void;
  const firstChunk = new Promise<void>((resolve) => { emitted = resolve; });
  const provider = new OpenAiCompatibleLlmProviderAdapter({
    routes: routes(),
    fetch: async (_input, init) => {
      init?.signal?.addEventListener("abort", () => { upstreamAborted = true; }, { once: true });
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"id":"vendor","object":"chat.completion.chunk","choices":[{"delta":{"content":"partial"}}]}\n\n',
          ));
          emitted();
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  const entitlements = new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 100 } });
  const usage = new InMemoryLlmUsageAdapter();
  const gateway = new LlmGateway({
    provider,
    entitlements,
    usage,
    fingerprintSecret: "provider-cancel-fingerprint",
  });
  const requestMessages = [{ role: "user", content: "cancel this synthetic request" }];
  const result = await gateway.invoke(principal("alice"), {
    idempotencyKey: "provider-cancel-1",
    request: {
      model: "maxpower/coach-v1",
      stream: true,
      messages: requestMessages,
    },
  });
  assert.equal(result.kind, "stream");
  if (result.kind !== "stream") return;
  await firstChunk;
  await gateway.cancel(principal("alice"), { idempotencyKey: "provider-cancel-1" });
  assert.equal(upstreamAborted, true);
  await assert.rejects(() => collect(result.chunks), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error);
    assert.equal((error as { code: string }).code, "client_cancelled");
    return true;
  });
  assert.equal(usage.invocations[0]?.errorCode, "client_cancelled_usage_estimated");
  assert.ok(
    (usage.usage[0]?.inputTokens ?? 0)
      >= Buffer.byteLength(JSON.stringify({ messages: requestMessages }), "utf8"),
  );
  assert.equal(usage.usage[0]?.outputTokens, Buffer.byteLength("partial", "utf8"));
  assert.equal(usage.usage[0]?.usageBasis, "conservative_estimate");
  assert.ok((usage.usage[0]?.providerCostMicros ?? 0) >= 6);
  assert.ok((entitlements.account("alice")?.spentCredits ?? 0) > 0);
});

test("OpenAI transport settles conservative input usage when a non-stream request is cancelled", async () => {
  let upstreamStarted!: () => void;
  const started = new Promise<void>((resolve) => { upstreamStarted = resolve; });
  const requestMessages = [{ role: "user", content: [{ type: "text", text: "inspect meal" }] }];
  const provider = new OpenAiCompatibleLlmProviderAdapter({
    routes: routes(),
    fetch: async (_input, init) => {
      upstreamStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  });
  const entitlements = new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 1_000 } });
  const usage = new InMemoryLlmUsageAdapter();
  const gateway = new LlmGateway({
    provider,
    entitlements,
    usage,
    fingerprintSecret: "provider-complete-cancel-fingerprint",
  });
  const pending = gateway.invoke(principal("alice"), {
    idempotencyKey: "provider-complete-cancel-1",
    request: {
      model: "maxpower/nutrition-vision-v1",
      stream: false,
      messages: requestMessages,
    },
  });
  await started;
  await gateway.cancel(principal("alice"), { idempotencyKey: "provider-complete-cancel-1" });
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error);
    assert.equal((error as { code: string }).code, "client_cancelled");
    return true;
  });
  assert.equal(usage.invocations[0]?.errorCode, "client_cancelled_usage_estimated");
  assert.ok(
    (usage.usage[0]?.inputTokens ?? 0)
      >= Buffer.byteLength(JSON.stringify({ messages: requestMessages }), "utf8"),
  );
  assert.equal(usage.usage[0]?.outputTokens, 0);
  assert.equal(usage.usage[0]?.usageBasis, "conservative_estimate");
  assert.ok((usage.usage[0]?.providerCostMicros ?? 0) >= 1);
  assert.ok((entitlements.account("alice")?.spentCredits ?? 0) > 0);
});

function routes() {
  return {
    "maxpower/coach-v1": {
      endpoint: "https://provider.example/v1/chat/completions",
      apiKey: "provider-secret",
      model: "vendor-coach-model",
      maxOutputTokens: 300_000,
      inputCreditsPerMillionTokens: 2,
      outputCreditsPerMillionTokens: 4,
      inputCostMicrosPerMillionTokens: 10,
      outputCostMicrosPerMillionTokens: 20,
    },
    "maxpower/nutrition-vision-v1": {
      endpoint: "https://vision.example/v1/chat/completions",
      apiKey: "vision-secret",
      model: "vendor-vision-model",
      maxOutputTokens: 4_096,
      inputCreditsPerMillionTokens: 10,
      outputCreditsPerMillionTokens: 20,
      inputCostMicrosPerMillionTokens: 100,
      outputCostMicrosPerMillionTokens: 200,
    },
  } as const;
}

function principal(accountId: string): Principal {
  return {
    accountId,
    sessionId: `session-${accountId}`,
    status: "active",
    scopes: new Set(["llm:invoke"]),
  };
}

async function collect(chunks: AsyncIterable<OpenAiObject>): Promise<readonly OpenAiObject[]> {
  const collected: OpenAiObject[] = [];
  for await (const chunk of chunks) collected.push(chunk);
  return collected;
}

test("a slow upstream stream survives past the header timeout as long as chunks keep arriving", async () => {
  const encoder = new TextEncoder();
  // The first chunk arrives after the 50ms header timeout; the second after an
  // additional 300ms idle gap that stays inside the 800ms stream idle budget.
  const provider = new OpenAiCompatibleLlmProviderAdapter({
    routes: routes(),
    timeoutMs: 50,
    streamIdleTimeoutMs: 800,
    streamOverallTimeoutMs: 5_000,
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              encoder.encode('data: {"id":"vendor","model":"vendor-coach-model","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"slow"}}]}\n\n'),
            );
            await new Promise((resolve) => setTimeout(resolve, 300));
            controller.enqueue(
              encoder.encode('data: {"id":"vendor","model":"vendor-coach-model","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n'),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
  });
  const gateway = new LlmGateway({
    provider,
    entitlements: new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 100 } }),
    usage: new InMemoryLlmUsageAdapter(),
    fingerprintSecret: "provider-slow-stream-fingerprint",
  });
  const result = await gateway.invoke(principal("alice"), {
    idempotencyKey: "provider-slow-stream-1",
    request: { model: "maxpower/coach-v1", stream: true, messages: [] },
  });
  assert.equal(result.kind, "stream");
  if (result.kind !== "stream") return;
  const chunks = await collect(result.chunks);
  assert.equal(chunks.length, 2);
});

test("a stalled upstream stream is aborted after the idle timeout", async () => {
  const encoder = new TextEncoder();
  const provider = new OpenAiCompatibleLlmProviderAdapter({
    routes: routes(),
    timeoutMs: 50,
    streamIdleTimeoutMs: 120,
    streamOverallTimeoutMs: 5_000,
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              encoder.encode('data: {"id":"vendor","model":"vendor-coach-model","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"stuck"}}]}\n\n'),
            );
            // Never produce another chunk; the idle timeout must end this.
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
  });
  const gateway = new LlmGateway({
    provider,
    entitlements: new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 100 } }),
    usage: new InMemoryLlmUsageAdapter(),
    fingerprintSecret: "provider-stalled-stream-fingerprint",
  });
  const result = await gateway.invoke(principal("alice"), {
    idempotencyKey: "provider-stalled-stream-1",
    request: { model: "maxpower/coach-v1", stream: true, messages: [] },
  });
  assert.equal(result.kind, "stream");
  if (result.kind !== "stream") return;
  await assert.rejects(collect(result.chunks));
});
