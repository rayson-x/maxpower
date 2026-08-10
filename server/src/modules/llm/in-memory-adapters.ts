import { ApiError } from "../../kernel/api-error.js";
import type { Clock } from "../../kernel/clock.js";
import { SystemClock } from "../../kernel/clock.js";
import type { LlmEntitlementView, OpenAiObject, ProductAlias } from "./model.js";
import type {
  ClaimInvocationResult,
  InvocationMetadata,
  InvocationMetadataUpdate,
  LlmEntitlementAdapter,
  LlmProviderAdapter,
  LlmUsageAdapter,
  ProviderInvocationInput,
  ProviderInvocationDispatch,
  ProviderResult,
  ProviderUsage,
  ReserveEntitlementInput,
  ReserveEntitlementResult,
  SettleEntitlementResult,
  StreamBufferFailure,
  UsageMetadata,
  VolatileStreamBufferAdapter,
} from "./ports.js";

export type InMemoryProviderReply =
  | {
      kind: "complete";
      response: OpenAiObject;
      usage: ProviderUsage;
    }
  | {
      kind: "stream";
      chunks: readonly OpenAiObject[] | AsyncIterable<OpenAiObject>;
      usage: ProviderUsage;
    };

export interface ProviderCallMetadata {
  invocationId: string;
  alias: ProductAlias;
  stream: boolean;
}

/** Test/development provider. It records routing metadata, never request content. */
export class InMemoryLlmProviderAdapter implements LlmProviderAdapter {
  readonly #replies: InMemoryProviderReply[];
  readonly #calls: ProviderCallMetadata[] = [];

  constructor(replies: readonly InMemoryProviderReply[] = []) {
    this.#replies = [...replies];
  }

  enqueue(reply: InMemoryProviderReply): void {
    this.#replies.push(reply);
  }

  get calls(): readonly ProviderCallMetadata[] {
    return structuredClone(this.#calls);
  }

  invoke(input: ProviderInvocationInput): ProviderInvocationDispatch {
    this.#calls.push({
      invocationId: input.invocationId,
      alias: input.alias,
      stream: input.stream,
    });

    const reply = this.#replies.shift();
    if (reply === undefined) {
      return rejectedDispatch(new Error("No in-memory provider reply was enqueued."));
    }
    if ((reply.kind === "stream") !== input.stream) {
      return rejectedDispatch(
        new Error("The in-memory provider reply does not match the requested stream mode."),
      );
    }

    if (reply.kind === "complete") {
      return {
        started: Promise.resolve(),
        result: Promise.resolve({
          kind: "complete",
          response: structuredClone(reply.response),
          usage: structuredClone(reply.usage),
        }),
      };
    }

    return {
      started: Promise.resolve(),
      result: Promise.resolve({
        kind: "stream",
        chunks: toAsyncIterable(reply.chunks),
        usage: Promise.resolve(structuredClone(reply.usage)),
      }),
    };
  }
}

function rejectedDispatch(error: Error): ProviderInvocationDispatch {
  const result = Promise.reject<ProviderResult>(error);
  void result.catch(() => undefined);
  return { started: Promise.reject(error), result };
}

export interface InMemoryEntitlementAccount {
  availableCredits: number;
  resetAt?: string;
}

interface MutableEntitlementAccount extends InMemoryEntitlementAccount {
  spentCredits: number;
}

export interface InMemoryReservation {
  id: string;
  accountId: string;
  invocationId: string;
  reservedCredits: number;
  chargedCredits: number;
  status: "reserved" | "settled" | "released";
}

/** Test/development entitlement ledger with atomic in-process reservations. */
export class InMemoryLlmEntitlementAdapter implements LlmEntitlementAdapter {
  readonly #accounts = new Map<string, MutableEntitlementAccount>();
  readonly #reservations = new Map<string, InMemoryReservation>();
  #nextReservation = 1;

  constructor(accounts: Readonly<Record<string, InMemoryEntitlementAccount>> = {}) {
    for (const [accountId, account] of Object.entries(accounts)) {
      assertCredits(account.availableCredits, "availableCredits");
      this.#accounts.set(accountId, {
        ...structuredClone(account),
        spentCredits: 0,
      });
    }
  }

  async reserve(input: ReserveEntitlementInput): Promise<ReserveEntitlementResult> {
    assertCredits(input.credits, "credits");
    const account = this.#accounts.get(input.accountId);
    if (account === undefined || account.availableCredits < input.credits) {
      return account?.resetAt === undefined
        ? { granted: false }
        : { granted: false, resetAt: account.resetAt };
    }

    account.availableCredits -= input.credits;
    const reservation: InMemoryReservation = {
      id: `llmres_${this.#nextReservation++}`,
      accountId: input.accountId,
      invocationId: input.invocationId,
      reservedCredits: input.credits,
      chargedCredits: 0,
      status: "reserved",
    };
    this.#reservations.set(reservation.id, reservation);
    return {
      granted: true,
      reservationId: reservation.id,
      reservedCredits: reservation.reservedCredits,
    };
  }

  async settle(
    reservationId: string,
    actualCredits: number,
  ): Promise<SettleEntitlementResult> {
    assertCredits(actualCredits, "actualCredits");
    const reservation = this.#requiredReservation(reservationId);
    if (reservation.status !== "reserved") {
      throw new ApiError(500, "invalid_reservation_state", "The reservation is already closed.");
    }

    // The reservation is an upper bound. Provider overage is absorbed by the platform,
    // so a user can never be debited past the amount admitted by the hard quota check.
    const chargedCredits = Math.min(actualCredits, reservation.reservedCredits);
    const account = this.#requiredAccount(reservation.accountId);
    account.availableCredits += reservation.reservedCredits - chargedCredits;
    account.spentCredits += chargedCredits;
    reservation.chargedCredits = chargedCredits;
    reservation.status = "settled";
    return { chargedCredits };
  }

  async release(reservationId: string): Promise<void> {
    const reservation = this.#requiredReservation(reservationId);
    if (reservation.status !== "reserved") {
      return;
    }
    const account = this.#requiredAccount(reservation.accountId);
    account.availableCredits += reservation.reservedCredits;
    reservation.status = "released";
  }

  async getAccount(accountId: string): Promise<LlmEntitlementView | undefined> {
    const account = this.#accounts.get(accountId);
    if (account === undefined) {
      return undefined;
    }
    return {
      availableCredits: account.availableCredits,
      spentCredits: account.spentCredits,
      resetAt: account.resetAt ?? null,
    };
  }

  account(accountId: string):
    | (InMemoryEntitlementAccount & { spentCredits: number })
    | undefined {
    const account = this.#accounts.get(accountId);
    return account === undefined ? undefined : structuredClone(account);
  }

  get reservations(): readonly InMemoryReservation[] {
    return structuredClone([...this.#reservations.values()]);
  }

  #requiredReservation(id: string): InMemoryReservation {
    const reservation = this.#reservations.get(id);
    if (reservation === undefined) {
      throw new ApiError(500, "reservation_not_found", "The entitlement reservation was not found.");
    }
    return reservation;
  }

  #requiredAccount(accountId: string): MutableEntitlementAccount {
    const account = this.#accounts.get(accountId);
    if (account === undefined) {
      throw new ApiError(500, "entitlement_not_found", "The entitlement account was not found.");
    }
    return account;
  }
}

/** Test/development audit adapter. Its types make content persistence impossible. */
export class InMemoryLlmUsageAdapter implements LlmUsageAdapter {
  readonly #invocations = new Map<string, InvocationMetadata>();
  readonly #idempotency = new Map<string, string>();
  readonly #cancellations = new Set<string>();
  readonly #usage: UsageMetadata[] = [];

  async claimInvocation(metadata: InvocationMetadata): Promise<ClaimInvocationResult> {
    const key = `${metadata.ownerAccountId}\u0000${metadata.idempotencyFingerprint}`;
    const existingId = this.#idempotency.get(key);
    if (existingId !== undefined) {
      const existing = this.#invocations.get(existingId);
      if (existing === undefined) {
        throw new ApiError(500, "invalid_usage_state", "Invocation metadata is inconsistent.");
      }
      return { created: false, invocation: structuredClone(existing) };
    }

    const stored = {
      ...structuredClone(metadata),
      ...(this.#cancellations.has(key)
        ? { status: "failed" as const, errorCode: "client_cancelled" }
        : {}),
    };
    this.#invocations.set(metadata.id, stored);
    this.#idempotency.set(key, metadata.id);
    return { created: true, invocation: structuredClone(stored) };
  }

  async updateInvocation(id: string, update: InvocationMetadataUpdate): Promise<void> {
    const invocation = this.#invocations.get(id);
    if (invocation === undefined) {
      throw new ApiError(500, "invocation_not_found", "Invocation metadata was not found.");
    }
    const cancellationRequested = this.#cancellations.has(
      `${invocation.ownerAccountId}\u0000${invocation.idempotencyFingerprint}`,
    );
    this.#invocations.set(id, {
      ...invocation,
      ...structuredClone(update),
      ...((invocation.status === "cancel_requested" || cancellationRequested)
        && (
          update.status === "received"
          || update.status === "dispatching"
          || update.status === "running"
        )
        ? { status: invocation.status }
        : {}),
    });
  }

  async getInvocation(id: string): Promise<InvocationMetadata | undefined> {
    const invocation = this.#invocations.get(id);
    return invocation === undefined ? undefined : structuredClone(invocation);
  }

  async requestCancellation(input: {
    ownerAccountId: string;
    idempotencyFingerprint: string;
    requestedAt: string;
  }): Promise<{ invocation?: InvocationMetadata }> {
    const key = `${input.ownerAccountId}\u0000${input.idempotencyFingerprint}`;
    this.#cancellations.add(key);
    const id = this.#idempotency.get(key);
    if (id === undefined) return {};
    const invocation = this.#invocations.get(id);
    if (invocation === undefined) return {};
    if (invocation.status === "received") {
      invocation.status = "failed";
      invocation.errorCode = "client_cancelled";
    } else if (invocation.status === "running") {
      invocation.status = "cancel_requested";
      invocation.errorCode = "client_cancelled";
    }
    return { invocation: structuredClone(invocation) };
  }

  async isCancellationRequested(invocationId: string): Promise<boolean> {
    const invocation = this.#invocations.get(invocationId);
    return invocation !== undefined && this.#cancellations.has(
      `${invocation.ownerAccountId}\u0000${invocation.idempotencyFingerprint}`,
    );
  }

  async recordUsage(metadata: UsageMetadata): Promise<void> {
    this.#usage.push(structuredClone(metadata));
  }

  get invocations(): readonly InvocationMetadata[] {
    return structuredClone([...this.#invocations.values()]);
  }

  get usage(): readonly UsageMetadata[] {
    return structuredClone(this.#usage);
  }
}

interface InMemoryStreamBuffer {
  ownerAccountId: string;
  chunks: OpenAiObject[];
  completed: boolean;
  failure?: StreamBufferFailure;
  ttlMs: number;
  expiresAtMs: number;
  timer?: NodeJS.Timeout;
  waiters: Set<() => void>;
}

/** Memory-only stream replay adapter used by tests and single-process deployments. */
export class InMemoryVolatileStreamBufferAdapter implements VolatileStreamBufferAdapter {
  readonly #clock: Clock;
  readonly #buffers = new Map<string, InMemoryStreamBuffer>();

  constructor(clock: Clock = new SystemClock()) {
    this.#clock = clock;
  }

  async create(input: {
    invocationId: string;
    ownerAccountId: string;
    ttlMs: number;
  }): Promise<void> {
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1) {
      throw new ApiError(500, "invalid_stream_ttl", "Stream buffer TTL must be positive.");
    }
    await this.delete(input.invocationId);
    const buffer: InMemoryStreamBuffer = {
      ownerAccountId: input.ownerAccountId,
      chunks: [],
      completed: false,
      ttlMs: input.ttlMs,
      expiresAtMs: this.#clock.now().getTime() + input.ttlMs,
      waiters: new Set(),
    };
    this.#buffers.set(input.invocationId, buffer);
    this.#touch(input.invocationId, buffer);
  }

  async append(invocationId: string, chunk: OpenAiObject): Promise<void> {
    const buffer = this.#required(invocationId);
    if (buffer.completed) {
      throw new ApiError(500, "stream_already_closed", "The stream buffer is already closed.");
    }
    buffer.chunks.push(structuredClone(chunk));
    this.#touch(invocationId, buffer);
    this.#signal(buffer);
  }

  async complete(invocationId: string): Promise<void> {
    const buffer = this.#required(invocationId);
    buffer.completed = true;
    this.#touch(invocationId, buffer);
    this.#signal(buffer);
  }

  async fail(invocationId: string, failure: StreamBufferFailure): Promise<void> {
    const buffer = this.#required(invocationId);
    buffer.failure = structuredClone(failure);
    buffer.completed = true;
    this.#touch(invocationId, buffer);
    this.#signal(buffer);
  }

  async read(input: {
    invocationId: string;
    ownerAccountId: string;
    afterSequence: number;
  }): Promise<AsyncIterable<OpenAiObject>> {
    const buffer = this.#required(input.invocationId);
    if (buffer.ownerAccountId !== input.ownerAccountId) {
      throw new ApiError(403, "invocation_forbidden", "The invocation belongs to another account.");
    }
    const adapter = this;
    return {
      [Symbol.asyncIterator]() {
        return adapter.#iterate(input.invocationId, input.afterSequence);
      },
    };
  }

  async delete(invocationId: string): Promise<void> {
    const buffer = this.#buffers.get(invocationId);
    if (buffer === undefined) return;
    if (buffer.timer !== undefined) clearTimeout(buffer.timer);
    buffer.chunks.length = 0;
    this.#buffers.delete(invocationId);
    this.#signal(buffer);
  }

  async *#iterate(invocationId: string, afterSequence: number): AsyncGenerator<OpenAiObject> {
    let index = afterSequence;
    while (true) {
      const buffer = this.#required(invocationId);
      while (index < buffer.chunks.length) {
        const chunk = buffer.chunks[index];
        index += 1;
        if (chunk !== undefined) yield structuredClone(chunk);
      }
      if (buffer.failure !== undefined) {
        throw new ApiError(
          buffer.failure.status,
          buffer.failure.code,
          buffer.failure.message,
        );
      }
      if (buffer.completed) return;
      await new Promise<void>((resolve) => buffer.waiters.add(resolve));
    }
  }

  #required(invocationId: string): InMemoryStreamBuffer {
    const buffer = this.#buffers.get(invocationId);
    if (buffer === undefined || this.#clock.now().getTime() >= buffer.expiresAtMs) {
      if (buffer !== undefined) void this.delete(invocationId);
      throw new ApiError(410, "stream_expired", "The volatile event buffer has expired.");
    }
    return buffer;
  }

  #touch(invocationId: string, buffer: InMemoryStreamBuffer): void {
    if (buffer.timer !== undefined) clearTimeout(buffer.timer);
    buffer.expiresAtMs = this.#clock.now().getTime() + buffer.ttlMs;
    buffer.timer = setTimeout(() => {
      void this.delete(invocationId);
    }, buffer.ttlMs);
    buffer.timer.unref();
  }

  #signal(buffer: InMemoryStreamBuffer): void {
    for (const waiter of buffer.waiters) waiter();
    buffer.waiters.clear();
  }
}

function assertCredits(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(500, "invalid_credit_amount", `${name} must be a non-negative integer.`);
  }
}

function toAsyncIterable(
  chunks: readonly OpenAiObject[] | AsyncIterable<OpenAiObject>,
): AsyncIterable<OpenAiObject> {
  if (Symbol.asyncIterator in chunks) {
    return chunks;
  }
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield structuredClone(chunk);
      }
    },
  };
}
