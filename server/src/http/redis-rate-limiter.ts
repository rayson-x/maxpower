import type { RateLimitDecision, RateLimiter } from "./security.js";

export interface RedisRateLimitClient {
  sendCommand(args: string[]): Promise<unknown>;
}

export interface RedisFixedWindowRateLimiterOptions {
  client: RedisRateLimitClient;
  limit: number;
  windowSeconds: number;
  keyPrefix?: string;
}

export class RedisFixedWindowRateLimiter implements RateLimiter {
  readonly #client: RedisRateLimitClient;
  readonly #limit: number;
  readonly #windowSeconds: number;
  readonly #keyPrefix: string;

  constructor(options: RedisFixedWindowRateLimiterOptions) {
    assertPositiveInteger(options.limit, "limit");
    assertPositiveInteger(options.windowSeconds, "windowSeconds");
    this.#client = options.client;
    this.#limit = options.limit;
    this.#windowSeconds = options.windowSeconds;
    this.#keyPrefix = options.keyPrefix ?? "maxpower:rate-limit";
  }

  async consume(key: string, nowMs: number): Promise<RateLimitDecision> {
    void nowMs;
    const result = await this.#client.sendCommand([
      "EVAL",
      FIXED_WINDOW_SCRIPT,
      "1",
      `${this.#keyPrefix}:${key}`,
      String(this.#limit),
      String(this.#windowSeconds),
    ]);
    if (!Array.isArray(result)) {
      throw new Error("Redis rate-limit result is invalid.");
    }
    const count = integer(result[0]);
    const ttl = integer(result[1]);
    return {
      allowed: count <= this.#limit,
      retryAfterSeconds: ttl > 0 ? ttl : this.#windowSeconds,
    };
  }
}

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function integer(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Redis rate-limit result is invalid.");
  }
  return parsed;
}
