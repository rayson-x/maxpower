import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import { InMemoryIdentityAdapter, LOCAL_TEST_ONLY_DEBUG_OTP } from "../src/modules/identity/index.js";
import { InMemoryLlmEntitlementAdapter, InMemoryLlmProviderAdapter, InMemoryLlmUsageAdapter, LlmGateway } from "../src/modules/llm/index.js";
import { AccountDeletionModule, InMemoryAccountDeletionAdapter } from "../src/modules/account-deletion/index.js";

function application(identity: InMemoryIdentityAdapter, provider = new InMemoryLlmProviderAdapter()) {
  return createApp({
    identity,
    tokens: identity,
    llm: new LlmGateway({
      provider,
      entitlements: new InMemoryLlmEntitlementAdapter(),
      usage: new InMemoryLlmUsageAdapter(),
      fingerprintSecret: "contract-test-secret-value",
    }),
    accountDeletion: new AccountDeletionModule({ adapter: new InMemoryAccountDeletionAdapter() }),
    localDebugOtp: LOCAL_TEST_ONLY_DEBUG_OTP,
  });
}

test("HTTP contract exposes identity and LLM only; product and media resources stay local", async () => {
  const identity = new InMemoryIdentityAdapter({ debugOtp: LOCAL_TEST_ONLY_DEBUG_OTP, requiredTermsVersion: "2026-08-10" });
  const app = application(identity);
  const openApi = await app.request("/openapi.json");
  assert.equal(openApi.status, 200);
  const document = await openApi.json() as { paths: Record<string, unknown>; components?: { schemas?: Record<string, unknown> } };
  assert.ok(document.paths["/v1/chat/completions"]);
  assert.ok(document.paths["/v1/auth/session"]);
  for (const path of ["/v1/plans", "/v1/workout-sessions", "/v1/results", "/v1/media", "/v1/me"]) {
    assert.equal(document.paths[path], undefined);
  }
  for (const schema of ["Profile", "Plan", "WorkoutSession", "Result", "MediaAsset"]) {
    assert.equal(document.components?.schemas?.[schema], undefined);
  }
  assert.equal((await app.request("/v1/plans")).status, 404);
  assert.equal((await app.request("/v1/media")).status, 404);
});

test("protected LLM routes keep the stable authentication error envelope", async () => {
  const app = application(new InMemoryIdentityAdapter());
  const response = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "invoke-1", "x-client-run-id": "run-1" },
    body: JSON.stringify({ model: "maxpower/coach-v1", messages: [{ role: "user", content: "hello" }] }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { message: "A valid access token is required.", type: "authentication_error", code: "invalid_access_token", param: null },
  });
});
