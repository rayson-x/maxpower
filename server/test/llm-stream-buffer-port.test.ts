import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/kernel/api-error.js";
import type { Principal } from "../src/kernel/principal.js";
import {
  InMemoryLlmEntitlementAdapter,
  InMemoryLlmProviderAdapter,
  InMemoryLlmUsageAdapter,
  LlmGateway,
  type OpenAiObject,
  type StreamBufferFailure,
  type VolatileStreamBufferAdapter,
} from "../src/modules/llm/index.js";

test("LlmGateway streams and resumes through the injected volatile buffer", async () => {
  const streamBuffers = new TestStreamBufferAdapter();
  const gateway = new LlmGateway({
    provider: new InMemoryLlmProviderAdapter([
      {
        kind: "stream",
        chunks: [
          { object: "chat.completion.chunk", choices: [{ delta: { content: "one" } }] },
          { object: "chat.completion.chunk", choices: [{ delta: { content: "two" } }] },
        ],
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4, credits: 2 },
      },
    ]),
    entitlements: new InMemoryLlmEntitlementAdapter({
      alice: { availableCredits: 200 },
    }),
    usage: new InMemoryLlmUsageAdapter(),
    streamBuffers,
    fingerprintSecret: "test-fingerprint-secret",
  });

  const result = await gateway.invoke(principal("alice"), {
    idempotencyKey: "stream-port-1",
    request: {
      model: "maxpower/coach-v1",
      stream: true,
      messages: [],
    },
  });
  assert.equal(result.kind, "stream");
  if (result.kind !== "stream") return;

  const initial = await collect(result.chunks);
  const resumed = await gateway.resume(principal("alice"), {
    invocationId: result.invocationId,
    afterSequence: 1,
  });
  const replay = await collect(resumed);

  assert.equal(initial.length, 2);
  assert.equal(replay.length, 1);
  assert.ok(initial.every((chunk) => chunk.bufferedBy === "injected-adapter"));
  assert.deepEqual(replay[0], initial[1]);
});

test("a second gateway node reuses an idempotent stream while its shared buffer is live", async () => {
  const streamBuffers = new TestStreamBufferAdapter();
  const usage = new InMemoryLlmUsageAdapter();
  const entitlements = new InMemoryLlmEntitlementAdapter({
    alice: { availableCredits: 200 },
  });
  const provider = new InMemoryLlmProviderAdapter([
    {
      kind: "stream",
      chunks: [
        { object: "chat.completion.chunk", choices: [{ delta: { content: "shared" } }] },
      ],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, credits: 1 },
    },
  ]);
  const common = {
    entitlements,
    usage,
    streamBuffers,
    fingerprintSecret: "test-fingerprint-secret",
  } as const;
  const firstNode = new LlmGateway({ ...common, provider });
  const secondNodeProvider = new InMemoryLlmProviderAdapter();
  const secondNode = new LlmGateway({ ...common, provider: secondNodeProvider });
  const input = {
    idempotencyKey: "cross-node-stream",
    request: {
      model: "maxpower/coach-v1",
      stream: true,
      messages: [],
    },
  } as const;

  const first = await firstNode.invoke(principal("alice"), input);
  assert.equal(first.kind, "stream");
  if (first.kind !== "stream") return;
  await collect(first.chunks);

  const replay = await secondNode.invoke(principal("alice"), input);
  assert.equal(replay.kind, "stream");
  if (replay.kind !== "stream") return;
  assert.equal(replay.invocationId, first.invocationId);
  assert.equal((await collect(replay.chunks)).length, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(secondNodeProvider.calls.length, 0);
});

interface TestBuffer {
  ownerAccountId: string;
  chunks: OpenAiObject[];
  completed: boolean;
  failure?: StreamBufferFailure;
}

class TestStreamBufferAdapter implements VolatileStreamBufferAdapter {
  readonly #buffers = new Map<string, TestBuffer>();

  async create(input: {
    invocationId: string;
    ownerAccountId: string;
    ttlMs: number;
  }): Promise<void> {
    void input.ttlMs;
    this.#buffers.set(input.invocationId, {
      ownerAccountId: input.ownerAccountId,
      chunks: [],
      completed: false,
    });
  }

  async append(invocationId: string, chunk: OpenAiObject): Promise<void> {
    this.#required(invocationId).chunks.push({
      ...structuredClone(chunk),
      bufferedBy: "injected-adapter",
    });
  }

  async complete(invocationId: string): Promise<void> {
    this.#required(invocationId).completed = true;
  }

  async fail(invocationId: string, failure: StreamBufferFailure): Promise<void> {
    const buffer = this.#required(invocationId);
    buffer.failure = failure;
    buffer.completed = true;
  }

  async read(input: {
    invocationId: string;
    ownerAccountId: string;
    afterSequence: number;
  }): Promise<AsyncIterable<OpenAiObject>> {
    const buffer = this.#required(input.invocationId);
    if (buffer.ownerAccountId !== input.ownerAccountId) {
      throw new ApiError(403, "invocation_forbidden", "Wrong owner.");
    }
    return {
      async *[Symbol.asyncIterator]() {
        let index = input.afterSequence;
        while (!buffer.completed || index < buffer.chunks.length) {
          const chunk = buffer.chunks[index];
          if (chunk !== undefined) {
            index += 1;
            yield structuredClone(chunk);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        if (buffer.failure !== undefined) {
          throw new ApiError(
            buffer.failure.status,
            buffer.failure.code,
            buffer.failure.message,
          );
        }
      },
    };
  }

  async delete(invocationId: string): Promise<void> {
    this.#buffers.delete(invocationId);
  }

  #required(invocationId: string): TestBuffer {
    const buffer = this.#buffers.get(invocationId);
    if (buffer === undefined) throw new Error("Buffer not found.");
    return buffer;
  }
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
