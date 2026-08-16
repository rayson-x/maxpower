import assert from "node:assert/strict";
import test from "node:test";

import type { OpenAiChatCompletionRequest } from "../src/modules/llm/model.js";
import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import type { IdFactory } from "../src/kernel/ids.js";
import type { Principal } from "../src/kernel/principal.js";
import {
  InMemoryLlmEntitlementAdapter,
  InMemoryLlmProviderAdapter,
  InMemoryLlmUsageAdapter,
  LlmGateway,
  immediateProviderDispatch,
  type LlmGatewayDependencies,
  type OpenAiObject,
} from "../src/modules/llm/index.js";

const alice = principal("alice");
const bob = principal("bob");

test("allows an active scoped principal and settles actual usage", async () => {
  const provider = new InMemoryLlmProviderAdapter([
    {
      kind: "complete",
      response: {
        id: "upstream-secret-id",
        object: "chat.completion",
        model: "provider-secret-model",
        system_fingerprint: "provider-fingerprint",
        choices: [{ message: { role: "assistant", content: "Keep training." } }],
      },
      usage: usage(11, 5, 4),
    },
  ]);
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 150, resetAt: "2026-09-01T00:00:00.000Z" },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });

  const result = await gateway.invoke(alice, {
    idempotencyKey: "allow-1",
    request: {
      model: "maxpower/coach-v1",
      stream: false,
      messages: [{ role: "user", content: "What next?" }],
    },
  });

  assert.equal(result.kind, "complete");
  if (result.kind !== "complete") return;
  assert.equal(result.response.model, "maxpower-cloud");
  assert.equal(result.response.id, `chatcmpl_${result.invocationId}`);
  assert.equal("system_fingerprint" in result.response, false);
  assert.equal(entitlements.account("alice")?.availableCredits, 146);
  assert.equal(entitlements.account("alice")?.spentCredits, 4);
  assert.equal(audit.usage[0]?.chargedCredits, 4);
  assert.equal(audit.invocations[0]?.status, "completed");
});

test("hard-stops before the provider when quota cannot be reserved", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 99, resetAt: "2026-09-01T00:00:00.000Z" },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });

  await assert.rejects(
    gateway.invoke(alice, {
      idempotencyKey: "quota-1",
      request: {
        model: "maxpower/coach-v1",
        messages: [{ role: "user", content: "This must never reach the provider." }],
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "quota_exceeded");
      assert.deepEqual(error.details, {
        canRetry: false,
        resetAt: "2026-09-01T00:00:00.000Z",
      });
      return true;
    },
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(audit.invocations[0]?.status, "rejected");
});

test("account revocation aborts an in-flight Provider call and releases its reservation", async () => {
  let providerSignal: AbortSignal | undefined;
  let providerStarted!: () => void;
  const started = new Promise<void>((resolve) => { providerStarted = resolve; });
  const provider = {
    invoke(input: { signal: AbortSignal }) {
      return immediateProviderDispatch((async () => {
        providerSignal = input.signal;
        providerStarted();
        return new Promise<never>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(new Error("aborted upstream")), { once: true });
        });
      })());
    },
  };
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 150 },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });

  const invocation = gateway.invoke(alice, {
    idempotencyKey: "delete-account-cancel",
    request: { model: "maxpower/coach-v1", messages: [{ role: "user", content: "continue" }] },
  });
  await started;
  assert.equal(await gateway.cancelAccount("alice"), 1);
  assert.equal(providerSignal?.aborted, true);
  await assert.rejects(invocation, apiError(403, "account_unavailable"));
  assert.equal(entitlements.account("alice")?.availableCredits, 150);
  assert.equal(audit.invocations[0]?.status, "failed");
});

test("client cancellation aborts upstream and settles the emitted partial usage estimate", async () => {
  let emitted!: () => void;
  const firstChunk = new Promise<void>((resolve) => { emitted = resolve; });
  let providerSignal: AbortSignal | undefined;
  const provider = {
    invoke(input: { signal: AbortSignal }) {
      providerSignal = input.signal;
      return immediateProviderDispatch({
          kind: "stream" as const,
          chunks: (async function* () {
            yield { choices: [{ delta: { content: "partial" } }] };
            emitted();
            await new Promise<never>((_resolve, reject) => {
              input.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
            });
          })(),
          usage: new Promise<never>(() => undefined),
          estimateCancelledUsage() {
            return usage(10, 3, 7);
          },
        });
    },
  };
  const entitlements = new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 200 } });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });
  const result = await gateway.invoke(alice, {
    idempotencyKey: "client-cancel",
    request: { model: "maxpower/coach-v1", stream: true, messages: [{ role: "user", content: "go" }] },
  });
  assert.equal(result.kind, "stream");
  if (result.kind !== "stream") return;
  await firstChunk;
  assert.deepEqual(await gateway.cancel(alice, { idempotencyKey: "client-cancel" }), {
    status: "cancel_requested",
    invocationId: result.invocationId,
  });
  assert.equal(providerSignal?.aborted, true);
  await assert.rejects(async () => {
    for await (const _chunk of result.chunks) {
      // Drain until the stable cancellation error arrives from the buffer.
    }
  }, apiError(499, "client_cancelled"));
  assert.equal(entitlements.account("alice")?.availableCredits, 193);
  assert.equal(entitlements.account("alice")?.spentCredits, 7);
  assert.equal(audit.invocations[0]?.errorCode, "client_cancelled_usage_estimated");
});

test("a durable cancellation is visible to another gateway node", async () => {
  let providerSignal: AbortSignal | undefined;
  let providerStarted!: () => void;
  const started = new Promise<void>((resolve) => { providerStarted = resolve; });
  const provider = {
    invoke(input: { signal: AbortSignal }) {
      return immediateProviderDispatch((async () => {
        providerSignal = input.signal;
        providerStarted();
        return new Promise<never>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
      })());
    },
  };
  const entitlements = new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 200 } });
  const audit = new InMemoryLlmUsageAdapter();
  const invokeNode = createGateway({
    provider,
    entitlements,
    usage: audit,
    accountStatusPollMs: 1,
  });
  const cancelNode = createGateway({
    provider: new InMemoryLlmProviderAdapter(),
    entitlements,
    usage: audit,
  });
  const pending = invokeNode.invoke(alice, {
    idempotencyKey: "cross-node-cancel",
    request: { model: "maxpower/coach-v1", messages: [{ role: "user", content: "go" }] },
  });
  await started;
  await cancelNode.cancel(alice, { idempotencyKey: "cross-node-cancel" });
  await assert.rejects(pending, apiError(499, "client_cancelled"));
  assert.equal(providerSignal?.aborted, true);
});

test("cancellation requested before claim is durable and prevents any Provider call", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const entitlements = new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 200 } });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });

  assert.deepEqual(await gateway.cancel(alice, { idempotencyKey: "cancel-before-claim" }), {
    status: "cancel_requested",
  });
  await assert.rejects(gateway.invoke(alice, {
    idempotencyKey: "cancel-before-claim",
    request: { model: "maxpower/coach-v1", messages: [{ role: "user", content: "never send" }] },
  }), apiError(499, "client_cancelled"));
  assert.equal(provider.calls.length, 0);
  assert.equal(entitlements.account("alice")?.availableCredits, 200);
  assert.equal(audit.invocations[0]?.status, "failed");
  assert.equal(audit.invocations[0]?.errorCode, "client_cancelled");
});

test("cancellation that wins between claim and reservation remains a 499 terminal state", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const entitlements = new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 200 } });
  const audit = new InMemoryLlmUsageAdapter();
  entitlements.reserve = async () => {
    const invocation = audit.invocations[0];
    assert.ok(invocation);
    await audit.requestCancellation({
      ownerAccountId: invocation.ownerAccountId,
      idempotencyFingerprint: invocation.idempotencyFingerprint,
      requestedAt: "2026-08-10T00:00:00.000Z",
    });
    return { granted: false };
  };
  const gateway = createGateway({ provider, entitlements, usage: audit });

  await assert.rejects(gateway.invoke(alice, {
    idempotencyKey: "cancel-before-reserve-race",
    request: { model: "maxpower/coach-v1", messages: [{ role: "user", content: "never send" }] },
  }), apiError(499, "client_cancelled"));

  assert.equal(provider.calls.length, 0);
  assert.equal(entitlements.account("alice")?.availableCredits, 200);
  assert.equal(audit.invocations[0]?.status, "failed");
  assert.equal(audit.invocations[0]?.errorCode, "client_cancelled");
});

test("quota that reaches a terminal state before cancellation remains quota_exceeded", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const entitlements = new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 0 } });
  const audit = new InMemoryLlmUsageAdapter();
  const updateInvocation = audit.updateInvocation.bind(audit);
  audit.updateInvocation = async (id, update) => {
    await updateInvocation(id, update);
    if (update.status !== "rejected") return;
    const invocation = audit.invocations[0];
    assert.ok(invocation);
    await audit.requestCancellation({
      ownerAccountId: invocation.ownerAccountId,
      idempotencyFingerprint: invocation.idempotencyFingerprint,
      requestedAt: "2026-08-10T00:00:00.000Z",
    });
  };
  const gateway = createGateway({ provider, entitlements, usage: audit });

  await assert.rejects(gateway.invoke(alice, {
    idempotencyKey: "quota-before-cancel-race",
    request: { model: "maxpower/coach-v1", messages: [{ role: "user", content: "never send" }] },
  }), apiError(429, "quota_exceeded"));

  assert.equal(provider.calls.length, 0);
  assert.equal(audit.invocations[0]?.status, "rejected");
  assert.equal(audit.invocations[0]?.errorCode, "quota_exceeded");
});

test("Provider dispatch is durable before the call and running is written only after it starts", async () => {
  const audit = new InMemoryLlmUsageAdapter();
  let statusWhenProviderStarted: string | undefined;
  let confirmStarted!: () => void;
  let finishProvider!: () => void;
  const started = new Promise<void>((resolve) => { confirmStarted = resolve; });
  const finished = new Promise<void>((resolve) => { finishProvider = resolve; });
  const provider = {
    invoke() {
      return {
        started,
        result: (async () => {
          await started;
          statusWhenProviderStarted = audit.invocations[0]?.status;
          await finished;
          return {
            kind: "complete" as const,
            response: { choices: [{ message: { role: "assistant", content: "ok" } }] },
            usage: usage(1, 1, 2),
          };
        })(),
      };
    },
  };
  const gateway = createGateway({
    provider,
    entitlements: new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 200 } }),
    usage: audit,
  });
  const invocation = gateway.invoke(alice, {
    idempotencyKey: "provider-before-running",
    request: { model: "maxpower/coach-v1", messages: [] },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audit.invocations[0]?.status, "dispatching");
  confirmStarted();
  await started;
  assert.equal(statusWhenProviderStarted, "dispatching");
  finishProvider();
  await invocation;
  assert.equal(audit.invocations[0]?.status, "completed");
});

test("a Provider that ignores abort cannot complete after cancellation wins", async () => {
  let started!: () => void;
  let finish!: () => void;
  const providerStarted = new Promise<void>((resolve) => { started = resolve; });
  const allowProviderToFinish = new Promise<void>((resolve) => { finish = resolve; });
  const provider = {
    invoke() {
      return immediateProviderDispatch((async () => {
        started();
        await allowProviderToFinish;
        return {
          kind: "complete" as const,
          response: { choices: [{ message: { role: "assistant", content: "too late" } }] },
          usage: usage(10, 5, 6),
        };
      })());
    },
  };
  const entitlements = new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 200 } });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });
  const pending = gateway.invoke(alice, {
    idempotencyKey: "uncooperative-provider",
    request: { model: "maxpower/coach-v1", messages: [{ role: "user", content: "stop" }] },
  });
  await providerStarted;
  await gateway.cancel(alice, { idempotencyKey: "uncooperative-provider" });
  finish();
  await assert.rejects(pending, apiError(499, "client_cancelled"));
  assert.equal(entitlements.account("alice")?.spentCredits, 6);
  assert.equal(audit.invocations[0]?.status, "failed");
});

test("the initial live account check completes before the Provider can start", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const gateway = new LlmGateway({
    provider,
    entitlements: new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 200 } }),
    usage: new InMemoryLlmUsageAdapter(),
    fingerprintSecret: "initial-account-check-secret",
    accountStatus: { async isActive() { return false; } },
  });
  await assert.rejects(gateway.invoke(alice, {
    idempotencyKey: "inactive-before-provider",
    request: { model: "maxpower/coach-v1", messages: [] },
  }), apiError(403, "account_unavailable"));
  assert.equal(provider.calls.length, 0);
});

test("enforces alias request limits and reserves the configured worst-case charge", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 119 },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = new LlmGateway({
    provider,
    entitlements,
    usage: audit,
    fingerprintSecret: "test-fingerprint-secret",
    requestPolicies: {
      "maxpower/coach-v1": {
        maxInputBytes: 128,
        maxInputTokens: 256,
        maxOutputTokens: 64,
        maxImages: 0,
        maxImageBytes: 1,
        reservationCredits: 120,
      },
      "maxpower/nutrition-vision-v1": {
        maxInputBytes: 256,
        maxInputTokens: 512,
        maxOutputTokens: 32,
        maxImages: 1,
        maxImageBytes: 128,
        reservationCredits: 200,
      },
    },
  });

  await assert.rejects(
    gateway.invoke(alice, {
      idempotencyKey: "too-many-output-tokens",
      request: {
        model: "maxpower/coach-v1",
        messages: [],
        max_tokens: 65,
      },
    }),
    apiError(400, "request_limit_exceeded"),
  );
  await assert.rejects(
    gateway.invoke(alice, {
      idempotencyKey: "input-too-large",
      request: {
        model: "maxpower/coach-v1",
        messages: [{ role: "user", content: "x".repeat(256) }],
      },
    }),
    apiError(413, "llm_request_too_large"),
  );
  await assert.rejects(
    gateway.invoke(alice, {
      idempotencyKey: "worst-case-reservation",
      request: { model: "maxpower/coach-v1", messages: [] },
    }),
    apiError(429, "quota_exceeded"),
  );
  assert.equal(provider.calls.length, 0);
});

test("normalizes the provider output cap and bounds image inputs by alias", async () => {
  const requests: unknown[] = [];
  const provider = {
    invoke(input: Parameters<InMemoryLlmProviderAdapter["invoke"]>[0]) {
      requests.push(input.request);
      return immediateProviderDispatch({
        kind: "complete" as const,
        response: { object: "chat.completion", choices: [] },
        usage: usage(1, 1, 1),
      });
    },
  };
  const gateway = new LlmGateway({
    provider,
    entitlements: new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 500 } }),
    usage: new InMemoryLlmUsageAdapter(),
    fingerprintSecret: "test-fingerprint-secret",
    requestPolicies: {
      "maxpower/coach-v1": {
        maxInputBytes: 512,
        maxInputTokens: 1_024,
        maxOutputTokens: 64,
        maxImages: 0,
        maxImageBytes: 1,
        reservationCredits: 100,
      },
      "maxpower/nutrition-vision-v1": {
        maxInputBytes: 1_024,
        maxInputTokens: 2_048,
        maxOutputTokens: 32,
        maxImages: 1,
        maxImageBytes: 256,
        reservationCredits: 100,
      },
    },
  });

  await gateway.invoke(alice, {
    idempotencyKey: "server-output-cap",
    request: { model: "maxpower/coach-v1", messages: [] },
  });
  assert.equal((requests[0] as { max_tokens?: number }).max_tokens, 64);

  await assert.rejects(
    gateway.invoke(alice, {
      idempotencyKey: "coach-image-rejected",
      request: {
        model: "maxpower/coach-v1",
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.test/a.jpg" } }] }],
      },
    }),
    apiError(400, "image_limit_exceeded"),
  );
  assert.equal(requests.length, 1);
});

test("rejects provider-specific request fields instead of forwarding policy overrides", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const gateway = createGateway({
    provider,
    entitlements: new InMemoryLlmEntitlementAdapter({ alice: { availableCredits: 500 } }),
    usage: new InMemoryLlmUsageAdapter(),
  });

  for (const [idempotencyKey, field] of [
    ["no-provider-metadata", { metadata: { user: "private" } }],
    ["no-provider-audio", { modalities: ["audio"] }],
    ["no-provider-tier", { service_tier: "priority" }],
  ] as const) {
    await assert.rejects(
      gateway.invoke(alice, {
        idempotencyKey,
        request: {
          model: "maxpower/coach-v1",
          messages: [],
          ...field,
        },
      }),
      apiError(400, "unsupported_request_field"),
    );
  }
  assert.equal(provider.calls.length, 0);
});

test("fails closed and audits actual provider usage when upstream exceeds its reservation", async () => {
  const provider = new InMemoryLlmProviderAdapter([
    {
      kind: "complete",
      response: { object: "chat.completion", choices: [] },
      usage: usage(2_000, 100, 150),
    },
  ]);
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 200 },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = new LlmGateway({
    provider,
    entitlements,
    usage: audit,
    fingerprintSecret: "test-fingerprint-secret",
    requestPolicies: {
      "maxpower/coach-v1": {
        maxInputBytes: 512,
        maxInputTokens: 1_024,
        maxOutputTokens: 64,
        maxImages: 0,
        maxImageBytes: 1,
        reservationCredits: 100,
      },
      "maxpower/nutrition-vision-v1": {
        maxInputBytes: 512,
        maxInputTokens: 1_024,
        maxOutputTokens: 64,
        maxImages: 1,
        maxImageBytes: 128,
        reservationCredits: 100,
      },
    },
  });

  await assert.rejects(
    gateway.invoke(alice, {
      idempotencyKey: "provider-overrun",
      request: { model: "maxpower/coach-v1", messages: [] },
    }),
    apiError(502, "provider_usage_exceeded_limits"),
  );
  assert.equal(entitlements.account("alice")?.availableCredits, 100);
  assert.equal(audit.usage[0]?.providerCredits, 150);
  assert.equal(audit.usage[0]?.chargedCredits, 100);
  assert.equal(audit.invocations[0]?.errorCode, "provider_usage_exceeded_limits");
});

test("reuses the same idempotent request and rejects a changed request", async () => {
  const provider = new InMemoryLlmProviderAdapter([
    {
      kind: "complete",
      response: { object: "chat.completion", choices: [] },
      usage: usage(3, 2, 2),
    },
  ]);
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 200 },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });
  const input = {
    idempotencyKey: "same-key",
    request: {
      model: "maxpower/coach-v1",
      messages: [{ role: "user", content: "same" }],
    },
  } as const;

  const first = await gateway.invoke(alice, input);
  const replay = await gateway.invoke(alice, input);
  assert.deepEqual(replay, first);
  assert.equal(provider.calls.length, 1);
  assert.equal(audit.usage.length, 1);

  await assert.rejects(
    gateway.invoke(alice, {
      ...input,
      request: {
        ...input.request,
        messages: [{ role: "user", content: "changed" }],
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "idempotency_conflict");
      return true;
    },
  );
});

test("persists invocation and usage metadata without request or response content", async () => {
  const secretPrompt = "SECRET_PROMPT_SENTINEL";
  const secretTool = "SECRET_TOOL_SENTINEL";
  const secretResponse = "SECRET_RESPONSE_SENTINEL";
  const provider = new InMemoryLlmProviderAdapter([
    {
      kind: "complete",
      response: {
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: secretResponse } }],
      },
      usage: usage(8, 6, 3),
    },
  ]);
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 200 },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });

  await gateway.invoke(alice, {
    idempotencyKey: "content-free",
    request: {
      model: "maxpower/coach-v1",
      messages: [{ role: "user", content: secretPrompt }],
      tools: [
        {
          type: "function",
          function: { name: "private_tool", description: secretTool, parameters: {} },
        },
      ],
    },
  });

  const persisted = JSON.stringify({
    invocations: audit.invocations,
    usage: audit.usage,
    providerCalls: provider.calls,
    reservations: entitlements.reservations,
  });
  assert.equal(persisted.includes(secretPrompt), false);
  assert.equal(persisted.includes(secretTool), false);
  assert.equal(persisted.includes(secretResponse), false);
  assert.equal(persisted.includes("messages"), false);
  assert.equal(persisted.includes("tools"), false);
  assert.equal(persisted.includes("content"), false);
});

test("buffers OpenAI-compatible chunks and only lets the owner resume", async () => {
  const provider = new InMemoryLlmProviderAdapter([
    {
      kind: "stream",
      chunks: [
        {
          id: "upstream-id",
          object: "chat.completion.chunk",
          model: "hidden-provider-model",
          choices: [{ index: 0, delta: { content: "Hello" } }],
        },
        {
          id: "upstream-id",
          object: "chat.completion.chunk",
          model: "hidden-provider-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
      ],
      usage: usage(4, 2, 2),
    },
  ]);
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 200 },
    bob: { availableCredits: 200 },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });

  const result = await gateway.invoke(alice, {
    idempotencyKey: "stream-1",
    request: {
      model: "maxpower/coach-v1",
      stream: true,
      messages: [{ role: "user", content: "stream" }],
    },
  });
  assert.equal(result.kind, "stream");
  if (result.kind !== "stream") return;

  await assert.rejects(
    gateway.resume(bob, { invocationId: result.invocationId }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "invocation_forbidden");
      return true;
    },
  );

  const replay = await gateway.resume(alice, { invocationId: result.invocationId });
  const chunks = await collect(replay);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.model === "maxpower-cloud"));
  assert.ok(chunks.every((chunk) => chunk.id === `chatcmpl_${result.invocationId}`));
  assert.equal(audit.usage[0]?.chargedCredits, 2);
});

test("erases the volatile stream buffer after five minutes", async () => {
  const provider = new InMemoryLlmProviderAdapter([
    {
      kind: "stream",
      chunks: [{ object: "chat.completion.chunk", choices: [] }],
      usage: usage(1, 1, 1),
    },
  ]);
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 200 },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const clock = new MutableClock("2026-08-10T00:00:00.000Z");
  const gateway = new LlmGateway({
    provider,
    entitlements,
    usage: audit,
    clock,
    fingerprintSecret: "test-fingerprint-secret",
  });

  const result = await gateway.invoke(alice, {
    idempotencyKey: "expires-1",
    request: {
      model: "maxpower/coach-v1",
      stream: true,
      messages: [],
    },
  });
  assert.equal(result.kind, "stream");
  if (result.kind !== "stream") return;
  await collect(result.chunks);
  clock.advance(5 * 60 * 1_000);

  await assert.rejects(
    gateway.resume(alice, { invocationId: result.invocationId }),
    apiError(410, "stream_expired"),
  );
});

test("requires an active principal with llm:invoke scope and a supported alias", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const entitlements = new InMemoryLlmEntitlementAdapter();
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });
  const request = {
    idempotencyKey: "auth-1",
    request: { model: "maxpower/coach-v1", messages: [] },
  } as const;

  await assert.rejects(gateway.invoke(undefined, request), apiError(401, "invalid_access_token"));
  await assert.rejects(
    gateway.invoke({ ...alice, status: "restricted" }, request),
    apiError(403, "account_unavailable"),
  );
  await assert.rejects(
    gateway.invoke({ ...alice, scopes: new Set() }, request),
    apiError(403, "missing_scope"),
  );
  await assert.rejects(
    gateway.invoke(alice, {
      ...request,
      request: { model: "gpt-secret-model", messages: [] },
    }),
    apiError(400, "unsupported_model_alias"),
  );
});

test("returns an authenticated content-free entitlement view", async () => {
  const provider = new InMemoryLlmProviderAdapter();
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 123, resetAt: "2026-09-01T00:00:00.000Z" },
  });
  const audit = new InMemoryLlmUsageAdapter();
  const gateway = createGateway({ provider, entitlements, usage: audit });

  const view = await gateway.getEntitlement(alice);
  assert.deepEqual(view, {
    availableCredits: 123,
    spentCredits: 0,
    resetAt: "2026-09-01T00:00:00.000Z",
  });
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("provider"), false);
  assert.equal(serialized.includes("model"), false);
});

function principal(accountId: string): Principal {
  return {
    accountId,
    sessionId: `session-${accountId}`,
    status: "active",
    scopes: new Set(["llm:invoke"]),
  };
}

function usage(inputTokens: number, outputTokens: number, credits: number) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    credits,
  };
}

function createGateway(
  dependencies: Pick<
    LlmGatewayDependencies,
    "provider" | "entitlements" | "usage" | "accountStatusPollMs"
  >,
): LlmGateway {
  let nextId = 1;
  const ids: IdFactory = (prefix) => `${prefix}_${nextId++}`;
  return new LlmGateway({
    ...dependencies,
    ids,
    fingerprintSecret: "test-fingerprint-secret",
  });
}

async function collect(chunks: AsyncIterable<OpenAiObject>): Promise<readonly OpenAiObject[]> {
  const result: OpenAiObject[] = [];
  for await (const chunk of chunks) {
    result.push(chunk);
  }
  return result;
}

function apiError(status: number, code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  };
}

class MutableClock implements Clock {
  #timestamp: number;

  constructor(iso: string) {
    this.#timestamp = new Date(iso).getTime();
  }

  now(): Date {
    return new Date(this.#timestamp);
  }

  advance(milliseconds: number): void {
    this.#timestamp += milliseconds;
  }
}
