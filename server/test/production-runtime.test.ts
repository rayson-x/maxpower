import assert from "node:assert/strict";
import test from "node:test";

import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

import { parseProductionConfig } from "../src/config/production-config.js";
import { composeProductionRuntime } from "../src/runtime/production/production-runtime.js";

test("production runtime composes only durable adapters behind hardened HTTP middleware", async (t) => {
  const postgres = new Pool({
    connectionString: "postgresql://maxpower:secret@db.example/maxpower?sslmode=require",
  });
  const objectStorage = new S3Client({
    endpoint: "https://objects.maxpower.example",
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  t.after(async () => {
    objectStorage.destroy();
    await postgres.end();
  });
  const redisCommands: string[][] = [];
  const redis = {
    async sendCommand(command: string[]) {
      redisCommands.push(command);
      if (command[0] === "EVAL" && command[2] === "1") return [1, 60];
      if (command[0] === "PING") return "PONG";
      return 1;
    },
    async close() {},
  };
  const logLines: string[] = [];
  const config = parseProductionConfig(validEnvironment());
  const runtime = composeProductionRuntime(config, {
    postgres,
    rateLimitRedis: redis,
    streamRedis: redis,
    objectStorage,
    async close() {},
  }, {
    writeLogLine(line) { logLines.push(line); },
  });

  const health = await runtime.app.request("/healthz", {
    headers: { origin: "https://app.maxpower.example", "x-real-ip": "203.0.113.10" },
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(health.headers.get("access-control-allow-origin"), "https://app.maxpower.example");
  assert.deepEqual(runtime.adapterKinds, {
    identity: "better-auth-postgres",
    productData: "postgres",
    media: "s3-private",
    entitlement: "postgres-ledger",
    llmProvider: "openai-compatible",
    streamBuffer: "redis-volatile",
    deletion: "postgres-worker",
  });
  assert.equal(logLines.length, 1);
  assert.equal(logLines[0]?.includes("x-real-ip"), false);

  const bypass = await runtime.app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { origin: "https://app.maxpower.example", "x-real-ip": "203.0.113.10" },
  });
  assert.equal(bypass.status, 404);
  assert.ok(redisCommands.some((command) => command[0] === "EVAL"));

  const appleCallback = await runtime.app.request("/api/auth/callback/apple", {
    method: "POST",
    headers: {
      origin: "https://appleid.apple.com",
      "content-type": "application/x-www-form-urlencoded",
      "x-real-ip": "203.0.113.10",
    },
    body: "error=access_denied",
  });
  assert.notEqual(appleCallback.status, 403);
  assert.equal(appleCallback.headers.get("access-control-allow-origin"), null);
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    MAXPOWER_RUNTIME: "production",
    PORT: "8787",
    DATABASE_URL: "postgresql://maxpower:secret@db.example:5432/maxpower?sslmode=require",
    RATE_LIMIT_REDIS_URL: "rediss://rate.redis.example:6380/0",
    STREAM_REDIS_URL: "rediss://stream.redis.example:6380/0",
    STREAM_REDIS_PERSISTENCE: "disabled",
    HTTP_ALLOWED_ORIGINS: "https://app.maxpower.example",
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
    GOOGLE_CLIENT_IDS: "google-web",
    GOOGLE_CLIENT_SECRET: "google-secret",
    APPLE_CLIENT_IDS: "apple-service",
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
    LLM_COACH_PROVIDER_ENDPOINT: "https://coach-provider.example/v1/chat/completions",
    LLM_COACH_PROVIDER_API_KEY: "coach-provider-secret",
    LLM_COACH_PROVIDER_ID: "coach-provider",
    LLM_COACH_MODEL: "coach-model",
    LLM_COACH_INPUT_CREDITS_PER_MILLION: "1000",
    LLM_COACH_OUTPUT_CREDITS_PER_MILLION: "2000",
    LLM_COACH_PRICING_VERSION_ID: "coach-pricing-v1",
    LLM_COACH_MAX_INPUT_BYTES: "65536",
    LLM_COACH_MAX_INPUT_TOKENS: "131072",
    LLM_COACH_MAX_OUTPUT_TOKENS: "4096",
    LLM_COACH_MAX_IMAGES: "0",
    LLM_COACH_MAX_IMAGE_BYTES: "65536",
    LLM_COACH_PROVIDER_INPUT_COST_MICROS_PER_MILLION: "1500",
    LLM_COACH_PROVIDER_OUTPUT_COST_MICROS_PER_MILLION: "6000",
    LLM_NUTRITION_PROVIDER_ENDPOINT: "https://vision-provider.example/v1/chat/completions",
    LLM_NUTRITION_PROVIDER_API_KEY: "vision-provider-secret",
    LLM_NUTRITION_PROVIDER_ID: "vision-provider",
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
  };
}
