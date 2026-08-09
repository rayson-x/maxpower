import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { ConfiguredRemoteNutritionObservationProvider } from "../../src/nutrition";
import { InMemoryMediaBlobStore, InMemorySecureCredentialPort } from "../../src/privacy";

function fixture() {
  let sequence = 0;
  let requests = 0;
  const ledger = new InMemoryCoachLedger();
  const credentials = new InMemorySecureCredentialPort();
  const media = new InMemoryMediaBlobStore();
  const resolver = new ConfiguredRemoteNutritionObservationProvider({
    ledger,
    credentials,
    media,
    fetch: async (_url, init) => {
      requests += 1;
      assert.equal(init.headers.authorization, "Bearer device-only-key");
      assert.equal(init.body.includes("device-only-key"), false);
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: JSON.stringify({
            candidates: [{
              foodName: "鸡肉饭",
              portionAssumption: "一份",
              energyRange: { min: { value: 500, unit: "kcal" }, max: { value: 700, unit: "kcal" } },
              assumptions: ["份量为估计"],
              confidence: "low",
            }],
            missing: ["实际份量"],
          }) } }] };
        },
      };
    },
  });
  const app = new CoachApplication({
    ledger,
    credentials,
    nutritionObservationResolver: resolver,
    runtime: { now: () => "2026-08-09T12:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` },
  });
  return { app, media, requests: () => requests };
}

function onePixelPng(): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const chunk = (kind: string, data: number[]) => [
    (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff,
    ...[...kind].map((character) => character.charCodeAt(0)), ...data, 0, 0, 0, 0,
  ];
  return new Uint8Array([...signature, ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), ...chunk("IEND", [])]);
}

async function bootstrap(app: CoachApplication) {
  const meta = {
    userId: "u1", actor: { kind: "user" as const, id: "u1" }, deviceId: "phone-1",
    occurredAt: "2026-08-09T12:00:00.000+08:00", timezoneOffsetMinutes: 480,
  };
  await app.executeDomainCommand({
    type: "user.bootstrap", meta: { ...meta, idempotencyKey: "bootstrap" },
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-09", endDate: "2026-12-09" } },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  await app.executeDomainCommand({
    type: "permission_set.revise", meta: { ...meta, idempotencyKey: "permissions" },
    permissionSetId: "permissions-1", expectedRevision: 0,
    permissionSet: {
      id: "permissions-1", camera: "not_configured", health: "not_configured", notifications: "not_configured",
      remoteLlm: "not_configured", cloudSync: "not_configured", mediaUpload: "not_configured",
    },
    authorization: { kind: "local_user_presence", verifiedAt: meta.occurredAt, nonce: "permissions" },
  });
}

test("远程营养估算仅在本机模型配置与授权同时存在时可用，并在撤销后立即停用", async () => {
  const state = fixture();
  await bootstrap(state.app);
  const request = { text: "午餐鸡肉饭，联系 a@example.com", mediaConsent: "not_requested" as const, purpose: "meal_estimate" as const };
  await assert.rejects(
    state.app.createNutritionObservationDraft({ userId: "u1", occurredAt: "2026-08-09T12:00:00.000+08:00", request, idempotencyKey: "before-config" }),
    /nutrition_observation_provider_unavailable/,
  );
  assert.equal(state.requests(), 0);

  await state.app.configureRemoteLlmProvider({
    userId: "u1", expectedPermissionRevision: 1,
    endpoint: "https://provider.example/v1/chat/completions", model: "vision-model", apiKey: "device-only-key",
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-09T12:00:00.000+08:00", nonce: "configure" },
    idempotencyKey: "configure",
  });
  const draft = await state.app.createNutritionObservationDraft({
    userId: "u1", occurredAt: "2026-08-09T12:00:00.000+08:00", request, idempotencyKey: "configured",
  });
  assert.equal(draft.draft.provider?.id, "openai-compatible");
  assert.equal(draft.draft.provider?.modelVersion, "vision-model");
  assert.equal(draft.draft.status, "draft");
  assert.deepEqual(draft.draft.redactionManifest, ["request.text.email"]);
  assert.equal(state.requests(), 1);

  await state.app.updatePermissionFromSettings({
    userId: "u1", expectedRevision: 2, changes: { remoteLlm: "denied" },
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-09T12:00:00.000+08:00", nonce: "revoke" },
    idempotencyKey: "revoke",
  });
  await assert.rejects(
    state.app.createNutritionObservationDraft({ userId: "u1", occurredAt: "2026-08-09T13:00:00.000+08:00", request, idempotencyKey: "after-revoke" }),
    /nutrition_observation_provider_unavailable/,
  );
  assert.equal(state.requests(), 1);
});

test("照片估算在远程模型已配置时仍需要独立的媒体上传授权", async () => {
  const state = fixture();
  await bootstrap(state.app);
  await state.app.configureRemoteLlmProvider({
    userId: "u1", expectedPermissionRevision: 1,
    endpoint: "https://provider.example/v1/chat/completions", model: "vision-model", apiKey: "device-only-key",
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-09T12:00:00.000+08:00", nonce: "configure-photo" },
    idempotencyKey: "configure-photo",
  });
  const photo = await state.media.put({ userId: "u1", mimeType: "image/png", bytes: onePixelPng() });
  const request = { localMediaRefs: [photo.id], mediaConsent: "provider_authorized" as const, purpose: "meal_estimate" as const };
  await assert.rejects(
    state.app.createNutritionObservationDraft({ userId: "u1", occurredAt: "2026-08-09T12:00:00.000+08:00", request, idempotencyKey: "photo-without-media-grant" }),
    /nutrition_observation_media_consent_required/,
  );
  assert.equal(state.requests(), 0);

  await state.app.updatePermissionFromSettings({
    userId: "u1", expectedRevision: 2, changes: { mediaUpload: "granted" },
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-09T12:00:00.000+08:00", nonce: "grant-photo" },
    idempotencyKey: "grant-photo",
  });
  const draft = await state.app.createNutritionObservationDraft({
    userId: "u1", occurredAt: "2026-08-09T12:00:00.000+08:00", request, idempotencyKey: "photo-with-media-grant" });
  assert.equal(draft.draft.provider?.processingScope, "photo");
  assert.equal(state.requests(), 1);
});
