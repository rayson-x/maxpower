export type IdentityChannel = "email" | "phone";

export interface IdentityIdentifier {
  kind: IdentityChannel;
  value: string;
}

export interface OtpChallengeStarted {
  challengeId: string;
  identifier: IdentityIdentifier;
  expiresAt: string;
}

export interface RegistrationRequired {
  status: "registration_required";
  registrationId: string;
  identifier: IdentityIdentifier;
  expiresAt: string;
}

export interface AuthenticatedIdentity {
  status: "authenticated";
  accountId: string;
  sessionId: string;
  displayName: string;
  /** Opaque Better Auth session credential. This is the only persisted token. */
  sessionToken: string;
  /** Five-minute MaxPower service JWT. It must remain in memory. */
  accessToken: string;
  expiresAt: string;
}

export type RegistrationOtpResult = AuthenticatedIdentity | RegistrationRequired;

export interface CompleteRegistrationInput {
  registrationId: string;
  displayName: string;
  password: string;
  termsVersion: string;
}

export interface CompleteSocialOnboardingInput {
  sessionToken: string;
  displayName: string;
  termsVersion: string;
}

export interface IdentityPublicConfiguration {
  realm: "global";
  requiredTermsVersion: string;
  socialProviders: readonly SocialProvider[];
}

export type SocialProvider = "google" | "apple";

export interface SocialSignInStarted {
  authorizationUrl: string;
  /** Browser transaction binding; held only in memory until callback exchange. */
  exchangeState: string;
}

export interface SocialCallbackExchange {
  sessionToken: string;
}

export interface LinkedIdentity {
  id: string;
  providerId: string;
  accountId: string;
}

export interface SocialIdentityLinkStarted {
  authorizationUrl: string;
}

export type AccountDeletionStatus = "pending" | "running" | "retryable" | "completed";

export interface AccountDeletionProgress {
  id: string;
  deletionReceipt?: string;
  status: AccountDeletionStatus;
  requestedAt: string;
  updatedAt: string;
  attempts: number;
  completedAt: string | null;
  lastErrorCode: string | null;
}

export interface AccountDeletionRecovery {
  requestKey: string;
  receipt: string | null;
}

export type SocialAuthorizationResult =
  | { status: "success"; callbackUrl: string }
  | { status: "cancelled" };

/** Injectable system-browser/deep-link boundary; it never sees service JWTs. */
export interface SocialAuthorizationPort {
  readonly callbackUrl: string;
  availableProviders(): readonly SocialProvider[];
  authorize(input: { authorizationUrl: string; signal?: AbortSignal }): Promise<SocialAuthorizationResult>;
}

export type SocialSignInResult =
  | { status: "authenticated" }
  | { status: "onboarding_required"; sessionToken: string }
  | { status: "cancelled" };

export interface SessionCredential {
  accountId: string;
  sessionToken: string;
}

export interface ServiceAccessToken {
  accountId: string;
  sessionId: string;
  accessToken: string;
  expiresAt: string;
}

export interface ReachabilityPort {
  assertReachable(signal?: AbortSignal): Promise<void>;
}

/** Stable app-facing identity API; no Better Auth SDK type crosses this seam. */
export interface OnlineAuthApi {
  getPublicConfiguration(signal?: AbortSignal): Promise<IdentityPublicConfiguration>;
  startSocialSignIn(
    input: { provider: SocialProvider; callbackUrl: string },
    signal?: AbortSignal,
  ): Promise<SocialSignInStarted>;
  exchangeSocialCallback(
    input: {
      callbackUrl: string;
      expectedCallbackUrl: string;
      expectedExchangeState: string;
    },
    signal?: AbortSignal,
  ): Promise<SocialCallbackExchange>;
  startRegistrationOtp(input: { identifier: IdentityIdentifier }, signal?: AbortSignal): Promise<OtpChallengeStarted>;
  verifyRegistrationOtp(input: { challengeId: string; code: string }, signal?: AbortSignal): Promise<RegistrationOtpResult>;
  completeRegistration(input: CompleteRegistrationInput, signal?: AbortSignal): Promise<AuthenticatedIdentity>;
  startLoginOtp(input: { identifier: IdentityIdentifier }, signal?: AbortSignal): Promise<OtpChallengeStarted>;
  verifyLoginOtp(input: { challengeId: string; code: string }, signal?: AbortSignal): Promise<AuthenticatedIdentity>;
  loginWithPassword(input: { identifier: IdentityIdentifier; password: string }, signal?: AbortSignal): Promise<AuthenticatedIdentity>;
  refreshSession(sessionToken: string, signal?: AbortSignal): Promise<AuthenticatedIdentity>;
  completeSocialOnboarding(input: CompleteSocialOnboardingInput, signal?: AbortSignal): Promise<AuthenticatedIdentity>;
  listLinkedIdentities(sessionToken: string, signal?: AbortSignal): Promise<readonly LinkedIdentity[]>;
  startSocialIdentityLink(
    input: { sessionToken: string; provider: SocialProvider; callbackUrl: string },
    signal?: AbortSignal,
  ): Promise<SocialIdentityLinkStarted>;
  unlinkIdentity(
    input: { sessionToken: string; providerId: string; accountId?: string },
    signal?: AbortSignal,
  ): Promise<void>;
  requestAccountDeletion(
    input: { accessToken?: string; idempotencyKey: string },
    signal?: AbortSignal,
  ): Promise<AccountDeletionProgress>;
  getAccountDeletion(receipt: string, signal?: AbortSignal): Promise<AccountDeletionProgress>;
  signOut(sessionToken: string, signal?: AbortSignal): Promise<void>;
}

export type OnlineAuthErrorCode =
  | "configuration_error"
  | "network_unavailable"
  | "request_aborted"
  | "not_authenticated"
  | "account_mismatch"
  | "invalid_response"
  | "secure_storage_unavailable"
  | "request_failed";

export class OnlineAuthError extends Error {
  constructor(
    readonly code: OnlineAuthErrorCode,
    message = `online_auth_${code}`,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OnlineAuthError";
  }
}

export interface AccountRuntime {
  accountId: string;
  dispose(): Promise<void> | void;
}

export interface AccountRuntimeCreateInput {
  accountId: string;
  /** Reads the current short-lived JWT; callers must not capture its value. */
  accessToken(): string;
  signal: AbortSignal;
}

export interface AccountRuntimeFactory<TRuntime extends AccountRuntime = AccountRuntime> {
  create(input: AccountRuntimeCreateInput): Promise<TRuntime>;
}

export function availableSocialProviders(
  platform: "ios" | "android" | "web" | string,
  googleEnabled: boolean,
): readonly SocialProvider[] {
  if (platform === "ios") return googleEnabled ? ["google", "apple"] : ["apple"];
  if (platform === "android") return googleEnabled ? ["google"] : [];
  return [];
}

export type OnlineAuthState<TRuntime extends AccountRuntime = AccountRuntime> =
  | { status: "checking" }
  | { status: "authenticating" }
  | { status: "signed_out"; error?: OnlineAuthError }
  | { status: "offline"; error: OnlineAuthError }
  | { status: "error"; error: OnlineAuthError }
  | { status: "deleting"; deletion: AccountDeletionProgress; recovery: AccountDeletionRecovery }
  | { status: "authenticated"; identity: AuthenticatedIdentity; runtime: TRuntime };
