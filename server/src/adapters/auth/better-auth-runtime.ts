import { decodeJwt } from "jose";

import { ApiError } from "../../kernel/api-error.js";
import type { AccountStatus } from "../../kernel/principal.js";
import type {
  IdentityModule,
  IdentityIdentifier,
  SocialAuthFlow,
} from "../../modules/identity/model.js";
import {
  BetterAuthIdentityAdapter,
  type AuthFlowChallenge,
  type AuthFlowRegistration,
  type AuthFlowStore,
  type BetterAuthAccount,
  type BetterAuthIdentityRuntime,
  type BetterAuthRuntimeSession,
} from "./better-auth-identity-adapter.js";
import {
  createProductionBetterAuth,
  createReviewedBetterAuthHandler,
  createServiceJwtPayload,
  type ProductionBetterAuthConfig,
  type ProductionOtpDelivery,
} from "./production-auth.js";
import {
  LiveSessionAccessTokenVerifier,
  type LiveIdentitySession,
  type LiveIdentitySessionStore,
} from "./live-session-access-token-verifier.js";
import { BetterAuthServiceJwtVerifier } from "./service-jwt-verifier.js";
import {
  BetterAuthSocialAuthFlow,
  BetterAuthSocialBridgeAdapter,
  BetterAuthVerificationSocialAuthStateStore,
} from "./better-auth-social-flow.js";

export type ProductionBetterAuth = ReturnType<typeof createProductionBetterAuth>;

interface BetterAuthUserRecord {
  id: string;
  name: string;
  email: string;
  accountStatus?: unknown;
  scopes?: unknown;
  registrationComplete?: unknown;
  phoneNumber?: unknown;
}

interface BetterAuthSessionRecord {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date | string;
}

/** Concrete operations over the pinned Better Auth server instance. */
export class BetterAuthRuntime implements BetterAuthIdentityRuntime {
  readonly #auth: ProductionBetterAuth;
  readonly #otpDelivery: ProductionOtpDelivery;

  constructor(auth: ProductionBetterAuth, otpDelivery: ProductionOtpDelivery) {
    this.#auth = auth;
    this.#otpDelivery = otpDelivery;
  }

  async findAccount(identifier: IdentityIdentifier): Promise<BetterAuthAccount | null> {
    const context = await this.#auth.$context;
    if (identifier.kind === "email") {
      const result = await context.internalAdapter.findUserByEmail(identifier.value);
      return result ? mapAccount(result.user) : null;
    }
    const user = await context.adapter.findOne<BetterAuthUserRecord>({
      model: "user",
      where: [{ field: "phoneNumber", value: identifier.value }],
    });
    return user ? mapAccount(user) : null;
  }

  async sendOtp(identifier: IdentityIdentifier): Promise<void> {
    try {
      if (identifier.kind === "email") {
        const code = await this.#auth.api.createVerificationOTP({
          body: { email: identifier.value, type: "sign-in" },
        });
        await this.#otpDelivery.sendEmailOtp({
          email: identifier.value,
          code,
          purpose: "sign-in",
        });
        return;
      }
      await this.#auth.api.sendPhoneNumberOTP({
        body: { phoneNumber: identifier.value },
      });
    } catch {
      throw new ApiError(
        503,
        "otp_delivery_unavailable",
        "The verification code could not be delivered.",
      );
    }
  }

  async verifyOtp(input: {
    identifier: IdentityIdentifier;
    code: string;
    allowCreate: boolean;
  }): Promise<BetterAuthRuntimeSession> {
    try {
      if (input.identifier.kind === "email") {
        let account = await this.findAccount(input.identifier);
        if (!account && !input.allowCreate) throw invalidCredentials();
        if (!account) {
          await this.#proveUnknownEmailOtp(input.identifier.value, input.code);
          await this.#createPendingEmailUser(input.identifier.value);
          account = await this.findAccount(input.identifier);
          if (!account) throw new Error("Pending Better Auth user was not created.");
        }
        const result = await this.#auth.api.signInEmailOTP({
          body: { email: input.identifier.value, otp: input.code },
        });
        return this.#sessionFromToken(result.token);
      }

      const existing = await this.findAccount(input.identifier);
      if (!existing && !input.allowCreate) throw invalidCredentials();
      const result = await this.#auth.api.verifyPhoneNumber({
        body: {
          phoneNumber: input.identifier.value,
          code: input.code,
          disableSession: false,
        },
      });
      if (!result.token) throw new Error("Better Auth did not create a phone session.");
      return this.#sessionFromToken(result.token);
    } catch (error) {
      if (error instanceof ApiError && error.code === "invalid_credentials") throw error;
      throw new ApiError(401, "invalid_otp", "The verification code is invalid or expired.");
    }
  }

  async completeRegistration(input: {
    accountId: string;
    sessionToken: string;
    displayName: string;
    password: string;
    termsVersion: string;
    scopes: readonly string[];
  }): Promise<BetterAuthRuntimeSession> {
    const context = await this.#auth.$context;
    const current = await context.internalAdapter.findSession(input.sessionToken);
    if (!current || current.user.id !== input.accountId) {
      throw new ApiError(401, "invalid_registration", "The verified registration is invalid.");
    }

    const passwordHash = await context.password.hash(input.password);
    const accounts = await context.internalAdapter.findAccounts(input.accountId);
    const credential = accounts.find((account) => account.providerId === "credential");
    if (credential) {
      await context.internalAdapter.updatePassword(input.accountId, passwordHash);
    } else {
      await context.internalAdapter.createAccount({
        userId: input.accountId,
        providerId: "credential",
        accountId: input.accountId,
        password: passwordHash,
      });
    }

    const user = await context.internalAdapter.updateUser<BetterAuthUserRecord>(
      input.accountId,
      {
        name: input.displayName,
        accountStatus: "active",
        scopes: [...new Set(input.scopes)].join(" "),
        termsVersion: input.termsVersion,
        registrationComplete: true,
      },
    );
    return {
      account: mapAccount(user),
      sessionId: current.session.id,
      sessionToken: current.session.token,
    };
  }

  async loginWithPassword(input: {
    identifier: IdentityIdentifier;
    password: string;
  }): Promise<BetterAuthRuntimeSession> {
    try {
      const result = input.identifier.kind === "email"
        ? await this.#auth.api.signInEmail({
            body: {
              email: input.identifier.value,
              password: input.password,
              rememberMe: true,
            },
          })
        : await this.#auth.api.signInPhoneNumber({
            body: {
              phoneNumber: input.identifier.value,
              password: input.password,
              rememberMe: true,
            },
          });
      return this.#sessionFromToken(result.token);
    } catch {
      throw invalidCredentials();
    }
  }

  async findSessionByToken(sessionToken: string): Promise<BetterAuthRuntimeSession | null> {
    const context = await this.#auth.$context;
    const result = await context.internalAdapter.findSession(sessionToken);
    if (!result || result.session.expiresAt.getTime() <= Date.now()) return null;
    return {
      account: mapAccount(result.user),
      sessionId: result.session.id,
      sessionToken: result.session.token,
    };
  }

  async completeSocialOnboarding(input: {
    sessionToken: string;
    displayName: string;
    termsVersion: string;
    scopes: readonly string[];
  }): Promise<BetterAuthRuntimeSession> {
    const context = await this.#auth.$context;
    const current = await context.internalAdapter.findSession(input.sessionToken);
    if (!current || current.session.expiresAt.getTime() <= Date.now()) {
      throw invalidSocialSession();
    }
    const accounts = await context.internalAdapter.findAccounts(current.user.id);
    if (!accounts.some((account) => account.providerId === "google" || account.providerId === "apple")) {
      throw invalidSocialSession();
    }
    const user = await context.adapter.update<BetterAuthUserRecord>({
      model: "user",
      where: [
        { field: "id", value: current.user.id },
        { field: "accountStatus", value: "restricted" },
        { field: "registrationComplete", value: false },
      ],
      update: {
        name: input.displayName,
        accountStatus: "active",
        scopes: [...new Set(input.scopes)].join(" "),
        termsVersion: input.termsVersion,
        registrationComplete: true,
      },
    });
    if (!user) {
      throw new ApiError(
        409,
        "social_onboarding_unavailable",
        "Social onboarding is no longer available for this account.",
      );
    }
    return {
      account: mapAccount(user),
      sessionId: current.session.id,
      sessionToken: current.session.token,
    };
  }

  async issueServiceToken(session: BetterAuthRuntimeSession): Promise<{
    token: string;
    expiresAt: string;
  }> {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const { token } = await this.#auth.api.signJWT({
      body: {
        payload: {
          iat: issuedAt,
          ...createServiceJwtPayload({
            accountId: session.account.accountId,
            sessionId: session.sessionId,
            accountStatus: session.account.status,
            scopes: [...session.account.scopes].join(" "),
          }),
        },
      },
    });
    const payload = decodeJwt(token);
    if (typeof payload.exp !== "number") {
      throw new Error("Better Auth service JWT is missing an expiration claim.");
    }
    return {
      token,
      expiresAt: new Date(payload.exp * 1_000).toISOString(),
    };
  }

  async revokeSession(input: { accountId: string; sessionId: string }): Promise<void> {
    const context = await this.#auth.$context;
    const session = await context.adapter.findOne<BetterAuthSessionRecord>({
      model: "session",
      where: [
        { field: "id", value: input.sessionId },
        { field: "userId", value: input.accountId },
      ],
    });
    if (session) await context.internalAdapter.deleteSession(session.token);
  }

  async #proveUnknownEmailOtp(email: string, code: string): Promise<void> {
    try {
      await this.#auth.api.checkVerificationOTP({
        body: { email, type: "sign-in", otp: code },
      });
      throw new Error("Unknown email unexpectedly resolved to a Better Auth user.");
    } catch (error) {
      if (!hasBetterAuthCode(error, "USER_NOT_FOUND")) throw error;
    }
  }

  async #createPendingEmailUser(email: string): Promise<void> {
    const context = await this.#auth.$context;
    try {
      await context.internalAdapter.createUser<BetterAuthUserRecord>({
        email,
        emailVerified: false,
        name: "Pending registration",
        accountStatus: "restricted",
        scopes: "",
        registrationComplete: false,
      });
    } catch {
      // A concurrent valid verification may have won the unique email insert.
      if (!await context.internalAdapter.findUserByEmail(email)) throw new Error(
        "Better Auth could not create the pending email user.",
      );
    }
  }

  async #sessionFromToken(sessionToken: string): Promise<BetterAuthRuntimeSession> {
    const context = await this.#auth.$context;
    const result = await context.internalAdapter.findSession(sessionToken);
    if (!result) throw new Error("Better Auth did not persist the new session.");
    return {
      account: mapAccount(result.user),
      sessionId: result.session.id,
      sessionToken: result.session.token,
    };
  }
}

/** Reads session revocation/expiry and current user authorization from Postgres. */
export class BetterAuthLiveSessionStore implements LiveIdentitySessionStore {
  readonly #auth: ProductionBetterAuth;

  constructor(auth: ProductionBetterAuth) {
    this.#auth = auth;
  }

  async findLiveSession(input: {
    accountId: string;
    sessionId: string;
  }): Promise<LiveIdentitySession | null> {
    const context = await this.#auth.$context;
    const session = await context.adapter.findOne<BetterAuthSessionRecord>({
      model: "session",
      where: [
        { field: "id", value: input.sessionId },
        { field: "userId", value: input.accountId },
      ],
    });
    if (!session) return null;
    const user = await context.internalAdapter.findUserById(input.accountId);
    const expiresAt = dateValue(session.expiresAt);
    if (!user || !expiresAt) return null;
    const account = mapAccount(user);
    return {
      accountId: account.accountId,
      sessionId: session.id,
      expiresAt,
      accountStatus: account.status,
      scopes: account.scopes,
    };
  }
}

/** Uses Better Auth's Postgres verification table for cluster-safe flow state. */
export class BetterAuthVerificationFlowStore implements AuthFlowStore {
  readonly #auth: ProductionBetterAuth;

  constructor(auth: ProductionBetterAuth) {
    this.#auth = auth;
  }

  async saveChallenge(challenge: AuthFlowChallenge): Promise<void> {
    const context = await this.#auth.$context;
    await context.internalAdapter.createVerificationValue({
      identifier: challengeKey(challenge.id),
      value: JSON.stringify(challenge),
      expiresAt: new Date(challenge.expiresAt),
    });
  }

  async findChallenge(id: string): Promise<AuthFlowChallenge | null> {
    const context = await this.#auth.$context;
    const value = await context.internalAdapter.findVerificationValue(challengeKey(id));
    return value ? parseChallenge(value.value) : null;
  }

  async consumeChallenge(id: string): Promise<boolean> {
    const context = await this.#auth.$context;
    return Boolean(await context.internalAdapter.consumeVerificationValue(challengeKey(id)));
  }

  async saveRegistration(registration: AuthFlowRegistration): Promise<void> {
    const context = await this.#auth.$context;
    await context.internalAdapter.createVerificationValue({
      identifier: registrationKey(registration.id),
      value: JSON.stringify(registration),
      expiresAt: new Date(registration.expiresAt),
    });
  }

  async consumeRegistration(
    id: string,
  ): Promise<AuthFlowRegistration | "used" | null> {
    const context = await this.#auth.$context;
    const value = await context.internalAdapter.consumeVerificationValue(registrationKey(id));
    if (!value) {
      return await context.internalAdapter.findVerificationValue(usedRegistrationKey(id))
        ? "used"
        : null;
    }
    const registration = parseRegistration(value.value);
    if (!registration) return null;
    await context.internalAdapter.reserveVerificationValue({
      identifier: usedRegistrationKey(id),
      value: "used",
      expiresAt: new Date(Math.max(Date.parse(registration.expiresAt), Date.now()) + 5 * 60_000),
    });
    return registration;
  }
}

export interface ProductionIdentityStack {
  identity: IdentityModule;
  socialAuth: SocialAuthFlow;
  /** Reviewed OAuth/JWKS handler; this is the only handler composition should mount. */
  authHandler(request: Request): Promise<Response>;
  /** Exposed for migrations and advanced server operations; never mount its raw handler. */
  betterAuth: ProductionBetterAuth;
}

/** Ready-to-compose production IdentityModule plus its Better Auth handler. */
export function createProductionIdentityStack(
  config: ProductionBetterAuthConfig,
): ProductionIdentityStack {
  const betterAuth = createProductionBetterAuth(config);
  const runtime = new BetterAuthRuntime(betterAuth, config.otpDelivery);
  const flows = new BetterAuthVerificationFlowStore(betterAuth);
  const jwksUrl = new URL("/api/auth/.well-known/jwks.json", config.baseURL);
  const signedTokens = new BetterAuthServiceJwtVerifier({
    issuer: config.serviceJwt.issuer,
    audience: config.serviceJwt.audience,
    jwks: jwksUrl,
  });
  const tokens = new LiveSessionAccessTokenVerifier({
    signedTokens,
    sessions: new BetterAuthLiveSessionStore(betterAuth),
  });
  const nativeCallbackUrls = (config.nativeSchemes ?? []).map(
    (scheme) => `${scheme}auth/callback`,
  );
  const socialAuth = new BetterAuthSocialAuthFlow({
    bridge: new BetterAuthSocialBridgeAdapter(betterAuth),
    store: new BetterAuthVerificationSocialAuthStateStore(betterAuth),
    baseUrl: config.baseURL,
    allowedCallbackUrls: nativeCallbackUrls,
  });
  return {
    betterAuth,
    socialAuth,
    authHandler: createReviewedBetterAuthHandler(betterAuth, { socialAuth }),
    identity: new BetterAuthIdentityAdapter({
      runtime,
      flows,
      tokens,
      requiredTermsVersion: config.requiredTermsVersion,
    }),
  };
}

function dateValue(value: unknown): Date | null {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

function mapAccount(user: BetterAuthUserRecord): BetterAuthAccount {
  return {
    accountId: user.id,
    displayName: user.name,
    registrationComplete: user.registrationComplete === true,
    status: accountStatus(user.accountStatus),
    scopes: parseScopes(user.scopes),
  };
}

function accountStatus(value: unknown): AccountStatus {
  if (value === "active" || value === "pending_deletion") return value;
  return "restricted";
}

function parseScopes(value: unknown): ReadonlySet<string> {
  if (typeof value !== "string") return new Set();
  return new Set(value.split(/\s+/).filter(Boolean));
}

function challengeKey(id: string): string {
  return `maxpower:identity:challenge:${id}`;
}

function registrationKey(id: string): string {
  return `maxpower:identity:registration:${id}`;
}

function usedRegistrationKey(id: string): string {
  return `maxpower:identity:registration-used:${id}`;
}

function parseChallenge(value: string): AuthFlowChallenge | null {
  const parsed = parseObject(value);
  if (
    !parsed ||
    typeof parsed.id !== "string" ||
    (parsed.purpose !== "registration" && parsed.purpose !== "login") ||
    typeof parsed.accountKnown !== "boolean" ||
    typeof parsed.expiresAt !== "string" ||
    !isIdentifier(parsed.identifier)
  ) return null;
  return {
    id: parsed.id,
    purpose: parsed.purpose,
    accountKnown: parsed.accountKnown,
    expiresAt: parsed.expiresAt,
    identifier: parsed.identifier,
  };
}

function parseRegistration(value: string): AuthFlowRegistration | null {
  const parsed = parseObject(value);
  if (
    !parsed ||
    typeof parsed.id !== "string" ||
    typeof parsed.accountId !== "string" ||
    typeof parsed.sessionId !== "string" ||
    typeof parsed.sessionToken !== "string" ||
    typeof parsed.expiresAt !== "string" ||
    !isIdentifier(parsed.identifier)
  ) return null;
  return {
    id: parsed.id,
    accountId: parsed.accountId,
    sessionId: parsed.sessionId,
    sessionToken: parsed.sessionToken,
    expiresAt: parsed.expiresAt,
    identifier: parsed.identifier,
  };
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isIdentifier(value: unknown): value is IdentityIdentifier {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "email" || candidate.kind === "phone") &&
    typeof candidate.value === "string"
  );
}

function hasBetterAuthCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    body?: { code?: unknown };
    code?: unknown;
  };
  return candidate.code === code || candidate.body?.code === code;
}

function invalidCredentials(): ApiError {
  return new ApiError(401, "invalid_credentials", "The credentials are invalid.");
}

function invalidSocialSession(): ApiError {
  return new ApiError(
    401,
    "invalid_social_session",
    "A verified Google or Apple session is required.",
  );
}
