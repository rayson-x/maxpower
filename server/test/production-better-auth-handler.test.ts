import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";

import { mountReviewedBetterAuthHandler } from "../src/http/better-auth-handler.js";
import { renderError } from "../src/http/response.js";

test("production app mounts only the reviewed Better Auth handler under its fixed prefix", async () => {
  const delegated: string[] = [];
  const app = new Hono();
  app.onError((error, context) => renderError(context, error));
  mountReviewedBetterAuthHandler(app, async (request) => {
    delegated.push(new URL(request.url).pathname);
    return new Response(null, { status: 204 });
  }, { maxRequestBytes: 8 });

  assert.equal((await app.request("/api/auth/callback/google")).status, 204);
  assert.equal((await app.request("/api/auth/sign-in/social", { method: "POST" })).status, 204);
  assert.equal((await app.request("/v1/auth/login/password", { method: "POST" })).status, 404);
  const oversized = await app.fetch(new Request("http://localhost/api/auth/link-social", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123456789"));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" }));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json() as { error: { code: string } }).error.code, "request_too_large");
  assert.deepEqual(delegated, [
    "/api/auth/callback/google",
    "/api/auth/sign-in/social",
  ]);
});
