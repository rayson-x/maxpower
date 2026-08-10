import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import {
  InMemoryIdentityAdapter,
  LOCAL_TEST_ONLY_DEBUG_OTP,
} from "../src/modules/identity/index.js";
import {
  InMemoryProductDataAdapter,
  ProductDataModule,
} from "../src/modules/product-data/index.js";
import {
  InMemoryMediaLibraryAdapter,
  MediaLibraryModule,
} from "../src/modules/media/index.js";
import {
  InMemoryLlmEntitlementAdapter,
  InMemoryLlmProviderAdapter,
  InMemoryLlmUsageAdapter,
  LlmGateway,
} from "../src/modules/llm/index.js";
import {
  AccountDeletionModule,
  InMemoryAccountDeletionAdapter,
} from "../src/modules/account-deletion/index.js";

test("HTTP contract carries an authenticated user from registration to cloud data and LLM", async () => {
  const identity = new InMemoryIdentityAdapter({
    debugOtp: LOCAL_TEST_ONLY_DEBUG_OTP,
    requiredTermsVersion: "2026-08-10",
  });
  const registration = await identity.startRegistrationOtp({
    identifier: { kind: "email", value: "owner@example.com" },
  });
  const verified = await identity.verifyRegistrationOtp({
    challengeId: registration.challengeId,
    code: LOCAL_TEST_ONLY_DEBUG_OTP,
  });
  assert.equal(verified.status, "registration_required");
  const authenticated = await identity.completeRegistration({
    registrationId: verified.registrationId,
    displayName: "Owner",
    password: "long-enough-password",
    termsVersion: "2026-08-10",
  });

  const provider = new InMemoryLlmProviderAdapter([
    {
      kind: "complete",
      response: {
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ready" } }],
      },
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6, credits: 6 },
    },
  ]);
  const entitlements = new InMemoryLlmEntitlementAdapter({
    [authenticated.accountId]: { availableCredits: 1_000 },
  });
  const app = createApp({
    identity,
    tokens: identity,
    productData: new ProductDataModule({ adapter: new InMemoryProductDataAdapter() }),
    media: new MediaLibraryModule({ adapter: new InMemoryMediaLibraryAdapter() }),
    llm: new LlmGateway({
      provider,
      entitlements,
      usage: new InMemoryLlmUsageAdapter(),
      fingerprintSecret: "contract-test-secret-value",
    }),
    accountDeletion: new AccountDeletionModule({
      adapter: new InMemoryAccountDeletionAdapter(),
    }),
    localDebugOtp: LOCAL_TEST_ONLY_DEBUG_OTP,
  });
  const authorization = `Bearer ${authenticated.accessToken}`;

  const health = await app.request("/healthz");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const authConfig = await app.request("/v1/auth/config");
  assert.deepEqual(await authConfig.json(), {
    realm: "global",
    requiredTermsVersion: "2026-08-10",
    socialProviders: ["google", "apple"],
  });

  const openApi = await app.request("/openapi.json");
  assert.equal(openApi.status, 200);
  const openApiBody = await openApi.json() as {
    openapi: string;
    paths: Record<string, {
      get?: { parameters?: Array<{ name?: string }> };
      post?: { requestBody?: { content?: { "application/json"?: { schema?: unknown } } } };
    }>;
    components?: { schemas?: Record<string, unknown> };
  };
  assert.equal(openApiBody.openapi, "3.1.0");
  assert.ok(openApiBody.paths["/v1/chat/completions"]);
  const openAiRequestSchema = openApiBody.components?.schemas?.OpenAiChatCompletionRequest as {
    additionalProperties?: boolean;
    properties?: Record<string, unknown>;
  };
  assert.equal(openAiRequestSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(openAiRequestSchema.properties ?? {}).sort(), [
    "max_completion_tokens",
    "max_tokens",
    "messages",
    "model",
    "parallel_tool_calls",
    "response_format",
    "stream",
    "temperature",
    "tools",
  ]);
  const cancelRequestSchema = openApiBody.components?.schemas?.CancelLlmInvocationRequest as {
    properties?: { idempotencyKey?: { pattern?: string } };
  };
  assert.equal(cancelRequestSchema.properties?.idempotencyKey?.pattern, ".*\\S.*");
  for (const path of ["/v1/plans", "/v1/workout-sessions", "/v1/results", "/v1/media"]) {
    assert.deepEqual(
      openApiBody.paths[path]?.get?.parameters?.map((parameter) => parameter.name),
      ["limit", "cursor"],
    );
  }
  assert.ok(openApiBody.components?.schemas?.MediaEvidenceReference);
  assert.ok(openApiBody.components?.schemas?.MediaUploadTarget);
  assert.deepEqual(
    openApiBody.paths["/v1/media/uploads"]?.post?.requestBody?.content?.["application/json"]
      ?.schema,
    { $ref: "#/components/schemas/CreateMediaUploadRequest" },
  );

  const profile = await app.request("/v1/me", { headers: { authorization } });
  assert.equal(profile.status, 200);
  assert.equal(profile.headers.get("etag"), '"1"');

  const plan = await app.request("/v1/plans", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": "plan-create-1",
    },
    body: JSON.stringify({ title: "First plan", snapshot: { days: 3 } }),
  });
  assert.equal(plan.status, 201);
  assert.equal((await plan.json() as { title: string }).title, "First plan");
  const plansPage = await app.request("/v1/plans?limit=1", { headers: { authorization } });
  assert.equal(plansPage.status, 200);
  assert.deepEqual(
    Object.keys(await plansPage.json() as Record<string, unknown>).sort(),
    ["data", "nextCursor"],
  );
  const invalidPlansCursor = await app.request("/v1/plans?cursor=broken", {
    headers: { authorization },
  });
  assert.equal(invalidPlansCursor.status, 400);
  assert.equal(
    (await invalidPlansCursor.json() as { error: { code: string } }).error.code,
    "invalid_cursor",
  );

  const uploadResponse = await app.request("/v1/media/uploads", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": "media-upload-1",
    },
    body: JSON.stringify({
      kind: "nutrition_photo",
      fileName: "meal.jpg",
      contentType: "image/jpeg",
      byteSize: 1024,
      sha256: "a".repeat(64),
    }),
  });
  assert.equal(uploadResponse.status, 201);
  const uploadBody = await uploadResponse.json() as {
    asset: { id: string };
    upload: { id: string; revision: number };
    uploadTarget: { kind: string };
  };
  assert.equal(uploadBody.uploadTarget.kind, "local_test");

  const completedUpload = await app.request(
    `/v1/media/uploads/${uploadBody.upload.id}/complete`,
    {
      method: "POST",
      headers: {
        authorization,
        "idempotency-key": "media-complete-1",
        "if-match": String(uploadBody.upload.revision),
      },
    },
  );
  assert.equal(completedUpload.status, 200);

  const mediaPage = await app.request("/v1/media?limit=1", { headers: { authorization } });
  assert.equal(mediaPage.status, 200);
  assert.deepEqual(
    Object.keys(await mediaPage.json() as Record<string, unknown>).sort(),
    ["data", "nextCursor"],
  );

  const workoutResponse = await app.request("/v1/workout-sessions", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": "workout-with-media-1",
    },
    body: JSON.stringify({
      title: "Media-backed workout",
      mediaAssetIds: [uploadBody.asset.id],
    }),
  });
  assert.equal(workoutResponse.status, 201);
  const workoutBody = await workoutResponse.json() as {
    id: string;
    mediaReferences: Array<{ assetId: string; evidenceStatus: string }>;
  };
  assert.deepEqual(workoutBody.mediaReferences, [{
    assetId: uploadBody.asset.id,
    evidenceStatus: "available",
    evidenceDeletedAt: null,
  }]);

  const resultResponse = await app.request("/v1/results", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": "result-with-media-1",
    },
    body: JSON.stringify({
      kind: "nutrition_observation",
      workoutSessionId: workoutBody.id,
      payload: { confirmed: true },
      mediaAssetIds: [uploadBody.asset.id],
    }),
  });
  assert.equal(resultResponse.status, 201);
  assert.equal(
    (await resultResponse.json() as { mediaReferences: Array<{ assetId: string }> })
      .mediaReferences[0]?.assetId,
    uploadBody.asset.id,
  );

  const download = await app.request(
    `/v1/media/${uploadBody.asset.id}/download-url`,
    { method: "POST", headers: { authorization } },
  );
  assert.equal(download.status, 200);
  assert.equal((await download.json() as { kind: string }).kind, "local_test");

  const completion = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": "llm-turn-1",
      "x-client-run-id": "run-1",
    },
    body: JSON.stringify({
      model: "maxpower/coach-v1",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    }),
  });
  assert.equal(completion.status, 200);
  const completionBody = await completion.json() as { model: string; choices: unknown[] };
  assert.equal(completionBody.model, "maxpower-cloud");
  assert.equal(completionBody.choices.length, 1);
  assert.equal(provider.calls.length, 1);

  const completedCancellation = await app.request("/v1/invocations/cancel", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: "llm-turn-1" }),
  });
  assert.equal(completedCancellation.status, 202);
  assert.equal(
    (await completedCancellation.json() as { status: string }).status,
    "already_terminal",
  );
  const blankCancellation = await app.request("/v1/invocations/cancel", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: "   " }),
  });
  assert.equal(blankCancellation.status, 400);

  const entitlement = await app.request("/v1/entitlements/me", {
    headers: { authorization },
  });
  assert.equal(entitlement.status, 200);
  assert.deepEqual(await entitlement.json(), {
    status: "available",
  });

  const deletionRequestKey = "c".repeat(64);
  const deletion = await app.request("/v1/me/deletion", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": deletionRequestKey,
    },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  assert.equal(deletion.status, 202);
  const deletionBody = await deletion.json() as {
    id: string;
    status: string;
    deletionReceipt: string;
  };
  assert.equal(deletionBody.status, "pending");
  assert.notEqual(deletionBody.deletionReceipt, deletionRequestKey);

  const deletionProgress = await app.request("/v1/me/deletion", {
    headers: { "deletion-receipt": deletionBody.deletionReceipt },
  });
  assert.equal(deletionProgress.status, 200);
  const deletionProgressBody = await deletionProgress.json() as Record<string, unknown>;
  assert.equal(deletionProgressBody.id, deletionBody.id);
  assert.equal("accountId" in deletionProgressBody, false);
  assert.equal("deletionReceipt" in deletionProgressBody, false);

  const guessedDeletionReplay = await app.request("/v1/me/deletion", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "guessable-delete-key",
    },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  assert.equal(guessedDeletionReplay.status, 400);

  const deletionReplay = await app.request("/v1/me/deletion", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": deletionRequestKey,
    },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  assert.equal(deletionReplay.status, 202);
  const deletionReplayBody = await deletionReplay.json() as Record<string, unknown>;
  assert.equal(deletionReplayBody.id, deletionBody.id);
  assert.equal(deletionReplayBody.deletionReceipt, deletionBody.deletionReceipt);
  assert.equal("accountId" in deletionReplayBody, false);
});

test("HTTP contract returns one stable error envelope", async () => {
  const identity = new InMemoryIdentityAdapter();
  const app = createApp({
    identity,
    tokens: identity,
    productData: new ProductDataModule({ adapter: new InMemoryProductDataAdapter() }),
    media: new MediaLibraryModule({ adapter: new InMemoryMediaLibraryAdapter() }),
    llm: new LlmGateway({
      provider: new InMemoryLlmProviderAdapter(),
      entitlements: new InMemoryLlmEntitlementAdapter(),
      usage: new InMemoryLlmUsageAdapter(),
      fingerprintSecret: "contract-test-secret-value",
    }),
    accountDeletion: new AccountDeletionModule({
      adapter: new InMemoryAccountDeletionAdapter(),
    }),
  });

  const response = await app.request("/v1/me");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      message: "A valid access token is required.",
      type: "authentication_error",
      code: "invalid_access_token",
      param: null,
    },
  });
});
