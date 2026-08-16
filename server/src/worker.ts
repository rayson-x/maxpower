import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ProductionConfigurationError,
  parseProductionWorkerConfig,
} from "./config/production-config.js";
import { ApiError } from "./kernel/api-error.js";
import type { AccountDeletion, AccountDeletionJob } from "./modules/account-deletion/model.js";
import type { LlmInvocationLifecycleAdapter } from "./modules/llm/ports.js";
import type { MediaDeletionJobResult } from "./adapters/object-storage/index.js";
import { createProductionWorkerRuntime } from "./runtime/production/production-worker-runtime.js";

export interface DeletionWorkerOptions {
  deletion: Pick<AccountDeletion, "processNext">;
  llmRecovery?: Pick<LlmInvocationLifecycleAdapter, "recoverExpired">;
  mediaDeletion?: { processNextDeletion(): Promise<MediaDeletionJobResult | undefined> };
  pollIntervalMs: number;
  signal: AbortSignal;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  writeEvent?: (event: Record<string, unknown>) => void;
}

/** Runs one durable deletion stage at a time. Events contain IDs/codes, never exception text. */
export async function runDeletionWorker(options: DeletionWorkerOptions): Promise<void> {
  if (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs < 1) {
    throw new Error("Deletion worker poll interval must be a positive integer.");
  }
  const sleep = options.sleep ?? abortableSleep;
  const writeEvent = options.writeEvent ?? writeJsonEvent;

  while (!options.signal.aborted) {
    let recovered = false;
    if (options.llmRecovery !== undefined) {
      try {
        const result = await options.llmRecovery.recoverExpired({
          recoveredAt: new Date().toISOString(),
          limit: 100,
        });
        recovered = result.releasedBeforeProvider > 0
          || result.releasedDispatchPendingReconciliation > 0
          || result.chargedPendingReconciliation > 0;
        if (recovered) {
          writeEvent({ event: "llm_reservations_recovered", ...result });
        }
      } catch {
        writeEvent({ event: "llm_reservation_recovery_retry_scheduled" });
      }
    }
    let mediaDeleted = false;
    if (options.mediaDeletion !== undefined) {
      try {
        const job = await options.mediaDeletion.processNextDeletion();
        if (job !== undefined) {
          mediaDeleted = true;
          writeEvent({ event: "media_deletion_completed", jobId: job.jobId });
        }
      } catch {
        writeEvent({ event: "media_deletion_retry_scheduled", errorCode: "object_delete_failed" });
      }
    }
    try {
      const job = await options.deletion.processNext();
      if (job !== undefined) {
        writeEvent(completedEvent(job));
      } else if (!recovered && !mediaDeleted) {
        await sleep(options.pollIntervalMs, options.signal);
      }
    } catch (error) {
      writeEvent({
        event: "account_deletion_retry_scheduled",
        errorCode: error instanceof ApiError ? error.code : "cleanup_failed",
      });
      await sleep(options.pollIntervalMs, options.signal);
    }
  }
}

function completedEvent(job: AccountDeletionJob): Record<string, unknown> {
  return { event: "account_deletion_completed", jobId: job.id };
}

function writeJsonEvent(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    timeout.unref();
    signal.addEventListener("abort", finish, { once: true });
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

async function main(): Promise<void> {
  const config = parseProductionWorkerConfig(process.env);
  const runtime = await createProductionWorkerRuntime(config);
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);
  try {
    await runDeletionWorker({
      deletion: runtime.deletion,
      llmRecovery: runtime.llmRecovery,
      mediaDeletion: runtime.mediaDeletion,
      pollIntervalMs: config.worker.deletionPollMs,
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGTERM", abort);
    process.removeListener("SIGINT", abort);
    await runtime.close();
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    process.stderr.write(error instanceof ProductionConfigurationError
      ? `${error.message}\n`
      : "MaxPower deletion worker failed.\n");
    process.exitCode = 1;
  });
}
