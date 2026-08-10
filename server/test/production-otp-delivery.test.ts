import assert from "node:assert/strict";
import test from "node:test";

import { HttpsOtpDelivery } from "../src/runtime/production/otp-delivery.js";

test("OTP delivery sends credentials only to the configured HTTPS service", async () => {
  const requests: Request[] = [];
  const delivery = new HttpsOtpDelivery({
    endpoint: "https://notify.maxpower.example/v1/otp",
    bearerToken: "delivery-token",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 202 });
    },
  });

  await delivery.sendEmailOtp({
    email: "person@example.com",
    code: "123456",
    purpose: "sign-in",
  });
  await delivery.sendSmsOtp({ phoneNumber: "+447700900123", code: "654321" });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer delivery-token");
  assert.deepEqual(await requests[0]?.json(), {
    channel: "email",
    destination: "person@example.com",
    code: "123456",
    purpose: "sign-in",
  });
  assert.deepEqual(await requests[1]?.json(), {
    channel: "sms",
    destination: "+447700900123",
    code: "654321",
    purpose: "sign-in",
  });
});

test("OTP delivery fails closed without returning provider details", async () => {
  const delivery = new HttpsOtpDelivery({
    endpoint: "https://notify.maxpower.example/v1/otp",
    bearerToken: "delivery-token",
    fetch: async () => Response.json({ error: "provider-secret-diagnostic" }, { status: 503 }),
  });

  await assert.rejects(
    () => delivery.sendSmsOtp({ phoneNumber: "+447700900123", code: "123456" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("provider-secret-diagnostic"), false);
      return true;
    },
  );
  assert.throws(
    () => new HttpsOtpDelivery({ endpoint: "http://notify.example/otp", bearerToken: "x" }),
    /HTTPS/i,
  );
});
