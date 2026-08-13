import assert from "node:assert/strict";
import test from "node:test";

import type { MediaBlobStore } from "../../src/privacy";
import { NutritionObservationError } from "../../src/nutrition/RemoteNutritionObservationProvider";
import {
  CloudNutritionObservationProviderResolver,
  MAXPOWER_NUTRITION_ALIAS,
} from "../../src/mobile/cloud/CloudNutritionObservationProvider";

const unusedMedia: MediaBlobStore = {
  async put() { throw new Error("unused"); },
  async get() { return null; },
  async reference() { return null; },
  async list() { return []; },
  async delete() {},
};

test("营养观察固定走 MaxPower Gateway alias 与内存 service JWT", async () => {
  let url = "";
  let body: Record<string, unknown> = {};
  let headers: Readonly<Record<string, string>> = {};
  const resolver = new CloudNutritionObservationProviderResolver({
    apiBaseUrl: "https://api.maxpower.example/provider-looking-path",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "ephemeral-service-jwt" },
    media: unusedMedia,
    permission: async () => ({ mediaUpload: "denied" }),
    requestId: () => "nutrition-request-1",
    fetch: async (requestUrl, init) => {
      url = requestUrl;
      body = JSON.parse(init.body) as Record<string, unknown>;
      headers = init.headers;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  candidates: [{
                    foodName: "rice",
                    portionAssumption: "one bowl",
                    energyRange: { min: { value: 200, unit: "kcal" }, max: { value: 300, unit: "kcal" } },
                    assumptions: ["portion estimated"],
                    confidence: "medium",
                  }],
                  missing: [],
                }),
              },
            }],
          };
        },
      };
    },
  });
  const request = {
    text: "一碗米饭",
    mediaConsent: "not_requested" as const,
    purpose: "meal_estimate" as const,
  };
  const provider = await resolver.resolve({ userId: "account-a", request });
  assert.ok(provider);
  const result = await provider.estimate(request);

  assert.equal(url, "https://api.maxpower.example/v1/chat/completions");
  assert.equal(body.model, MAXPOWER_NUTRITION_ALIAS);
  assert.equal(headers.authorization, "Bearer ephemeral-service-jwt");
  assert.match(headers["idempotency-key"] ?? "", /^nutrition-/);
  assert.match(headers["x-client-run-id"] ?? "", /^nutrition-/);
  assert.equal(JSON.stringify(body).includes("ephemeral-service-jwt"), false);
  assert.equal(result.provider.id, "maxpower-cloud");
  assert.equal(result.provider.modelVersion, MAXPOWER_NUTRITION_ALIAS);
});

test("本地照片未被用户允许上传时不会创建任何云请求", async () => {
  let calls = 0;
  const resolver = new CloudNutritionObservationProviderResolver({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "jwt" },
    media: unusedMedia,
    permission: async () => ({ mediaUpload: "denied" }),
    fetch: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
  });
  const request = {
    localMediaRefs: ["local-photo-1"],
    mediaConsent: "provider_authorized" as const,
    purpose: "meal_estimate" as const,
  };
  await assert.rejects(
    () => resolver.resolve({ userId: "account-a", request }),
    (error: unknown) => error instanceof NutritionObservationError && error.code === "media_consent_required",
  );
  assert.equal(calls, 0);
});

test("营养观察拒绝跨账号解析，并随账号 runtime 中止", async () => {
  const account = new AbortController();
  const resolver = new CloudNutritionObservationProviderResolver({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "jwt" },
    media: unusedMedia,
    permission: async () => ({ mediaUpload: "granted" }),
    accountSignal: account.signal,
  });
  const request = { text: "meal", mediaConsent: "not_requested" as const, purpose: "meal_estimate" as const };
  await assert.rejects(() => resolver.resolve({ userId: "account-b", request }), /cloud_nutrition_account_mismatch/);
  account.abort();
  const provider = await resolver.resolve({ userId: "account-a", request });
  assert.ok(provider);
  await assert.rejects(
    () => provider.estimate(request),
    (error: unknown) => error instanceof NutritionObservationError && error.code === "cancelled",
  );
});

test("已开始的营养请求被主动中止时使用原幂等键通知 Gateway 结算", async () => {
  const requestAbort = new AbortController();
  let started!: () => void;
  const upstreamStarted = new Promise<void>((resolve) => { started = resolve; });
  let chatKey = "";
  let cancelledKey = "";
  let cancellationAttempts = 0;
  const resolver = new CloudNutritionObservationProviderResolver({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "ephemeral-service-jwt" },
    media: unusedMedia,
    permission: async () => ({ mediaUpload: "granted" }),
    requestId: () => "nutrition-cancel-1",
    cancellationAttemptTimeoutMs: 5,
    cancellationRetryDelayMs: 0,
    fetch: async (url, init) => {
      if (url.endsWith("/v1/invocations/cancel")) {
        cancellationAttempts += 1;
        cancelledKey = (JSON.parse(init.body) as { idempotencyKey: string }).idempotencyKey;
        if (cancellationAttempts === 1) return new Promise(() => undefined);
        return {
          ok: cancellationAttempts === 3,
          status: cancellationAttempts === 3 ? 202 : 503,
          async json() { return {}; },
        };
      }
      chatKey = init.headers["idempotency-key"] ?? "";
      started();
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    },
  });
  const request = {
    text: "meal",
    mediaConsent: "not_requested" as const,
    purpose: "meal_estimate" as const,
    signal: requestAbort.signal,
  };
  const provider = await resolver.resolve({ userId: "account-a", request });
  const pending = provider.estimate(request);
  await upstreamStarted;
  requestAbort.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof NutritionObservationError && error.code === "cancelled",
  );
  assert.match(chatKey, /^nutrition-/);
  assert.equal(cancelledKey, chatKey);
  assert.equal(cancellationAttempts, 3);
});
