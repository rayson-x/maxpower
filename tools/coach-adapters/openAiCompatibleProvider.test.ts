import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenAICompatibleProvider,
  type LLMProviderRequest,
} from "../../src/coach/adapters/provider";

function request(overrides: Partial<LLMProviderRequest> = {}): LLMProviderRequest {
  return {
    sessionId: "session-1",
    runId: "run-1",
    userText: "查看今天计划",
    context: {
      userPseudonym: "local-hash",
      profile: { trainingExperience: "beginner" },
      plan: { sessions: [{ scheduledFor: "2026-08-09" }] },
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
      userPseudonym: "local-hash",
      providerKind: "openai-compatible",
      requestPurpose: "today",
      assembledAt: "2026-08-09T00:00:00.000Z",
      factRefs: [], redactedPaths: [], includes: [],
      priority: ["authoritative_facts", "active_constraints", "working_memory", "conversation"],
      productionCompression: "none",
      retrievalFactRefs: [], summaryRefs: [], timeRange: {}, mediaAttachments: [], redactionPolicyVersion: "direct-identifiers-v1",
    },
    toolManifest: [{
      name: "plan.show_today", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
      permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["current_local_plan"], output: "artifact_ref", outputLimit: 1,
      inputSchema: { type: "object", additionalProperties: false },
    }],
    modelInput: {
      systemPrompt: "local harness test prompt",
      userContent: JSON.stringify({ kind: "local_harness_test" }),
    },
    ...overrides,
  };
}

function sseBody(lines: readonly string[]) {
  const encoded = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoded.encode(line));
      controller.close();
    },
  });
}

test("OpenAI-compatible adapter 将 wire stream 归并成自有文字与完整 ToolCall", async () => {
  let sent: Record<string, unknown> | undefined;
  let headers: Readonly<Record<string, string>> | undefined;
  const provider = new OpenAICompatibleProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "coach-model",
    authorizationHeader: async () => "Bearer device-only-secret",
    fetch: async (_url, init) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      headers = init.headers;
      const wireToolName = (((sent.tools as Array<Record<string, unknown>>)[0]?.function as Record<string, unknown>).name as string);
      return {
        ok: true,
        status: 200,
        body: sseBody([
          'data: {"choices":[{"delta":{"content":"我会读取本机计划。"}}]}\n\n',
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"provider-tool-1","function":{"name":"${wireToolName}","arguments":"{\\\"date\\\":\\\""}}]}}]}\n\n`,
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"2026-08-09\\\"}"}}]}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      };
    },
  });

  const events = [];
  for await (const event of provider.stream(request())) events.push(event);
  assert.equal(headers?.authorization, "Bearer device-only-secret");
  assert.equal(sent?.model, "coach-model");
  assert.equal(sent?.parallel_tool_calls, false);
  assert.equal(Array.isArray(sent?.tools), true);
  const sentToolName = ((((sent?.tools as Array<Record<string, unknown>>)[0]?.function) as Record<string, unknown>).name);
  assert.match(String(sentToolName), /^[a-zA-Z0-9_-]+$/);
  assert.notEqual(sentToolName, "plan.show_today");
  assert.equal(JSON.stringify(sent).includes("device-only-secret"), false);
  assert.deepEqual(events, [
    { type: "text-delta", delta: "我会读取本机计划。" },
    { type: "tool-input-delta", toolCallId: "provider-tool-1", toolName: "plan.show_today", delta: '{"date":"' },
    { type: "tool-input-delta", toolCallId: "provider-tool-1", toolName: "plan.show_today", delta: '2026-08-09"}' },
    { type: "tool-call", toolCallId: "provider-tool-1", toolName: "plan.show_today", input: { date: "2026-08-09" } },
    { type: "completed" },
  ]);
});

test("OpenAI-compatible adapter 将同 Run 的 HITL continuation 作为结构化上下文发送", async () => {
  let sent = "";
  const provider = new OpenAICompatibleProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "coach-model",
    authorizationHeader: async () => "Bearer credential",
    fetch: async (_url, init) => {
      sent = init.body;
      return { ok: true, status: 200, body: sseBody(["data: [DONE]\n\n"]) };
    },
  });
  const resumed = {
    ...request(),
    modelInput: {
      systemPrompt: "local harness continuation prompt",
      userContent: JSON.stringify({
        continuation: { pendingActionId: "pending-1", toolCallId: "provider-tool-1", output: { kind: "selected", optionId: "continue" } },
      }),
    },
    continuation: { pendingActionId: "pending-1", toolCallId: "provider-tool-1", output: { kind: "selected", optionId: "continue" } },
  };
  const events = [];
  for await (const event of provider.resume(resumed)) events.push(event);
  assert.deepEqual(events, [{ type: "completed" }]);
  assert.equal(sent.includes("pending-1"), true);
  assert.equal(sent.includes("provider-tool-1"), true);
});

test("OpenAI-compatible transport forwards the local Harness tool manifest without text routing", async () => {
  let sent: Record<string, unknown> | undefined;
  const baseTool = request().toolManifest[0]!;
  const provider = new OpenAICompatibleProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "coach-model",
    authorizationHeader: async () => "Bearer credential",
    fetch: async (_url, init) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 200, body: sseBody(["data: [DONE]\n\n"]) };
    },
  });
  const toolManifest = [
    { ...baseTool, name: "plan.show_current" },
    { ...baseTool, name: "nutrition.show_strategy" },
    { ...baseTool, name: "plan.show_today" },
  ];
  for await (const _event of provider.stream(request({
    userText: "请给我本周训练和每日摄入计划",
    toolManifest,
  }))) { /* consume */ }
  const tools = sent?.tools as Array<{ function: { description: string } }>;
  assert.equal(tools.length, 3);
  assert.match(tools[0]!.function.description, /plan\.show_current/);
  assert.match(tools[1]!.function.description, /nutrition\.show_strategy/);
  const systemMessage = (sent?.messages as Array<{ role: string; content: string }>).find((message) => message.role === "system")?.content ?? "";
  assert.equal(systemMessage, "local harness test prompt");
});

test("OpenAI-compatible adapter 在无设备凭据或非 HTTPS endpoint 时 fail closed", async () => {
  assert.throws(() => new OpenAICompatibleProvider({
    endpoint: "http://provider.example", model: "coach-model", authorizationHeader: async () => "Bearer x",
  }), /remote_provider_https_required/);
  const provider = new OpenAICompatibleProvider({
    endpoint: "https://provider.example", model: "coach-model", authorizationHeader: async () => undefined,
  });
  await assert.rejects(async () => {
    for await (const _event of provider.stream(request())) { /* no events */ }
  }, /remote_provider_credential_unavailable/);
});

test("OpenAI-compatible adapter 调用浏览器 fetch 时保留全局接收者", async () => {
  const originalFetch = globalThis.fetch;
  let receiverWasGlobal = false;
  globalThis.fetch = async function (this: typeof globalThis) {
    receiverWasGlobal = this === globalThis;
    return new Response(sseBody(["data: [DONE]\n\n"]), { status: 200 });
  } as typeof fetch;
  try {
    const provider = new OpenAICompatibleProvider({
      endpoint: "https://provider.example/v1/chat/completions",
      model: "coach-model",
      authorizationHeader: async () => "Bearer credential",
    });
    const events = [];
    for await (const event of provider.stream(request())) events.push(event);
    assert.equal(receiverWasGlobal, true);
    assert.deepEqual(events, [{ type: "completed" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI-compatible adapter 拒绝损坏 SSE 和没有完整 identity 的 ToolCall", async () => {
  const malformed = new OpenAICompatibleProvider({
    endpoint: "https://provider.example", model: "coach-model", authorizationHeader: async () => "Bearer credential",
    fetch: async () => ({ ok: true, status: 200, body: sseBody(["data: {not-json}\n\n"]) }),
  });
  await assert.rejects(async () => {
    for await (const _event of malformed.stream(request())) { /* no events */ }
  }, /remote_provider_malformed_stream/);

  const incomplete = new OpenAICompatibleProvider({
    endpoint: "https://provider.example", model: "coach-model", authorizationHeader: async () => "Bearer credential",
    fetch: async () => ({
      ok: true,
      status: 200,
      body: sseBody(['data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"plan.show_today","arguments":"{}"}}]}}]}\n\n']),
    }),
  });
  await assert.rejects(async () => {
    for await (const _event of incomplete.stream(request())) { /* no events */ }
  }, /remote_provider_incomplete_tool_call/);
});
