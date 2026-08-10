import type { Principal } from "../../kernel/principal.js";

export const DEFAULT_IDENTITY_SCOPES = [
  "account:read",
  "account:delete",
  "data:read",
  "data:write",
  "media:read",
  "media:write",
  "llm:invoke",
] as const;

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

export interface AuthenticatedIdentity {
  status: "authenticated";
  accountId: string;
  sessionId: string;
  displayName: string;
  /** Opaque, long-lived session credential. Persist only in platform secure storage. */
  sessionToken: string;
  /** Short-lived service JWT. Keep in memory and replace through refreshSession. */
  accessToken: string;
  expiresAt: string;
}

export interface RegistrationRequired {
  status: "registration_required";
  registrationId: string;
  identifier: IdentityIdentifier;
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
  socialProviders: readonly ["google", "apple"];
}

export type SocialAuthProvider = "google" | "apple";

export interface StartSocialAuthInput {
  provider: SocialAuthProvider;
  callbackUrl: string;
  /** Per-install 32-byte random value. The production adapter persists only its digest. */
  deviceBinding: string;
}

export interface ExchangeSocialAuthInput {
  code: string;
  state: string;
  callbackUrl: string;
  deviceBinding: string;
}

/** Stable MaxPower OAuth handoff; Provider and Better Auth details stay behind it. */
export interface SocialAuthFlow {
  start(input: StartSocialAuthInput): Promise<{
    authorizationUrl: string;
    exchangeState: string;
  }>;
  exchange(input: ExchangeSocialAuthInput): Promise<{ sessionToken: string }>;
  /** Browser-only HTTPS landing point. Never accepts deviceBinding or emits a session token. */
  handleBrowserHandoff(request: Request): Promise<Response>;
  /** Browser-only failure landing point; consumes the flow and redirects with only error + state. */
  handleBrowserError(request: Request): Promise<Response>;
}

/**
 * The identity seam used by application modules and tests. Provider SDKs,
 * OTP delivery, credential hashing and token formats stay behind this small
 * interface. A future Better Auth/JWKS adapter can replace the in-memory one
 * without changing callers that only verify access tokens.
 */
export interface IdentityModule {
  getPublicConfiguration(): Promise<IdentityPublicConfiguration>;
  startRegistrationOtp(input: { identifier: IdentityIdentifier }): Promise<OtpChallengeStarted>;
  verifyRegistrationOtp(input: { challengeId: string; code: string }): Promise<RegistrationOtpResult>;
  completeRegistration(input: CompleteRegistrationInput): Promise<AuthenticatedIdentity>;

  startLoginOtp(input: { identifier: IdentityIdentifier }): Promise<OtpChallengeStarted>;
  verifyLoginOtp(input: { challengeId: string; code: string }): Promise<AuthenticatedIdentity>;
  loginWithPassword(input: { identifier: IdentityIdentifier; password: string }): Promise<AuthenticatedIdentity>;
  completeSocialOnboarding(input: CompleteSocialOnboardingInput): Promise<AuthenticatedIdentity>;

  refreshSession(sessionToken: string): Promise<AuthenticatedIdentity>;

  verifyAccessToken(token: string): Promise<Principal>;
  signOut(accessToken: string): Promise<void>;
  /** Idempotently revoke the opaque refresh/session credential, even after its service JWT expires. */
  signOutSession(sessionToken: string): Promise<void>;
}
