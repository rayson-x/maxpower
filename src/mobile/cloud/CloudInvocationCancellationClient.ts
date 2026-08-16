import type { CloudServiceAccessTokenSource } from "./CloudServiceAccessTokenSource";
import { maxPowerApiOrigin, requiredCloudText } from "./cloudServiceValidation";

export interface CloudCancellationFetch {
  (
    url: string,
    init: {
      method: "POST";
      headers: Readonly<Record<string, string>>;
      body: string;
      signal: AbortSignal;
    },
  ): Promise<{ ok: boolean; status: number }>;
}

export interface CloudInvocationCancellationClientOptions {
  apiBaseUrl: string;
  accountId: string;
  accessTokens: CloudServiceAccessTokenSource;
  fetch: CloudCancellationFetch;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
}

/** Delivers one durable cancel command with bounded retries and no persisted token. */
export class CloudInvocationCancellationClient {
  private readonly endpoint: string;
  private readonly accountId: string;
  private readonly accessTokens: CloudServiceAccessTokenSource;
  private readonly fetchImpl: CloudCancellationFetch;
  private readonly attemptTimeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(options: CloudInvocationCancellationClientOptions) {
    this.endpoint = new URL("/v1/invocations/cancel", maxPowerApiOrigin(options.apiBaseUrl)).toString();
    this.accountId = requiredCloudText(options.accountId, "cloud_cancel_account_required");
    this.accessTokens = options.accessTokens;
    this.fetchImpl = options.fetch;
    this.attemptTimeoutMs = positiveInteger(options.attemptTimeoutMs ?? 2_500);
    this.retryDelayMs = nonNegativeInteger(options.retryDelayMs ?? 100);
  }

  async cancel(idempotencyKeyInput: string): Promise<void> {
    const idempotencyKey = requiredCloudText(idempotencyKeyInput, "cloud_cancel_key_required");
    let lastFailure: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.attempt(idempotencyKey);
        if (response.ok) return;
        lastFailure = new Error(`cloud_cancel_http_${response.status}`);
        if (response.status < 500) break;
      } catch (error) {
        lastFailure = error;
      }
      if (attempt < 2 && this.retryDelayMs > 0) {
        await delay(this.retryDelayMs * (attempt + 1));
      }
    }
    throw lastFailure instanceof Error ? lastFailure : new Error("cloud_cancel_failed");
  }

  private async attempt(idempotencyKey: string): Promise<{ ok: boolean; status: number }> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("cloud_cancel_timeout"));
      }, this.attemptTimeoutMs);
    });
    try {
      const request = (async () => {
        const token = requiredCloudText(
          await this.accessTokens.accessTokenFor(this.accountId),
          "cloud_cancel_access_token_required",
        );
        return this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ idempotencyKey }),
          signal: controller.signal,
        });
      })();
      return await Promise.race([request, timedOut]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("cloud_cancel_timeout_invalid");
  return value;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("cloud_cancel_retry_delay_invalid");
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
