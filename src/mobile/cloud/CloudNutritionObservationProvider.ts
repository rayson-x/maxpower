import { stableHash } from "../../coach/stable";
import type { SecureCredentialPort } from "../../privacy";
import type {
  NutritionObservationPort,
  NutritionObservationProviderResolver,
  NutritionObservationRequest,
} from "../../nutrition/NutritionStrategyEngine";
import {
  OpenAICompatibleNutritionTransport,
  type OpenAICompatibleNutritionFetch,
} from "../../nutrition/OpenAICompatibleNutritionTransport";
import {
  NutritionObservationError,
  RemoteNutritionObservationProvider,
} from "../../nutrition/RemoteNutritionObservationProvider";

import type { CloudServiceAccessTokenSource } from "./MaxPowerCloudLlmProvider";
import { CloudInvocationCancellationClient } from "./CloudInvocationCancellationClient";
import { maxPowerApiOrigin, requiredCloudText } from "./cloudServiceValidation";
import { linkAbortSignals } from "./linkAbortSignals";

export const MAXPOWER_NUTRITION_ALIAS = "maxpower/nutrition-vision-v1";

export interface CloudNutritionPermissions {
  mediaUpload: "granted" | "denied";
}

export interface CloudNutritionObservationProviderResolverOptions {
  apiBaseUrl: string;
  allowInsecureHttp?: boolean;
  accountId: string;
  accessTokens: CloudServiceAccessTokenSource;
  media: ConstructorParameters<typeof RemoteNutritionObservationProvider>[0]["media"];
  permission(accountId: string): Promise<CloudNutritionPermissions>;
  accountSignal?: AbortSignal;
  requestId?: () => string;
  fetch?: OpenAICompatibleNutritionFetch;
  cancellationAttemptTimeoutMs?: number;
  cancellationRetryDelayMs?: number;
}

/** Resolves one first-party vision request without persisting its service JWT. */
export class CloudNutritionObservationProviderResolver implements NutritionObservationProviderResolver {
  private readonly endpoint: string;
  private readonly cancellations: CloudInvocationCancellationClient;

  constructor(private readonly options: CloudNutritionObservationProviderResolverOptions) {
    const origin = maxPowerApiOrigin(options.apiBaseUrl, {
      allowInsecureHttp: options.allowInsecureHttp,
    });
    this.endpoint = new URL("/v1/chat/completions", origin).toString();
    const fetchImpl = options.fetch
      ?? (globalThis.fetch?.bind(globalThis) as unknown as OpenAICompatibleNutritionFetch);
    if (!fetchImpl) throw new Error("cloud_nutrition_fetch_unavailable");
    this.cancellations = new CloudInvocationCancellationClient({
      apiBaseUrl: origin,
      ...(options.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: options.allowInsecureHttp }),
      accountId: options.accountId,
      accessTokens: options.accessTokens,
      fetch: (url, init) => fetchImpl(url, init),
      ...(options.cancellationAttemptTimeoutMs === undefined
        ? {}
        : { attemptTimeoutMs: options.cancellationAttemptTimeoutMs }),
      ...(options.cancellationRetryDelayMs === undefined
        ? {}
        : { retryDelayMs: options.cancellationRetryDelayMs }),
    });
  }

  async resolve(input: {
    userId: string;
    request: NutritionObservationRequest;
  }): Promise<NutritionObservationPort> {
    if (input.userId !== this.options.accountId) throw new Error("cloud_nutrition_account_mismatch");
    const permission = await this.options.permission(input.userId);
    if (input.request.localMediaRefs?.length && permission.mediaUpload !== "granted") {
      throw new NutritionObservationError("media_consent_required");
    }

    const requestId = requiredCloudText(
      this.options.requestId?.() ?? nextNutritionRequestId(),
      "cloud_nutrition_request_id_invalid",
    );
    const credential = new EphemeralServiceJwtCredential({
      accountId: input.userId,
      accessTokens: this.options.accessTokens,
    });
    const idempotencyKey = `nutrition-${stableHash({ accountId: input.userId, requestId })}`;
    const provider = new RemoteNutritionObservationProvider({
      userId: input.userId,
      providerId: "maxpower-cloud",
      modelVersion: MAXPOWER_NUTRITION_ALIAS,
      credential,
      credentialKey: { accountId: input.userId, name: "service-jwt" },
      media: this.options.media,
      transport: new OpenAICompatibleNutritionTransport({
        endpoint: this.endpoint,
        model: MAXPOWER_NUTRITION_ALIAS,
        requestHeaders: () => ({
          "idempotency-key": idempotencyKey,
          "x-client-run-id": `nutrition-${stableHash({ accountId: input.userId, requestId, kind: "client-run" })}`,
        }),
        onCancelled: () => this.cancellations.cancel(idempotencyKey),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      }),
    });
    return new AccountBoundNutritionProvider(provider, this.options.accountSignal);
  }
}

class EphemeralServiceJwtCredential implements SecureCredentialPort {
  constructor(private readonly options: {
    accountId: string;
    accessTokens: CloudServiceAccessTokenSource;
  }) {}

  async get(input: Parameters<SecureCredentialPort["get"]>[0]): Promise<Awaited<ReturnType<SecureCredentialPort["get"]>>> {
    if (input.key.accountId !== this.options.accountId || input.key.name !== "service-jwt") {
      return { status: "missing_or_invalidated" };
    }
    const value = await this.options.accessTokens.accessTokenFor(this.options.accountId);
    return { status: "available", value: requiredCloudText(value, "cloud_nutrition_access_token_required") };
  }

  async put(): Promise<void> { throw new Error("cloud_service_jwt_is_memory_only"); }
  async rotate(): Promise<void> { throw new Error("cloud_service_jwt_is_memory_only"); }
  async delete(): Promise<void> { /* nothing was persisted */ }
}

class AccountBoundNutritionProvider implements NutritionObservationPort {
  constructor(
    private readonly delegate: NutritionObservationPort,
    private readonly accountSignal?: AbortSignal,
  ) {}

  capabilities(): ReturnType<NonNullable<NutritionObservationPort["capabilities"]>> {
    return this.delegate.capabilities?.() ?? {
      text: true,
      photo: true,
      nutritionLabel: true,
      cancellation: true,
    };
  }

  async estimate(input: NutritionObservationRequest): Promise<Awaited<ReturnType<NutritionObservationPort["estimate"]>>> {
    if (this.accountSignal?.aborted) throw new NutritionObservationError("cancelled");
    const linked = linkAbortSignals(input.signal, this.accountSignal);
    try {
      return await this.delegate.estimate({
        ...input,
        ...(linked.signal ? { signal: linked.signal } : {}),
      });
    } finally {
      linked.dispose();
    }
  }
}

let nutritionRequestSequence = 0;

function nextNutritionRequestId(): string {
  nutritionRequestSequence += 1;
  return `${Date.now().toString(36)}-${nutritionRequestSequence.toString(36)}`;
}
