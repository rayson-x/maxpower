import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  CloudMediaLibrary,
  CloudMediaLibraryError,
  IncrementalSha256,
  type CloudMediaFetch,
  type MediaByteTransferPort,
  type MediaByteTransferInput,
} from "../../src/mobile/cloud/media";

test("large media SHA-256 can be produced incrementally without buffering the whole file", () => {
  const bytes = new TextEncoder().encode("abc".repeat(100_000));
  const digest = new IncrementalSha256();
  for (let offset = 0; offset < bytes.length; offset += 8_191) {
    digest.update(bytes.subarray(offset, Math.min(offset + 8_191, bytes.length)));
  }
  assert.equal(digest.digestHex(), "a77aedfe2e4a7232ea628a71745a966224c4521d93134b993cde5b65ea2f6e3c");
  assert.throws(() => digest.update(new Uint8Array([1])), /sha256_already_finalized/);
});

test("media that the user did not select never creates a cloud asset", async () => {
  let apiCalls = 0;
  let byteTransfers = 0;
  const library = new CloudMediaLibrary({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "short-lived-service-jwt" },
    fetch: (async () => {
      apiCalls += 1;
      throw new Error("unexpected_cloud_request");
    }) as CloudMediaFetch,
    byteTransfer: {
      async put() {
        byteTransfers += 1;
      },
    } satisfies MediaByteTransferPort,
  });

  assert.deepEqual(await library.upload({ decision: "not_selected" }), {
    status: "not_selected",
  });
  assert.equal(apiCalls, 0);
  assert.equal(byteTransfers, 0);
});

test("authenticated runtime exposes the media library through ProductShell's explicit upload and delete UI", () => {
  const root = process.cwd();
  const runtime = readFileSync(resolve(root, "src/mobile/runtime/createMobileAccountRuntime.ts"), "utf8");
  const app = readFileSync(resolve(root, "src/mobile/ui/MaxPowerApp.tsx"), "utf8");
  const shell = readFileSync(resolve(root, "src/mobile/ui/ProductShell.tsx"), "utf8");
  const progress = readFileSync(resolve(root, "src/mobile/ui/ProgressScreen.tsx"), "utf8");

  assert.match(runtime, /cloudMediaLibrary\s*=\s*new CloudMediaLibrary/);
  assert.match(app, /cloudMediaLibrary=\{runtime\.cloudMediaLibrary\}/);
  assert.match(shell, /<VideoLibraryScreen[^>]*cloudMediaLibrary=\{cloudMediaLibrary\}/s);
  for (const label of ["上传到资料库", "上传 packet", "上传关键点", "上传"]) {
    assert.match(progress, new RegExp(label));
  }
  assert.match(progress, /decision:\s*"upload"/);
  assert.match(progress, /cloudMediaLibrary!\.deleteAsset/);
  assert.match(progress, /只有你主动点“上传”后/);
});

test("the opt-in boundary accepts only the four reviewed media kinds", async () => {
  let apiCalls = 0;
  const library = new CloudMediaLibrary({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "jwt" },
    fetch: async () => {
      apiCalls += 1;
      return new Response(null, { status: 500 });
    },
    byteTransfer: { async put() { throw new Error("unexpected_put"); } },
  });
  const invalid = {
    ...uploadChoice("video"),
    kind: "profile_photo",
  } as unknown as Parameters<CloudMediaLibrary["upload"]>[0];

  await assert.rejects(() => library.upload(invalid), /cloud_media_kind_invalid/);
  for (const kind of ["video", "canonical_packet", "keypoints", "nutrition_photo"] as const) {
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      () => library.upload(uploadChoice(kind), { signal: cancelled.signal }),
      (error: unknown) => error instanceof CloudMediaLibraryError && error.code === "cancelled",
    );
  }
  assert.equal(apiCalls, 0);
});

test("an opted-in video uploads through the presigned target, reports progress, and completes", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    jsonResponse({
      asset: mediaAsset({ status: "uploading", revision: 1, readyAt: null }),
      upload: mediaUpload({ status: "pending", revision: 1, completedAt: null }),
      uploadTarget: {
        kind: "presigned_put",
        url: "https://objects.example/upload/video-1",
        headers: {
          "content-type": "video/mp4",
          "content-length": "4",
          "x-amz-checksum-sha256": "declared-checksum",
        },
        expiresAt: "2026-08-10T12:15:00.000Z",
      },
    }, 201),
    jsonResponse({
      asset: mediaAsset({ status: "ready", revision: 2, readyAt: "2026-08-10T12:01:00.000Z" }),
      upload: mediaUpload({
        status: "completed",
        revision: 2,
        completedAt: "2026-08-10T12:01:00.000Z",
      }),
    }),
  ];
  const transferred: MediaByteTransferInput[] = [];
  const phases: string[] = [];
  const sent: number[] = [];
  const tokenAccounts: string[] = [];
  const library = new CloudMediaLibrary({
    apiBaseUrl: "https://api.maxpower.example/ignored",
    accountId: "account-a",
    accessTokens: {
      accessTokenFor(accountId) {
        tokenAccounts.push(accountId);
        return "short-lived-service-jwt";
      },
    },
    fetch: async (url, init) => {
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      const response = responses.shift();
      if (response === undefined) throw new Error("unexpected_cloud_request");
      return response;
    },
    byteTransfer: {
      async put(input) {
        transferred.push(input);
        input.onProgress?.(2);
        input.onProgress?.(4);
      },
    },
  });

  const outcome = await library.upload({
    decision: "upload",
    kind: "video",
    source: { kind: "bytes", bytes: Uint8Array.from([1, 2, 3, 4]) },
    fileName: "squat.mp4",
    contentType: "video/mp4",
    byteSize: 4,
    sha256: "a".repeat(64),
    idempotencyKey: "video-upload-1",
  }, {
    onProgress(progress) {
      phases.push(progress.phase);
      sent.push(progress.bytesSent);
    },
  });

  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(outcome.asset.status, "ready");
  assert.equal(outcome.upload.status, "completed");
  assert.deepEqual(phases, [
    "requesting_target",
    "uploading",
    "uploading",
    "uploading",
    "completing",
    "ready",
  ]);
  assert.deepEqual(sent, [0, 0, 2, 4, 4, 4]);
  assert.deepEqual(tokenAccounts, ["account-a", "account-a"]);
  assert.equal(transferred.length, 1);
  assert.equal(transferred[0]?.url, "https://objects.example/upload/video-1");
  assert.deepEqual(transferred[0]?.headers, {
    "content-type": "video/mp4",
    "content-length": "4",
    "x-amz-checksum-sha256": "declared-checksum",
  });
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://api.maxpower.example/v1/media/uploads",
    "https://api.maxpower.example/v1/media/uploads/upload-1/complete",
  ]);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    kind: "video",
    fileName: "squat.mp4",
    contentType: "video/mp4",
    byteSize: 4,
    sha256: "a".repeat(64),
  });
  assert.equal(new Headers(requests[0]?.init?.headers).get("authorization"), "Bearer short-lived-service-jwt");
  assert.equal(new Headers(requests[0]?.init?.headers).get("idempotency-key"), "video-upload-1");
  assert.equal(new Headers(requests[1]?.init?.headers).get("if-match"), '"1"');
  assert.equal(
    new Headers(requests[1]?.init?.headers).get("idempotency-key"),
    "media-complete:video-upload-1",
  );
});

test("a failed PUT retries the same cloud asset through a freshly returned target", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    jsonResponse({
      asset: mediaAsset(),
      upload: mediaUpload(),
      uploadTarget: uploadTarget("https://objects.example/upload/attempt-1"),
    }, 201),
    jsonResponse({
      asset: mediaAsset(),
      upload: mediaUpload({ revision: 2, expiresAt: "2026-08-10T12:30:00.000Z" }),
      uploadTarget: uploadTarget(
        "https://objects.example/upload/attempt-2",
        "2026-08-10T12:30:00.000Z",
      ),
    }, 201),
    jsonResponse({
      asset: mediaAsset({ status: "ready", revision: 2, readyAt: "2026-08-10T12:16:00.000Z" }),
      upload: mediaUpload({
        status: "completed",
        revision: 3,
        expiresAt: "2026-08-10T12:30:00.000Z",
        completedAt: "2026-08-10T12:16:00.000Z",
      }),
    }),
  ];
  const targets: string[] = [];
  const attempts: number[] = [];
  const library = new CloudMediaLibrary({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "jwt" },
    fetch: async (url, init) => {
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      return responses.shift() ?? new Response(null, { status: 500 });
    },
    byteTransfer: {
      async put(input) {
        targets.push(input.url);
        if (targets.length === 1) throw new TypeError("connection reset");
        input.onProgress?.(4);
      },
    },
  });

  const result = await library.upload(uploadChoice("canonical_packet"), {
    maxTransferAttempts: 2,
    onProgress: ({ phase, attempt }) => {
      if (phase === "requesting_target") attempts.push(attempt);
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(targets, [
    "https://objects.example/upload/attempt-1",
    "https://objects.example/upload/attempt-2",
  ]);
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://api.maxpower.example/v1/media/uploads",
    "https://api.maxpower.example/v1/media/uploads",
    "https://api.maxpower.example/v1/media/uploads/upload-1/complete",
  ]);
  assert.equal(new Headers(requests[0]?.init?.headers).get("idempotency-key"), "upload-canonical_packet");
  assert.equal(new Headers(requests[1]?.init?.headers).get("idempotency-key"), "upload-canonical_packet");
  assert.equal(new Headers(requests[2]?.init?.headers).get("if-match"), '"2"');
});

test("an expired completion reissues the idempotent upload before retrying bytes", async () => {
  const responses = [
    jsonResponse({
      asset: mediaAsset(),
      upload: mediaUpload(),
      uploadTarget: uploadTarget("https://objects.example/upload/expired"),
    }, 201),
    jsonResponse({
      error: {
        message: "The media upload target has expired.",
        type: "invalid_request_error",
        code: "upload_expired",
        param: null,
      },
    }, 410),
    jsonResponse({
      asset: mediaAsset(),
      upload: mediaUpload({ revision: 2, expiresAt: "2026-08-10T12:45:00.000Z" }),
      uploadTarget: uploadTarget(
        "https://objects.example/upload/reissued",
        "2026-08-10T12:45:00.000Z",
      ),
    }, 201),
    jsonResponse({
      asset: mediaAsset({ status: "ready", revision: 2, readyAt: "2026-08-10T12:31:00.000Z" }),
      upload: mediaUpload({
        status: "completed",
        revision: 3,
        expiresAt: "2026-08-10T12:45:00.000Z",
        completedAt: "2026-08-10T12:31:00.000Z",
      }),
    }),
  ];
  const targets: string[] = [];
  const library = new CloudMediaLibrary({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "jwt" },
    fetch: async () => responses.shift() ?? new Response(null, { status: 500 }),
    byteTransfer: {
      async put(input) {
        targets.push(input.url);
        input.onProgress?.(4);
      },
    },
  });

  const result = await library.upload(uploadChoice("video"), { maxTransferAttempts: 2 });

  assert.equal(result.status, "ready");
  assert.deepEqual(targets, [
    "https://objects.example/upload/expired",
    "https://objects.example/upload/reissued",
  ]);
});

test("cancelling an upload aborts the PUT and never calls complete", async () => {
  const controller = new AbortController();
  const requestUrls: string[] = [];
  let transferStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    transferStarted = resolve;
  });
  const library = new CloudMediaLibrary({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "jwt" },
    fetch: async (url) => {
      requestUrls.push(url);
      return jsonResponse({
        asset: mediaAsset(),
        upload: mediaUpload(),
        uploadTarget: uploadTarget("https://objects.example/upload/cancel"),
      }, 201);
    },
    byteTransfer: {
      put(input) {
        transferStarted();
        return new Promise<void>((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            const error = new Error("native upload aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
    },
  });

  const upload = library.upload(uploadChoice("keypoints"), { signal: controller.signal });
  await started;
  controller.abort();

  await assert.rejects(upload, (error: unknown) => (
    error instanceof CloudMediaLibraryError && error.code === "cancelled"
  ));
  assert.deepEqual(requestUrls, ["https://api.maxpower.example/v1/media/uploads"]);
});

test("the owner can page media, inspect status, and request recursive deletion", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    jsonResponse({
      data: [
        mediaAsset({
          id: "asset-photo",
          kind: "nutrition_photo",
          fileName: "meal.jpg",
          contentType: "image/jpeg",
          status: "ready",
          verification: "object_metadata_verified",
          revision: 2,
          readyAt: "2026-08-10T12:01:00.000Z",
        }),
      ],
      nextCursor: "opaque-next",
    }),
    jsonResponse(mediaAsset({
      id: "asset-photo",
      kind: "nutrition_photo",
      fileName: "meal.jpg",
      contentType: "image/jpeg",
      status: "ready",
      verification: "object_metadata_verified",
      revision: 2,
      readyAt: "2026-08-10T12:01:00.000Z",
    })),
    jsonResponse({ status: "deleted", deletedAssetIds: ["asset-photo", "asset-keypoints"] }, 202),
  ];
  const library = new CloudMediaLibrary({
    apiBaseUrl: "https://api.maxpower.example",
    accountId: "account-a",
    accessTokens: { accessTokenFor: () => "jwt" },
    fetch: async (url, init) => {
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      return responses.shift() ?? new Response(null, { status: 500 });
    },
    byteTransfer: { async put() { throw new Error("unexpected_put"); } },
  });

  const page = await library.listAssets({ limit: 1, cursor: "opaque prior" });
  assert.equal(page.data[0]?.kind, "nutrition_photo");
  assert.equal(page.nextCursor, "opaque-next");
  const asset = await library.getAssetStatus("asset-photo");
  assert.equal(asset.status, "ready");
  const deletion = await library.deleteAsset({
    assetId: "asset-photo",
    expectedRevision: 2,
    idempotencyKey: "delete-photo-1",
  });
  assert.deepEqual(deletion, { deletedAssetIds: ["asset-photo", "asset-keypoints"] });

  assert.deepEqual(requests.map(({ url }) => url), [
    "https://api.maxpower.example/v1/media?limit=1&cursor=opaque+prior",
    "https://api.maxpower.example/v1/media/asset-photo",
    "https://api.maxpower.example/v1/media/asset-photo",
  ]);
  assert.equal(requests[0]?.init?.method, "GET");
  assert.equal(requests[1]?.init?.method, "GET");
  assert.equal(requests[2]?.init?.method, "DELETE");
  assert.equal(new Headers(requests[2]?.init?.headers).get("if-match"), '"2"');
  assert.equal(new Headers(requests[2]?.init?.headers).get("idempotency-key"), "delete-photo-1");
});

function mediaAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    accountId: "account-a",
    kind: "video",
    fileName: "squat.mp4",
    contentType: "video/mp4",
    byteSize: 4,
    sha256: "a".repeat(64),
    status: "uploading",
    purpose: "personal",
    verification: "unverified_metadata",
    revision: 1,
    createdAt: "2026-08-10T12:00:00.000Z",
    readyAt: null,
    ...overrides,
  };
}

function mediaUpload(overrides: Record<string, unknown> = {}) {
  return {
    id: "upload-1",
    assetId: "asset-1",
    status: "pending",
    byteTransfer: "presigned_put",
    revision: 1,
    createdAt: "2026-08-10T12:00:00.000Z",
    expiresAt: "2026-08-10T12:15:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function uploadTarget(
  url: string,
  expiresAt = "2026-08-10T12:15:00.000Z",
) {
  return {
    kind: "presigned_put",
    url,
    headers: { "content-type": "application/octet-stream", "content-length": "4" },
    expiresAt,
  };
}

function uploadChoice(kind: "video" | "canonical_packet" | "keypoints" | "nutrition_photo") {
  return {
    decision: "upload" as const,
    kind,
    source: { kind: "bytes" as const, bytes: Uint8Array.from([1, 2, 3, 4]) },
    fileName: `${kind}.bin`,
    contentType: "application/octet-stream",
    byteSize: 4,
    sha256: "a".repeat(64),
    idempotencyKey: `upload-${kind}`,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
