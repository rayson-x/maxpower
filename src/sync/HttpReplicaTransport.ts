import type { ReplicaPullResult, ReplicaPushResult, ReplicaTransportPort, ReplicaWireEnvelope } from "./model";

export type ReplicaTransportErrorCode =
  | "invalid_configuration"
  | "credential_unavailable"
  | "credential_expired"
  | "credential_rejected"
  | "network_unavailable"
  | "request_timeout"
  | "server_rejected"
  | "invalid_response"
  | "payload_too_large";

/**
 * Typed failure surface for the application lifecycle layer. It intentionally
 * never stores a token, authorization header, raw response body, or PII.
 */
export class ReplicaTransportError extends Error {
  constructor(
    readonly code: ReplicaTransportErrorCode,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(code);
    this.name = "ReplicaTransportError";
  }
}

export interface ReplicaAccessCredential {
  /** Opaque bearer credential from the platform secure-credential adapter. */
  accessToken: string;
  /** Account ID is used only for adapter/account isolation, never sent as a token claim. */
  accountId: string;
  expiresAt?: string;
}

/** Secure storage / refresh belongs behind this port, never in the transport. */
export interface ReplicaCredentialSource {
  readReplicaCredential(input: { accountId: string }): Promise<ReplicaAccessCredential | null>;
}

export interface HttpReplicaTransportConfig {
  /** HTTPS origin or a versioned service base path, for example https://sync.example.com. */
  endpoint: string;
  accountId: string;
  replicaId: string;
  deviceId: string;
  credentials: ReplicaCredentialSource;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Test-only escape hatch for an explicit localhost contract server. */
  allowInsecureForTesting?: boolean;
  maxPayloadBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 900_000;
const API_PATH = "v1/replica-events";

/**
 * Production network adapter. It only authenticates and transports a closed
 * wire schema; applying events, resolving conflicts, and all Coach policy stay
 * in ReplicaSynchronizer and CoachApplication.
 */
export class HttpReplicaTransport implements ReplicaTransportPort {
  readonly mode = "enabled" as const;
  readonly replicaId: string;
  readonly deviceId: string;

  private readonly endpoint: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxPayloadBytes: number;

  constructor(private readonly config: HttpReplicaTransportConfig) {
    this.endpoint = normalizeEndpoint(config.endpoint, config.allowInsecureForTesting === true);
    this.fetchImpl = config.fetch ?? fetch;
    this.replicaId = requireNonEmpty(config.replicaId, "invalid_configuration");
    this.deviceId = requireNonEmpty(config.deviceId, "invalid_configuration");
    requireNonEmpty(config.accountId, "invalid_configuration");
    this.timeoutMs = positiveInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, "invalid_configuration");
    this.maxPayloadBytes = positiveInteger(config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES, "invalid_configuration");
  }

  async push(input: { userId: string; envelopes: readonly ReplicaWireEnvelope[]; idempotencyKey: string }): Promise<ReplicaPushResult> {
    assertRequestIdentity(input.userId, input.idempotencyKey);
    const body = {
      userId: input.userId,
      replicaId: this.replicaId,
      deviceId: this.deviceId,
      envelopes: input.envelopes,
    };
    const response = await this.request("POST", API_PATH, {
      body,
      idempotencyKey: input.idempotencyKey,
    });
    const value = await readJson(response);
    if (!isObject(value) || !isStringArray(value.acknowledgedEventIds) || !Array.isArray(value.rejected)) {
      throw new ReplicaTransportError("invalid_response", false, response.status);
    }
    const rejected = value.rejected.map((item) => parseRejected(item, response.status));
    return {
      acknowledgedEventIds: value.acknowledgedEventIds,
      rejected,
      ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    };
  }

  async pull(input: { userId: string; cursor?: string; limit: number }): Promise<ReplicaPullResult> {
    assertRequestIdentity(input.userId, "pull");
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ReplicaTransportError("invalid_configuration", false);
    }
    const query = new URLSearchParams({ userId: input.userId, limit: String(input.limit) });
    if (input.cursor) query.set("cursor", input.cursor);
    const response = await this.request("GET", `${API_PATH}?${query.toString()}`);
    const value = await readJson(response);
    if (!isObject(value) || !Array.isArray(value.envelopes) || typeof value.hasMore !== "boolean" ||
      !value.envelopes.every(isWireEnvelopeShape)) {
      throw new ReplicaTransportError("invalid_response", false, response.status);
    }
    return {
      envelopes: value.envelopes,
      hasMore: value.hasMore,
      ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    input?: { body?: unknown; idempotencyKey?: string },
  ): Promise<Response> {
    const credential = await this.readCredential();
    const url = new URL(path, this.endpoint);
    const payload = input?.body === undefined ? undefined : JSON.stringify(input.body);
    if (payload && new TextEncoder().encode(payload).byteLength > this.maxPayloadBytes) {
      throw new ReplicaTransportError("payload_too_large", false);
    }
    const controller = typeof AbortController === "undefined" ? undefined : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${credential.accessToken}`,
          "X-MaxPower-Replica-Id": this.replicaId,
          "X-MaxPower-Device-Id": this.deviceId,
          "X-MaxPower-Wire-Version": "1",
          ...(input?.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
        },
        ...(payload ? { body: payload } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (response.status === 401 || response.status === 403) {
        throw new ReplicaTransportError("credential_rejected", false, response.status);
      }
      if (!response.ok) {
        throw new ReplicaTransportError("server_rejected", response.status >= 500 || response.status === 429, response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof ReplicaTransportError) throw error;
      if (controller?.signal.aborted) throw new ReplicaTransportError("request_timeout", true);
      throw new ReplicaTransportError("network_unavailable", true);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async readCredential(): Promise<ReplicaAccessCredential> {
    const credential = await this.config.credentials.readReplicaCredential({ accountId: this.config.accountId });
    if (!credential || !credential.accessToken || credential.accountId !== this.config.accountId) {
      throw new ReplicaTransportError("credential_unavailable", false);
    }
    if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) {
      throw new ReplicaTransportError("credential_expired", false);
    }
    return credential;
  }
}

/** Explicit no-network implementation for local-only users. */
export class DisabledReplicaTransport implements ReplicaTransportPort {
  readonly mode = "disabled" as const;
  async push(): Promise<ReplicaPushResult> { throw new ReplicaTransportError("credential_unavailable", false); }
  async pull(): Promise<ReplicaPullResult> { throw new ReplicaTransportError("credential_unavailable", false); }
}

function normalizeEndpoint(value: string, allowInsecureForTesting: boolean): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new ReplicaTransportError("invalid_configuration", false);
  }
  const localTestHost = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "::1";
  if (endpoint.protocol !== "https:" && !(allowInsecureForTesting && localTestHost && endpoint.protocol === "http:")) {
    throw new ReplicaTransportError("invalid_configuration", false);
  }
  if (endpoint.username || endpoint.password || endpoint.hash) throw new ReplicaTransportError("invalid_configuration", false);
  return endpoint;
}

function assertRequestIdentity(userId: string, idempotencyKey: string): void {
  requireNonEmpty(userId, "invalid_configuration");
  if (!idempotencyKey || idempotencyKey.length > 256) throw new ReplicaTransportError("invalid_configuration", false);
}

function requireNonEmpty(value: string, code: ReplicaTransportErrorCode): string {
  if (!value.trim()) throw new ReplicaTransportError(code, false);
  return value;
}

function positiveInteger(value: number, code: ReplicaTransportErrorCode): number {
  if (!Number.isInteger(value) || value <= 0) throw new ReplicaTransportError(code, false);
  return value;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ReplicaTransportError("invalid_response", false, response.status);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseRejected(value: unknown, status: number): { eventId: string; code: "account_mismatch" | "unknown_schema" | "payload_hash_mismatch" | "replayed" } {
  if (!isObject(value) || typeof value.eventId !== "string" ||
    (value.code !== "account_mismatch" && value.code !== "unknown_schema" && value.code !== "payload_hash_mismatch" && value.code !== "replayed")) {
    throw new ReplicaTransportError("invalid_response", false, status);
  }
  return { eventId: value.eventId, code: value.code };
}

function isWireEnvelopeShape(value: unknown): value is ReplicaWireEnvelope {
  return isObject(value) && value.schemaVersion === 1 && typeof value.userId === "string" &&
    typeof value.replicaId === "string" && typeof value.deviceId === "string" &&
    isObject(value.event) && typeof value.payloadHash === "string" && typeof value.hlc === "string" &&
    Array.isArray(value.causalParents) && value.scope === "domain";
}
