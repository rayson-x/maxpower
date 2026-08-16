import assert from "node:assert/strict";
import test from "node:test";

import type { Context } from "@mariozechner/pi-ai";
import type { AgentOptions } from "@mariozechner/pi-agent-core";

import {
  MaxPowerPiLlmProvider,
  type MaxPowerPiFetch,
} from "../../src/mobile/cloud/MaxPowerPiLlmProvider";

function sseBody(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

test("Pi provider exposes Agent-compatible configuration and streams text plus tool calls", async () => {
  const requests: Array<{
    url: string;
    method: "GET" | "POST";
    headers: Readonly<Record<string, string>>;
    body?: string;
  }> = [];
  const fetch: MaxPowerPiFetch = async (url, init) => {
    requests.push({
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "x-maxpower-invocation-id" ? "llmi_pi_1" : null },
      body: sseBody([
        'id: 1\ndata: {"id":"chatcmpl_llmi_pi_1","object":"chat.completion.chunk","model":"maxpower-cloud","choices":[{"index":0,"delta":{"role":"assistant","content":"先检查计划。"},"finish_reason":null}]}\n\n',
        'id: 2\ndata: {"id":"chatcmpl_llmi_pi_1","object":"chat.completion.chunk","model":"maxpower-cloud","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_plan","type":"function","function":{"name":"read_plan","arguments":"{\\"day\\":"}}]},"finish_reason":null}]}\n\n',
        'id: 3\ndata: {"id":"chatcmpl_llmi_pi_1","object":"chat.completion.chunk","model":"maxpower-cloud","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    };
  };
  const accounts: string[] = [];
  const provider = new MaxPowerPiLlmProvider({
    apiBaseUrl: "https://api.maxpower.example/ignored",
    accountId: "account-a",
    accessTokens: {
      accessTokenFor(accountId) {
        accounts.push(accountId);
        return "service-jwt";
      },
    },
    fetch,
    invocationId: () => "pi-request-1",
  });
  const agentCompatibility: Pick<AgentOptions, "streamFn" | "getApiKey"> = {
    streamFn: provider.streamFn,
    getApiKey: provider.getApiKey,
  };
  assert.equal(agentCompatibility.streamFn, provider.streamFn);

  const context: Context = {
    systemPrompt: "You are the MaxPower coach.",
    messages: [{ role: "user", content: "今天怎么练？", timestamp: 1 }],
    tools: [{
      name: "read_plan",
      description: "Read one training day.",
      parameters: {
        type: "object",
        properties: { day: { type: "number" } },
        required: ["day"],
      } as never,
    }],
  };
  const stream = provider.streamFn(provider.model, context, { maxTokens: 512 });
  const events = [];
  for await (const event of stream) events.push(event);
  const final = await stream.result();

  assert.equal(provider.model.api, "openai-completions");
  assert.equal(provider.model.id, "maxpower/coach-v1");
  assert.equal(provider.model.provider, "maxpower");
  assert.deepEqual(accounts, ["account-a"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.maxpower.example/v1/chat/completions");
  assert.equal(requests[0]?.headers.authorization, "Bearer service-jwt");
  assert.equal(requests[0]?.headers["idempotency-key"], "pi-pi-request-1");
  assert.equal(requests[0]?.headers["x-client-run-id"], "pi-run-pi-request-1");
  const body = JSON.parse(requests[0]?.body ?? "") as Record<string, unknown>;
  assert.equal(body.model, "maxpower/coach-v1");
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.parallel_tool_calls, false);
  assert.equal(body.max_tokens, 512);
  assert.equal((body.tools as unknown[]).length, 1);
  assert.equal(JSON.stringify(body).includes("service-jwt"), false);

  assert.deepEqual(events.map((event) => event.type), [
    "start",
    "text_start",
    "text_delta",
    "toolcall_start",
    "toolcall_delta",
    "toolcall_delta",
    "text_end",
    "toolcall_end",
    "done",
  ]);
  assert.equal(final.stopReason, "toolUse");
  assert.equal(final.responseId, "chatcmpl_llmi_pi_1");
  assert.deepEqual(final.content, [
    { type: "text", text: "先检查计划。" },
    { type: "toolCall", id: "call_plan", name: "read_plan", arguments: { day: 1 } },
  ]);
  assert.equal(final.usage.totalTokens, 0);
});

test("Pi provider resumes a dropped SSE connection from the last MaxPower event", async () => {
  const encoder = new TextEncoder();
  const requests: Array<{
    method: "GET" | "POST";
    headers: Readonly<Record<string, string>>;
  }> = [];
  let call = 0;
  const provider = new MaxPowerPiLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "service-jwt" },
    invocationId: () => "resume-1",
    fetch: async (_url, init) => {
      requests.push({ method: init.method, headers: init.headers });
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "llmi_resume_1" },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(
                'id: 1\ndata: {"id":"chatcmpl_resume","object":"chat.completion.chunk","model":"maxpower-cloud","choices":[{"index":0,"delta":{"content":"第一段"},"finish_reason":null}]}\n\n',
              ));
              setTimeout(() => controller.error(new Error("connection reset")), 0);
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "llmi_resume_1" },
        body: sseBody([
          'id: 2\ndata: {"id":"chatcmpl_resume","object":"chat.completion.chunk","model":"maxpower-cloud","choices":[{"index":0,"delta":{"content":"第二段"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      };
    },
  });

  const stream = provider.streamFn(provider.model, {
    messages: [{ role: "user", content: "继续", timestamp: 1 }],
  });
  for await (const _event of stream) { /* drain */ }
  const final = await stream.result();

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[1]?.method, "GET");
  assert.equal(requests[1]?.headers["last-event-id"], "1");
  assert.deepEqual(final.content, [{ type: "text", text: "第一段第二段" }]);
  assert.equal(final.stopReason, "stop");
});

test("Pi provider waits for durable cancellation acknowledgement on Agent abort", async () => {
  const controller = new AbortController();
  let responseStarted!: () => void;
  const started = new Promise<void>((resolve) => { responseStarted = resolve; });
  let chatKey = "";
  let cancelledKey = "";
  const provider = new MaxPowerPiLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "service-jwt" },
    invocationId: () => "cancel-1",
    cancellationRetryDelayMs: 0,
    fetch: async (url, init) => {
      if (url.endsWith("/v1/invocations/cancel")) {
        cancelledKey = (JSON.parse(init.body ?? "") as { idempotencyKey: string }).idempotencyKey;
        return { ok: true, status: 202 };
      }
      chatKey = init.headers["idempotency-key"] ?? "";
      return {
        ok: true,
        status: 200,
        headers: { get: () => "llmi_cancel_1" },
        body: new ReadableStream({
          start(streamController) {
            responseStarted();
            init.signal?.addEventListener(
              "abort",
              () => streamController.error(new Error("aborted")),
              { once: true },
            );
          },
        }),
      };
    },
  });

  const stream = provider.streamFn(
    provider.model,
    { messages: [{ role: "user", content: "停止", timestamp: 1 }] },
    { signal: controller.signal },
  );
  const draining = (async () => {
    for await (const _event of stream) { /* drain */ }
  })();
  await started;
  controller.abort();
  await draining;
  const final = await stream.result();

  assert.equal(chatKey, "pi-cancel-1");
  assert.equal(cancelledKey, chatKey);
  assert.equal(final.stopReason, "aborted");
});

test("Pi provider does not retry a terminal server SSE error as a dropped connection", async () => {
  let calls = 0;
  const provider = new MaxPowerPiLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "service-jwt" },
    invocationId: () => "terminal-error-1",
    fetch: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "llmi_terminal_error_1" },
        body: sseBody([
          'event: error\ndata: {"error":{"message":"allowance exhausted","type":"server_error","code":"quota_exceeded","param":null}}\n\n',
        ]),
      };
    },
  });

  const stream = provider.streamFn(provider.model, {
    messages: [{ role: "user", content: "继续", timestamp: 1 }],
  });
  for await (const _event of stream) { /* drain */ }
  const final = await stream.result();

  assert.equal(calls, 1);
  assert.equal(final.stopReason, "error");
  assert.equal(final.errorMessage, "quota_exceeded");
});

test("Pi provider retries once when an upstream failure kills a turn before any visible content", async () => {
  let calls = 0;
  const provider = new MaxPowerPiLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "service-jwt" },
    invocationId: () => `empty-turn-${calls}`,
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        // Reasoning model died mid-reasoning: zero visible content, then a
        // transient provider error frame.
        return {
          ok: true,
          status: 200,
          headers: { get: () => "llmi_empty_turn_1" },
          body: sseBody([
            'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"maxpower-cloud","choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning_content":"thinking"},"logprobs":null,"finish_reason":null}]}\nid: 1\n\n',
            'event: error\ndata: {"error":{"message":"The cloud LLM stream failed.","type":"server_error","code":"provider_unavailable","param":null}}\n\n',
          ]),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "llmi_empty_turn_2" },
        body: sseBody([
          'data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":2,"model":"maxpower-cloud","choices":[{"index":0,"delta":{"role":"assistant","content":"重试成功。"},"logprobs":null,"finish_reason":null}]}\nid: 1\n\n',
          'data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":2,"model":"maxpower-cloud","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}]}\nid: 2\n\n',
          "data: [DONE]\n\n",
        ]),
      };
    },
  });

  const stream = provider.streamFn(provider.model, {
    messages: [{ role: "user", content: "继续", timestamp: 1 }],
  });
  for await (const _event of stream) { /* drain */ }
  const final = await stream.result();

  assert.equal(calls, 2);
  assert.equal(final.stopReason, "stop");
  assert.equal(final.content.filter((part) => part.type === "text").map((part) => part.text).join(""), "重试成功。");
});

test("Pi provider never retries a turn that already produced visible content", async () => {
  let calls = 0;
  const provider = new MaxPowerPiLlmProvider({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "service-jwt" },
    invocationId: () => `visible-turn-${calls}`,
    maxResumeAttempts: 0,
    fetch: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "llmi_visible_turn" },
        body: sseBody([
          'data: {"id":"chatcmpl_3","object":"chat.completion.chunk","created":3,"model":"maxpower-cloud","choices":[{"index":0,"delta":{"role":"assistant","content":"已输出"},"logprobs":null,"finish_reason":null}]}\nid: 1\n\n',
          'event: error\ndata: {"error":{"message":"The cloud LLM stream failed.","type":"server_error","code":"provider_unavailable","param":null}}\n\n',
        ]),
      };
    },
  });

  const stream = provider.streamFn(provider.model, {
    messages: [{ role: "user", content: "继续", timestamp: 1 }],
  });
  for await (const _event of stream) { /* drain */ }
  const final = await stream.result();

  assert.equal(calls, 1, "已有可见内容的轮次不盲目重试，避免重复文本");
  assert.equal(final.stopReason, "error");
  assert.equal(final.errorMessage, "provider_unavailable");
});
