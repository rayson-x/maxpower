import {
  OnlineAuthError,
  type AuthenticatedIdentity,
  type AccountDeletionProgress,
  type CompleteRegistrationInput,
  type CompleteSocialOnboardingInput,
  type IdentityIdentifier,
  type IdentityPublicConfiguration,
  type LinkedIdentity,
  type OnlineAuthApi,
  type OtpChallengeStarted,
  type ReachabilityPort,
  type RegistrationOtpResult,
  type SocialCallbackExchange,
  type SocialProvider,
  type SocialSignInStarted,
  type SocialIdentityLinkStarted,
} from "./model";

export type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ServerAuthClientOptions {
  baseUrl: string;
  fetch?: AuthFetch;
  /** Reads the SecureStore-only install secret used by social code exchange. */
  socialExchangeBinding?: () => Promise<string>;
}

/**
 * Thin client for MaxPower's reviewed `/v1/auth/*` contract. Better Auth's
 * cookies, routes, and SDK models deliberately remain server implementation
 * details.
 */
export class ServerAuthClient implements OnlineAuthApi, ReachabilityPort {
  private readonly origin: URL;
  private readonly fetch: AuthFetch;
  private readonly socialExchangeBinding?: () => Promise<string>;

  constructor(options: ServerAuthClientOptions) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl);
    } catch {
      throw new OnlineAuthError("configuration_error", "MaxPower API URL is invalid.");
    }
    const protocolAllowed = baseUrl.protocol === "https:" || baseUrl.protocol === "http:";
    if (!protocolAllowed) {
      throw new OnlineAuthError("configuration_error", "MaxPower API URL must use HTTP or HTTPS.");
    }
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new OnlineAuthError("configuration_error", "MaxPower API URL must not contain credentials, query, or fragment.");
    }
    this.origin = new URL(baseUrl.origin);
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.socialExchangeBinding = options.socialExchangeBinding;
  }

  async assertReachable(signal?: AbortSignal): Promise<void> {
    // Media storage is optional for Coach/LLM. Probe the public identity
    // contract so an unavailable S3 bucket cannot disable the core product.
    const response = await this.perform("/v1/auth/config", { method: "GET", signal });
    if (!response.ok) throw await this.responseError(response);
    parsePublicConfiguration(await readJson(response));
  }

  async getPublicConfiguration(signal?: AbortSignal): Promise<IdentityPublicConfiguration> {
    const response = await this.perform("/v1/auth/config", { method: "GET", signal });
    if (!response.ok) throw await this.responseError(response);
    return parsePublicConfiguration(await readJson(response));
  }

  async startSocialSignIn(
    input: { provider: SocialProvider; callbackUrl: string },
    signal?: AbortSignal,
  ): Promise<SocialSignInStarted> {
    const callback = validatedCallbackBaseUrl(input.callbackUrl);
    const deviceBinding = await this.readSocialExchangeBinding();
    const response = await this.perform("/v1/auth/social/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: input.provider,
        callbackUrl: callback.toString(),
        deviceBinding,
      }),
      signal,
    });
    if (!response.ok) throw await this.responseError(response);
    const value = await readJson(response);
    if (!isRecord(value)) throw invalidResponse();
    return {
      authorizationUrl: validatedHttpsUrl(recordText(value, "authorizationUrl")).toString(),
      exchangeState: boundedText(value.exchangeState, 2048),
    };
  }

  async exchangeSocialCallback(
    input: {
      callbackUrl: string;
      expectedCallbackUrl: string;
      expectedExchangeState: string;
    },
    signal?: AbortSignal,
  ): Promise<SocialCallbackExchange> {
    const expected = validatedCallbackBaseUrl(input.expectedCallbackUrl);
    const callback = validatedCallbackResultUrl(input.callbackUrl);
    if (!sameCallbackTarget(callback, expected)) {
      throw new OnlineAuthError("invalid_response", "Social login returned to an unexpected callback.");
    }
    const providerError = callback.searchParams.get("error");
    if (providerError) throw new OnlineAuthError("request_failed", "Social login was not completed.");
    for (const key of callback.searchParams.keys()) {
      if (key !== "code" && key !== "state") {
        throw new OnlineAuthError("invalid_response", "Social login returned an unexpected callback parameter.");
      }
    }
    const expectedState = boundedText(input.expectedExchangeState, 2048);
    const state = boundedText(callback.searchParams.get("state"), 2048);
    if (state !== expectedState) {
      throw new OnlineAuthError("invalid_response", "Social login state did not match the initiating request.");
    }
    const code = boundedText(callback.searchParams.get("code"), 4096);
    const deviceBinding = await this.readSocialExchangeBinding();
    return this.post(
      "/v1/auth/social/exchange",
      { code, state, callbackUrl: expected.toString(), deviceBinding },
      parseSocialCallbackExchange,
      signal,
    );
  }

  startRegistrationOtp(input: { identifier: IdentityIdentifier }, signal?: AbortSignal): Promise<OtpChallengeStarted> {
    return this.post("/v1/auth/register/otp/start", { identifier: normalizeIdentifier(input.identifier) }, parseChallenge, signal);
  }

  verifyRegistrationOtp(input: { challengeId: string; code: string }, signal?: AbortSignal): Promise<RegistrationOtpResult> {
    return this.post("/v1/auth/register/otp/verify", cleanOtpVerification(input), parseRegistrationResult, signal);
  }

  completeRegistration(input: CompleteRegistrationInput, signal?: AbortSignal): Promise<AuthenticatedIdentity> {
    return this.post("/v1/auth/register/complete", input, parseAuthenticatedIdentity, signal);
  }

  startLoginOtp(input: { identifier: IdentityIdentifier }, signal?: AbortSignal): Promise<OtpChallengeStarted> {
    return this.post("/v1/auth/login/otp/start", { identifier: normalizeIdentifier(input.identifier) }, parseChallenge, signal);
  }

  verifyLoginOtp(input: { challengeId: string; code: string }, signal?: AbortSignal): Promise<AuthenticatedIdentity> {
    return this.post("/v1/auth/login/otp/verify", cleanOtpVerification(input), parseAuthenticatedIdentity, signal);
  }

  loginWithPassword(
    input: { identifier: IdentityIdentifier; password: string },
    signal?: AbortSignal,
  ): Promise<AuthenticatedIdentity> {
    return this.post(
      "/v1/auth/login/password",
      { identifier: normalizeIdentifier(input.identifier), password: input.password },
      parseAuthenticatedIdentity,
      signal,
    );
  }

  refreshSession(sessionToken: string, signal?: AbortSignal): Promise<AuthenticatedIdentity> {
    return this.post("/v1/auth/refresh", { sessionToken: requiredText(sessionToken) }, parseAuthenticatedIdentity, signal);
  }

  completeSocialOnboarding(input: CompleteSocialOnboardingInput, signal?: AbortSignal): Promise<AuthenticatedIdentity> {
    return this.post("/v1/auth/social/complete", input, parseAuthenticatedIdentity, signal);
  }

  async listLinkedIdentities(
    sessionToken: string,
    signal?: AbortSignal,
  ): Promise<readonly LinkedIdentity[]> {
    const response = await this.perform("/api/auth/list-accounts", {
      method: "GET",
      headers: sessionAuthorization(sessionToken),
      signal,
    });
    if (!response.ok) throw await this.responseError(response);
    return parseLinkedIdentities(await readJson(response));
  }

  async startSocialIdentityLink(
    input: { sessionToken: string; provider: SocialProvider; callbackUrl: string },
    signal?: AbortSignal,
  ): Promise<SocialIdentityLinkStarted> {
    const callbackUrl = validatedCallbackBaseUrl(input.callbackUrl).toString();
    const response = await this.perform("/api/auth/link-social", {
      method: "POST",
      headers: {
        ...sessionAuthorization(input.sessionToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: input.provider,
        callbackURL: callbackUrl,
        disableRedirect: true,
      }),
      signal,
    });
    if (!response.ok) throw await this.responseError(response);
    const value = await readJson(response);
    if (!isRecord(value)) throw invalidResponse();
    return { authorizationUrl: validatedHttpsUrl(recordText(value, "url")).toString() };
  }

  async unlinkIdentity(
    input: { sessionToken: string; providerId: string; accountId?: string },
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.perform("/api/auth/unlink-account", {
      method: "POST",
      headers: {
        ...sessionAuthorization(input.sessionToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        providerId: requiredText(input.providerId),
        ...(input.accountId === undefined ? {} : { accountId: requiredText(input.accountId) }),
      }),
      signal,
    });
    if (!response.ok) throw await this.responseError(response);
    const value = await readJson(response);
    if (!isRecord(value) || value.status !== true) throw invalidResponse();
  }

  async requestAccountDeletion(
    input: { accessToken?: string; idempotencyKey: string },
    signal?: AbortSignal,
  ): Promise<AccountDeletionProgress> {
    const idempotencyKey = deletionRecoveryKey(input.idempotencyKey);
    const response = await this.perform("/v1/me/deletion", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...(input.accessToken === undefined
          ? {}
          : { authorization: `Bearer ${requiredText(input.accessToken)}` }),
      },
      body: JSON.stringify({ confirmation: "DELETE" }),
      signal,
    });
    if (!response.ok) throw await this.responseError(response);
    return parseAccountDeletion(await readJson(response), true);
  }

  async getAccountDeletion(receipt: string, signal?: AbortSignal): Promise<AccountDeletionProgress> {
    const response = await this.perform("/v1/me/deletion", {
      method: "GET",
      headers: { "deletion-receipt": requiredText(receipt) },
      signal,
    });
    if (!response.ok) throw await this.responseError(response);
    return parseAccountDeletion(await readJson(response), false);
  }

  async signOut(sessionToken: string, signal?: AbortSignal): Promise<void> {
    await this.post(
      "/v1/auth/logout",
      { sessionToken: requiredText(sessionToken) },
      () => undefined,
      signal,
    );
  }

  private async readSocialExchangeBinding(): Promise<string> {
    if (!this.socialExchangeBinding) {
      throw new OnlineAuthError("configuration_error", "Secure social login binding is not configured.");
    }
    const binding = await this.socialExchangeBinding();
    if (!/^[a-f0-9]{64}$/.test(binding)) {
      throw new OnlineAuthError("configuration_error", "Secure social login binding is invalid.");
    }
    return binding;
  }

  private async post<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.perform(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw await this.responseError(response);
    return parse(await readJson(response));
  }

  private async perform(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetch(new URL(path, this.origin).toString(), init);
    } catch (cause) {
      if (init.signal?.aborted || isAbortError(cause)) {
        throw new OnlineAuthError("request_aborted");
      }
      throw new OnlineAuthError("network_unavailable", "Cannot reach MaxPower service.");
    }
  }

  private async responseError(response: Response): Promise<OnlineAuthError> {
    const value = await readJson(response).catch(() => undefined);
    const serverCode = isRecord(value) && isRecord(value.error) && typeof value.error.code === "string"
      ? value.error.code
      : undefined;
    const serverMessage = isRecord(value) && isRecord(value.error) && typeof value.error.message === "string"
      ? value.error.message
      : undefined;
    if (response.status === 401) {
      return new OnlineAuthError("not_authenticated", serverMessage ?? "Authentication is no longer valid.", response.status);
    }
    if (response.status === 503) {
      return new OnlineAuthError("network_unavailable", serverMessage ?? "MaxPower service is not ready.", response.status);
    }
    return new OnlineAuthError("request_failed", serverMessage ?? serverCode ?? "MaxPower request failed.", response.status);
  }
}

export function normalizeIdentifier(identifier: IdentityIdentifier): IdentityIdentifier {
  const value = requiredText(identifier.value);
  return identifier.kind === "email"
    ? { kind: "email", value: value.toLocaleLowerCase("en-US") }
    : { kind: "phone", value };
}

function cleanOtpVerification(input: { challengeId: string; code: string }): { challengeId: string; code: string } {
  return { challengeId: requiredText(input.challengeId), code: requiredText(input.code) };
}

function parseChallenge(value: unknown): OtpChallengeStarted {
  if (!isRecord(value)) throw invalidResponse();
  return {
    challengeId: recordText(value, "challengeId"),
    identifier: parseIdentifier(value.identifier),
    expiresAt: recordText(value, "expiresAt"),
  };
}

function parsePublicConfiguration(value: unknown): IdentityPublicConfiguration {
  if (!isRecord(value) || value.realm !== "global" || !Array.isArray(value.socialProviders)) {
    throw invalidResponse();
  }
  const socialProviders = value.socialProviders.filter(
    (provider): provider is "google" | "apple" => provider === "google" || provider === "apple",
  );
  if (socialProviders.length !== value.socialProviders.length) throw invalidResponse();
  return {
    realm: "global",
    requiredTermsVersion: recordText(value, "requiredTermsVersion"),
    socialProviders,
  };
}

function validatedCallbackBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OnlineAuthError("configuration_error", "Social callback URL is invalid.");
  }
  if (
    !url.protocol ||
    url.protocol === "http:" ||
    url.protocol === "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new OnlineAuthError("configuration_error", "Social callback must use the app's private URL scheme.");
  }
  return url;
}

function validatedCallbackResultUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OnlineAuthError("invalid_response", "Social login returned an invalid callback.");
  }
  if (!url.protocol || url.protocol === "http:" || url.protocol === "https:" || url.username || url.password || url.hash) {
    throw new OnlineAuthError("invalid_response", "Social login returned an invalid callback.");
  }
  return url;
}

function validatedHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidResponse();
  }
  if (url.protocol !== "https:" || url.username || url.password) throw invalidResponse();
  return url;
}

function sameCallbackTarget(actual: URL, expected: URL): boolean {
  return actual.protocol === expected.protocol &&
    actual.hostname === expected.hostname &&
    actual.port === expected.port &&
    actual.pathname === expected.pathname;
}

function parseSocialCallbackExchange(value: unknown): SocialCallbackExchange {
  if (!isRecord(value)) throw invalidResponse();
  return { sessionToken: recordText(value, "sessionToken") };
}

function parseLinkedIdentities(value: unknown): readonly LinkedIdentity[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((identity) => {
    if (!isRecord(identity)) throw invalidResponse();
    return {
      id: recordText(identity, "id"),
      providerId: recordText(identity, "providerId"),
      accountId: recordText(identity, "accountId"),
    };
  });
}

function parseAccountDeletion(value: unknown, requireReceipt: boolean): AccountDeletionProgress {
  if (!isRecord(value)) throw invalidResponse();
  const status = value.status;
  if (status !== "pending" && status !== "running" && status !== "retryable" && status !== "completed") {
    throw invalidResponse();
  }
  const deletionReceipt = typeof value.deletionReceipt === "string"
    ? requiredText(value.deletionReceipt)
    : undefined;
  if (requireReceipt && deletionReceipt === undefined) throw invalidResponse();
  const completedAt = value.completedAt === null ? null : requiredText(value.completedAt);
  const lastErrorCode = value.lastErrorCode === null ? null : requiredText(value.lastErrorCode);
  if (!Number.isSafeInteger(value.attempts) || (value.attempts as number) < 0) throw invalidResponse();
  return {
    id: recordText(value, "id"),
    ...(deletionReceipt === undefined ? {} : { deletionReceipt }),
    status,
    requestedAt: recordText(value, "requestedAt"),
    updatedAt: recordText(value, "updatedAt"),
    attempts: value.attempts as number,
    completedAt,
    lastErrorCode,
  };
}

function sessionAuthorization(sessionToken: string): Record<string, string> {
  return { authorization: `Bearer ${requiredText(sessionToken)}` };
}

function deletionRecoveryKey(value: string): string {
  const key = requiredText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(key)) throw invalidResponse();
  return key;
}

function parseRegistrationResult(value: unknown): RegistrationOtpResult {
  if (isRecord(value) && value.status === "authenticated") return parseAuthenticatedIdentity(value);
  if (!isRecord(value) || value.status !== "registration_required") throw invalidResponse();
  return {
    status: "registration_required",
    registrationId: recordText(value, "registrationId"),
    identifier: parseIdentifier(value.identifier),
    expiresAt: recordText(value, "expiresAt"),
  };
}

function parseAuthenticatedIdentity(value: unknown): AuthenticatedIdentity {
  if (!isRecord(value) || value.status !== "authenticated") throw invalidResponse();
  return {
    status: "authenticated",
    accountId: recordText(value, "accountId"),
    sessionId: recordText(value, "sessionId"),
    displayName: recordText(value, "displayName"),
    sessionToken: recordText(value, "sessionToken"),
    accessToken: recordText(value, "accessToken"),
    expiresAt: recordText(value, "expiresAt"),
  };
}

function parseIdentifier(value: unknown): IdentityIdentifier {
  if (!isRecord(value) || (value.kind !== "email" && value.kind !== "phone")) throw invalidResponse();
  return { kind: value.kind, value: recordText(value, "value") };
}

function recordText(value: Record<string, unknown>, key: string): string {
  return requiredText(value[key]);
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw invalidResponse();
  return value.trim();
}

function boundedText(value: unknown, maxLength: number): string {
  const text = requiredText(value);
  if (text.length > maxLength || /[\u0000-\u001F\u007F]/.test(text)) throw invalidResponse();
  return text;
}

function invalidResponse(): OnlineAuthError {
  return new OnlineAuthError("invalid_response", "MaxPower service returned an invalid authentication response.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidResponse();
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}
