import { createHmac } from "node:crypto";

import { ApiError, conflict, forbidden, notFound, unauthorized } from "../../kernel/api-error.js";
import type { Clock } from "../../kernel/clock.js";
import { SystemClock } from "../../kernel/clock.js";
import { randomId, type IdFactory } from "../../kernel/ids.js";
import { hasScope, type Principal } from "../../kernel/principal.js";
import {
  PRODUCT_ALIASES,
  PUBLIC_MODEL_NAME,
  isProductAlias,
  type CancelLlmInput,
  type CancelLlmResult,
  type InvokeLlmInput,
  type LlmEntitlementView,
  type LlmGatewayModule,
  type LlmResult,
  type OpenAiChatCompletionRequest,
  type OpenAiObject,
  type ProductAlias,
  type ResumeLlmInput,
} from "./model.js";
import {
  ProviderInvocationCancelledError,
  type InvocationMetadata,
  type LlmAccountStatusSource,
  type LlmInvocationLifecycleAdapter,
  type LlmEntitlementAdapter,
  type LlmProviderAdapter,
  type LlmUsageAdapter,
  type ProviderStreamResult,
  type ProviderUsage,
  type ReserveEntitlementResult,
  type VolatileStreamBufferAdapter,
} from "./ports.js";
import { InMemoryVolatileStreamBufferAdapter } from "./in-memory-adapters.js";

const LLM_SCOPE = "llm:invoke";
const DEFAULT_EVENT_TTL_MS = 5 * 60 * 1_000;

export const DEFAULT_RESERVATION_CREDITS: Readonly<Record<ProductAlias, number>> = {
  "maxpower/coach-v1": 100,
  "maxpower/nutrition-vision-v1": 500,
};

export interface LlmAliasRequestPolicy {
  /** Maximum UTF-8 bytes accepted by the gateway before provider invocation. */
  maxInputBytes: number;
  /** Provider context ceiling used to calculate the worst-case reservation. */
  maxInputTokens: number;
  /** Server-enforced upper bound for generated tokens. */
  maxOutputTokens: number;
  maxImages: number;
  /** Maximum decoded bytes for each inline data URL image. */
  maxImageBytes: number;
  /** Worst-case user charge admitted atomically before provider invocation. */
  reservationCredits: number;
}

export const DEFAULT_LLM_REQUEST_POLICIES: Readonly<
  Record<ProductAlias, LlmAliasRequestPolicy>
> = {
  "maxpower/coach-v1": {
    maxInputBytes: 64 * 1_024,
    maxInputTokens: 128 * 1_024,
    maxOutputTokens: 4_096,
    maxImages: 4,
    maxImageBytes: 5 * 1_024 * 1_024,
    reservationCredits: DEFAULT_RESERVATION_CREDITS["maxpower/coach-v1"],
  },
  "maxpower/nutrition-vision-v1": {
    maxInputBytes: 6 * 1_024 * 1_024,
    maxInputTokens: 8 * 1_024 * 1_024,
    maxOutputTokens: 2_048,
    maxImages: 4,
    maxImageBytes: 5 * 1_024 * 1_024,
    reservationCredits: DEFAULT_RESERVATION_CREDITS["maxpower/nutrition-vision-v1"],
  },
};

export interface LlmGatewayDependencies {
  provider: LlmProviderAdapter;
  entitlements: LlmEntitlementAdapter;
  usage: LlmUsageAdapter;
  /** Secret used only for non-reversible idempotency/request fingerprints. */
  fingerprintSecret: string;
  clock?: Clock;
  ids?: IdFactory;
  requestPolicies?: Readonly<Record<ProductAlias, LlmAliasRequestPolicy>>;
  eventTtlMs?: number;
  streamBuffers?: VolatileStreamBufferAdapter;
  /** Required by production to atomically close durable reservations and audits. */
  lifecycle?: LlmInvocationLifecycleAdapter;
  /** Live account policy used to abort work started on another API node. */
  accountStatus?: LlmAccountStatusSource;
  accountStatusPollMs?: number;
}

interface LocalInvocation {
  cacheKey: string;
  invocationId: string;
  ownerAccountId: string;
  requestFingerprint: string;
  stream: boolean;
  result: Promise<LlmResult>;
  expiresAtMs?: number;
  cleanupTimer?: NodeJS.Timeout;
  abortController?: AbortController;
  accountStatusTimer?: NodeJS.Timeout;
  abortReason?: "account_unavailable" | "account_status_unavailable" | "client_cancelled";
}

interface AcceptedRequest {
  alias: ProductAlias;
  stream: boolean;
  request: OpenAiChatCompletionRequest;
}

interface SettledUsage {
  chargedCredits: number;
  policyExceeded: boolean;
  terminalStatus: "completed" | "failed";
  terminalErrorCode?: string;
}

/**
 * Deep module for authenticated LLM invocation. Callers only invoke or resume;
 * provider routing, quota, idempotency, metadata auditing and volatile content
 * buffering remain implementation details.
 */
export class LlmGateway implements LlmGatewayModule {
  readonly #provider: LlmProviderAdapter;
  readonly #entitlements: LlmEntitlementAdapter;
  readonly #usage: LlmUsageAdapter;
  readonly #fingerprintSecret: string;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #requestPolicies: Readonly<Record<ProductAlias, LlmAliasRequestPolicy>>;
  readonly #eventTtlMs: number;
  readonly #streamBuffers: VolatileStreamBufferAdapter;
  readonly #lifecycle: LlmInvocationLifecycleAdapter | undefined;
  readonly #accountStatus: LlmAccountStatusSource | undefined;
  readonly #accountStatusPollMs: number;
  readonly #byIdempotency = new Map<string, LocalInvocation>();
  readonly #byInvocation = new Map<string, LocalInvocation>();
  readonly #activeByAccount = new Map<string, Set<LocalInvocation>>();

  constructor(dependencies: LlmGatewayDependencies) {
    if (dependencies.fingerprintSecret.length < 16) {
      throw new Error("fingerprintSecret must contain at least 16 characters.");
    }
    if (
      dependencies.eventTtlMs !== undefined &&
      (!Number.isSafeInteger(dependencies.eventTtlMs) || dependencies.eventTtlMs < 1)
    ) {
      throw new Error("eventTtlMs must be a positive integer.");
    }

    this.#provider = dependencies.provider;
    this.#entitlements = dependencies.entitlements;
    this.#usage = dependencies.usage;
    this.#fingerprintSecret = dependencies.fingerprintSecret;
    this.#clock = dependencies.clock ?? new SystemClock();
    this.#ids = dependencies.ids ?? randomId;
    this.#requestPolicies = dependencies.requestPolicies ?? DEFAULT_LLM_REQUEST_POLICIES;
    this.#eventTtlMs = dependencies.eventTtlMs ?? DEFAULT_EVENT_TTL_MS;
    this.#streamBuffers =
      dependencies.streamBuffers ?? new InMemoryVolatileStreamBufferAdapter(this.#clock);
    this.#lifecycle = dependencies.lifecycle;
    this.#accountStatus = dependencies.accountStatus;
    this.#accountStatusPollMs = dependencies.accountStatusPollMs ?? 1_000;
    if (!Number.isSafeInteger(this.#accountStatusPollMs) || this.#accountStatusPollMs < 1) {
      throw new Error("accountStatusPollMs must be a positive integer.");
    }

    for (const alias of PRODUCT_ALIASES) {
      validateRequestPolicy(alias, this.#requestPolicies[alias]);
    }
  }

  async invoke(principal: Principal | undefined, input: InvokeLlmInput): Promise<LlmResult> {
    const owner = requireInvoker(principal);
    const accepted = acceptRequest(input.request, this.#requestPolicies);
    const idempotencyKey = acceptIdempotencyKey(input.idempotencyKey);
    const cacheKey = `${owner.accountId}\u0000${idempotencyKey}`;
    const requestFingerprint = this.#fingerprint(canonicalJson(accepted.request));

    const cached = this.#liveEntry(cacheKey);
    if (cached !== undefined) {
      if (cached.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict();
      }
      return cached.result;
    }

    const invocationId = this.#ids("llmi");
    const local = {} as LocalInvocation;
    local.cacheKey = cacheKey;
    local.invocationId = invocationId;
    local.ownerAccountId = owner.accountId;
    local.requestFingerprint = requestFingerprint;
    local.stream = accepted.stream;
    local.result = this.#startInvocation(
      local,
      owner,
      idempotencyKey,
      accepted,
      requestFingerprint,
    );
    this.#byIdempotency.set(cacheKey, local);

    try {
      const result = await local.result;
      if (result.kind === "complete") {
        this.#scheduleExpiry(local);
      }
      return result;
    } catch (error) {
      this.#scheduleExpiry(local);
      throw error;
    }
  }

  async resume(
    principal: Principal | undefined,
    input: ResumeLlmInput,
  ): Promise<AsyncIterable<OpenAiObject>> {
    const owner = requireInvoker(principal);
    const afterSequence = input.afterSequence ?? 0;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new ApiError(400, "invalid_event_sequence", "afterSequence must be zero or greater.");
    }

    const local = this.#byInvocation.get(input.invocationId);
    if (local !== undefined && !this.#isExpired(local)) {
      if (local.ownerAccountId !== owner.accountId) {
        throw forbidden("invocation_forbidden", "The invocation belongs to another account.");
      }
      if (!local.stream) {
        throw new ApiError(400, "invocation_not_streaming", "The invocation is not streaming.");
      }
      return this.#streamBuffers.read({
        invocationId: input.invocationId,
        ownerAccountId: owner.accountId,
        afterSequence,
      });
    }

    if (local !== undefined) {
      this.#expire(local);
    }
    const metadata = await this.#usage.getInvocation(input.invocationId);
    if (metadata === undefined) {
      throw notFound("LLM invocation");
    }
    if (metadata.ownerAccountId !== owner.accountId) {
      throw forbidden("invocation_forbidden", "The invocation belongs to another account.");
    }
    if (!metadata.stream) {
      throw new ApiError(400, "invocation_not_streaming", "The invocation is not streaming.");
    }
    return this.#streamBuffers.read({
      invocationId: input.invocationId,
      ownerAccountId: owner.accountId,
      afterSequence,
    });
  }

  async getEntitlement(principal: Principal | undefined): Promise<LlmEntitlementView> {
    const owner = requireInvoker(principal);
    return (
      (await this.#entitlements.getAccount(owner.accountId)) ?? {
        availableCredits: 0,
        spentCredits: 0,
        resetAt: null,
      }
    );
  }

  async cancel(
    principal: Principal | undefined,
    input: CancelLlmInput,
  ): Promise<CancelLlmResult> {
    const owner = requireInvoker(principal);
    const idempotencyKey = acceptIdempotencyKey(input.idempotencyKey);
    const cancellation = await this.#usage.requestCancellation({
      ownerAccountId: owner.accountId,
      idempotencyFingerprint: this.#fingerprint(idempotencyKey),
      requestedAt: this.#now(),
    });
    const invocation = cancellation.invocation;
    if (invocation === undefined) return { status: "cancel_requested" };
    if (
      invocation.status !== "received"
      && invocation.status !== "dispatching"
      && invocation.status !== "running"
      && invocation.status !== "cancel_requested"
    ) {
      return { status: "already_terminal", invocationId: invocation.id };
    }

    const local = this.#byInvocation.get(invocation.id)
      ?? this.#byIdempotency.get(`${owner.accountId}\u0000${idempotencyKey}`);
    if (local !== undefined && local.invocationId === invocation.id) {
      local.abortReason = "client_cancelled";
      local.abortController?.abort();
    }
    return { status: "cancel_requested", invocationId: invocation.id };
  }

  cancelAccount(accountId: string): number {
    const active = this.#activeByAccount.get(accountId);
    if (active === undefined) return 0;
    for (const invocation of active) {
      invocation.abortReason = "account_unavailable";
      invocation.abortController?.abort();
    }
    return active.size;
  }

  async #startInvocation(
    local: LocalInvocation,
    owner: Principal,
    idempotencyKey: string,
    accepted: AcceptedRequest,
    requestFingerprint: string,
  ): Promise<LlmResult> {
    const now = this.#now();
    const metadata: InvocationMetadata = {
      id: local.invocationId,
      ownerAccountId: owner.accountId,
      alias: accepted.alias,
      stream: accepted.stream,
      idempotencyFingerprint: this.#fingerprint(idempotencyKey),
      requestFingerprint,
      status: "received",
      reservedCredits: 0,
      settledCredits: 0,
      createdAt: now,
      updatedAt: now,
    };
    const claim = await this.#usage.claimInvocation(metadata);
    if (!claim.created) {
      if (claim.invocation.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict();
      }
      if (accepted.stream && claim.invocation.stream) {
        local.invocationId = claim.invocation.id;
        local.ownerAccountId = claim.invocation.ownerAccountId;
        local.stream = true;
        let chunks: AsyncIterable<OpenAiObject>;
        try {
          chunks = await this.#streamBuffers.read({
            invocationId: claim.invocation.id,
            ownerAccountId: owner.accountId,
            afterSequence: 0,
          });
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw conflict(
            "idempotency_replay_unavailable",
            "The invocation already exists but its volatile response is no longer available.",
          );
        }
        this.#byInvocation.set(claim.invocation.id, local);
        this.#scheduleExpiry(local);
        return {
          kind: "stream",
          invocationId: claim.invocation.id,
          chunks,
        };
      }
      throw conflict(
        "idempotency_replay_unavailable",
        "The invocation already exists but its volatile response is no longer available.",
      );
    }
    if (
      claim.invocation.status === "failed"
      && claim.invocation.errorCode === "client_cancelled"
    ) {
      local.abortReason = "client_cancelled";
      throw this.#invocationFailure(local, new Error("cancelled before reservation"));
    }
    if (claim.invocation.status === "cancel_requested") {
      local.abortReason = "client_cancelled";
      await this.#usage.updateInvocation(local.invocationId, {
        status: "failed",
        updatedAt: this.#now(),
        errorCode: "client_cancelled",
      });
      throw this.#invocationFailure(local, new Error("cancelled before reservation"));
    }

    const requestedReservation = this.#requestPolicies[accepted.alias].reservationCredits;
    const reservation = await this.#entitlements.reserve({
      accountId: owner.accountId,
      invocationId: local.invocationId,
      credits: requestedReservation,
    });
    if (!reservation.granted) {
      if (await this.#cancellationWonBeforeProvider(local)) {
        throw this.#invocationFailure(local, new Error("cancelled before reservation"));
      }
      await this.#usage.updateInvocation(local.invocationId, {
        status: "rejected",
        updatedAt: this.#now(),
        errorCode: "quota_exceeded",
      });
      if (await this.#cancellationWonBeforeProvider(local)) {
        throw this.#invocationFailure(local, new Error("cancelled before reservation"));
      }
      throw quotaExceeded(reservation);
    }

    const controller = await this.#activateInvocation(local);
    let streamHandedOff = false;
    let reservationClosed = false;
    try {
      if (controller.signal.aborted) {
        throw this.#invocationFailure(local, new Error("invocation blocked before provider"));
      }
      await this.#usage.updateInvocation(local.invocationId, {
        status: "dispatching",
        reservedCredits: reservation.reservedCredits,
        updatedAt: this.#now(),
      });
      await this.#refreshAbortReason(local);
      if (local.abortReason !== undefined) {
        controller.abort();
        throw this.#invocationFailure(local, new Error("invocation blocked during dispatch"));
      }
      const providerDispatch = this.#provider.invoke({
        invocationId: local.invocationId,
        alias: accepted.alias,
        stream: accepted.stream,
        request: accepted.request,
        signal: controller.signal,
      });
      void providerDispatch.result.catch(() => undefined);
      await providerDispatch.started;
      // The Adapter has acknowledged the external side effect. Only now may
      // durable recovery classify this invocation as Provider-started.
      try {
        await this.#usage.updateInvocation(local.invocationId, {
          status: "running",
          reservedCredits: reservation.reservedCredits,
          updatedAt: this.#now(),
        });
      } catch (error) {
        controller.abort();
        throw error;
      }
      const providerResult = await providerDispatch.result;

      if (accepted.stream) {
        if (providerResult.kind !== "stream") {
          throw new Error("Provider returned a non-stream response for a stream request.");
        }
        await this.#streamBuffers.create({
          invocationId: local.invocationId,
          ownerAccountId: owner.accountId,
          ttlMs: this.#eventTtlMs,
        });
        this.#byInvocation.set(local.invocationId, local);
        streamHandedOff = true;
        void this.#pumpStream(
          local,
          accepted.alias,
          providerResult,
          reservation.reservationId,
          reservation.reservedCredits,
        );
        reservationClosed = true;
        return {
          kind: "stream",
          invocationId: local.invocationId,
          chunks: await this.#streamBuffers.read({
            invocationId: local.invocationId,
            ownerAccountId: owner.accountId,
            afterSequence: 0,
          }),
        };
      }

      if (providerResult.kind !== "complete") {
        throw new Error("Provider returned a stream response for a non-stream request.");
      }
      await this.#refreshAbortReason(local);
      if (local.abortReason !== undefined) {
        throw new ProviderInvocationCancelledError(providerResult.usage);
      }
      const settlement = await this.#settleSuccess(
        local.invocationId,
        owner.accountId,
        accepted.alias,
        providerResult.usage,
        reservation.reservationId,
        reservation.reservedCredits,
      );
      reservationClosed = true;
      if (settlement.terminalErrorCode === "client_cancelled") {
        local.abortReason = "client_cancelled";
        throw this.#invocationFailure(local, new Error("cancelled during settlement"));
      }
      if (settlement.policyExceeded) throw providerUsageExceededLimits();
      if (this.#lifecycle === undefined) {
        await this.#usage.updateInvocation(local.invocationId, {
          status: "completed",
          settledCredits: settlement.chargedCredits,
          updatedAt: this.#now(),
        });
      }
      return {
        kind: "complete",
        invocationId: local.invocationId,
        response: publicChunk(providerResult.response, local.invocationId),
      };
    } catch (error) {
      let failure = this.#invocationFailure(local, error);
      let cancellationUsageSettled = false;
      if (!reservationClosed && error instanceof ProviderInvocationCancelledError) {
        try {
          const settlement = await this.#settleSuccess(
            local.invocationId,
            owner.accountId,
            accepted.alias,
            error.usage,
            reservation.reservationId,
            reservation.reservedCredits,
            { status: "failed", errorCode: `${failure.code}_usage_estimated` },
          );
          reservationClosed = true;
          cancellationUsageSettled = true;
          if (this.#lifecycle === undefined) {
            await this.#usage.updateInvocation(local.invocationId, {
              status: "failed",
              settledCredits: settlement.chargedCredits,
              reservedCredits: reservation.reservedCredits,
              updatedAt: this.#now(),
              errorCode: `${failure.code}_usage_estimated`,
            });
          }
        } catch {
          // Fall through to the durable release path when estimated settlement fails.
        }
      }
      if (!reservationClosed) {
        failure = await this.#failInvocation(
          local.invocationId,
          reservation.reservationId,
          failure,
        );
      }
      if (this.#lifecycle === undefined && !cancellationUsageSettled) {
        await this.#usage.updateInvocation(local.invocationId, {
          status: "failed",
          updatedAt: this.#now(),
          errorCode: failure.code,
        });
      }
      throw failure;
    } finally {
      if (!streamHandedOff) this.#releaseInvocation(local);
    }
  }

  async #pumpStream(
    local: LocalInvocation,
    alias: ProductAlias,
    providerResult: ProviderStreamResult,
    reservationId: string,
    reservedCredits: number,
  ): Promise<void> {
    let reservationClosed = false;
    try {
      for await (const chunk of providerResult.chunks) {
        await this.#streamBuffers.append(
          local.invocationId,
          publicChunk(chunk, local.invocationId),
        );
      }
      const usage = await providerResult.usage;
      await this.#refreshAbortReason(local);
      if (local.abortReason !== undefined) {
        throw new ProviderInvocationCancelledError(usage);
      }
      const settlement = await this.#settleSuccess(
        local.invocationId,
        local.ownerAccountId,
        alias,
        usage,
        reservationId,
        reservedCredits,
      );
      reservationClosed = true;
      if (settlement.terminalErrorCode === "client_cancelled") {
        local.abortReason = "client_cancelled";
        throw this.#invocationFailure(local, new Error("cancelled during settlement"));
      }
      if (settlement.policyExceeded) throw providerUsageExceededLimits();
      if (this.#lifecycle === undefined) {
        await this.#usage.updateInvocation(local.invocationId, {
          status: "completed",
          settledCredits: settlement.chargedCredits,
          reservedCredits,
          updatedAt: this.#now(),
        });
      }
      await this.#streamBuffers.complete(local.invocationId);
    } catch (error) {
      let failure = this.#invocationFailure(local, error);
      if (
        !reservationClosed
        && local.abortReason !== undefined
        && providerResult.estimateCancelledUsage !== undefined
      ) {
        try {
          const settlement = await this.#settleSuccess(
            local.invocationId,
            local.ownerAccountId,
            alias,
            providerResult.estimateCancelledUsage(),
            reservationId,
            reservedCredits,
            { status: "failed", errorCode: `${failure.code}_usage_estimated` },
          );
          reservationClosed = true;
          if (this.#lifecycle === undefined) {
            await this.#usage.updateInvocation(local.invocationId, {
              status: "failed",
              settledCredits: settlement.chargedCredits,
              reservedCredits,
              updatedAt: this.#now(),
              errorCode: `${failure.code}_usage_estimated`,
            });
          }
        } catch {
          // Fall through to the durable failure/release path if estimation or
          // settlement itself cannot be validated.
        }
      }
      if (!reservationClosed) {
        failure = await this.#failInvocation(
          local.invocationId,
          reservationId,
          failure,
        );
      }
      if (this.#lifecycle === undefined && !reservationClosed) {
        await this.#usage.updateInvocation(local.invocationId, {
          status: "failed",
          updatedAt: this.#now(),
          errorCode: failure.code,
        });
      }
      try {
        await this.#streamBuffers.fail(local.invocationId, {
          status: failure.status,
          code: failure.code,
          message: failure.message,
        });
      } catch {
        // The content-free audit already records failure; a missing volatile
        // buffer must not resurrect or persist provider output elsewhere.
      }
    } finally {
      this.#releaseInvocation(local);
      this.#scheduleExpiry(local);
    }
  }

  async #activateInvocation(local: LocalInvocation): Promise<AbortController> {
    const controller = new AbortController();
    local.abortController = controller;
    const active = this.#activeByAccount.get(local.ownerAccountId) ?? new Set<LocalInvocation>();
    active.add(local);
    this.#activeByAccount.set(local.ownerAccountId, active);
    let checking = false;
    const check = async (): Promise<void> => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      try {
        await this.#refreshAbortReason(local);
        if (local.abortReason !== undefined) controller.abort();
      } catch {
        local.abortReason = "account_status_unavailable";
        controller.abort();
      } finally {
        checking = false;
      }
    };
    local.accountStatusTimer = setInterval(() => void check(), this.#accountStatusPollMs);
    local.accountStatusTimer.unref();
    await check();
    return controller;
  }

  async #cancellationWonBeforeProvider(local: LocalInvocation): Promise<boolean> {
    const invocation = await this.#usage.getInvocation(local.invocationId);
    const cancelled = invocation?.errorCode === "client_cancelled"
      || invocation?.status === "cancel_requested"
      || (
        invocation !== undefined
        && ["received", "dispatching", "running"].includes(invocation.status)
        && await this.#usage.isCancellationRequested(local.invocationId)
      );
    if (cancelled) local.abortReason = "client_cancelled";
    return cancelled;
  }

  async #refreshAbortReason(local: LocalInvocation): Promise<void> {
    if (local.abortReason !== undefined) return;
    if (
      this.#accountStatus !== undefined
      && !(await this.#accountStatus.isActive(local.ownerAccountId))
    ) {
      local.abortReason = "account_unavailable";
      return;
    }
    if (await this.#usage.isCancellationRequested(local.invocationId)) {
      local.abortReason = "client_cancelled";
    }
  }

  #releaseInvocation(local: LocalInvocation): void {
    if (local.accountStatusTimer !== undefined) clearInterval(local.accountStatusTimer);
    delete local.accountStatusTimer;
    delete local.abortController;
    const active = this.#activeByAccount.get(local.ownerAccountId);
    active?.delete(local);
    if (active?.size === 0) this.#activeByAccount.delete(local.ownerAccountId);
  }

  #invocationFailure(local: LocalInvocation, error: unknown): ApiError {
    if (local.abortReason === "account_unavailable") {
      return forbidden("account_unavailable", "The account can no longer use the LLM service.");
    }
    if (local.abortReason === "client_cancelled") {
      return new ApiError(499, "client_cancelled", "The client cancelled the LLM invocation.");
    }
    return publicProviderFailure(error);
  }

  async #settleSuccess(
    invocationId: string,
    ownerAccountId: string,
    alias: ProductAlias,
    usage: ProviderUsage,
    reservationId: string,
    reservedCredits: number,
    terminal?: { status: "failed"; errorCode: string },
  ): Promise<SettledUsage> {
    assertUsage(usage);
    const policy = this.#requestPolicies[alias];
    const policyExceeded =
      usage.inputTokens > policy.maxInputTokens ||
      usage.outputTokens > policy.maxOutputTokens ||
      usage.credits > reservedCredits;
    const recordedAt = this.#now();
    const usageMetadata = {
      invocationId,
      ownerAccountId,
      alias,
      usageBasis: usage.usageBasis ?? "provider_reported",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      imageTokens: usage.imageTokens ?? 0,
      providerCredits: usage.credits,
      providerCostMicros: usage.providerCostMicros ?? 0,
      chargedCredits: policyExceeded ? reservedCredits : usage.credits,
      recordedAt,
    };
    const settlement = this.#lifecycle === undefined
      ? {
          ...(await this.#entitlements.settle(reservationId, usageMetadata.chargedCredits)),
          terminalStatus: terminal?.status ?? (policyExceeded ? "failed" : "completed") as "completed" | "failed",
          ...(terminal !== undefined
            ? { errorCode: terminal.errorCode }
            : policyExceeded
              ? { errorCode: "provider_usage_exceeded_limits" }
              : {}),
        }
      : await this.#lifecycle.finalizeSuccess({
          ...usageMetadata,
          reservationId,
          terminalStatus: terminal?.status ?? (policyExceeded ? "failed" : "completed"),
          ...(terminal !== undefined
            ? { errorCode: terminal.errorCode }
            : policyExceeded
              ? { errorCode: "provider_usage_exceeded_limits" }
              : {}),
        });
    if (this.#lifecycle === undefined) {
      await this.#usage.recordUsage({
        ...usageMetadata,
        chargedCredits: settlement.chargedCredits,
      });
    }
    return {
      chargedCredits: settlement.chargedCredits,
      policyExceeded,
      terminalStatus: settlement.terminalStatus,
      ...(settlement.errorCode === undefined ? {} : { terminalErrorCode: settlement.errorCode }),
    };
  }

  async #failInvocation(
    invocationId: string,
    reservationId: string,
    failure: ApiError,
  ): Promise<ApiError> {
    if (this.#lifecycle !== undefined) {
      const terminal = await this.#lifecycle.fail({
        invocationId,
        reservationId,
        failedAt: this.#now(),
        errorCode: failure.code,
      });
      if (terminal.errorCode === "client_cancelled") {
        return new ApiError(499, "client_cancelled", "The client cancelled the LLM invocation.");
      }
      return failure;
    }
    await this.#entitlements.release(reservationId);
    return failure;
  }

  #fingerprint(value: string): string {
    return createHmac("sha256", this.#fingerprintSecret).update(value).digest("hex");
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }

  #liveEntry(cacheKey: string): LocalInvocation | undefined {
    const local = this.#byIdempotency.get(cacheKey);
    if (local === undefined) {
      return undefined;
    }
    if (this.#isExpired(local)) {
      this.#expire(local);
      return undefined;
    }
    return local;
  }

  #isExpired(local: LocalInvocation): boolean {
    return local.expiresAtMs !== undefined && this.#clock.now().getTime() >= local.expiresAtMs;
  }

  #scheduleExpiry(local: LocalInvocation): void {
    if (local.cleanupTimer !== undefined) {
      return;
    }
    local.expiresAtMs = this.#clock.now().getTime() + this.#eventTtlMs;
    local.cleanupTimer = setTimeout(() => {
      this.#expire(local);
    }, this.#eventTtlMs);
    local.cleanupTimer.unref();
  }

  #expire(local: LocalInvocation): void {
    if (local.cleanupTimer !== undefined) {
      clearTimeout(local.cleanupTimer);
    }
    void this.#streamBuffers.delete(local.invocationId);
    if (this.#byIdempotency.get(local.cacheKey) === local) {
      this.#byIdempotency.delete(local.cacheKey);
    }
    if (this.#byInvocation.get(local.invocationId) === local) {
      this.#byInvocation.delete(local.invocationId);
    }
  }
}

function requireInvoker(principal: Principal | undefined): Principal {
  if (principal === undefined) {
    throw unauthorized();
  }
  if (principal.status !== "active") {
    throw forbidden("account_unavailable", "The account is not active.");
  }
  if (!hasScope(principal, LLM_SCOPE)) {
    throw forbidden("missing_scope", "The access token cannot invoke the LLM gateway.");
  }
  return principal;
}

function acceptRequest(
  request: OpenAiChatCompletionRequest,
  policies: Readonly<Record<ProductAlias, LlmAliasRequestPolicy>>,
): AcceptedRequest {
  if (!isPlainObject(request)) {
    throw new ApiError(400, "invalid_request", "The request must be a JSON object.");
  }
  if (typeof request.model !== "string" || !isProductAlias(request.model)) {
    throw new ApiError(400, "unsupported_model_alias", "The product model alias is not supported.");
  }
  if (!Array.isArray(request.messages)) {
    throw new ApiError(400, "invalid_request", "messages must be an array.");
  }
  if (request.tools !== undefined && !Array.isArray(request.tools)) {
    throw new ApiError(400, "invalid_request", "tools must be an array when provided.");
  }
  if (request.stream !== undefined && typeof request.stream !== "boolean") {
    throw new ApiError(400, "invalid_request", "stream must be a boolean when provided.");
  }
  assertAllowedRequestFields(request);
  if (request.parallel_tool_calls !== undefined && request.parallel_tool_calls !== false) {
    throw new ApiError(400, "invalid_request", "parallel_tool_calls must be false.");
  }
  if (
    request.temperature !== undefined &&
    (typeof request.temperature !== "number" ||
      !Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 2)
  ) {
    throw new ApiError(400, "invalid_request", "temperature must be between 0 and 2.");
  }
  if (
    request.response_format !== undefined &&
    (!isPlainObject(request.response_format) ||
      Object.keys(request.response_format).length !== 1 ||
      request.response_format.type !== "json_object")
  ) {
    throw new ApiError(400, "invalid_request", "Only JSON object response format is supported.");
  }
  const policy = policies[request.model];
  const requestedOutputTokens = outputTokenLimit(request, policy.maxOutputTokens);
  if (requestedOutputTokens > policy.maxOutputTokens) {
    throw new ApiError(
      400,
      "request_limit_exceeded",
      "The requested output token limit exceeds the product limit.",
    );
  }
  const normalizedRequest: OpenAiChatCompletionRequest = {
    model: request.model,
    messages: request.messages,
    ...(request.stream === undefined ? {} : { stream: request.stream }),
    ...(request.tools === undefined ? {} : { tools: request.tools }),
    ...(request.parallel_tool_calls === undefined
      ? {}
      : { parallel_tool_calls: request.parallel_tool_calls }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.response_format === undefined
      ? {}
      : { response_format: request.response_format }),
    max_tokens: requestedOutputTokens,
  };
  const inputBytes = new TextEncoder().encode(canonicalJson(normalizedRequest)).byteLength;
  if (inputBytes > policy.maxInputBytes) {
    throw new ApiError(
      413,
      "llm_request_too_large",
      "The LLM request exceeds the product input limit.",
    );
  }
  assertImageLimits(request.messages, policy);
  return {
    alias: request.model,
    stream: request.stream ?? false,
    request: normalizedRequest,
  };
}

const ALLOWED_REQUEST_FIELDS = new Set([
  "model",
  "messages",
  "stream",
  "tools",
  "max_tokens",
  "max_completion_tokens",
  "parallel_tool_calls",
  "temperature",
  "response_format",
]);

function assertAllowedRequestFields(request: OpenAiChatCompletionRequest): void {
  const unsupported = Object.keys(request).filter((key) => !ALLOWED_REQUEST_FIELDS.has(key));
  if (unsupported.length > 0) {
    throw new ApiError(
      400,
      "unsupported_request_field",
      `Unsupported LLM request field: ${unsupported.sort()[0]}.`,
    );
  }
}

function outputTokenLimit(
  request: OpenAiChatCompletionRequest,
  defaultValue: number,
): number {
  const legacy = optionalPositiveInteger(request.max_tokens, "max_tokens");
  const completion = optionalPositiveInteger(
    request.max_completion_tokens,
    "max_completion_tokens",
  );
  if (legacy !== undefined && completion !== undefined && legacy !== completion) {
    throw new ApiError(
      400,
      "invalid_request",
      "max_tokens and max_completion_tokens must match when both are provided.",
    );
  }
  return legacy ?? completion ?? defaultValue;
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ApiError(400, "invalid_request", `${name} must be a positive integer.`);
  }
  return value as number;
}

function assertImageLimits(
  messages: readonly unknown[],
  policy: LlmAliasRequestPolicy,
): void {
  const images = collectImageUrls(messages);
  if (images.length > policy.maxImages) {
    throw new ApiError(
      400,
      "image_limit_exceeded",
      "The request contains too many images for this product alias.",
    );
  }
  for (const image of images) {
    const bytes = decodedDataUrlBytes(image);
    if (bytes === undefined) {
      throw new ApiError(
        400,
        "remote_image_forbidden",
        "LLM image inputs must use bounded inline data URLs.",
      );
    }
    if (bytes > policy.maxImageBytes) {
      throw new ApiError(
        413,
        "image_too_large",
        "An LLM image input exceeds the product limit.",
      );
    }
  }
}

function collectImageUrls(value: unknown, seen = new Set<object>()): string[] {
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value)) {
    throw new ApiError(400, "invalid_request", "The request must not contain cycles.");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.flatMap((item) => collectImageUrls(item, seen));
    }
    if (!isPlainObject(value)) {
      throw new ApiError(400, "invalid_request", "The request must contain plain JSON objects.");
    }
    const type = value.type;
    if (type === "image_url" || type === "input_image") {
      const candidate = value.image_url ?? value.image_url_data ?? value.url;
      if (typeof candidate === "string") return [candidate];
      if (isPlainObject(candidate) && typeof candidate.url === "string") {
        return [candidate.url];
      }
      throw new ApiError(400, "invalid_request", "An image input is missing its URL.");
    }
    return Object.values(value).flatMap((item) => collectImageUrls(item, seen));
  } finally {
    seen.delete(value);
  }
}

function decodedDataUrlBytes(value: string): number | undefined {
  const match = /^data:image\/[a-z0-9.+-]+(;base64)?,(.*)$/is.exec(value);
  if (match === null) return undefined;
  const payload = match[2] ?? "";
  if (match[1] === ";base64") {
    if (!/^[a-z0-9+/]*={0,2}$/i.test(payload) || payload.length % 4 === 1) {
      throw new ApiError(400, "invalid_request", "An image data URL is invalid.");
    }
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    return Math.floor((payload.length * 3) / 4) - padding;
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  } catch {
    throw new ApiError(400, "invalid_request", "An image data URL is invalid.");
  }
}

function validateRequestPolicy(alias: ProductAlias, policy: LlmAliasRequestPolicy): void {
  if (policy === undefined) throw new Error(`Request policy is missing for ${alias}.`);
  for (const [name, value, minimum] of [
    ["maxInputBytes", policy.maxInputBytes, 1],
    ["maxInputTokens", policy.maxInputTokens, 1],
    ["maxOutputTokens", policy.maxOutputTokens, 1],
    ["maxImages", policy.maxImages, 0],
    ["maxImageBytes", policy.maxImageBytes, 1],
    ["reservationCredits", policy.reservationCredits, 1],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`${name} for ${alias} must be an integer of at least ${minimum}.`);
    }
  }
}

function acceptIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new ApiError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key must contain between 1 and 200 characters.",
    );
  }
  return normalized;
}

function quotaExceeded(reservation: Extract<ReserveEntitlementResult, { granted: false }>): ApiError {
  const details: Record<string, unknown> = { canRetry: false };
  if (reservation.resetAt !== undefined) {
    details.resetAt = reservation.resetAt;
  }
  return new ApiError(
    429,
    "quota_exceeded",
    "The account's cloud LLM allowance has been exhausted.",
    details,
  );
}

function idempotencyConflict(): ApiError {
  return conflict(
    "idempotency_conflict",
    "Idempotency-Key was already used with a different request.",
  );
}

function providerUnavailable(): ApiError {
  return new ApiError(503, "provider_unavailable", "The cloud LLM is temporarily unavailable.");
}

function providerUsageExceededLimits(): ApiError {
  return new ApiError(
    502,
    "provider_usage_exceeded_limits",
    "The cloud LLM exceeded its configured usage limit.",
  );
}

function publicProviderFailure(error: unknown): ApiError {
  return error instanceof ApiError && error.code === "provider_usage_exceeded_limits"
    ? error
    : providerUnavailable();
}

function assertUsage(usage: ProviderUsage): void {
  for (const [name, value] of [
    ["inputTokens", usage.inputTokens],
    ["outputTokens", usage.outputTokens],
    ["totalTokens", usage.totalTokens],
    ["credits", usage.credits],
    ["cachedInputTokens", usage.cachedInputTokens ?? 0],
    ["imageTokens", usage.imageTokens ?? 0],
    ["providerCostMicros", usage.providerCostMicros ?? 0],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(500, "invalid_provider_usage", `${name} must be a non-negative integer.`);
    }
  }
  if (
    usage.usageBasis !== undefined
    && usage.usageBasis !== "provider_reported"
    && usage.usageBasis !== "conservative_estimate"
  ) {
    throw new ApiError(500, "invalid_provider_usage", "usageBasis is invalid.");
  }
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
    throw new ApiError(500, "invalid_provider_usage", "Provider token totals are inconsistent.");
  }
  if (
    (usage.cachedInputTokens ?? 0) > usage.inputTokens ||
    (usage.imageTokens ?? 0) > usage.inputTokens
  ) {
    throw new ApiError(500, "invalid_provider_usage", "Provider input token details are inconsistent.");
  }
}

function publicChunk(chunk: OpenAiObject, invocationId: string): OpenAiObject {
  const result: Record<string, unknown> = { ...chunk };
  delete result.provider;
  delete result.provider_name;
  delete result.system_fingerprint;
  delete result.usage;
  result.id = `chatcmpl_${invocationId}`;
  result.model = PUBLIC_MODEL_NAME;
  return result;
}

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ApiError(400, "invalid_request", "The request must contain valid JSON values.");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new ApiError(400, "invalid_request", "The request must contain valid JSON values.");
  }
  if (seen.has(value)) {
    throw new ApiError(400, "invalid_request", "The request must not contain cycles.");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    }
    if (!isPlainObject(value)) {
      throw new ApiError(400, "invalid_request", "The request must contain plain JSON objects.");
    }
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`);
    return `{${members.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
