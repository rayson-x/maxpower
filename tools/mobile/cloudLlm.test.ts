import assert from "node:assert/strict";
import test from "node:test";

import type { LLMProviderRequest } from "../../src/coach/adapters/provider";
import {
  MaxPowerCloudLlmProvider,
  MaxPowerCloudLlmProviderResolver,
  type CloudServiceAccessTokenSource,
} from "../../src/mobile/cloud/MaxPowerCloudLlmProvider";

function request(overrides: Partial<LLMProviderRequest> = {}): LLMProviderRequest {
  return {
    sessionId: "conversation-local-1",
    runId: "run-1",
    userText: "今天怎么练？",
    context: {
      userPseudonym: "local-pseudonym",
      profile: {},
      plan: {},
      timeline: [],
      workingMemory: [],
      activeConstraints: [],
      nutritionStrategies: [],
      goalCycles: [],
      canonicalEvidence: [],
      historicalSummaries: [],
      currentConversation: [],
      conversationSummaries: [],
    },
    contextManifest: {
      schemaVersion: 1,
      userPseudonym: "local-pseudonym",
      providerKind: "maxpower-cloud",
      requestPurpose: "coach.general",
      assembledAt: "2026-08-10T00:00:00.000Z",
      factRefs: [],
      redactedPaths: [],
      includes: [],
      priority: ["authoritative_facts", "active_constraints", "working_memory", "conversation"],
      productionCompression: "none",
      retrievalFactRefs: [],
      summaryRefs: [],
      timeRange: {},
      mediaAttachments: [],
      redactionPolicyVersion: "direct-identifiers-v1",
    },
    toolManifest: [],
    modelInput: { systemPrompt: "local harness test prompt", userContent: JSON.stringify({ kind: "local_harness_test" }) },
    ...overrides,
  };
}

function sseBody(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

class Tokens implements CloudServiceAccessTokenSource {
  readonly accounts: string[] = [];

  accessTokenFor(accountId: string): string {
    this.accounts.push(accountId);
    return "short-lived-service-jwt";
  }
}

test("cloud Coach 固定使用 MaxPower endpoint、产品 alias、JWT 与幂等头", async () => {
  const tokens = new Tokens();
  let calledUrl = "";
  let sentBody = "";
  let sentHeaders: Readonly<Record<string, string>> = {};
  const provider = new MaxPowerCloudLlmProvider({
    apiBaseUrl: "https://api.maxpower.example/ignored/path",
    accountId: "account-a",
    accessTokens: tokens,
    fetch: async (url, init) => {
      calledUrl = url;
      sentBody = init.body;
      sentHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        body: sseBody([
          'id: 1\ndata: {"choices":[{"delta":{"content":"去训练。"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      };
    },
  });

  const events = [];
  for await (const event of provider.stream(request())) events.push(event);

  assert.equal(calledUrl, "https://api.maxpower.example/v1/chat/completions");
  assert.equal(JSON.parse(sentBody).model, "maxpower/coach-v1");
  assert.equal(sentHeaders.authorization, "Bearer short-lived-service-jwt");
  assert.match(sentHeaders["idempotency-key"] ?? "", /^coach-/);
  assert.match(sentHeaders["x-client-run-id"] ?? "", /^run-/);
  assert.notEqual(sentHeaders["x-client-run-id"], "run-1");
  assert.equal(sentBody.includes("short-lived-service-jwt"), false);
  assert.deepEqual(tokens.accounts, ["account-a"]);
  assert.deepEqual(events, [
    { type: "text-delta", delta: "去训练。" },
    { type: "completed" },
  ]);
});

test("同一 run 重试复用幂等键，HITL continuation 使用独立幂等键", async () => {
  const keys: string[] = [];
  const provider = new MaxPowerCloudLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: new Tokens(),
    fetch: async (_url, init) => {
      keys.push(init.headers["idempotency-key"] ?? "");
      return { ok: true, status: 200, body: sseBody(["data: [DONE]\n\n"]) };
    },
  });

  for await (const _event of provider.stream(request())) { /* consume */ }
  for await (const _event of provider.stream(request())) { /* consume */ }
  for await (const _event of provider.resume!({
    ...request(),
    continuation: {
      pendingActionId: "action-1",
      toolCallId: "tool-1",
      output: { approved: true },
    },
  })) { /* consume */ }

  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
});

test("云端 SSE 断流会在五分钟缓冲接口从最后事件继续，而不重复已收内容", async () => {
  const encoder = new TextEncoder();
  let resumeUrl = "";
  let resumeHeaders: Readonly<Record<string, string>> = {};
  const provider = new MaxPowerCloudLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: new Tokens(),
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "x-maxpower-invocation-id" ? "invocation-1" : null },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('id: 1\ndata: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'));
          setTimeout(() => controller.error(new Error("connection reset")), 0);
        },
      }),
    }),
    resumeFetch: async (url, init) => {
      resumeUrl = url;
      resumeHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        body: sseBody([
          'id: 2\ndata: {"choices":[{"delta":{"content":"第二段"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      };
    },
  });

  const events = [];
  for await (const event of provider.stream(request())) events.push(event);
  assert.equal(resumeUrl, "https://api.maxpower.example/v1/invocations/invocation-1/events");
  assert.equal(resumeHeaders["last-event-id"], "1");
  assert.equal(resumeHeaders.authorization, "Bearer short-lived-service-jwt");
  assert.deepEqual(events, [
    { type: "text-delta", delta: "第一段" },
    { type: "text-delta", delta: "第二段" },
    { type: "completed" },
  ]);
});

test("账号 runtime 被替换后，旧云端流在发起前即中止", async () => {
  const account = new AbortController();
  account.abort();
  let calls = 0;
  const provider = new MaxPowerCloudLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: new Tokens(),
    accountSignal: account.signal,
    fetch: async () => {
      calls += 1;
      return { ok: true, status: 200, body: sseBody(["data: [DONE]\n\n"]) };
    },
  });

  await assert.rejects(async () => {
    for await (const _event of provider.stream(request())) { /* consume */ }
  }, (error: unknown) => (
    error instanceof Error &&
    error.name === "ProviderServiceError" &&
    "code" in error &&
    error.code === "account_switched"
  ));
  assert.equal(calls, 0);
});

test("主动中止已开始的 Coach 流会发送显式取消，而普通断流仍走恢复接口", async () => {
  const account = new AbortController();
  let started!: () => void;
  const upstreamStarted = new Promise<void>((resolve) => { started = resolve; });
  let chatKey = "";
  let cancelledKey = "";
  const provider = new MaxPowerCloudLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: new Tokens(),
    accountSignal: account.signal,
    fetch: async (url, init) => {
      if (url.endsWith("/v1/invocations/cancel")) {
        cancelledKey = (JSON.parse(init.body) as { idempotencyKey: string }).idempotencyKey;
        return { ok: true, status: 202 };
      }
      chatKey = init.headers["idempotency-key"] ?? "";
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            started();
            init.signal?.addEventListener(
              "abort",
              () => controller.error(new Error("explicit local cancellation")),
              { once: true },
            );
          },
        }),
      };
    },
  });

  const consuming = (async () => {
    for await (const _event of provider.stream(request())) { /* consume */ }
  })();
  await upstreamStarted;
  account.abort();
  await assert.rejects(consuming, (error: unknown) => (
    error instanceof Error
    && error.name === "ProviderServiceError"
    && "code" in error
    && error.code === "account_switched"
  ));
  assert.match(chatKey, /^coach-/);
  assert.equal(cancelledKey, chatKey);
});

test("HITL continuation 使用自己的幂等键发送显式取消并重试暂时故障", async () => {
  const account = new AbortController();
  let started!: () => void;
  const upstreamStarted = new Promise<void>((resolve) => { started = resolve; });
  let continuationKey = "";
  let cancelAttempts = 0;
  let cancelledKey = "";
  const provider = new MaxPowerCloudLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: new Tokens(),
    accountSignal: account.signal,
    cancellationAttemptTimeoutMs: 5,
    cancellationRetryDelayMs: 0,
    fetch: async (url, init) => {
      if (url.endsWith("/v1/invocations/cancel")) {
        cancelAttempts += 1;
        cancelledKey = (JSON.parse(init.body) as { idempotencyKey: string }).idempotencyKey;
        if (cancelAttempts === 1) return new Promise(() => undefined);
        return { ok: cancelAttempts === 3, status: cancelAttempts === 3 ? 202 : 503 };
      }
      continuationKey = init.headers["idempotency-key"] ?? "";
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            started();
            init.signal?.addEventListener("abort", () => controller.error(new Error("cancelled")), { once: true });
          },
        }),
      };
    },
  });
  const consuming = (async () => {
    for await (const _event of provider.resume!({
      ...request(),
      continuation: {
        pendingActionId: "action-1",
        toolCallId: "tool-1",
        output: { approved: true },
      },
    })) { /* consume */ }
  })();
  await upstreamStarted;
  account.abort();
  await assert.rejects(consuming, (error: unknown) => (
    error instanceof Error
    && error.name === "ProviderServiceError"
    && "code" in error
    && error.code === "account_switched"
  ));
  assert.equal(cancelAttempts, 3);
  assert.match(continuationKey, /^coach-/);
  assert.equal(cancelledKey, continuationKey);
});

test("云端额度耗尽与 Provider 故障使用稳定错误分类", async () => {
  for (const [status, code] of [[429, "allowance_exhausted"], [503, "service_unavailable"]] as const) {
    const provider = new MaxPowerCloudLlmProvider({
      apiBaseUrl: "https://api.maxpower.example",
      accountId: "account-a",
      accessTokens: new Tokens(),
      fetch: async () => ({
        ok: false,
        status,
        ...(status === 429
          ? { json: async () => ({ error: { code: "quota_exceeded" } }) }
          : {}),
      }),
    });
    await assert.rejects(async () => {
      for await (const _event of provider.stream(request())) { /* consume */ }
    }, (error: unknown) => (
      error instanceof Error &&
      error.name === "ProviderServiceError" &&
      "code" in error &&
      error.code === code
    ));
  }
});

test("通用 429 限流不会冒充用户额度耗尽", async () => {
  const provider = new MaxPowerCloudLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: new Tokens(),
    fetch: async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: { code: "rate_limit_exceeded" } }),
    }),
  });

  await assert.rejects(async () => {
    for await (const _event of provider.stream(request())) { /* consume */ }
  }, (error: unknown) => (
    error instanceof Error &&
    error.name === "ProviderServiceError" &&
    "code" in error &&
    error.code === "service_unavailable"
  ));
});

test("resolver 不能被客户端覆盖 endpoint 或物理模型", async () => {
  const resolver = new MaxPowerCloudLlmProviderResolver({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: new Tokens(),
    permission: async () => "granted",
  });
  const provider = await resolver.resolve({ userId: "account-a", sessionId: "local-session" });
  assert.equal(provider?.kind, "maxpower-cloud");
  assert.equal(provider?.model, "maxpower/coach-v1");
  await assert.rejects(
    () => resolver.resolve({ userId: "account-b", sessionId: "other" }),
    /cloud_llm_account_mismatch/,
  );
});
