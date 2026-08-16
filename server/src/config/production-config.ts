import type { OpenAiProviderRoute } from "../adapters/llm-provider/openai-compatible.js";
import type { UsageRouteMetadata } from "../adapters/entitlements/postgres-usage.js";
import type { ProductAlias } from "../modules/llm/model.js";
import type { LlmAliasRequestPolicy } from "../modules/llm/llm-gateway.js";

export interface ProductionConfig {
  runtime: "production";
  http: {
    port: number;
    allowedOrigins: readonly string[];
    maxRequestBytes: number;
    rateLimitRequests: number;
    rateLimitWindowSeconds: number;
    trustProxyHeaders: "controlled-ingress-only";
    strictTransportSecurity: true;
  };
  database: { url: string };
  rateLimitRedis: { url: string };
  streamRedis: { url: string; persistence: "disabled" };
  auth: {
    baseURL: string;
    secret: string;
    trustedOrigins: readonly string[];
    nativeSchemes: readonly string[];
    phoneIdentityDomain: string;
    requiredTermsVersion: string;
    serviceJwt: { issuer: string; audience: string };
    google: { clientIds: readonly [string, ...string[]]; clientSecret: string };
    apple: {
      clientIds: readonly [string, ...string[]];
      clientSecret: string;
      appBundleIdentifier: string;
    };
    otpDelivery: { endpoint: string; bearerToken: string };
  };
  llm: {
    fingerprintSecret: string;
    monthlyFreeCredits: number;
    routes: Readonly<Record<ProductAlias, OpenAiProviderRoute>>;
    requestPolicies: Readonly<Record<ProductAlias, LlmAliasRequestPolicy>>;
    usageRoutes: Readonly<Record<ProductAlias, UsageRouteMetadata>>;
    providerCostRoutes: Readonly<Record<ProductAlias, ProviderCostRoute>>;
  };
  worker: { deletionPollMs: number };
}

export interface ProviderCostRoute {
  inputMicrosPerMillionTokens: number;
  outputMicrosPerMillionTokens: number;
}

export class ProductionConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    const uniqueIssues = [...new Set(issues)];
    super(`Invalid production environment:\n- ${uniqueIssues.join("\n- ")}`);
    this.issues = uniqueIssues;
  }
}

export interface MigrationConfig {
  database: { url: string };
}

export interface ProductionWorkerConfig {
  runtime: "production";
  database: { url: string };
  worker: ProductionConfig["worker"];
}

/** Least-privilege configuration for the schema job; it receives no product secrets. */
export function parseMigrationConfig(environment: NodeJS.ProcessEnv): MigrationConfig {
  const errors: string[] = [];
  if (environment.NODE_ENV !== "production") errors.push("Migration NODE_ENV must be production");
  const databaseUrl = environment.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl || !isTlsPostgresUrl(databaseUrl)) {
    errors.push("Migration DATABASE_URL must be a TLS PostgreSQL URL");
  }
  if (errors.length > 0) throw new ProductionConfigurationError(errors);
  return { database: { url: databaseUrl } };
}

/** Least-privilege deletion/recovery worker configuration; no API/auth/LLM secrets. */
export function parseProductionWorkerConfig(
  environment: NodeJS.ProcessEnv,
): ProductionWorkerConfig {
  const errors: string[] = [];
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) errors.push(`${name} is required`);
    return value ?? "";
  };
  const integer = (name: string, minimum: number, maximum: number): number => {
    const value = required(name);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
      return minimum;
    }
    return parsed;
  };
  if (environment.NODE_ENV !== "production") errors.push("Worker NODE_ENV must be production");
  if (environment.MAXPOWER_RUNTIME !== "production") {
    errors.push("Worker MAXPOWER_RUNTIME must be production");
  }
  const databaseUrl = required("DATABASE_URL");
  if (databaseUrl && !isTlsPostgresUrl(databaseUrl)) {
    errors.push("Worker DATABASE_URL must be a TLS PostgreSQL URL");
  }
  const deletionPollMs = integer("DELETION_WORKER_POLL_MS", 100, 60_000);
  if (errors.length > 0) throw new ProductionConfigurationError(errors);
  return {
    runtime: "production",
    database: { url: databaseUrl },
    worker: { deletionPollMs },
  };
}

/** Parse once at process startup. No partial/default production configuration is accepted. */
export function parseProductionConfig(environment: NodeJS.ProcessEnv): ProductionConfig {
  const errors: string[] = [];
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) {
      errors.push(`${name} is required`);
      return "";
    }
    return value;
  };
  const integer = (name: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number => {
    const value = required(name);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
      return minimum;
    }
    return parsed;
  };
  const https = (name: string): string => {
    const value = required(name);
    if (value && !isUrlWithProtocol(value, "https:")) {
      errors.push(`${name} must be an absolute HTTPS URL`);
    }
    return value;
  };
  const secret = (name: string, minimumLength = 1): string => {
    const value = required(name);
    if (value && value.length < minimumLength) {
      errors.push(`${name} must contain at least ${minimumLength} characters`);
    }
    return value;
  };
  const csv = (name: string): readonly [string, ...string[]] => {
    const values = required(name).split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length === 0) {
      errors.push(`${name} must contain at least one value`);
      return [""];
    }
    return values as [string, ...string[]];
  };

  if (environment.NODE_ENV !== "production") {
    errors.push("NODE_ENV must be production");
  }
  if (environment.MAXPOWER_RUNTIME !== "production") {
    errors.push("MAXPOWER_RUNTIME must be production");
  }
  for (const name of ["AUTH_DEBUG_OTP", "LOCAL_DEBUG_OTP", "MAXPOWER_DEBUG_OTP"]) {
    if (environment[name] !== undefined) errors.push(`${name} is forbidden in production`);
  }

  const databaseUrl = required("DATABASE_URL");
  if (databaseUrl && !isTlsPostgresUrl(databaseUrl)) {
    errors.push("DATABASE_URL must be a PostgreSQL URL with sslmode=require or verify-full");
  }
  const rateLimitRedisUrl = required("RATE_LIMIT_REDIS_URL");
  if (rateLimitRedisUrl && !isUrlWithProtocol(rateLimitRedisUrl, "rediss:", true)) {
    errors.push("RATE_LIMIT_REDIS_URL must use rediss://");
  }
  const streamRedisUrl = required("STREAM_REDIS_URL");
  if (streamRedisUrl && !isUrlWithProtocol(streamRedisUrl, "rediss:", true)) {
    errors.push("STREAM_REDIS_URL must use rediss://");
  }
  if (
    rateLimitRedisUrl &&
    streamRedisUrl &&
    redisServerIdentity(rateLimitRedisUrl) !== null &&
    redisServerIdentity(rateLimitRedisUrl) === redisServerIdentity(streamRedisUrl)
  ) {
    errors.push("stream replay must use a separate Redis from rate limiting");
  }
  const persistence = required("STREAM_REDIS_PERSISTENCE");
  if (persistence !== "disabled") {
    errors.push("STREAM_REDIS_PERSISTENCE must be disabled");
  }

  const allowedOrigins = required("HTTP_ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0) errors.push("HTTP_ALLOWED_ORIGINS must not be empty");
  for (const origin of allowedOrigins) {
    if (!isAllowedCorsOrigin(origin)) {
      errors.push("HTTP_ALLOWED_ORIGINS entries must be exact HTTPS origins or loopback HTTP origins");
    }
  }
  if (required("HTTP_TRUST_PROXY_HEADERS") !== "controlled-ingress-only") {
    errors.push("HTTP_TRUST_PROXY_HEADERS must be controlled-ingress-only");
  }

  const authBaseUrl = required("AUTH_BASE_URL");
  if (authBaseUrl && !isExactHttpsOrigin(authBaseUrl)) {
    errors.push("AUTH_BASE_URL must be an exact HTTPS origin");
  }
  const authSecret = secret("AUTH_SECRET", 32);
  const jwtIssuer = https("SERVICE_JWT_ISSUER");
  const jwtAudience = required("SERVICE_JWT_AUDIENCE");
  const phoneIdentityDomain = required("AUTH_PHONE_IDENTITY_DOMAIN");
  const requiredTermsVersion = required("AUTH_TERMS_VERSION");
  if (phoneIdentityDomain && !isDnsName(phoneIdentityDomain)) {
    errors.push("AUTH_PHONE_IDENTITY_DOMAIN must be a DNS name");
  }
  const nativeSchemes = csv("AUTH_NATIVE_SCHEMES");
  if (nativeSchemes.some((scheme) => !isNativeScheme(scheme))) {
    errors.push("AUTH_NATIVE_SCHEMES must contain exact non-HTTP schemes such as maxpower://");
  }
  const googleClientIds = csv("GOOGLE_CLIENT_IDS");
  const googleClientSecret = secret("GOOGLE_CLIENT_SECRET");
  const appleClientIds = csv("APPLE_CLIENT_IDS");
  const appleClientSecret = secret("APPLE_CLIENT_SECRET");
  const appleBundleIdentifier = required("APPLE_BUNDLE_IDENTIFIER");
  const otpEndpoint = https("OTP_DELIVERY_ENDPOINT");
  const otpBearerToken = secret("OTP_DELIVERY_BEARER_TOKEN");

  const port = integer("PORT", 1, 65_535);
  const maxRequestBytes = integer("HTTP_MAX_REQUEST_BYTES");
  const rateLimitRequests = integer("HTTP_RATE_LIMIT_REQUESTS");
  const rateLimitWindowSeconds = integer("HTTP_RATE_LIMIT_WINDOW_SECONDS");
  const deletionPollMs = integer("DELETION_WORKER_POLL_MS", 100, 60_000);

  const coachProviderEndpoint = https("LLM_COACH_PROVIDER_ENDPOINT");
  const coachProviderApiKey = secret("LLM_COACH_PROVIDER_API_KEY");
  const coachProviderId = required("LLM_COACH_PROVIDER_ID");
  const coachModel = required("LLM_COACH_MODEL");
  const coachInputCredits = integer("LLM_COACH_INPUT_CREDITS_PER_MILLION", 0);
  const coachOutputCredits = integer("LLM_COACH_OUTPUT_CREDITS_PER_MILLION", 0);
  const coachPricingVersion = required("LLM_COACH_PRICING_VERSION_ID");
  const coachMaxInputBytes = integer("LLM_COACH_MAX_INPUT_BYTES", 1, maxRequestBytes);
  const coachMaxInputTokens = integer("LLM_COACH_MAX_INPUT_TOKENS");
  const coachMaxOutputTokens = integer("LLM_COACH_MAX_OUTPUT_TOKENS");
  const coachProviderInputCost = integer(
    "LLM_COACH_PROVIDER_INPUT_COST_MICROS_PER_MILLION",
    0,
  );
  const coachProviderOutputCost = integer(
    "LLM_COACH_PROVIDER_OUTPUT_COST_MICROS_PER_MILLION",
    0,
  );
  const fingerprintSecret = secret("LLM_FINGERPRINT_SECRET", 32);
  const monthlyFreeCredits = integer("LLM_MONTHLY_FREE_CREDITS");

  if (coachMaxInputTokens < coachMaxInputBytes) {
    errors.push("LLM_COACH_MAX_INPUT_TOKENS must cover the maximum UTF-8 request bytes");
  }
  const worstCaseCredits = (
    name: string,
    maxInputTokens: number,
    inputRate: number,
    maxOutputTokens: number,
    outputRate: number,
  ): number => {
    const numerator = maxInputTokens * inputRate + maxOutputTokens * outputRate;
    if (!Number.isSafeInteger(numerator) || numerator < 0) {
      errors.push(`${name} worst-case credit reservation exceeds safe integer precision`);
      return 1;
    }
    return Math.max(1, Math.ceil(numerator / 1_000_000));
  };
  const coachReservationCredits = worstCaseCredits(
    "LLM_COACH",
    coachMaxInputTokens,
    coachInputCredits,
    coachMaxOutputTokens,
    coachOutputCredits,
  );

  if (errors.length > 0) {
    throw new ProductionConfigurationError(errors);
  }

  const routes: Readonly<Record<ProductAlias, OpenAiProviderRoute>> = {
    "maxpower/coach-v1": {
      endpoint: coachProviderEndpoint,
      apiKey: coachProviderApiKey,
      model: coachModel,
      maxOutputTokens: coachMaxOutputTokens,
      inputCreditsPerMillionTokens: coachInputCredits,
      outputCreditsPerMillionTokens: coachOutputCredits,
      inputCostMicrosPerMillionTokens: coachProviderInputCost,
      outputCostMicrosPerMillionTokens: coachProviderOutputCost,
    },
  };
  const usageRoutes: Readonly<Record<ProductAlias, UsageRouteMetadata>> = {
    "maxpower/coach-v1": {
      providerId: coachProviderId,
      providerModel: coachModel,
      pricingVersionId: coachPricingVersion,
    },
  };
  const requestPolicies: Readonly<Record<ProductAlias, LlmAliasRequestPolicy>> = {
    "maxpower/coach-v1": {
      maxInputBytes: coachMaxInputBytes,
      maxInputTokens: coachMaxInputTokens,
      maxOutputTokens: coachMaxOutputTokens,
      reservationCredits: coachReservationCredits,
    },
  };
  const providerCostRoutes: Readonly<Record<ProductAlias, ProviderCostRoute>> = {
    "maxpower/coach-v1": {
      inputMicrosPerMillionTokens: coachProviderInputCost,
      outputMicrosPerMillionTokens: coachProviderOutputCost,
    },
  };

  return {
    runtime: "production",
    http: {
      port,
      allowedOrigins,
      maxRequestBytes,
      rateLimitRequests,
      rateLimitWindowSeconds,
      trustProxyHeaders: "controlled-ingress-only",
      strictTransportSecurity: true,
    },
    database: { url: databaseUrl },
    rateLimitRedis: { url: rateLimitRedisUrl },
    streamRedis: { url: streamRedisUrl, persistence: "disabled" },
    auth: {
      baseURL: authBaseUrl,
      secret: authSecret,
      // Local HTTP is allowed only at the API CORS boundary for development.
      // Better Auth's browser/OAuth trust boundary remains HTTPS-only.
      trustedOrigins: allowedOrigins.filter(isExactHttpsOrigin),
      nativeSchemes,
      phoneIdentityDomain,
      requiredTermsVersion,
      serviceJwt: { issuer: jwtIssuer, audience: jwtAudience },
      google: { clientIds: googleClientIds, clientSecret: googleClientSecret },
      apple: {
        clientIds: appleClientIds,
        clientSecret: appleClientSecret,
        appBundleIdentifier: appleBundleIdentifier,
      },
      otpDelivery: { endpoint: otpEndpoint, bearerToken: otpBearerToken },
    },
    llm: {
      fingerprintSecret,
      monthlyFreeCredits,
      routes,
      requestPolicies,
      usageRoutes,
      providerCostRoutes,
    },
    worker: { deletionPollMs },
  };
}

function isUrlWithProtocol(
  value: string,
  protocol: string,
  allowCredentials = false,
): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === protocol &&
      Boolean(url.hostname) &&
      (allowCredentials || (url.username === "" && url.password === ""))
    );
  } catch {
    return false;
  }
}

function isExactHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.origin !== value) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function isTlsPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      (url.searchParams.get("sslmode") === "require" ||
        url.searchParams.get("sslmode") === "verify-full")
    );
  } catch {
    return false;
  }
}

function redisServerIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "rediss:" || !url.hostname) return null;
    return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || "6379"}`;
  } catch {
    return null;
  }
}

function isDnsName(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

function isNativeScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/$/i.test(value) && !/^https?:/i.test(value);
}
