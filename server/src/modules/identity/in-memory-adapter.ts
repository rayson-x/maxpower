import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { ApiError, conflict, notFound, unauthorized } from "../../kernel/api-error.js";
import { SystemClock, type Clock } from "../../kernel/clock.js";
import { randomId, type IdFactory } from "../../kernel/ids.js";
import type { AccountStatus, Principal } from "../../kernel/principal.js";
import {
  identityIdentifierKey,
  normalizeIdentityIdentifier,
} from "./normalization.js";
import { DEFAULT_IDENTITY_SCOPES } from "./model.js";
import type {
  AuthenticatedIdentity,
  CompleteRegistrationInput,
  IdentityIdentifier,
  IdentityModule,
  OtpChallengeStarted,
  RegistrationOtpResult,
} from "./model.js";

export const OTP_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
export const LOCAL_SERVICE_TOKEN_TTL_MS = 5 * 60 * 1_000;
const REGISTRATION_TICKET_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Fixed code for the in-memory adapter only. Never expose this adapter or code
 * in production; a production adapter must deliver unpredictable, rate-limited
 * OTPs through the configured provider.
 */
export const LOCAL_TEST_ONLY_DEBUG_OTP = "246810";

interface AccountRecord {
  id: string;
  displayName: string;
  password: PasswordRecord;
  termsVersion: string;
  identifier: IdentityIdentifier;
  status: AccountStatus;
  scopes: Set<string>;
  createdAt: string;
}

interface PasswordRecord {
  salt: string;
  digest: string;
}

interface OtpChallengeRecord {
  id: string;
  purpose: "registration" | "login";
  identifier: IdentityIdentifier;
  codeDigest: string;
  expiresAtMs: number;
  usedAt?: string;
}

interface RegistrationTicketRecord {
  id: string;
  identifier: IdentityIdentifier;
  expiresAtMs: number;
  usedAt?: string;
}

interface SessionRecord {
  id: string;
  accountId: string;
  expiresAtMs: number;
  revokedAt?: string;
}

interface AccessTokenRecord {
  sessionId: string;
  expiresAtMs: number;
}

export interface InMemoryIdentityAdapterOptions {
  clock?: Clock;
  idFactory?: IdFactory;
  defaultScopes?: readonly string[];
  sessionTtlMs?: number;
  /** Local/test override only. It must never be sourced from production config. */
  debugOtp?: string;
  requiredTermsVersion?: string;
}

/**
 * Local/test identity adapter. It is intentionally complete enough to exercise
 * the public identity interface, but is not a production credential store or
 * OTP delivery system.
 */
export class InMemoryIdentityAdapter implements IdentityModule {
  readonly #clock: Clock;
  readonly #idFactory: IdFactory;
  readonly #defaultScopes: readonly string[];
  readonly #sessionTtlMs: number;
  readonly #debugOtp: string;
  readonly #requiredTermsVersion: string;
  readonly #accounts = new Map<string, AccountRecord>();
  readonly #accountIdByIdentifier = new Map<string, string>();
  readonly #challenges = new Map<string, OtpChallengeRecord>();
  readonly #registrationTickets = new Map<string, RegistrationTicketRecord>();
  readonly #sessionsBySessionTokenDigest = new Map<string, SessionRecord>();
  readonly #sessionsById = new Map<string, SessionRecord>();
  readonly #accessTokensByDigest = new Map<string, AccessTokenRecord>();

  constructor(options: InMemoryIdentityAdapterOptions = {}) {
    this.#clock = options.clock ?? new SystemClock();
    this.#idFactory = options.idFactory ?? randomId;
    this.#defaultScopes = [...(options.defaultScopes ?? DEFAULT_IDENTITY_SCOPES)];
    this.#sessionTtlMs = positiveDuration(options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS);
    this.#debugOtp = validDebugOtp(options.debugOtp ?? LOCAL_TEST_ONLY_DEBUG_OTP);
    this.#requiredTermsVersion = requiredText(
      options.requiredTermsVersion ?? "terms-v1",
      "invalid_terms_configuration",
      "A required terms version must be configured.",
    );
  }

  async getPublicConfiguration() {
    return {
      realm: "global" as const,
      requiredTermsVersion: this.#requiredTermsVersion,
      socialProviders: ["google", "apple"] as const,
    };
  }

  async startRegistrationOtp(input: { identifier: IdentityIdentifier }): Promise<OtpChallengeStarted> {
    return this.#startOtp("registration", input.identifier);
  }

  async verifyRegistrationOtp(input: { challengeId: string; code: string }): Promise<RegistrationOtpResult> {
    const challenge = this.#consumeOtp(input.challengeId, "registration", input.code);
    const account = this.#accountFor(challenge.identifier);
    if (account) {
      return this.#createAuthenticatedIdentity(account);
    }

    const nowMs = this.#clock.now().getTime();
    const ticket: RegistrationTicketRecord = {
      id: this.#idFactory("registration"),
      identifier: challenge.identifier,
      expiresAtMs: nowMs + REGISTRATION_TICKET_TTL_MS,
    };
    this.#registrationTickets.set(ticket.id, ticket);
    return {
      status: "registration_required",
      registrationId: ticket.id,
      identifier: { ...ticket.identifier },
      expiresAt: new Date(ticket.expiresAtMs).toISOString(),
    };
  }

  async completeRegistration(input: CompleteRegistrationInput): Promise<AuthenticatedIdentity> {
    const registrationId = requiredText(input?.registrationId, "invalid_registration", "A verified registration is required.");
    const ticket = this.#registrationTickets.get(registrationId);
    if (!ticket) {
      throw new ApiError(400, "invalid_registration", "A verified registration is required.");
    }
    if (ticket.usedAt) {
      throw conflict("registration_used", "This verified registration has already been used.");
    }
    if (this.#clock.now().getTime() >= ticket.expiresAtMs) {
      throw new ApiError(410, "registration_expired", "The verified registration has expired.");
    }

    const displayName = validDisplayName(input.displayName);
    const password = validPassword(input.password);
    const termsVersion = requiredText(input.termsVersion, "terms_required", "A terms version is required.");
    if (termsVersion !== this.#requiredTermsVersion) {
      throw conflict("terms_version_outdated", "The current terms must be accepted before continuing.", {
        requiredTermsVersion: this.#requiredTermsVersion,
      });
    }
    if (this.#accountFor(ticket.identifier)) {
      throw conflict("identifier_already_registered", "This identifier already belongs to an account.");
    }

    const now = this.#clock.now();
    const account: AccountRecord = {
      id: this.#idFactory("account"),
      displayName,
      password: hashPassword(password),
      termsVersion,
      identifier: { ...ticket.identifier },
      status: "active",
      scopes: new Set(this.#defaultScopes),
      createdAt: now.toISOString(),
    };
    ticket.usedAt = now.toISOString();
    this.#accounts.set(account.id, account);
    this.#accountIdByIdentifier.set(identityIdentifierKey(account.identifier), account.id);
    return this.#createAuthenticatedIdentity(account);
  }

  async startLoginOtp(input: { identifier: IdentityIdentifier }): Promise<OtpChallengeStarted> {
    // Unknown identifiers receive the same challenge shape. Verification fails
    // generically and never creates an account, avoiding a start-time account
    // enumeration signal while keeping registration a separate operation.
    return this.#startOtp("login", input.identifier);
  }

  async verifyLoginOtp(input: { challengeId: string; code: string }): Promise<AuthenticatedIdentity> {
    const challenge = this.#consumeOtp(input.challengeId, "login", input.code);
    const account = this.#accountFor(challenge.identifier);
    if (!account) throw invalidCredentials();
    return this.#createAuthenticatedIdentity(account);
  }

  async loginWithPassword(input: { identifier: IdentityIdentifier; password: string }): Promise<AuthenticatedIdentity> {
    const identifier = normalizeIdentityIdentifier(input.identifier);
    const account = this.#accountFor(identifier);
    if (!account || typeof input.password !== "string" || !verifyPassword(input.password, account.password)) {
      throw invalidCredentials();
    }
    return this.#createAuthenticatedIdentity(account);
  }

  async refreshSession(sessionToken: string): Promise<AuthenticatedIdentity> {
    const normalized = sessionToken?.trim();
    if (!normalized) throw invalidSession();
    const session = this.#sessionsBySessionTokenDigest.get(digest(normalized));
    if (!this.#isLiveSession(session)) throw invalidSession();
    const account = this.#accounts.get(session.accountId);
    if (!account) throw invalidSession();
    return this.#issueAuthenticatedIdentity(account, session, normalized);
  }

  async completeSocialOnboarding(): Promise<AuthenticatedIdentity> {
    throw new ApiError(
      401,
      "invalid_social_session",
      "A verified Google or Apple session is required.",
    );
  }

  async verifyAccessToken(token: string): Promise<Principal> {
    const normalized = token?.trim();
    if (!normalized) throw unauthorized();
    const access = this.#accessTokensByDigest.get(digest(normalized));
    if (!access || this.#clock.now().getTime() >= access.expiresAtMs) {
      throw unauthorized("The access token is invalid or expired.");
    }
    const session = this.#sessionsById.get(access.sessionId);
    if (!this.#isLiveSession(session)) throw unauthorized("The access token is invalid or expired.");
    const account = this.#accounts.get(session.accountId);
    if (!account) throw unauthorized("The access token is invalid or expired.");
    return {
      accountId: account.id,
      sessionId: session.id,
      status: account.status,
      scopes: new Set(account.scopes),
    };
  }

  async signOut(accessToken: string): Promise<void> {
    const principal = await this.verifyAccessToken(accessToken);
    const session = this.#sessionsById.get(principal.sessionId);
    if (!session || session.id !== principal.sessionId) throw unauthorized();
    session.revokedAt = this.#clock.now().toISOString();
  }

  async signOutSession(sessionToken: string): Promise<void> {
    const normalized = sessionToken?.trim();
    if (!normalized) return;
    const session = this.#sessionsBySessionTokenDigest.get(digest(normalized));
    if (session) session.revokedAt = this.#clock.now().toISOString();
  }

  /** Local/test-only authorization mutation. This is not part of IdentityModule. */
  setAccountAuthorizationForLocalTest(input: {
    accountId: string;
    status?: AccountStatus;
    scopes?: readonly string[];
  }): void {
    const account = this.#accounts.get(input.accountId);
    if (!account) throw notFound("Account");
    if (input.status) account.status = input.status;
    if (input.scopes) account.scopes = new Set(input.scopes);
  }

  #startOtp(
    purpose: OtpChallengeRecord["purpose"],
    unnormalizedIdentifier: IdentityIdentifier,
  ): OtpChallengeStarted {
    const identifier = normalizeIdentityIdentifier(unnormalizedIdentifier);
    const nowMs = this.#clock.now().getTime();
    const challenge: OtpChallengeRecord = {
      id: this.#idFactory("otp"),
      purpose,
      identifier,
      codeDigest: digest(this.#debugOtp),
      expiresAtMs: nowMs + OTP_CHALLENGE_TTL_MS,
    };
    this.#challenges.set(challenge.id, challenge);
    return {
      challengeId: challenge.id,
      identifier: { ...identifier },
      expiresAt: new Date(challenge.expiresAtMs).toISOString(),
    };
  }

  #consumeOtp(
    challengeIdInput: string,
    purpose: OtpChallengeRecord["purpose"],
    codeInput: string,
  ): OtpChallengeRecord {
    const challengeId = requiredText(challengeIdInput, "invalid_otp_challenge", "The OTP challenge is invalid.");
    const challenge = this.#challenges.get(challengeId);
    if (!challenge || challenge.purpose !== purpose) {
      throw new ApiError(400, "invalid_otp_challenge", "The OTP challenge is invalid.");
    }
    if (challenge.usedAt) {
      throw conflict("otp_challenge_used", "The OTP challenge has already been used.");
    }
    if (this.#clock.now().getTime() >= challenge.expiresAtMs) {
      throw new ApiError(410, "otp_challenge_expired", "The OTP challenge has expired.");
    }
    const code = typeof codeInput === "string" ? codeInput.trim() : "";
    if (!safeDigestEqual(digest(code), challenge.codeDigest)) {
      throw new ApiError(401, "invalid_otp", "The OTP code is invalid.");
    }
    challenge.usedAt = this.#clock.now().toISOString();
    return challenge;
  }

  #accountFor(identifier: IdentityIdentifier): AccountRecord | undefined {
    const accountId = this.#accountIdByIdentifier.get(identityIdentifierKey(identifier));
    return accountId ? this.#accounts.get(accountId) : undefined;
  }

  #createAuthenticatedIdentity(account: AccountRecord): AuthenticatedIdentity {
    const nowMs = this.#clock.now().getTime();
    const sessionToken = randomBytes(32).toString("base64url");
    const session: SessionRecord = {
      id: this.#idFactory("session"),
      accountId: account.id,
      expiresAtMs: nowMs + this.#sessionTtlMs,
    };
    this.#sessionsBySessionTokenDigest.set(digest(sessionToken), session);
    this.#sessionsById.set(session.id, session);
    return this.#issueAuthenticatedIdentity(account, session, sessionToken);
  }

  #issueAuthenticatedIdentity(
    account: AccountRecord,
    session: SessionRecord,
    sessionToken: string,
  ): AuthenticatedIdentity {
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAtMs = Math.min(
      session.expiresAtMs,
      this.#clock.now().getTime() + LOCAL_SERVICE_TOKEN_TTL_MS,
    );
    this.#accessTokensByDigest.set(digest(accessToken), {
      sessionId: session.id,
      expiresAtMs,
    });
    return {
      status: "authenticated",
      accountId: account.id,
      sessionId: session.id,
      displayName: account.displayName,
      sessionToken,
      accessToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  #isLiveSession(session: SessionRecord | undefined): session is SessionRecord {
    return Boolean(
      session &&
      !session.revokedAt &&
      this.#clock.now().getTime() < session.expiresAtMs,
    );
  }
}

function hashPassword(password: string): PasswordRecord {
  const salt = randomBytes(16).toString("base64url");
  return {
    salt,
    digest: scryptSync(password, salt, 32).toString("base64url"),
  };
}

function verifyPassword(password: string, record: PasswordRecord): boolean {
  const candidate = scryptSync(password, record.salt, 32);
  const expected = Buffer.from(record.digest, "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function validDebugOtp(value: string): string {
  const normalized = value.trim();
  if (!/^\d{4,10}$/.test(normalized)) {
    throw new Error("The local/test debug OTP must contain 4-10 digits.");
  }
  return normalized;
}

function validDisplayName(value: string): string {
  const normalized = requiredText(value, "display_name_required", "A display name is required.");
  if (normalized.length > 80 || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new ApiError(400, "invalid_display_name", "The display name is invalid.");
  }
  return normalized;
}

function validPassword(value: string): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new ApiError(400, "invalid_password", "The password must contain 8-256 printable characters.");
  }
  return value;
}

function requiredText(value: string, code: string, message: string): string {
  if (typeof value !== "string") throw new ApiError(400, code, message);
  const normalized = value.trim();
  if (!normalized) throw new ApiError(400, code, message);
  return normalized;
}

function positiveDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Session TTL must be a positive integer.");
  }
  return value;
}

function invalidCredentials(): ApiError {
  return new ApiError(401, "invalid_credentials", "The credentials are invalid.");
}

function invalidSession(): ApiError {
  return new ApiError(401, "invalid_session", "The session is invalid or expired.");
}
