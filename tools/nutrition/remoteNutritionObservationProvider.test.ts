import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryMediaBlobStore, InMemorySecureCredentialPort } from "../../src/privacy";
import {
  normalizeNutritionPhoto,
  NutritionObservationError,
  NutritionRemoteTransportError,
  OpenAICompatibleNutritionTransport,
  RemoteNutritionObservationProvider,
} from "../../src/nutrition";

function pngWithText(): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const chunk = (kind: string, data: number[]) => [
    (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff,
    ...[...kind].map((item) => item.charCodeAt(0)), ...data, 0, 0, 0, 0,
  ];
  return new Uint8Array([
    ...signature,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...chunk("tEXt", [..."filename=home-address.png"].map((item) => item.charCodeAt(0))),
    ...chunk("IEND", []),
  ]);
}

test("photo normalization verifies true PNG bytes and strips text metadata without touching the local original", () => {
  const original = pngWithText();
  const prepared = normalizeNutritionPhoto({ id: "photo-1", mimeType: "image/png", bytes: original }, { maxBytes: 1_000_000, maxPixels: 10_000 });
  assert.equal(prepared.width, 1);
  assert.equal(prepared.height, 1);
  assert.equal(prepared.metadataStripped, true);
  assert.equal(Buffer.from(prepared.bytes).includes(Buffer.from("filename=home-address.png")), false);
  assert.equal(Buffer.from(original).includes(Buffer.from("filename=home-address.png")), true);
  assert.throws(
    () => normalizeNutritionPhoto({ id: "not-an-image", mimeType: "image/jpeg", bytes: original }, { maxBytes: 1_000_000, maxPixels: 10_000 }),
    (error: unknown) => error instanceof NutritionObservationError && error.code === "invalid_media",
  );
});

test("remote nutrition adapter reads credential securely and sends only sanitized opaque photo bytes", async () => {
  const credentials = new InMemorySecureCredentialPort();
  await credentials.put({ key: { accountId: "local-user", scope: "remote_llm", name: "nutrition" }, value: "secret-not-for-ledger" });
  const media = new InMemoryMediaBlobStore();
  const original = pngWithText();
  const photo = await media.put({ userId: "u", mimeType: "image/png", bytes: original });
  let request: { credential: string; photos: readonly { id: string; bytes: Uint8Array }[] } | undefined;
  const provider = new RemoteNutritionObservationProvider({
    userId: "u", providerId: "approved-vision", modelVersion: "v1", credential: credentials,
    credentialKey: { accountId: "local-user", name: "nutrition" }, media,
    transport: {
      async estimate(input) {
        request = input;
        return {
          candidates: [{
            foodName: "鸡肉饭", portionAssumption: "一份", energyRange: { min: { value: 500, unit: "kcal" }, max: { value: 700, unit: "kcal" } },
            assumptions: ["酱汁未知"], confidence: "low",
          }],
          missing: ["份量"],
        };
      },
    },
  });
  const result = await provider.estimate({ localMediaRefs: [photo.id], mediaConsent: "provider_authorized", purpose: "meal_estimate" });
  assert.equal(result.provider.processingScope, "photo");
  assert.equal(request?.credential, "secret-not-for-ledger");
  assert.equal(request?.photos[0]?.id, photo.id);
  assert.equal(Buffer.from(request?.photos[0]?.bytes ?? []).includes(Buffer.from("filename=home-address.png")), false);
  assert.equal(Buffer.from((await media.get({ userId: "u", id: photo.id }))?.bytes ?? []).includes(Buffer.from("filename=home-address.png")), true);
});

test("a visible cancellation stops the adapter before credential use or transport upload", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const provider = new RemoteNutritionObservationProvider({
    userId: "u", providerId: "approved-vision", modelVersion: "v1", credential: new InMemorySecureCredentialPort(),
    credentialKey: { accountId: "u", name: "nutrition" }, media: new InMemoryMediaBlobStore(),
    transport: { async estimate() { calls += 1; return { candidates: [], missing: [] }; } },
  });
  await assert.rejects(
    provider.estimate({ text: "一碗饭", mediaConsent: "not_requested", purpose: "meal_estimate", signal: controller.signal }),
    (error: unknown) => error instanceof NutritionObservationError && error.code === "cancelled",
  );
  assert.equal(calls, 0);
});

test("the remote adapter itself refuses photo upload without visible provider consent", async () => {
  const media = new InMemoryMediaBlobStore();
  const photo = await media.put({ userId: "u", mimeType: "image/png", bytes: pngWithText() });
  const provider = new RemoteNutritionObservationProvider({
    userId: "u", providerId: "approved-vision", modelVersion: "v1", credential: new InMemorySecureCredentialPort(),
    credentialKey: { accountId: "u", name: "nutrition" }, media,
    transport: { async estimate() { throw new Error("must_not_upload"); } },
  });
  await assert.rejects(
    provider.estimate({ localMediaRefs: [photo.id], mediaConsent: "local_only", purpose: "meal_estimate" }),
    (error: unknown) => error instanceof NutritionObservationError && error.code === "media_consent_required",
  );
});

test("provider transport failures keep a typed user-visible category and malformed estimates are rejected", async () => {
  const credentials = new InMemorySecureCredentialPort();
  await credentials.put({ key: { accountId: "u", scope: "remote_llm", name: "nutrition" }, value: "secret" });
  const unavailable = new RemoteNutritionObservationProvider({
    userId: "u", providerId: "approved-vision", modelVersion: "v1", credential: credentials,
    credentialKey: { accountId: "u", name: "nutrition" }, media: new InMemoryMediaBlobStore(),
    transport: {
      async estimate() { throw new NutritionRemoteTransportError("rate_limited"); },
    },
  });
  await assert.rejects(
    unavailable.estimate({ text: "鸡肉饭", mediaConsent: "not_requested", purpose: "meal_estimate" }),
    (error: unknown) => error instanceof NutritionObservationError && error.code === "rate_limited",
  );

  const malformed = new RemoteNutritionObservationProvider({
    userId: "u", providerId: "approved-vision", modelVersion: "v1", credential: credentials,
    credentialKey: { accountId: "u", name: "nutrition" }, media: new InMemoryMediaBlobStore(),
    transport: {
      async estimate() {
        return {
          candidates: [{ foodName: "鸡肉饭", portionAssumption: "一份", assumptions: [], confidence: "high" }],
          missing: [],
        };
      },
    },
  });
  await assert.rejects(
    malformed.estimate({ text: "鸡肉饭", mediaConsent: "not_requested", purpose: "meal_estimate" }),
    (error: unknown) => error instanceof NutritionObservationError && error.code === "schema_invalid",
  );
});

test("OpenAI-compatible transport sends only the explicit description and sanitized photo payload", async () => {
  const credentials = new InMemorySecureCredentialPort();
  await credentials.put({ key: { accountId: "u", scope: "remote_llm", name: "nutrition" }, value: "remote-secret" });
  const media = new InMemoryMediaBlobStore();
  const photo = await media.put({ userId: "u", mimeType: "image/png", bytes: pngWithText() });
  let captured: { url: string; headers: Readonly<Record<string, string>>; body: string } | undefined;
  const transport = new OpenAICompatibleNutritionTransport({
    endpoint: "https://example.invalid/v1/chat/completions",
    model: "vision-model",
    fetch: async (url, init) => {
      captured = { url, headers: init.headers, body: init.body };
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: JSON.stringify({
            candidates: [{
              foodName: "鸡肉饭",
              portionAssumption: "一份",
              energyRange: { min: { value: 500, unit: "kcal" }, max: { value: 700, unit: "kcal" } },
              assumptions: ["酱汁未知"],
              confidence: "low",
            }],
            missing: ["份量"],
          }) } }] };
        },
      };
    },
  });
  const provider = new RemoteNutritionObservationProvider({
    userId: "u", providerId: "openai-compatible", modelVersion: "vision-model", credential: credentials,
    credentialKey: { accountId: "u", name: "nutrition" }, media, transport,
  });

  const result = await provider.estimate({
    text: "午餐鸡肉饭",
    localMediaRefs: [photo.id],
    mediaConsent: "provider_authorized",
    purpose: "meal_estimate",
  });
  assert.equal(result.candidates[0]?.foodName, "鸡肉饭");
  assert.equal(captured?.url, "https://example.invalid/v1/chat/completions");
  assert.equal(captured?.headers.authorization, "Bearer remote-secret");
  assert.match(captured?.body ?? "", /午餐鸡肉饭/);
  assert.doesNotMatch(captured?.body ?? "", /remote-secret|filename=home-address\.png|photo-1/);
  assert.match(captured?.body ?? "", /data:image\/png;base64,/);
});

test("OpenAI-compatible transport does not mislabel provider HTTP failures as timeouts", async () => {
  const transport = new OpenAICompatibleNutritionTransport({
    endpoint: "https://example.invalid/v1/chat/completions",
    model: "vision-model",
    fetch: async () => ({ ok: false, status: 500, async json() { return {}; } }),
  });
  await assert.rejects(
    transport.estimate({ credential: "secret", inputProvenance: ["text"], photos: [], purpose: "meal_estimate", text: "米饭" }),
    /nutrition_remote_http_failure/,
  );
});

test("远程营养描述会移除直接身份片段，并把脱敏范围返回给草稿审计", async () => {
  const credentials = new InMemorySecureCredentialPort();
  await credentials.put({ key: { accountId: "u", scope: "remote_llm", name: "nutrition" }, value: "secret" });
  let body = "";
  const provider = new RemoteNutritionObservationProvider({
    userId: "u", providerId: "openai-compatible", modelVersion: "vision-model", credential: credentials,
    credentialKey: { accountId: "u", name: "nutrition" }, media: new InMemoryMediaBlobStore(),
    transport: new OpenAICompatibleNutritionTransport({
      endpoint: "https://example.invalid/v1/chat/completions",
      model: "vision-model",
      fetch: async (_url, init) => {
        body = init.body;
        return { ok: true, status: 200, async json() { return { choices: [{ message: { content: JSON.stringify({
          candidates: [{ foodName: "米饭", portionAssumption: "一碗", assumptions: ["份量未知"], confidence: "low" }],
          missing: ["营养标签"],
        }) } }] }; } };
      },
    }),
  });
  const result = await provider.estimate({
    text: "午餐：米饭。邮箱 alex@example.com，电话 13812345678，住址：上海市静安区测试路 1 号。",
    mediaConsent: "not_requested",
    purpose: "meal_estimate",
  });
  assert.doesNotMatch(body, /alex@example\.com|13812345678|上海市静安区测试路/);
  assert.match(body, /午餐：米饭/);
  assert.deepEqual(result.redactionManifest, ["request.text.email", "request.text.phone", "request.text.address_label"]);
});
