import { ApiError, forbidden, notFound } from "../../kernel/api-error.js";
import { SystemClock, type Clock } from "../../kernel/clock.js";
import { hasScope, type Principal } from "../../kernel/principal.js";
import type {
  AccountDeletion,
  AccountDeletionAdapter,
  AccountDeletionJob,
  RequestAccountDeletionInput,
} from "./model.js";

export interface AccountDeletionModuleDependencies {
  adapter: AccountDeletionAdapter;
  clock?: Clock;
}

export class AccountDeletionModule implements AccountDeletion {
  readonly #adapter: AccountDeletionAdapter;
  readonly #clock: Clock;

  constructor(dependencies: AccountDeletionModuleDependencies) {
    this.#adapter = dependencies.adapter;
    this.#clock = dependencies.clock ?? new SystemClock();
  }

  request(
    principal: Principal,
    input: RequestAccountDeletionInput,
  ): Promise<AccountDeletionJob> {
    requireDeleteCapability(principal);
    if (input.confirmation !== "DELETE") {
      throw new ApiError(400, "deletion_confirmation_required", "Type DELETE to confirm.");
    }
    const idempotencyKey = validIdempotencyKey(input.idempotencyKey);
    return this.#adapter.request({
      accountId: principal.accountId,
      idempotencyKey,
      requestedAt: this.#clock.now().toISOString(),
    });
  }

  async get(principal: Principal): Promise<AccountDeletionJob> {
    if (principal.accountId.trim() === "") {
      throw forbidden();
    }
    const job = await this.#adapter.getForAccount(principal.accountId);
    if (job === undefined) throw notFound("account_deletion");
    return job;
  }

  async getByReceipt(receiptInput: string): Promise<AccountDeletionJob> {
    const receipt = validReceipt(receiptInput);
    const job = await this.#adapter.getForReceipt(receipt);
    if (job === undefined) throw notFound("account_deletion");
    return job;
  }

  async getByRequestKey(idempotencyKeyInput: string): Promise<AccountDeletionJob> {
    const idempotencyKey = validIdempotencyKey(idempotencyKeyInput);
    const job = await this.#adapter.getForRequest(idempotencyKey);
    if (job === undefined) throw notFound("account_deletion");
    return job;
  }

  async processNext(): Promise<AccountDeletionJob | undefined> {
    const timestamp = this.#clock.now().toISOString();
    const job = await this.#adapter.claimNext(timestamp);
    if (job === undefined) return undefined;
    try {
      await this.#adapter.eraseOwnedData(job.accountId);
      return await this.#adapter.complete(job.id, this.#clock.now().toISOString());
    } catch (error) {
      await this.#adapter.retry(
        job.id,
        error instanceof ApiError ? error.code : "cleanup_failed",
        this.#clock.now().toISOString(),
      );
      throw error;
    }
  }
}

function requireDeleteCapability(principal: Principal): void {
  if (principal.status !== "active") {
    throw forbidden("account_unavailable", "The account is not active.");
  }
  if (!hasScope(principal, "account:delete")) {
    throw forbidden("missing_scope", "The access token cannot delete the account.");
  }
}

function validReceipt(value: string): string {
  const receipt = value.trim();
  if (!receipt || receipt.length > 200) {
    throw new ApiError(400, "invalid_deletion_receipt", "The deletion receipt is invalid.");
  }
  return receipt;
}

function validIdempotencyKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(key)) {
    throw new ApiError(
      400,
      "invalid_idempotency_key",
      "Account deletion requires a random 32-byte hexadecimal Idempotency-Key.",
    );
  }
  return key;
}
