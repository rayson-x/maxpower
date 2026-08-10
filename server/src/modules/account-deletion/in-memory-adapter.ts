import { createHash } from "node:crypto";

import { ApiError, conflict, notFound } from "../../kernel/api-error.js";
import { randomId, type IdFactory } from "../../kernel/ids.js";
import type {
  AccountDeletionAdapter,
  AccountDeletionJob,
  BeginAccountDeletionInput,
} from "./model.js";

export interface InMemoryOwnedAccountData {
  sessions: number;
  productResources: number;
  mediaObjects: number;
  entitlementEnabled: boolean;
  identityExists: boolean;
}

interface StoredJob extends AccountDeletionJob {
  requestHash: string;
  receiptHash: string;
}

export class InMemoryAccountDeletionAdapter implements AccountDeletionAdapter {
  readonly #ids: IdFactory;
  readonly #jobs = new Map<string, StoredJob>();
  readonly #jobIdByAccount = new Map<string, string>();
  readonly #data = new Map<string, InMemoryOwnedAccountData>();
  readonly #blockedAccounts = new Set<string>();
  #failNext = false;

  constructor(ids: IdFactory = randomId) {
    this.#ids = ids;
  }

  async request(input: BeginAccountDeletionInput): Promise<AccountDeletionJob> {
    const existingId = this.#jobIdByAccount.get(input.accountId);
    if (existingId !== undefined) {
      const existing = requiredJob(this.#jobs, existingId);
      if (existing.requestHash !== receiptHash(input.idempotencyKey)) {
        throw conflict("deletion_already_requested", "Account deletion is already requested.");
      }
      return publicJob(existing);
    }

    const id = this.#ids("deletion");
    const job: StoredJob = {
      id,
      accountId: input.accountId,
      deletionReceipt: id,
      status: "pending",
      requestedAt: input.requestedAt,
      updatedAt: input.requestedAt,
      attempts: 0,
      completedAt: null,
      lastErrorCode: null,
      requestHash: receiptHash(input.idempotencyKey),
      receiptHash: receiptHash(id),
    };
    this.#blockedAccounts.add(input.accountId);
    this.#jobs.set(job.id, job);
    this.#jobIdByAccount.set(job.accountId, job.id);
    return publicJob(job);
  }

  async getForAccount(accountId: string): Promise<AccountDeletionJob | undefined> {
    const jobId = this.#jobIdByAccount.get(accountId);
    if (jobId === undefined) return undefined;
    return publicJob(requiredJob(this.#jobs, jobId));
  }

  async getForReceipt(receipt: string): Promise<AccountDeletionJob | undefined> {
    const hash = receiptHash(receipt);
    const job = [...this.#jobs.values()].find((candidate) => candidate.receiptHash === hash);
    return job === undefined ? undefined : publicJob(job);
  }

  async getForRequest(idempotencyKey: string): Promise<AccountDeletionJob | undefined> {
    const hash = receiptHash(idempotencyKey);
    const job = [...this.#jobs.values()].find((candidate) => candidate.requestHash === hash);
    return job === undefined ? undefined : publicJob(job);
  }

  async claimNext(updatedAt: string): Promise<AccountDeletionJob | undefined> {
    const job = [...this.#jobs.values()]
      .filter((candidate) => candidate.status === "pending" || candidate.status === "retryable")
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))[0];
    if (job === undefined) return undefined;
    job.status = "running";
    job.attempts += 1;
    job.updatedAt = updatedAt;
    return publicJob(job);
  }

  async eraseOwnedData(accountId: string): Promise<void> {
    if (this.#failNext) {
      this.#failNext = false;
      throw new Error("Simulated cleanup failure.");
    }
    const data = this.#data.get(accountId);
    if (data === undefined) throw notFound("account_data");
    data.sessions = 0;
    data.productResources = 0;
    data.mediaObjects = 0;
    data.entitlementEnabled = false;
    data.identityExists = false;
  }

  async complete(jobId: string, completedAt: string): Promise<AccountDeletionJob> {
    const job = requiredJob(this.#jobs, jobId);
    job.status = "completed";
    job.completedAt = completedAt;
    job.updatedAt = completedAt;
    job.lastErrorCode = null;
    return publicJob(job);
  }

  async retry(
    jobId: string,
    errorCode: string,
    updatedAt: string,
  ): Promise<AccountDeletionJob> {
    const job = requiredJob(this.#jobs, jobId);
    job.status = "retryable";
    job.lastErrorCode = errorCode;
    job.updatedAt = updatedAt;
    return publicJob(job);
  }

  seedAccount(accountId: string, data: InMemoryOwnedAccountData): void {
    this.#data.set(accountId, structuredClone(data));
  }

  inspectAccount(accountId: string): InMemoryOwnedAccountData | undefined {
    const data = this.#data.get(accountId);
    return data === undefined ? undefined : structuredClone(data);
  }

  canUseService(accountId: string): boolean {
    return !this.#blockedAccounts.has(accountId);
  }

  failNextCleanup(): void {
    this.#failNext = true;
  }
}

function receiptHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredJob(jobs: Map<string, StoredJob>, id: string): StoredJob {
  const job = jobs.get(id);
  if (job === undefined) throw new ApiError(500, "deletion_job_missing", "Deletion job is missing.");
  return job;
}

function publicJob(job: StoredJob): AccountDeletionJob {
  return {
    id: job.id,
    accountId: job.accountId,
    deletionReceipt: job.deletionReceipt,
    status: job.status,
    requestedAt: job.requestedAt,
    updatedAt: job.updatedAt,
    attempts: job.attempts,
    completedAt: job.completedAt,
    lastErrorCode: job.lastErrorCode,
  };
}
