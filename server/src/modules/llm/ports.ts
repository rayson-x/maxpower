import type {
  LlmEntitlementView,
  OpenAiChatCompletionRequest,
  OpenAiObject,
  ProductAlias,
} from "./model.js";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  credits: number;
  /** Subsets of inputTokens used for provider billing reconciliation. */
  cachedInputTokens?: number;
  imageTokens?: number;
  /** Estimated actual upstream cost at the route's versioned price, in millionths of currency. */
  providerCostMicros?: number;
  /** Distinguishes authoritative Provider totals from cancellation estimates. */
  usageBasis?: "provider_reported" | "conservative_estimate";
}

export class ProviderInvocationCancelledError extends Error {
  constructor(readonly usage: ProviderUsage) {
    super("provider_invocation_cancelled");
    this.name = "ProviderInvocationCancelledError";
  }
}

export interface ProviderInvocationInput {
  invocationId: string;
  alias: ProductAlias;
  stream: boolean;
  request: OpenAiChatCompletionRequest;
  /** Aborts upstream generation when account policy revokes the invocation. */
  signal: AbortSignal;
}

export interface LlmAccountStatusSource {
  isActive(accountId: string): Promise<boolean>;
}

export interface ProviderCompleteResult {
  kind: "complete";
  response: OpenAiObject;
  usage: ProviderUsage;
}

export interface ProviderStreamResult {
  kind: "stream";
  chunks: AsyncIterable<OpenAiObject>;
  /** Resolves to final normalized usage after the provider stream terminates. */
  usage: Promise<ProviderUsage>;
  /** Conservative content-free estimate used only when the client cancels before terminal usage. */
  estimateCancelledUsage?(): ProviderUsage;
}

export type ProviderResult = ProviderCompleteResult | ProviderStreamResult;

/**
 * Explicit acknowledgement for the external side-effect seam. `started`
 * resolves only after the Adapter has initiated its Provider request; until
 * then durable recovery must treat the invocation as dispatch-ambiguous.
 */
export interface ProviderInvocationDispatch {
  started: Promise<void>;
  result: Promise<ProviderResult>;
}

export interface LlmProviderAdapter {
  invoke(input: ProviderInvocationInput): ProviderInvocationDispatch;
}

/** Test/local Adapter helper for a Provider operation that starts synchronously. */
export function immediateProviderDispatch(
  result: ProviderResult | PromiseLike<ProviderResult>,
): ProviderInvocationDispatch {
  return { started: Promise.resolve(), result: Promise.resolve(result) };
}

export interface ReserveEntitlementInput {
  accountId: string;
  invocationId: string;
  credits: number;
}

export type ReserveEntitlementResult =
  | {
      granted: true;
      reservationId: string;
      reservedCredits: number;
    }
  | {
      granted: false;
      resetAt?: string;
    };

export interface SettleEntitlementResult {
  chargedCredits: number;
}

export interface LlmEntitlementAdapter {
  reserve(input: ReserveEntitlementInput): Promise<ReserveEntitlementResult>;
  settle(reservationId: string, actualCredits: number): Promise<SettleEntitlementResult>;
  release(reservationId: string): Promise<void>;
  getAccount(accountId: string): Promise<LlmEntitlementView | undefined>;
}

export type InvocationStatus =
  | "received"
  | "dispatching"
  | "running"
  | "cancel_requested"
  | "rejected"
  | "completed"
  | "failed";

export interface InvocationMetadata {
  id: string;
  ownerAccountId: string;
  alias: ProductAlias;
  stream: boolean;
  idempotencyFingerprint: string;
  requestFingerprint: string;
  status: InvocationStatus;
  reservedCredits: number;
  settledCredits: number;
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
}

export interface InvocationMetadataUpdate {
  status?: InvocationStatus;
  reservedCredits?: number;
  settledCredits?: number;
  updatedAt: string;
  errorCode?: string;
}

export type ClaimInvocationResult =
  | { created: true; invocation: InvocationMetadata }
  | { created: false; invocation: InvocationMetadata };

export interface UsageMetadata {
  invocationId: string;
  ownerAccountId: string;
  alias: ProductAlias;
  usageBasis: "provider_reported" | "conservative_estimate";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  imageTokens: number;
  providerCredits: number;
  providerCostMicros: number;
  chargedCredits: number;
  recordedAt: string;
}

export interface FinalizeLlmInvocationInput extends UsageMetadata {
  reservationId: string;
  terminalStatus: "completed" | "failed";
  errorCode?: string;
}

export interface FinalizeLlmInvocationResult extends SettleEntitlementResult {
  terminalStatus: "completed" | "failed";
  errorCode?: string;
}

export interface FailLlmInvocationInput {
  invocationId: string;
  reservationId: string;
  failedAt: string;
  errorCode: string;
}

export interface FailLlmInvocationResult {
  errorCode: string;
}

export interface LlmRecoveryResult {
  releasedBeforeProvider: number;
  releasedDispatchPendingReconciliation: number;
  chargedPendingReconciliation: number;
}

/** Production seam that commits entitlement, usage and terminal invocation state atomically. */
export interface LlmInvocationLifecycleAdapter {
  finalizeSuccess(input: FinalizeLlmInvocationInput): Promise<FinalizeLlmInvocationResult>;
  fail(input: FailLlmInvocationInput): Promise<FailLlmInvocationResult>;
  recoverExpired(input: {
    recoveredAt: string;
    limit: number;
  }): Promise<LlmRecoveryResult>;
}

/**
 * Persists content-free invocation and usage metadata. Implementations must never
 * add request messages, tools, provider chunks, or response content.
 */
export interface LlmUsageAdapter {
  claimInvocation(metadata: InvocationMetadata): Promise<ClaimInvocationResult>;
  updateInvocation(id: string, update: InvocationMetadataUpdate): Promise<void>;
  getInvocation(id: string): Promise<InvocationMetadata | undefined>;
  requestCancellation(input: {
    ownerAccountId: string;
    idempotencyFingerprint: string;
    requestedAt: string;
  }): Promise<{ invocation?: InvocationMetadata }>;
  isCancellationRequested(invocationId: string): Promise<boolean>;
  recordUsage(metadata: UsageMetadata): Promise<void>;
}

export interface StreamBufferFailure {
  status: number;
  code: string;
  message: string;
}

/**
 * Ephemeral replay seam. Production implementations must use memory-only
 * storage with persistence, snapshots, backups and cross-region replication disabled.
 */
export interface VolatileStreamBufferAdapter {
  create(input: {
    invocationId: string;
    ownerAccountId: string;
    ttlMs: number;
  }): Promise<void>;
  append(invocationId: string, chunk: OpenAiObject): Promise<void>;
  complete(invocationId: string): Promise<void>;
  fail(invocationId: string, failure: StreamBufferFailure): Promise<void>;
  read(input: {
    invocationId: string;
    ownerAccountId: string;
    afterSequence: number;
  }): Promise<AsyncIterable<OpenAiObject>>;
  delete(invocationId: string): Promise<void>;
}
