import { ApiError, conflict } from "../../kernel/api-error.js";
import { SystemClock, type Clock } from "../../kernel/clock.js";
import { randomId, type IdFactory } from "../../kernel/ids.js";
import type { AccountStatus, Principal } from "../../kernel/principal.js";
import {
  DEFAULT_IDENTITY_SCOPES,
  type AuthenticatedIdentity,
  type CompleteRegistrationInput,
  type CompleteSocialOnboardingInput,
  type IdentityIdentifier,
  type IdentityModule,
  type OtpChallengeStarted,
  type RegistrationOtpResult,
} from "../../modules/identity/model.js";
import { normalizeIdentityIdentifier } from "../../modules/identity/normalization.js";

const FLOW_TTL_MS = 5 * 60 * 1_000;

export interface BetterAuthAccount {
  accountId: string;
  displayName: string;
  registrationComplete: boolean;
  status: AccountStatus;
  scopes: ReadonlySet<string>;
}

export interface BetterAuthRuntimeSession {
  account: BetterAuthAccount;
  sessionId: string;
  /** Opaque session credential; never use it as a service-API access token. */
  sessionToken: string;
}

/** Narrow runtime port implemented by the pinned Better Auth integration. */
export interface BetterAuthIdentityRuntime {
  findAccount(identifier: IdentityIdentifier): Promise<BetterAuthAccount | null>;
  sendOtp(identifier: IdentityIdentifier): Promise<void>;
  verifyOtp(input: {
    identifier: IdentityIdentifier;
    code: string;
    allowCreate: boolean;
  }): Promise<BetterAuthRuntimeSession>;
  completeRegistration(input: {
    accountId: string;
    sessionToken: string;
    displayName: string;
    password: string;
    termsVersion: string;
    scopes: readonly string[];
  }): Promise<BetterAuthRuntimeSession>;
  loginWithPassword(input: {
    identifier: IdentityIdentifier;
    password: string;
  }): Promise<BetterAuthRuntimeSession>;
  findSessionByToken(sessionToken: string): Promise<BetterAuthRuntimeSession | null>;
  completeSocialOnboarding(input: {
    sessionToken: string;
    displayName: string;
    termsVersion: string;
    scopes: readonly string[];
  }): Promise<BetterAuthRuntimeSession>;
  issueServiceToken(session: BetterAuthRuntimeSession): Promise<{
    token: string;
    expiresAt: string;
  }>;
  revokeSession(input: { accountId: string; sessionId: string }): Promise<void>;
}

export interface AuthFlowChallenge {
  id: string;
  purpose: "registration" | "login";
  identifier: IdentityIdentifier;
  accountKnown: boolean;
  expiresAt: string;
}

export interface AuthFlowRegistration {
  id: string;
  accountId: string;
  identifier: IdentityIdentifier;
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
}

/** Cluster-safe challenge/ticket store; production uses Better Auth verification rows. */
export interface AuthFlowStore {
  saveChallenge(challenge: AuthFlowChallenge): Promise<void>;
  findChallenge(id: string): Promise<AuthFlowChallenge | null>;
  consumeChallenge(id: string): Promise<boolean>;
  saveRegistration(registration: AuthFlowRegistration): Promise<void>;
  consumeRegistration(id: string): Promise<AuthFlowRegistration | "used" | null>;
}

export interface IdentityAccessTokenVerifier {
  verifyAccessToken(token: string): Promise<Principal>;
}

export interface BetterAuthIdentityAdapterOptions {
  runtime: BetterAuthIdentityRuntime;
  flows: AuthFlowStore;
  tokens: IdentityAccessTokenVerifier;
  clock?: Clock;
  idFactory?: IdFactory;
  requiredTermsVersion: string;
}

/**
 * Production IdentityModule. It preserves the V1 registration/login contract
 * while hiding Better Auth sessions, plugins and service-token minting.
 */
export class BetterAuthIdentityAdapter implements IdentityModule {
  readonly #runtime: BetterAuthIdentityRuntime;
  readonly #flows: AuthFlowStore;
  readonly #tokens: IdentityAccessTokenVerifier;
  readonly #clock: Clock;
  readonly #idFactory: IdFactory;
  readonly #requiredTermsVersion: string;

  constructor(options: BetterAuthIdentityAdapterOptions) {
    this.#runtime = options.runtime;
    this.#flows = options.flows;
    this.#tokens = options.tokens;
    this.#clock = options.clock ?? new SystemClock();
    this.#idFactory = options.idFactory ?? randomId;
    this.#requiredTermsVersion = requiredText(
      options.requiredTermsVersion,
      "invalid_terms_configuration",
      "A required terms version must be configured.",
    );
  }

  async startRegistrationOtp(input: {
    identifier: IdentityIdentifier;
  }): Promise<OtpChallengeStarted> {
    return this.#startOtp("registration", input.identifier);
  }

  async getPublicConfiguration() {
    return {
      realm: "global" as const,
      requiredTermsVersion: this.#requiredTermsVersion,
      socialProviders: ["google", "apple"] as const,
    };
  }

  async verifyRegistrationOtp(input: {
    challengeId: string;
    code: string;
  }): Promise<RegistrationOtpResult> {
    const challenge = await this.#validChallenge(input.challengeId, "registration");
    const session = await this.#runtime.verifyOtp({
      identifier: challenge.identifier,
      code: input.code,
      allowCreate: true,
    });
    await this.#consumeChallenge(challenge.id);

    if (session.account.registrationComplete) {
      return this.#authenticated(session);
    }

    const expiresAt = new Date(this.#clock.now().getTime() + FLOW_TTL_MS).toISOString();
    const registration: AuthFlowRegistration = {
      id: this.#idFactory("registration"),
      accountId: session.account.accountId,
      identifier: { ...challenge.identifier },
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      expiresAt,
    };
    await this.#flows.saveRegistration(registration);
    return {
      status: "registration_required",
      registrationId: registration.id,
      identifier: { ...registration.identifier },
      expiresAt,
    };
  }

  async completeRegistration(input: CompleteRegistrationInput): Promise<AuthenticatedIdentity> {
    const registrationId = requiredText(
      input?.registrationId,
      "invalid_registration",
      "A verified registration is required.",
    );
    const displayName = validDisplayName(input.displayName);
    const password = validPassword(input.password);
    const termsVersion = requiredText(
      input.termsVersion,
      "terms_required",
      "A terms version is required.",
    );
    this.#assertCurrentTerms(termsVersion);

    const registration = await this.#flows.consumeRegistration(registrationId);
    if (registration === "used") {
      throw conflict("registration_used", "This verified registration has already been used.");
    }
    if (!registration) {
      throw new ApiError(400, "invalid_registration", "A verified registration is required.");
    }
    if (this.#clock.now().getTime() >= Date.parse(registration.expiresAt)) {
      throw new ApiError(410, "registration_expired", "The verified registration has expired.");
    }

    const session = await this.#runtime.completeRegistration({
      accountId: registration.accountId,
      sessionToken: registration.sessionToken,
      displayName,
      password,
      termsVersion,
      scopes: DEFAULT_IDENTITY_SCOPES,
    });
    if (session.account.accountId !== registration.accountId) {
      throw new ApiError(401, "invalid_registration", "The verified registration is invalid.");
    }
    return this.#authenticated(session);
  }

  async startLoginOtp(input: {
    identifier: IdentityIdentifier;
  }): Promise<OtpChallengeStarted> {
    return this.#startOtp("login", input.identifier);
  }

  async verifyLoginOtp(input: {
    challengeId: string;
    code: string;
  }): Promise<AuthenticatedIdentity> {
    const challenge = await this.#validChallenge(input.challengeId, "login");
    if (!challenge.accountKnown) {
      await this.#consumeChallenge(challenge.id);
      throw invalidCredentials();
    }
    const session = await this.#runtime.verifyOtp({
      identifier: challenge.identifier,
      code: input.code,
      allowCreate: false,
    });
    await this.#consumeChallenge(challenge.id);
    if (!session.account.registrationComplete) {
      await this.#runtime.revokeSession({
        accountId: session.account.accountId,
        sessionId: session.sessionId,
      });
      throw invalidCredentials();
    }
    return this.#authenticated(session);
  }

  async loginWithPassword(input: {
    identifier: IdentityIdentifier;
    password: string;
  }): Promise<AuthenticatedIdentity> {
    const identifier = normalizeIdentityIdentifier(input.identifier);
    const session = await this.#runtime.loginWithPassword({
      identifier,
      password: typeof input.password === "string" ? input.password : "",
    });
    if (!session.account.registrationComplete) {
      await this.#runtime.revokeSession({
        accountId: session.account.accountId,
        sessionId: session.sessionId,
      });
      throw invalidCredentials();
    }
    return this.#authenticated(session);
  }

  async refreshSession(sessionTokenInput: string): Promise<AuthenticatedIdentity> {
    const sessionToken = requiredText(
      sessionTokenInput,
      "invalid_session",
      "The session is invalid or expired.",
    );
    const session = await this.#runtime.findSessionByToken(sessionToken);
    if (!session || !session.account.registrationComplete) throw invalidSession();
    if (session.account.status !== "active") {
      throw new ApiError(403, "account_unavailable", "The account is not available.");
    }
    return this.#authenticated(session);
  }

  async completeSocialOnboarding(
    input: CompleteSocialOnboardingInput,
  ): Promise<AuthenticatedIdentity> {
    const termsVersion = requiredText(
      input.termsVersion,
      "terms_required",
      "A terms version is required.",
    );
    this.#assertCurrentTerms(termsVersion);
    const session = await this.#runtime.completeSocialOnboarding({
      sessionToken: requiredText(
        input?.sessionToken,
        "invalid_social_session",
        "A verified Google or Apple session is required.",
      ),
      displayName: validDisplayName(input.displayName),
      termsVersion,
      scopes: DEFAULT_IDENTITY_SCOPES,
    });
    if (!session.account.registrationComplete || session.account.status !== "active") {
      throw new ApiError(401, "invalid_social_session", "Social onboarding failed.");
    }
    return this.#authenticated(session);
  }

  #assertCurrentTerms(value: string): void {
    if (value !== this.#requiredTermsVersion) {
      throw new ApiError(
        409,
        "terms_version_outdated",
        "The current terms must be accepted before continuing.",
        { requiredTermsVersion: this.#requiredTermsVersion },
      );
    }
  }

  verifyAccessToken(token: string): Promise<Principal> {
    return this.#tokens.verifyAccessToken(token);
  }

  async signOut(accessToken: string): Promise<void> {
    const principal = await this.#tokens.verifyAccessToken(accessToken);
    await this.#runtime.revokeSession({
      accountId: principal.accountId,
      sessionId: principal.sessionId,
    });
  }

  async signOutSession(sessionToken: string): Promise<void> {
    const normalized = requiredText(
      sessionToken,
      "invalid_session",
      "The session is invalid or expired.",
    );
    const session = await this.#runtime.findSessionByToken(normalized);
    if (!session) return;
    await this.#runtime.revokeSession({
      accountId: session.account.accountId,
      sessionId: session.sessionId,
    });
  }

  async #startOtp(
    purpose: AuthFlowChallenge["purpose"],
    input: IdentityIdentifier,
  ): Promise<OtpChallengeStarted> {
    const identifier = normalizeIdentityIdentifier(input);
    const accountKnown = Boolean(await this.#runtime.findAccount(identifier));
    const challenge: AuthFlowChallenge = {
      id: this.#idFactory("otp"),
      purpose,
      identifier,
      accountKnown,
      expiresAt: new Date(this.#clock.now().getTime() + FLOW_TTL_MS).toISOString(),
    };
    await this.#flows.saveChallenge(challenge);
    if (purpose === "registration" || accountKnown) {
      await this.#runtime.sendOtp(identifier);
    }
    return {
      challengeId: challenge.id,
      identifier: { ...identifier },
      expiresAt: challenge.expiresAt,
    };
  }

  async #validChallenge(
    idInput: string,
    purpose: AuthFlowChallenge["purpose"],
  ): Promise<AuthFlowChallenge> {
    const id = requiredText(
      idInput,
      "invalid_otp_challenge",
      "The OTP challenge is invalid.",
    );
    const challenge = await this.#flows.findChallenge(id);
    if (!challenge || challenge.purpose !== purpose) {
      throw new ApiError(400, "invalid_otp_challenge", "The OTP challenge is invalid.");
    }
    if (this.#clock.now().getTime() >= Date.parse(challenge.expiresAt)) {
      await this.#flows.consumeChallenge(challenge.id);
      throw new ApiError(410, "otp_challenge_expired", "The OTP challenge has expired.");
    }
    return challenge;
  }

  async #consumeChallenge(id: string): Promise<void> {
    if (!await this.#flows.consumeChallenge(id)) {
      throw conflict("otp_challenge_used", "The OTP challenge has already been used.");
    }
  }

  async #authenticated(session: BetterAuthRuntimeSession): Promise<AuthenticatedIdentity> {
    const issued = await this.#runtime.issueServiceToken(session);
    return {
      status: "authenticated",
      accountId: session.account.accountId,
      sessionId: session.sessionId,
      displayName: session.account.displayName,
      sessionToken: session.sessionToken,
      accessToken: issued.token,
      expiresAt: issued.expiresAt,
    };
  }
}

function validDisplayName(value: string): string {
  const normalized = requiredText(
    value,
    "display_name_required",
    "A display name is required.",
  );
  if (normalized.length > 80 || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new ApiError(400, "invalid_display_name", "The display name is invalid.");
  }
  return normalized;
}

function validPassword(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 256 ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new ApiError(
      400,
      "invalid_password",
      "The password must contain 8-256 printable characters.",
    );
  }
  return value;
}

function requiredText(value: string, code: string, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, code, message);
  }
  return value.trim();
}

function invalidCredentials(): ApiError {
  return new ApiError(401, "invalid_credentials", "The credentials are invalid.");
}

function invalidSession(): ApiError {
  return new ApiError(401, "invalid_session", "The session is invalid or expired.");
}
