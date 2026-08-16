import assert from "node:assert/strict";
import test from "node:test";

import { HeadBucketCommand } from "@aws-sdk/client-s3";

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
    objectStorage: {
      bucket: "maxpower-private-media",
      client: {
        async send(command: unknown) {
          assert.ok(command instanceof HeadBucketCommand);
          calls.push(`s3:${command.input.Bucket}`);
          return { $metadata: { httpStatusCode: 200 } };
        },
      },
    },
  });

  assert.equal(await readiness(), true);
  assert.deepEqual(calls, [
    "postgres:SELECT 1 AS ok",
    "rate:PING",
    "stream:PING",
    "s3:maxpower-private-media",
  ]);
});

test("production readiness returns not-ready without leaking dependency errors", async () => {
  const readiness = createInfrastructureReadiness({
    postgres: { async query() { throw new Error("postgres://user:password@private"); } },
    rateLimitRedis: { async sendCommand() { return "PONG"; } },
    streamRedis: { async sendCommand() { return "PONG"; } },
    objectStorage: {
      bucket: "maxpower-private-media",
      client: { async send() { return {}; } },
    },
  });

  assert.equal(await readiness(), false);
});
