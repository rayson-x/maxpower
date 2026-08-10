import assert from "node:assert/strict";
import test from "node:test";

import {
  RedisVolatileStreamBufferAdapter,
  type RedisCommandClient,
} from "../src/adapters/stream-buffer/index.js";
import { ApiError } from "../src/kernel/api-error.js";
import type { Principal } from "../src/kernel/principal.js";
import {
  InMemoryLlmEntitlementAdapter,
  InMemoryLlmProviderAdapter,
  InMemoryLlmUsageAdapter,
  LlmGateway,
  type OpenAiObject,
} from "../src/modules/llm/index.js";

test("Redis volatile buffer replays Gateway chunks and erases them on delete", async () => {
  const redis = new MemoryRedisCommands();
  const streamBuffers = new RedisVolatileStreamBufferAdapter({
    client: redis,
    persistence: "disabled",
    pollIntervalMs: 1,
  });
  const gateway = new LlmGateway({
    provider: new InMemoryLlmProviderAdapter([
      {
        kind: "stream",
        chunks: [
          {
            object: "chat.completion.chunk",
            choices: [{ delta: { content: "EPHEMERAL_STREAM_SENTINEL" } }],
          },
          { object: "chat.completion.chunk", choices: [{ delta: { content: "done" } }] },
        ],
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4, credits: 1 },
      },
    ]),
    entitlements: new InMemoryLlmEntitlementAdapter({
      alice: { availableCredits: 200 },
    }),
    usage: new InMemoryLlmUsageAdapter(),
    streamBuffers,
    fingerprintSecret: "redis-stream-fingerprint",
  });

  const result = await gateway.invoke(principal("alice"), {
    idempotencyKey: "redis-stream-1",
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
  assert.equal((await collect(resumed)).length, 1);
  assert.equal(initial.length, 2);
  assert.equal(redis.serialized().includes("EPHEMERAL_STREAM_SENTINEL"), true);

  await streamBuffers.delete(result.invocationId);
  assert.equal(redis.serialized().includes("EPHEMERAL_STREAM_SENTINEL"), false);
  await assert.rejects(
    gateway.resume(principal("alice"), { invocationId: result.invocationId }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 410);
      assert.equal(error.code, "stream_expired");
      return true;
    },
  );
});

class MemoryRedisCommands implements RedisCommandClient {
  readonly #hashes = new Map<string, Map<string, string>>();
  readonly #lists = new Map<string, string[]>();

  async sendCommand(args: string[]): Promise<unknown> {
    const command = args[0]?.toUpperCase();
    if (command === "EVAL") return this.#eval(args);
    if (command === "HMGET") {
      const hash = this.#hashes.get(required(args[1]));
      return args.slice(2).map((field) => hash?.get(field) ?? null);
    }
    if (command === "LRANGE") {
      const list = this.#lists.get(required(args[1])) ?? [];
      const start = Number.parseInt(required(args[2]), 10);
      const endRaw = Number.parseInt(required(args[3]), 10);
      const end = endRaw < 0 ? list.length : endRaw + 1;
      return list.slice(start, end);
    }
    if (command === "DEL") {
      let deleted = 0;
      for (const key of args.slice(1)) {
        if (this.#hashes.delete(key)) deleted += 1;
        if (this.#lists.delete(key)) deleted += 1;
      }
      return deleted;
    }
    throw new Error(`Unsupported Redis command: ${command}`);
  }

  serialized(): string {
    return JSON.stringify({
      hashes: [...this.#hashes].map(([key, hash]) => [key, [...hash]]),
      lists: [...this.#lists],
    });
  }

  #eval(args: string[]): number {
    const script = required(args[1]);
    const metaKey = required(args[3]);
    const eventsKey = required(args[4]);
    const scriptArgs = args.slice(5);
    if (script.includes("maxpower:create-stream")) {
      this.#hashes.set(
        metaKey,
        new Map([
          ["owner_account_id", required(scriptArgs[0])],
          ["status", "active"],
          ["error_status", ""],
          ["error_code", ""],
        ]),
      );
      this.#lists.delete(eventsKey);
      return 1;
    }
    if (script.includes("maxpower:append-stream")) {
      const list = this.#lists.get(eventsKey) ?? [];
      list.push(required(scriptArgs[0]));
      this.#lists.set(eventsKey, list);
      return list.length;
    }
    if (script.includes("maxpower:complete-stream")) {
      const hash = this.#hashes.get(metaKey);
      if (hash === undefined) return 0;
      hash.set("status", "completed");
      return 1;
    }
    if (script.includes("maxpower:fail-stream")) {
      const hash = this.#hashes.get(metaKey);
      if (hash === undefined) return 0;
      hash.set("status", "failed");
      hash.set("error_status", required(scriptArgs[0]));
      hash.set("error_code", required(scriptArgs[1]));
      return 1;
    }
    throw new Error("Unsupported Redis script.");
  }
}

function required(value: string | undefined): string {
  if (value === undefined) throw new Error("Missing Redis argument.");
  return value;
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
