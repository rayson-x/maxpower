import type { Principal } from "../../kernel/principal.js";

export type AccountDeletionStatus = "pending" | "running" | "retryable" | "completed";

export interface AccountDeletionJob {
  id: string;
  accountId: string;
  /** Server-generated bearer capability used only to read deletion progress. */
  deletionReceipt: string;
  status: AccountDeletionStatus;
  requestedAt: string;
  updatedAt: string;
  attempts: number;
  completedAt: string | null;
  lastErrorCode: string | null;
}

export interface RequestAccountDeletionInput {
  idempotencyKey: string;
  confirmation: "DELETE";
}

export interface AccountDeletion {
  request(
    principal: Principal,
    input: RequestAccountDeletionInput,
  ): Promise<AccountDeletionJob>;
  get(principal: Principal): Promise<AccountDeletionJob>;
  /** Narrow status lookup using the server-generated receipt. */
  getByReceipt(receipt: string): Promise<AccountDeletionJob>;
  /** Used only to recover the same receipt after an authenticated request revoked its session. */
  getByRequestKey(idempotencyKey: string): Promise<AccountDeletionJob>;
  processNext(): Promise<AccountDeletionJob | undefined>;
}

export interface BeginAccountDeletionInput {
  accountId: string;
  idempotencyKey: string;
  requestedAt: string;
}

export interface AccountDeletionAdapter {
  /** Atomically blocks service and creates/replays the deletion job. */
  request(input: BeginAccountDeletionInput): Promise<AccountDeletionJob>;
  getForAccount(accountId: string): Promise<AccountDeletionJob | undefined>;
  getForReceipt(receipt: string): Promise<AccountDeletionJob | undefined>;
  getForRequest(idempotencyKey: string): Promise<AccountDeletionJob | undefined>;
  claimNext(updatedAt: string): Promise<AccountDeletionJob | undefined>;
  eraseOwnedData(accountId: string): Promise<void>;
  complete(jobId: string, completedAt: string): Promise<AccountDeletionJob>;
  retry(jobId: string, errorCode: string, updatedAt: string): Promise<AccountDeletionJob>;
}
