import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runDeletionWorker } from "../src/worker.js";

test("deletion worker drains jobs and idles without logging cleanup exceptions", async () => {
  const controller = new AbortController();
  const events: Record<string, unknown>[] = [];
  let attempts = 0;
  const deletion = {
    async processNext() {
      attempts += 1;
      if (attempts === 1) return { id: "deletion_1" } as never;
      if (attempts === 2) throw new Error("secret object key");
      controller.abort();
      return undefined;
    },
  };

  await runDeletionWorker({
    deletion,
    pollIntervalMs: 1,
    signal: controller.signal,
    sleep: async () => undefined,
    writeEvent(event) { events.push(event); },
  });

  assert.deepEqual(events, [
    { event: "account_deletion_completed", jobId: "deletion_1" },
    { event: "account_deletion_retry_scheduled", errorCode: "cleanup_failed" },
  ]);
  assert.equal(JSON.stringify(events).includes("secret object key"), false);
});

test("worker recovers expired LLM reservations without exposing invocation content", async () => {
  const controller = new AbortController();
  const events: Record<string, unknown>[] = [];
  let recoveries = 0;
  await runDeletionWorker({
    deletion: {
      async processNext() {
        controller.abort();
        return undefined;
      },
    },
    llmRecovery: {
      async recoverExpired() {
        recoveries += 1;
        return {
          releasedBeforeProvider: 1,
          releasedDispatchPendingReconciliation: 3,
          chargedPendingReconciliation: 2,
        };
      },
    },
    pollIntervalMs: 1,
    signal: controller.signal,
    sleep: async () => undefined,
    writeEvent(event) { events.push(event); },
  });

  assert.equal(recoveries, 1);
  assert.deepEqual(events, [{
    event: "llm_reservations_recovered",
    releasedBeforeProvider: 1,
    releasedDispatchPendingReconciliation: 3,
    chargedPendingReconciliation: 2,
  }]);
});

test("worker drains durable media byte-deletion jobs outside the HTTP request", async () => {
  const controller = new AbortController();
  const events: Record<string, unknown>[] = [];
  await runDeletionWorker({
    deletion: {
      async processNext() {
        controller.abort();
        return undefined;
      },
    },
    mediaDeletion: {
      async processNextDeletion() {
        return { jobId: "media-delete-1", accountId: "alice", deletedAssetIds: ["asset-1"] };
      },
    },
    pollIntervalMs: 1,
    signal: controller.signal,
    sleep: async () => undefined,
    writeEvent(event) { events.push(event); },
  });
  assert.deepEqual(events, [{ event: "media_deletion_completed", jobId: "media-delete-1" }]);
  assert.doesNotMatch(JSON.stringify(events), /alice|asset-1/);
});

test("worker entrypoint composes the least-privilege runtime instead of the API runtime", () => {
  const source = readFileSync(resolve(process.cwd(), "src/worker.ts"), "utf8");
  assert.match(source, /parseProductionWorkerConfig/);
  assert.match(source, /createProductionWorkerRuntime/);
  assert.doesNotMatch(source, /createProductionRuntime\(/);
});
