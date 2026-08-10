import { createHmac, randomUUID } from "node:crypto";

import { betterAuth } from "better-auth";
import { bearer, emailOTP, jwt, phoneNumber } from "better-auth/plugins";
import type { Pool } from "pg";

export const SERVICE_JWT_TTL_SECONDS = 5 * 60;
export const AUTH_OTP_TTL_SECONDS = 5 * 60;

export type EmailOtpPurpose =
  | "sign-in"
  | "email-verification"
  | "forget-password"
  | "change-email";

/**
 * Production delivery boundary. Implementations may use any transactional
 * email/SMS provider, but must never return or log the OTP value.
 */
export interface ProductionOtpDelivery {
  sendEmailOtp(input: {
    email: string;
    code: string;
    purpose: EmailOtpPurpose;
  }): Promise<void>;
  sendSmsOtp(input: { phoneNumber: string; code: string }): Promise<void>;
}

export interface ProductionSocialProviderConfig {
  clientIds: readonly [string, ...string[]];
  clientSecret: string;
}

export interface ProductionAppleProviderConfig extends ProductionSocialProviderConfig {
  appBundleIdentifier: string;
}

export interface ProductionBetterAuthConfig {
  database: Pool;
  baseURL: string;
  secret: string;
  trustedOrigins: readonly string[];
  /** Exact native callback schemes trusted by the Expo OAuth bridge. */
  nativeSchemes?: readonly string[];
  otpDelivery: ProductionOtpDelivery;
  /** Reserved domain used for Better Auth's required email on phone-only users. */
  phoneIdentityDomain: string;
  /** Version the server currently requires during registration/social onboarding. */
  requiredTermsVersion: string;
  serviceJwt: {
    issuer: string;
    audience: string;
  };
  google: ProductionSocialProviderConfig;
  apple: ProductionAppleProviderConfig;
}

export interface BetterAuthServerInstance {
  handler(request: Request): Promise<Response>;
}

export interface ReviewedBetterAuthHandlerOptions {
  /** Linking is a privileged operation and requires a session this recent. */
  maxLinkSessionAgeSeconds?: number;
  now?: () => Date;
  socialAuth?: ReviewedSocialAuthHandler;
}

export interface ReviewedSocialAuthHandler {
  authorize(oauthState: string): Promise<Response>;
  handleProviderCallback(
    request: Request,
    provider: "google" | "apple",
  ): Promise<Response>;
}

const REVIEWED_PUBLIC_AUTH_PATHS = new Set([
  "/api/auth/social/authorize",
  "/api/auth/callback/google",
  "/api/auth/callback/apple",
  "/api/auth/link-social",
  "/api/auth/list-accounts",
  "/api/auth/unlink-account",
  "/api/auth/.well-known/jwks.json",
  "/api/auth/error",
]);

const FRESH_SESSION_PATHS = new Set([
  "/api/auth/link-social",
  "/api/auth/unlink-account",
]);

/**
 * Safe composition-root handler. Credential and OTP endpoints stay behind
 * IdentityModule's `/v1/auth/*` contract instead of exposing Better Auth raw.
 */
export function createReviewedBetterAuthHandler(
  auth: BetterAuthServerInstance,
  options: ReviewedBetterAuthHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const now = options.now ?? (() => new Date());
  const maxLinkSessionAgeMs = (options.maxLinkSessionAgeSeconds ?? 5 * 60) * 1_000;
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (!REVIEWED_PUBLIC_AUTH_PATHS.has(path)) {
      return Response.json(
        { error: { code: "not_found", message: "Route not found." } },
        { status: 404 },
      );
    }
    if (path === "/api/auth/social/authorize") {
      if (request.method !== "GET" || !options.socialAuth) return notFoundResponse();
      const state = new URL(request.url).searchParams.get("state");
      if (!state || state.length < 16 || state.length > 512) {
        return Response.json(
          { error: { code: "invalid_social_flow", message: "The social sign-in request is invalid." } },
          { status: 400 },
        );
      }
      return options.socialAuth.authorize(state);
    }
    if (options.socialAuth && path === "/api/auth/callback/google") {
      return options.socialAuth.handleProviderCallback(request, "google");
    }
    if (options.socialAuth && path === "/api/auth/callback/apple") {
      return options.socialAuth.handleProviderCallback(request, "apple");
    }
    if (FRESH_SESSION_PATHS.has(path)) {
      const createdAt = await currentSessionCreatedAt(auth, request.headers);
      const ageMs = createdAt ? now().getTime() - createdAt.getTime() : Number.POSITIVE_INFINITY;
      if (ageMs < 0 || ageMs > maxLinkSessionAgeMs) {
        return Response.json(
          {
            error: {
              code: "reauthentication_required",
              message: "Please sign in again before changing linked identities.",
            },
          },
          { status: 401 },
        );
      }
    }
    return auth.handler(request);
  };
}

function notFoundResponse(): Response {
  return Response.json(
    { error: { code: "not_found", message: "Route not found." } },
    { status: 404 },
  );
}

async function currentSessionCreatedAt(
  auth: BetterAuthServerInstance,
  headers: Headers,
): Promise<Date | null> {
  const api = (auth as BetterAuthServerInstance & {
    api?: {
      getSession?: (input: {
        headers: Headers;
        query?: { disableCookieCache?: boolean };
      }) => Promise<unknown>;
    };
  }).api;
  if (!api?.getSession) return null;
  const result = await api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!result || typeof result !== "object") return null;
  const session = (result as { session?: unknown }).session;
  if (!session || typeof session !== "object") return null;
  const value = (session as { createdAt?: unknown }).createdAt;
  const parsed = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

export interface ServiceJwtIdentity {
  accountId: string;
  sessionId: string;
  accountStatus: unknown;
  scopes: unknown;
}

export function createServiceJwtPayload(identity: ServiceJwtIdentity): {
  sub: string;
  jti: string;
  sid: string;
  account_status: "active" | "restricted" | "pending_deletion";
  scope: string;
  realm: "global";
} {
  return {
    sub: identity.accountId,
    jti: randomUUID(),
    sid: identity.sessionId,
    account_status: accountStatusClaim(identity.accountStatus),
    scope: scopeClaim(identity.scopes),
    realm: "global",
  };
}

/**
 * Builds the production Better Auth instance. PostgreSQL stores users,
 * sessions, OTP verification rows, provider accounts and rotating JWKS keys.
 */
export function createProductionBetterAuth(config: ProductionBetterAuthConfig) {
  const validated = validateConfig(config);
  const trustedOrigins = unique([
    ...validated.trustedOrigins,
    ...(validated.nativeSchemes ?? []),
    "https://appleid.apple.com",
  ]);

  return betterAuth({
    appName: "MaxPower",
    database: validated.database,
    baseURL: validated.baseURL,
    basePath: "/api/auth",
    secret: validated.secret,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 256,
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        accountStatus: {
          type: "string",
          required: true,
          defaultValue: "restricted",
          input: false,
        },
        scopes: {
          type: "string",
          required: true,
          defaultValue: "",
          input: false,
        },
        termsVersion: {
          type: "string",
          required: false,
          input: false,
        },
        registrationComplete: {
          type: "boolean",
          required: true,
          defaultValue: false,
          input: false,
        },
      },
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        trustedProviders: [],
      },
    },
    socialProviders: {
      google: {
        clientId: [...validated.google.clientIds],
        clientSecret: validated.google.clientSecret,
      },
      apple: {
        clientId: [...validated.apple.clientIds],
        clientSecret: validated.apple.clientSecret,
        appBundleIdentifier: validated.apple.appBundleIdentifier,
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
    },
    plugins: [
      emailOTP({
        expiresIn: AUTH_OTP_TTL_SECONDS,
        otpLength: 6,
        allowedAttempts: 3,
        disableSignUp: true,
        storeOTP: "hashed",
        resendStrategy: "rotate",
        async sendVerificationOTP({ email, otp, type }) {
          await validated.otpDelivery.sendEmailOtp({
            email,
            code: otp,
            purpose: type,
          });
        },
      }),
      phoneNumber({
        expiresIn: AUTH_OTP_TTL_SECONDS,
        otpLength: 6,
        allowedAttempts: 3,
        requireVerification: true,
        phoneNumberValidator: isCanonicalE164,
        async sendOTP({ phoneNumber: value, code }) {
          await validated.otpDelivery.sendSmsOtp({ phoneNumber: value, code });
        },
        signUpOnVerification: {
          getTempEmail(value) {
            const localPart = createHmac("sha256", validated.secret)
              .update(value)
              .digest("hex");
            return `${localPart}@${validated.phoneIdentityDomain}`;
          },
          getTempName() {
            return "Pending registration";
          },
        },
      }),
      // The V1 contract returns Better Auth's opaque, high-entropy session token.
      // Raw bearer support lets that same credential authorize reviewed OAuth
      // link/session endpoints; core still validates it against Postgres.
      bearer({ requireSignature: false }),
      jwt({
        jwks: {
          jwksPath: "/.well-known/jwks.json",
          keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
          disablePrivateKeyEncryption: false,
          rotationInterval: 30 * 24 * 60 * 60,
          gracePeriod: 10 * 60,
        },
        jwt: {
          issuer: validated.serviceJwt.issuer,
          audience: validated.serviceJwt.audience,
          expirationTime: "5m",
          definePayload({ user, session }) {
            const { sub: _subject, ...payload } = createServiceJwtPayload({
              accountId: user.id,
              sessionId: session.id,
              accountStatus: user.accountStatus,
              scopes: user.scopes,
            });
            return payload;
          },
        },
      }),
    ],
  });
}

function validateConfig(config: ProductionBetterAuthConfig): ProductionBetterAuthConfig {
  requireHttpsUrl(config.baseURL, "baseURL");
  requireHttpsUrl(config.serviceJwt.issuer, "serviceJwt.issuer");
  for (const origin of config.trustedOrigins) requireHttpsUrl(origin, "trustedOrigins");
  for (const scheme of config.nativeSchemes ?? []) requireNativeScheme(scheme);
  if (config.secret.length < 32) {
    throw new Error("Better Auth production secret must contain at least 32 characters.");
  }
  if (!config.serviceJwt.audience.trim()) {
    throw new Error("A service JWT audience is required.");
  }
  if (!isDnsName(config.phoneIdentityDomain)) {
    throw new Error("phoneIdentityDomain must be a DNS name without a scheme.");
  }
  if (!config.requiredTermsVersion.trim()) {
    throw new Error("requiredTermsVersion is required.");
  }
  requireProvider(config.google, "google");
  requireProvider(config.apple, "apple");
  if (!config.apple.appBundleIdentifier.trim()) {
    throw new Error("Apple appBundleIdentifier is required.");
  }
  return config;
}

function requireNativeScheme(value: string): void {
  if (!/^[a-z][a-z0-9+.-]*:\/\/$/i.test(value) || /^https?:/i.test(value)) {
    throw new Error("nativeSchemes must contain exact non-HTTP callback schemes such as maxpower://.");
  }
}

function requireProvider(
  provider: ProductionSocialProviderConfig,
  name: string,
): void {
  if (!provider.clientIds.length || provider.clientIds.some((value) => !value.trim())) {
    throw new Error(`${name} clientIds must contain non-empty values.`);
  }
  if (!provider.clientSecret.trim()) {
    throw new Error(`${name} clientSecret is required.`);
  }
}

function requireHttpsUrl(value: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
}

function isDnsName(value: string): boolean {
  return (
    value.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
      value,
    )
  );
}

function isCanonicalE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

function accountStatusClaim(value: unknown): "active" | "restricted" | "pending_deletion" {
  if (value === "active" || value === "pending_deletion") return value;
  return "restricted";
}

function scopeClaim(value: unknown): string {
  if (typeof value !== "string") return "";
  return unique(value.split(/\s+/).filter(Boolean)).join(" ");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
