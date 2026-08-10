import type {
  EmailOtpPurpose,
  ProductionOtpDelivery,
} from "../../adapters/auth/production-auth.js";

export interface HttpsOtpDeliveryOptions {
  endpoint: string;
  bearerToken: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** Minimal provider-neutral OTP webhook. It never reads or returns provider response bodies. */
export class HttpsOtpDelivery implements ProductionOtpDelivery {
  readonly #endpoint: string;
  readonly #bearerToken: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: HttpsOtpDeliveryOptions) {
    if (!isHttpsUrl(options.endpoint)) {
      throw new Error("OTP delivery endpoint must be an absolute HTTPS URL.");
    }
    if (!options.bearerToken.trim()) {
      throw new Error("OTP delivery bearer token is required.");
    }
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("OTP delivery timeout must be a positive integer.");
    }
    this.#endpoint = options.endpoint;
    this.#bearerToken = options.bearerToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
  }

  sendEmailOtp(input: {
    email: string;
    code: string;
    purpose: EmailOtpPurpose;
  }): Promise<void> {
    return this.#send({
      channel: "email",
      destination: input.email,
      code: input.code,
      purpose: input.purpose,
    });
  }

  sendSmsOtp(input: { phoneNumber: string; code: string }): Promise<void> {
    return this.#send({
      channel: "sms",
      destination: input.phoneNumber,
      code: input.code,
      purpose: "sign-in",
    });
  }

  async #send(payload: OtpDeliveryPayload): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    timeout.unref();
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#bearerToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("OTP delivery service rejected the request.");
      }
      await response.body?.cancel().catch(() => undefined);
    } catch {
      throw new Error("OTP delivery is unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface OtpDeliveryPayload {
  channel: "email" | "sms";
  destination: string;
  code: string;
  purpose: EmailOtpPurpose;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}
