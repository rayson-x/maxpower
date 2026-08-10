import assert from "node:assert/strict";
import test from "node:test";

import {
  RedisFixedWindowRateLimiter,
  type RedisRateLimitClient,
} from "../src/http/redis-rate-limiter.js";

test("shared Redis limiter admits up to the limit and returns the remaining retry window", async () => {
  const client = new FakeRedisRateLimitClient();
  const limiter = new RedisFixedWindowRateLimiter({
    client,
    limit: 2,
    windowSeconds: 60,
  });

  assert.deepEqual(await limiter.consume("account-and-route", 0), {
    allowed: true,
    retryAfterSeconds: 60,
  });
  assert.equal((await limiter.consume("account-and-route", 1)).allowed, true);
  assert.deepEqual(await limiter.consume("account-and-route", 2), {
    allowed: false,
    retryAfterSeconds: 60,
  });
});

class FakeRedisRateLimitClient implements RedisRateLimitClient {
  readonly #counts = new Map<string, number>();

  async sendCommand(args: string[]): Promise<unknown> {
    const key = args[3];
    const windowSeconds = Number(args[5]);
    assert.ok(key);
    const count = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, count);
    return [count, windowSeconds];
  }
}
