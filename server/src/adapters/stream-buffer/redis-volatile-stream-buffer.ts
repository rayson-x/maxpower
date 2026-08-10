import { ApiError } from "../../kernel/api-error.js";
import type { OpenAiObject } from "../../modules/llm/model.js";
import type {
  StreamBufferFailure,
  VolatileStreamBufferAdapter,
} from "../../modules/llm/ports.js";

const MAX_TTL_MS = 5 * 60 * 1_000;

/** Structurally compatible with node-redis' low-level command surface. */
export interface RedisCommandClient {
  sendCommand(args: string[]): Promise<unknown>;
}

export interface RedisVolatileStreamBufferOptions {
  client: RedisCommandClient;
  /**
   * Explicit operational acknowledgement: Redis AOF, RDB snapshots, managed
   * backups and cross-region replication must all be disabled for this client.
   */
  persistence: "disabled";
  keyPrefix?: string;
  pollIntervalMs?: number;
}

/** Five-minute, memory-only Redis replay buffer. No request content is logged. */
export class RedisVolatileStreamBufferAdapter implements VolatileStreamBufferAdapter {
  readonly #client: RedisCommandClient;
  readonly #keyPrefix: string;
  readonly #pollIntervalMs: number;

  constructor(options: RedisVolatileStreamBufferOptions) {
    if (options.persistence !== "disabled") {
      throw new Error("The stream Redis client must have persistence disabled.");
    }
    const pollIntervalMs = options.pollIntervalMs ?? 100;
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
      throw new Error("pollIntervalMs must be a positive integer.");
    }
    this.#client = options.client;
    this.#keyPrefix = options.keyPrefix ?? "maxpower:llm:stream";
    this.#pollIntervalMs = pollIntervalMs;
  }

  async create(input: {
    invocationId: string;
    ownerAccountId: string;
    ttlMs: number;
  }): Promise<void> {
    const ttlSeconds = ttl(input.ttlMs);
    const keys = this.#keys(input.invocationId);
    await this.#eval(CREATE_SCRIPT, keys, [input.ownerAccountId, String(ttlSeconds)]);
  }

  async append(invocationId: string, chunk: OpenAiObject): Promise<void> {
    const keys = this.#keys(invocationId);
    const result = await this.#eval(APPEND_SCRIPT, keys, [
      JSON.stringify(chunk),
    ]);
    if (numeric(result) < 1) throw streamExpired();
  }

  async complete(invocationId: string): Promise<void> {
    const result = await this.#eval(COMPLETE_SCRIPT, this.#keys(invocationId), []);
    if (numeric(result) < 1) throw streamExpired();
  }

  async fail(invocationId: string, failure: StreamBufferFailure): Promise<void> {
    const result = await this.#eval(FAIL_SCRIPT, this.#keys(invocationId), [
      String(failure.status),
      failure.code,
    ]);
    if (numeric(result) < 1) throw streamExpired();
  }

  async read(input: {
    invocationId: string;
    ownerAccountId: string;
    afterSequence: number;
  }): Promise<AsyncIterable<OpenAiObject>> {
    const first = await this.#snapshot(
      input.invocationId,
      input.ownerAccountId,
      input.afterSequence,
    );
    const adapter = this;
    return {
      async *[Symbol.asyncIterator]() {
        let snapshot = first;
        let nextSequence = input.afterSequence;
        while (true) {
          for (const chunk of snapshot.chunks) {
            nextSequence += 1;
            yield chunk;
          }
          if (snapshot.status === "completed") return;
          if (snapshot.status === "failed") {
            throw new ApiError(
              snapshot.errorStatus ?? 503,
              snapshot.errorCode ?? "provider_unavailable",
              "The cloud LLM stream failed.",
            );
          }
          await delay(adapter.#pollIntervalMs);
          snapshot = await adapter.#snapshot(
            input.invocationId,
            input.ownerAccountId,
            nextSequence,
          );
        }
      },
    };
  }

  async delete(invocationId: string): Promise<void> {
    const keys = this.#keys(invocationId);
    await this.#client.sendCommand(["DEL", keys.meta, keys.events]);
  }

  async #snapshot(
    invocationId: string,
    ownerAccountId: string,
    afterSequence: number,
  ): Promise<StreamSnapshot> {
    const keys = this.#keys(invocationId);
    const metadata = await this.#client.sendCommand([
      "HMGET",
      keys.meta,
      "owner_account_id",
      "status",
      "error_status",
      "error_code",
    ]);
    if (!Array.isArray(metadata)) throw streamExpired();
    const storedOwner = text(metadata[0]);
    if (storedOwner === null) throw streamExpired();
    if (storedOwner !== ownerAccountId) {
      throw new ApiError(403, "invocation_forbidden", "The invocation belongs to another account.");
    }
    const status = text(metadata[1]);
    if (status !== "active" && status !== "completed" && status !== "failed") {
      throw streamExpired();
    }
    const events = await this.#client.sendCommand([
      "LRANGE",
      keys.events,
      String(afterSequence),
      "-1",
    ]);
    if (!Array.isArray(events)) throw streamExpired();
    return {
      status,
      chunks: events.map(parseChunk),
      errorStatus: optionalInteger(metadata[2]),
      errorCode: text(metadata[3]),
    };
  }

  async #eval(
    script: string,
    keys: { meta: string; events: string },
    args: string[],
  ): Promise<unknown> {
    return this.#client.sendCommand([
      "EVAL",
      script,
      "2",
      keys.meta,
      keys.events,
      ...args,
    ]);
  }

  #keys(invocationId: string): { meta: string; events: string } {
    const base = `${this.#keyPrefix}:${invocationId}`;
    return { meta: `${base}:meta`, events: `${base}:events` };
  }
}

interface StreamSnapshot {
  status: "active" | "completed" | "failed";
  chunks: OpenAiObject[];
  errorStatus: number | null;
  errorCode: string | null;
}

const CREATE_SCRIPT = `
-- maxpower:create-stream
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('HSET', KEYS[1],
  'owner_account_id', ARGV[1],
  'status', 'active',
  'error_status', '',
  'error_code', '',
  'ttl_seconds', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

const APPEND_SCRIPT = `
-- maxpower:append-stream
if redis.call('HGET', KEYS[1], 'status') ~= 'active' then return 0 end
local length = redis.call('RPUSH', KEYS[2], ARGV[1])
local ttl = redis.call('HGET', KEYS[1], 'ttl_seconds')
redis.call('EXPIRE', KEYS[1], ttl)
redis.call('EXPIRE', KEYS[2], ttl)
return length
`;

const COMPLETE_SCRIPT = `
-- maxpower:complete-stream
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'status', 'completed')
local ttl = redis.call('HGET', KEYS[1], 'ttl_seconds')
redis.call('EXPIRE', KEYS[1], ttl)
redis.call('EXPIRE', KEYS[2], ttl)
return 1
`;

const FAIL_SCRIPT = `
-- maxpower:fail-stream
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1],
  'status', 'failed',
  'error_status', ARGV[1],
  'error_code', ARGV[2])
local ttl = redis.call('HGET', KEYS[1], 'ttl_seconds')
redis.call('EXPIRE', KEYS[1], ttl)
redis.call('EXPIRE', KEYS[2], ttl)
return 1
`;

function ttl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TTL_MS) {
    throw new ApiError(500, "invalid_stream_ttl", "Stream buffer TTL must be at most five minutes.");
  }
  return Math.ceil(value / 1_000);
}

function parseChunk(value: unknown): OpenAiObject {
  const serialized = text(value);
  if (serialized === null) throw streamExpired();
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ApiError(500, "invalid_stream_buffer", "The volatile stream buffer is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(500, "invalid_stream_buffer", "The volatile stream buffer is invalid.");
  }
  return parsed as OpenAiObject;
}

function numeric(value: unknown): number {
  const number = typeof value === "number" ? value : Number.parseInt(text(value) ?? "", 10);
  return Number.isFinite(number) ? number : 0;
}

function optionalInteger(value: unknown): number | null {
  const valueAsText = text(value);
  if (valueAsText === null || valueAsText === "") return null;
  const parsed = Number.parseInt(valueAsText, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (typeof value === "number") return String(value);
  return null;
}

function streamExpired(): ApiError {
  return new ApiError(410, "stream_expired", "The volatile event buffer has expired.");
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
