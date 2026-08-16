import assert from "node:assert/strict";
import test from "node:test";

import { createInfrastructureReadiness } from "../src/runtime/production/readiness.js";

test("production readiness requires PostgreSQL and both Redis roles", async () => {
  const calls: string[] = [];
  const readiness = createInfrastructureReadiness({
    postgres: {
      async query(sql: string) {
        calls.push(`postgres:${sql}`);
        return { rows: [{ ok: 1 }] };
      },
    },
    rateLimitRedis: {
      async sendCommand(command: string[]) {
        calls.push(`rate:${command.join(" ")}`);
        return "PONG";
      },
    },
    streamRedis: {
      async sendCommand(command: string[]) {
        calls.push(`stream:${command.join(" ")}`);
        return "PONG";
      },
    },
  });

  assert.equal(await readiness(), true);
  assert.deepEqual(calls, [
    "postgres:SELECT 1 AS ok",
    "rate:PING",
    "stream:PING",
  ]);
});

test("production readiness returns not-ready without leaking dependency errors", async () => {
  const readiness = createInfrastructureReadiness({
    postgres: { async query() { throw new Error("postgres://user:password@private"); } },
    rateLimitRedis: { async sendCommand() { return "PONG"; } },
    streamRedis: { async sendCommand() { return "PONG"; } },
  });

  assert.equal(await readiness(), false);
});
