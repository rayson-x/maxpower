import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionConfigurationError,
  parseMigrationConfig,
  parseProductionConfig,
  parseProductionWorkerConfig,
} from "../src/config/production-config.js";

test("migration config follows least privilege and only requires the TLS database URL", () => {
  assert.deepEqual(parseMigrationConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://maxpower:secret@db.example/maxpower?sslmode=require",
  }), {
    database: {
      url: "postgresql://maxpower:secret@db.example/maxpower?sslmode=require",
    },
  });
  assert.throws(
    () => parseMigrationConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://db/maxpower" }),
    /TLS PostgreSQL/i,
  );
});

test("deletion worker config excludes HTTP, Redis, auth, OTP and LLM provider secrets", () => {
  const environment = validEnvironment();
  const workerEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: environment.NODE_ENV,
    MAXPOWER_RUNTIME: environment.MAXPOWER_RUNTIME,
    DATABASE_URL: environment.DATABASE_URL,
    S3_ENDPOINT: environment.S3_ENDPOINT,
    S3_REGION: environment.S3_REGION,
    S3_BUCKET: environment.S3_BUCKET,
    S3_ACCESS_KEY_ID: environment.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: environment.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: environment.S3_FORCE_PATH_STYLE,
    MEDIA_TRANSFER_EXPIRY_SECONDS: environment.MEDIA_TRANSFER_EXPIRY_SECONDS,
    DELETION_WORKER_POLL_MS: environment.DELETION_WORKER_POLL_MS,
  };

  const config = parseProductionWorkerConfig(workerEnvironment);
  assert.equal(config.database.url, environment.DATABASE_URL);
  assert.equal(config.objectStorage.bucket, environment.S3_BUCKET);
  assert.equal("llm" in config, false);
  assert.equal("auth" in config, false);
  assert.equal("rateLimitRedis" in config, false);
});

test("production config accepts a complete HTTPS/TLS-only deployment", () => {
  const config = parseProductionConfig(validEnvironment());

  assert.equal(config.runtime, "production");
  assert.equal(config.http.port, 8787);
  assert.deepEqual(config.http.allowedOrigins, [
    "https://app.maxpower.example",
    "https://admin.maxpower.example",
  ]);
  assert.equal(config.http.strictTransportSecurity, true);
  assert.equal(config.streamRedis.persistence, "disabled");
  assert.equal(config.media.transferExpirySeconds, 900);
  assert.equal(config.llm.monthlyFreeCredits, 2500);
  assert.deepEqual(config.auth.nativeSchemes, ["maxpower://"]);
  assert.equal(config.llm.routes["maxpower/coach-v1"].model, "coach-model");
  assert.equal(
    config.llm.routes["maxpower/coach-v1"].inputCostMicrosPerMillionTokens,
    1500,
  );
  assert.equal(
    config.llm.usageRoutes["maxpower/nutrition-vision-v1"].pricingVersionId,
    "nutrition-pricing-v1",
  );
  assert.deepEqual(config.llm.providerCostRoutes["maxpower/coach-v1"], {
    inputMicrosPerMillionTokens: 1500,
    outputMicrosPerMillionTokens: 6000,
  });
  assert.deepEqual(config.llm.requestPolicies["maxpower/coach-v1"], {
    maxInputBytes: 65_536,
    maxInputTokens: 131_072,
    maxOutputTokens: 4_096,
    maxImages: 4,
    maxImageBytes: 65_536,
    reservationCredits: 140,
  });
});

test("production config fails closed on insecure external URLs and weak secrets", () => {
  assert.throws(
    () => parseProductionConfig(validEnvironment({ AUTH_BASE_URL: "http://auth.example" })),
    /AUTH_BASE_URL.*HTTPS/i,
  );
  for (const value of [
    "https://auth.example/base/path",
    "https://auth.example?tenant=one",
    "https://user@auth.example",
  ]) {
    assert.throws(
      () => parseProductionConfig(validEnvironment({ AUTH_BASE_URL: value })),
      /AUTH_BASE_URL.*exact HTTPS origin/i,
    );
  }
  assert.throws(
    () => parseProductionConfig(validEnvironment({ LLM_PROVIDER_ENDPOINT: "http://llm.example/v1/chat/completions" })),
    /LLM_PROVIDER_ENDPOINT.*HTTPS/i,
  );
  assert.throws(
    () => parseProductionConfig(validEnvironment({ AUTH_SECRET: "short" })),
    /AUTH_SECRET.*32/i,
  );
});

test("production config forbids memory/debug OTP and persistent/shared stream Redis", () => {
  assert.throws(
    () => parseProductionConfig(validEnvironment({ MAXPOWER_RUNTIME: "memory" })),
    /MAXPOWER_RUNTIME.*production/i,
  );
  assert.throws(
    () => parseProductionConfig(validEnvironment({
      AUTH_DEBUG_OTP: "123456",
      LOCAL_DEBUG_OTP: "123456",
      MAXPOWER_DEBUG_OTP: "123456",
    })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /AUTH_DEBUG_OTP/);
      assert.match(error.message, /LOCAL_DEBUG_OTP/);
      assert.match(error.message, /MAXPOWER_DEBUG_OTP/);
      return true;
    },
  );
  assert.throws(
    () => parseProductionConfig(validEnvironment({ STREAM_REDIS_PERSISTENCE: "rdb" })),
    /STREAM_REDIS_PERSISTENCE.*disabled/i,
  );
  assert.throws(
    () => parseProductionConfig(validEnvironment({ STREAM_REDIS_URL: "rediss://rate.redis.example:6380/0" })),
    /separate Redis/i,
  );
  assert.throws(
    () => parseProductionConfig(validEnvironment({ STREAM_REDIS_URL: "rediss://rate.redis.example:6380/9" })),
    /separate Redis/i,
  );
});

test("production config reports every missing variable in one startup error", () => {
  assert.throws(
    () => parseProductionConfig({ NODE_ENV: "production", MAXPOWER_RUNTIME: "production" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error instanceof ProductionConfigurationError);
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /AUTH_SECRET/);
      assert.match(error.message, /LLM_PROVIDER_API_KEY/);
      return true;
    },
  );
});

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    MAXPOWER_RUNTIME: "production",
    PORT: "8787",
    DATABASE_URL: "postgresql://maxpower:secret@db.example:5432/maxpower?sslmode=require",
    RATE_LIMIT_REDIS_URL: "rediss://rate.redis.example:6380/0",
    STREAM_REDIS_URL: "rediss://stream.redis.example:6380/0",
    STREAM_REDIS_PERSISTENCE: "disabled",
    HTTP_ALLOWED_ORIGINS: "https://app.maxpower.example,https://admin.maxpower.example",
    HTTP_MAX_REQUEST_BYTES: "1048576",
    HTTP_RATE_LIMIT_REQUESTS: "120",
    HTTP_RATE_LIMIT_WINDOW_SECONDS: "60",
    HTTP_TRUST_PROXY_HEADERS: "controlled-ingress-only",
    AUTH_BASE_URL: "https://auth.maxpower.example",
    AUTH_SECRET: "auth-secret-with-at-least-thirty-two-characters",
    AUTH_PHONE_IDENTITY_DOMAIN: "phone-id.maxpower.invalid",
    AUTH_TERMS_VERSION: "terms-v1",
    AUTH_NATIVE_SCHEMES: "maxpower://",
    SERVICE_JWT_ISSUER: "https://auth.maxpower.example",
    SERVICE_JWT_AUDIENCE: "maxpower-api",
    GOOGLE_CLIENT_IDS: "google-web,google-ios,google-android",
    GOOGLE_CLIENT_SECRET: "google-secret",
    APPLE_CLIENT_IDS: "apple-service,apple-ios",
    APPLE_CLIENT_SECRET: "apple-secret",
    APPLE_BUNDLE_IDENTIFIER: "com.maxpower.ios",
    OTP_DELIVERY_ENDPOINT: "https://notify.maxpower.example/v1/otp",
    OTP_DELIVERY_BEARER_TOKEN: "otp-delivery-token",
    S3_ENDPOINT: "https://objects.maxpower.example",
    S3_REGION: "us-east-1",
    S3_BUCKET: "maxpower-private-media",
    S3_ACCESS_KEY_ID: "s3-access-key",
    S3_SECRET_ACCESS_KEY: "s3-secret-key",
    S3_FORCE_PATH_STYLE: "false",
    MEDIA_TRANSFER_EXPIRY_SECONDS: "900",
    LLM_PROVIDER_ENDPOINT: "https://llm-provider.example/v1/chat/completions",
    LLM_PROVIDER_API_KEY: "provider-secret",
    LLM_PROVIDER_ID: "primary-openai-compatible",
    LLM_COACH_MODEL: "coach-model",
    LLM_COACH_INPUT_CREDITS_PER_MILLION: "1000",
    LLM_COACH_OUTPUT_CREDITS_PER_MILLION: "2000",
    LLM_COACH_PRICING_VERSION_ID: "coach-pricing-v1",
    LLM_COACH_MAX_INPUT_BYTES: "65536",
    LLM_COACH_MAX_INPUT_TOKENS: "131072",
    LLM_COACH_MAX_OUTPUT_TOKENS: "4096",
    LLM_COACH_MAX_IMAGES: "4",
    LLM_COACH_MAX_IMAGE_BYTES: "65536",
    LLM_COACH_PROVIDER_INPUT_COST_MICROS_PER_MILLION: "1500",
    LLM_COACH_PROVIDER_OUTPUT_COST_MICROS_PER_MILLION: "6000",
    LLM_NUTRITION_MODEL: "nutrition-model",
    LLM_NUTRITION_INPUT_CREDITS_PER_MILLION: "3000",
    LLM_NUTRITION_OUTPUT_CREDITS_PER_MILLION: "4000",
    LLM_NUTRITION_PRICING_VERSION_ID: "nutrition-pricing-v1",
    LLM_NUTRITION_MAX_INPUT_BYTES: "524288",
    LLM_NUTRITION_MAX_INPUT_TOKENS: "1048576",
    LLM_NUTRITION_MAX_OUTPUT_TOKENS: "2048",
    LLM_NUTRITION_MAX_IMAGES: "4",
    LLM_NUTRITION_MAX_IMAGE_BYTES: "393216",
    LLM_NUTRITION_PROVIDER_INPUT_COST_MICROS_PER_MILLION: "2500",
    LLM_NUTRITION_PROVIDER_OUTPUT_COST_MICROS_PER_MILLION: "10000",
    LLM_FINGERPRINT_SECRET: "fingerprint-secret-with-at-least-32-characters",
    LLM_MONTHLY_FREE_CREDITS: "2500",
    DELETION_WORKER_POLL_MS: "1000",
    ...overrides,
  };
}
