import {
  OpenAICompatibleHttpError,
  OpenAICompatibleProvider,
  OpenAICompatibleStreamError,
  ProviderServiceError,
  type LLMProvider,
  type LLMProviderRequest,
  type LLMProviderResolver,
  type LLMProviderResumeRequest,
  type OpenAICompatibleFetch,
  type OpenAICompatibleResumeFetch,
  type ProviderEvent,
} from "../../coach/adapters/provider";
import { stableHash } from "../../coach/stable";
import { CloudInvocationCancellationClient } from "./CloudInvocationCancellationClient";
import { maxPowerApiOrigin, requiredCloudText } from "./cloudServiceValidation";
import { linkAbortSignals } from "./linkAbortSignals";

export const MAXPOWER_COACH_ALIAS = "maxpower/coach-v1";

export interface CloudServiceAccessTokenSource {
  /** Service JWTs are short-lived and read from memory for every request. */
  accessTokenFor(accountId: string): string | Promise<string>;
}

export interface MaxPowerCloudLlmProviderOptions {
  apiBaseUrl: string;
  accountId: string;
  accessTokens: CloudServiceAccessTokenSource;
  accountSignal?: AbortSignal;
  fetch?: OpenAICompatibleFetch;
  resumeFetch?: OpenAICompatibleResumeFetch;
  cancellationAttemptTimeoutMs?: number;
  cancellationRetryDelayMs?: number;
}

/**
 * First-party cloud boundary for the local AgentRuntime. Provider selection,
 * physical model names and credentials never enter this interface.
 */
export class MaxPowerCloudLlmProvider implements LLMProvider {
  readonly kind = "maxpower-cloud";
  readonly usesNetwork = true;
  readonly model = MAXPOWER_COACH_ALIAS;
  readonly configurationFingerprint: string;

  private readonly accountId: string;
  private readonly accountSignal?: AbortSignal;
  private readonly fetchImpl: OpenAICompatibleFetch;
  private readonly cancellations: CloudInvocationCancellationClient;
  private readonly delegate: OpenAICompatibleProvider;

  constructor(options: MaxPowerCloudLlmProviderOptions) {
    const origin = maxPowerApiOrigin(options.apiBaseUrl);
    this.accountId = requiredCloudText(options.accountId, "cloud_llm_account_required");
    this.accountSignal = options.accountSignal;
    this.fetchImpl = options.fetch
      ?? (globalThis.fetch?.bind(globalThis) as unknown as OpenAICompatibleFetch);
    if (!this.fetchImpl) throw new Error("cloud_llm_fetch_unavailable");
    this.cancellations = new CloudInvocationCancellationClient({
      apiBaseUrl: origin,
      accountId: this.accountId,
      accessTokens: options.accessTokens,
      fetch: (url, init) => this.fetchImpl(url, init),
      ...(options.cancellationAttemptTimeoutMs === undefined
        ? {}
        : { attemptTimeoutMs: options.cancellationAttemptTimeoutMs }),
      ...(options.cancellationRetryDelayMs === undefined
        ? {}
        : { retryDelayMs: options.cancellationRetryDelayMs }),
    });
    this.configurationFingerprint = stableHash({
      kind: this.kind,
      origin,
      alias: this.model,
    });
    this.delegate = new OpenAICompatibleProvider({
      endpoint: new URL("/v1/chat/completions", origin).toString(),
      model: this.model,
      authorizationHeader: async () => {
        const token = await options.accessTokens.accessTokenFor(this.accountId);
        return `Bearer ${requiredCloudText(token, "cloud_llm_access_token_required")}`;
      },
      requestHeaders: (request) => cloudRequestIdentity(this.accountId, request).headers,
      streamResume: {
        endpoint: (invocationId) => new URL(
          `/v1/invocations/${encodeURIComponent(invocationId)}/events`,
          origin,
        ).toString(),
        ...(options.resumeFetch ? { fetch: options.resumeFetch } : {}),
      },
      fetch: this.fetchImpl,
    });
  }

  stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent> {
    return this.invoke(request, false);
  }

  resume(request: LLMProviderResumeRequest): AsyncIterable<ProviderEvent> {
    return this.invoke(request, true);
  }

  private async *invoke(
    request: LLMProviderRequest | LLMProviderResumeRequest,
    continuation: boolean,
  ): AsyncIterable<ProviderEvent> {
    if (this.accountSignal?.aborted) throw new ProviderServiceError("account_switched");
    const linked = linkAbortSignals(request.signal, this.accountSignal);
    const delegated = {
      ...request,
      ...(linked.signal ? { signal: linked.signal } : {}),
    };
    const { idempotencyKey } = cloudRequestIdentity(this.accountId, request);
    try {
      const stream = continuation
        ? this.delegate.resume(delegated as LLMProviderResumeRequest)
        : this.delegate.stream(delegated);
      for await (const event of stream) yield event;
    } catch (cause) {
      let cancellationFailure: unknown;
      if (
        this.accountSignal?.aborted === true || request.signal?.aborted === true
      ) {
        try {
          await this.cancellations.cancel(idempotencyKey);
        } catch (error) {
          cancellationFailure = error;
        }
      }
      if (this.accountSignal?.aborted) throw new ProviderServiceError("account_switched");
      if (request.signal?.aborted) {
        if (cancellationFailure !== undefined) {
          throw new ProviderServiceError("service_unavailable");
        }
        throw cause;
      }
      throw normalizeCloudFailure(cause);
    } finally {
      linked.dispose();
    }
  }

}

export interface MaxPowerCloudLlmProviderResolverOptions extends MaxPowerCloudLlmProviderOptions {
  permission(accountId: string): Promise<"granted" | "denied">;
}

/** One-account resolver; account switches replace the entire runtime. */
export class MaxPowerCloudLlmProviderResolver implements LLMProviderResolver {
  private readonly provider: MaxPowerCloudLlmProvider;

  constructor(private readonly options: MaxPowerCloudLlmProviderResolverOptions) {
    this.provider = new MaxPowerCloudLlmProvider(options);
  }

  async resolve(input: Parameters<LLMProviderResolver["resolve"]>[0]): Promise<LLMProvider> {
    if (input.userId !== this.options.accountId) throw new Error("cloud_llm_account_mismatch");
    if (await this.options.permission(input.userId) !== "granted") {
      throw new ProviderServiceError("consent_required");
    }
    if (input.prior && (
      input.prior.kind !== this.provider.kind ||
      input.prior.configurationFingerprint !== this.provider.configurationFingerprint
    )) {
      throw new Error("cloud_llm_runtime_changed");
    }
    return this.provider;
  }
}

function cloudRequestIdentity(
  accountId: string,
  request: LLMProviderRequest | LLMProviderResumeRequest,
): { idempotencyKey: string; headers: Readonly<Record<string, string>> } {
  const continuation = "continuation" in request ? request.continuation : undefined;
  const fingerprint = stableHash({
    accountId,
    sessionId: request.sessionId,
    runId: request.runId,
    ...(continuation ? { continuation } : {}),
  });
  const idempotencyKey = `coach-${fingerprint}`;
  return {
    idempotencyKey,
    headers: {
      "idempotency-key": idempotencyKey,
      // Do not put a local conversation or run identifier into an HTTP header.
      "x-client-run-id": `run-${stableHash({ accountId, runId: request.runId })}`,
    },
  };
}

function normalizeCloudFailure(cause: unknown): ProviderServiceError {
  if (cause instanceof ProviderServiceError) return cause;
  if (cause instanceof OpenAICompatibleHttpError) {
    if (cause.wireCode === "quota_exceeded") return new ProviderServiceError("allowance_exhausted");
    if (cause.wireCode === "provider_unavailable") return new ProviderServiceError("service_unavailable");
    if (cause.status === 401) return new ProviderServiceError("authentication_required");
    if (cause.status === 403) return new ProviderServiceError("permission_denied");
    if (cause.status === 409) return new ProviderServiceError("request_conflict");
    if (cause.status === 429) return new ProviderServiceError("service_unavailable");
    if (cause.status >= 500) return new ProviderServiceError("service_unavailable");
    return new ProviderServiceError("request_failed");
  }
  if (cause instanceof OpenAICompatibleStreamError) {
    if (cause.wireCode === "quota_exceeded") return new ProviderServiceError("allowance_exhausted");
    return new ProviderServiceError("service_unavailable");
  }
  return new ProviderServiceError("service_unavailable");
}
