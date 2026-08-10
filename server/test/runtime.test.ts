import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRuntime } from "../src/runtime/memory-runtime.js";

test("memory runtime is executable for local contract development", async () => {
  const runtime = createMemoryRuntime({ production: false });
  const health = await runtime.app.request("/healthz");
  assert.equal(health.status, 200);
  const ready = await runtime.app.request("/readyz");
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ready" });

  const otp = await runtime.app.request("/v1/auth/register/otp/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: { kind: "email", value: "local@example.com" },
    }),
  });
  assert.equal(otp.status, 202);
  assert.equal(typeof (await otp.json() as { debugOtp?: string }).debugOtp, "string");
});

test("memory runtime cannot be selected in production", () => {
  assert.throws(
    () => createMemoryRuntime({ production: true }),
    /memory runtime is forbidden in production/i,
  );
});
