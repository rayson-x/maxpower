import {
  parseCloudPlan,
  parseCloudProfile,
  parseCloudResult,
  parseCloudWorkoutSession,
  type CloudCanonicalProjection,
  type CloudPage,
  type CloudPlan,
  type CloudProfile,
  type CloudResult,
  type CloudWorkoutSession,
  type CompleteCloudWorkoutSessionInput,
  type CreateCloudPlanInput,
  type CreateCloudResultInput,
  type CreateCloudWorkoutSessionInput,
  type DeleteCloudPlanInput,
  type DeleteCloudResultInput,
  type DeleteCloudWorkoutSessionInput,
  type PatchCloudPlanInput,
  type PatchCloudProfileInput,
  type PatchCloudResultInput,
  type PatchCloudWorkoutSessionInput,
  type PublishCloudPlanInput,
} from "./model";

export type CloudProductDataFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface CloudProductDataClientOptions {
  baseUrl: string;
  /** Debug-only escape hatch supplied by the mobile composition root. */
  allowInsecureHttp?: boolean;
  /** Reads the current five-minute service JWT; the value is never captured. */
  accessToken(): string;
  fetch?: CloudProductDataFetch;
  now?: () => string;
}

export type CloudProductDataErrorCode =
  | "configuration_error"
  | "network_unavailable"
  | "request_aborted"
  | "not_authenticated"
  | "revision_conflict"
  | "idempotency_conflict"
  | "not_found"
  | "invalid_response"
  | "request_failed";

export class CloudProductDataError extends Error {
  constructor(
    readonly code: CloudProductDataErrorCode,
    message = `cloud_product_data_${code}`,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CloudProductDataError";
  }
}

/** HTTPS client for the four cloud-authoritative product resources only. */
export class CloudProductDataClient {
  private readonly origin: URL;
  private readonly accessToken: () => string;
  private readonly fetch: CloudProductDataFetch;
  private readonly now: () => string;

  constructor(options: CloudProductDataClientOptions) {
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new CloudProductDataError("configuration_error", "MaxPower API URL is invalid.");
    }
    const protocolAllowed = url.protocol === "https:"
      || (options.allowInsecureHttp === true && url.protocol === "http:");
    if (!protocolAllowed || url.username || url.password || url.search || url.hash) {
      throw new CloudProductDataError("configuration_error", "MaxPower product data requires an HTTPS API origin.");
    }
    this.origin = new URL(url.origin);
    this.accessToken = options.accessToken;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async fetchCanonicalProjection(signal?: AbortSignal): Promise<CloudCanonicalProjection> {
    const [profile, plans, workoutSessions, results] = await Promise.all([
      this.getProfile(signal),
      this.listAll("/v1/plans", parseCloudPlan, signal),
      this.listAll("/v1/workout-sessions", parseCloudWorkoutSession, signal),
      this.listAll("/v1/results", parseCloudResult, signal),
    ]);
    return {
      accountId: profile.accountId,
      profile,
      plans,
      workoutSessions,
      results,
      fetchedAt: this.now(),
    };
  }

  async getProfile(signal?: AbortSignal): Promise<CloudProfile> {
    return parseProductData(parseCloudProfile, await this.jsonRequest("/v1/me", { method: "GET", signal }));
  }

  async patchProfile(input: PatchCloudProfileInput): Promise<CloudProfile> {
    return parseProductData(parseCloudProfile, await this.writeJson("/v1/me", "PATCH", input.patch, input));
  }

  async createPlan(input: CreateCloudPlanInput): Promise<CloudPlan> {
    return parseProductData(parseCloudPlan, await this.createJson("/v1/plans", {
      title: input.title,
      snapshot: input.snapshot,
    }, input.idempotencyKey, input.signal));
  }

  async getPlan(planId: string, signal?: AbortSignal): Promise<CloudPlan> {
    return parseProductData(parseCloudPlan, await this.jsonRequest(`/v1/plans/${pathId(planId)}`, { method: "GET", signal }));
  }

  async patchPlan(input: PatchCloudPlanInput): Promise<CloudPlan> {
    return parseProductData(parseCloudPlan, await this.writeJson(
      `/v1/plans/${pathId(input.planId)}`,
      "PATCH",
      input.patch,
      input,
    ));
  }

  async publishPlan(input: PublishCloudPlanInput): Promise<CloudPlan> {
    return parseProductData(parseCloudPlan, await this.writeJson(
      `/v1/plans/${pathId(input.planId)}/publish`,
      "POST",
      undefined,
      input,
    ));
  }

  deletePlan(input: DeleteCloudPlanInput): Promise<void> {
    return this.deleteResource(`/v1/plans/${pathId(input.planId)}`, input);
  }

  async createWorkoutSession(input: CreateCloudWorkoutSessionInput): Promise<CloudWorkoutSession> {
    return parseProductData(parseCloudWorkoutSession, await this.createJson("/v1/workout-sessions", {
      title: input.title,
      ...(input.planId === undefined ? {} : { planId: input.planId }),
      ...(input.data === undefined ? {} : { data: input.data }),
      ...(input.mediaAssetIds === undefined ? {} : { mediaAssetIds: input.mediaAssetIds }),
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    }, input.idempotencyKey, input.signal));
  }

  async getWorkoutSession(workoutSessionId: string, signal?: AbortSignal): Promise<CloudWorkoutSession> {
    return parseProductData(parseCloudWorkoutSession, await this.jsonRequest(
      `/v1/workout-sessions/${pathId(workoutSessionId)}`,
      { method: "GET", signal },
    ));
  }

  async patchWorkoutSession(input: PatchCloudWorkoutSessionInput): Promise<CloudWorkoutSession> {
    return parseProductData(parseCloudWorkoutSession, await this.writeJson(
      `/v1/workout-sessions/${pathId(input.workoutSessionId)}`,
      "PATCH",
      input.patch,
      input,
    ));
  }

  async completeWorkoutSession(input: CompleteCloudWorkoutSessionInput): Promise<CloudWorkoutSession> {
    return parseProductData(parseCloudWorkoutSession, await this.writeJson(
      `/v1/workout-sessions/${pathId(input.workoutSessionId)}/complete`,
      "POST",
      {
        summary: input.summary,
        ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
      },
      input,
    ));
  }

  deleteWorkoutSession(input: DeleteCloudWorkoutSessionInput): Promise<void> {
    return this.deleteResource(`/v1/workout-sessions/${pathId(input.workoutSessionId)}`, input);
  }

  async createResult(input: CreateCloudResultInput): Promise<CloudResult> {
    return parseProductData(parseCloudResult, await this.createJson("/v1/results", {
      kind: input.kind,
      payload: input.payload,
      ...(input.workoutSessionId === undefined ? {} : { workoutSessionId: input.workoutSessionId }),
      ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
      ...(input.mediaAssetIds === undefined ? {} : { mediaAssetIds: input.mediaAssetIds }),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    }, input.idempotencyKey, input.signal));
  }

  async getResult(resultId: string, signal?: AbortSignal): Promise<CloudResult> {
    return parseProductData(parseCloudResult, await this.jsonRequest(`/v1/results/${pathId(resultId)}`, { method: "GET", signal }));
  }

  async patchResult(input: PatchCloudResultInput): Promise<CloudResult> {
    return parseProductData(parseCloudResult, await this.writeJson(
      `/v1/results/${pathId(input.resultId)}`,
      "PATCH",
      input.patch,
      input,
    ));
  }

  deleteResult(input: DeleteCloudResultInput): Promise<void> {
    return this.deleteResource(`/v1/results/${pathId(input.resultId)}`, input);
  }

  private async listAll<T>(
    path: string,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<readonly T[]> {
    const result: T[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
      const url = new URL(path, this.origin);
      url.searchParams.set("limit", "100");
      if (cursor !== null) url.searchParams.set("cursor", cursor);
      const page = parsePage(await this.jsonRequest(`${url.pathname}${url.search}`, { method: "GET", signal }), parse);
      result.push(...page.data);
      if (page.nextCursor === null) return result;
      if (seen.has(page.nextCursor)) throw invalidResponse();
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw invalidResponse();
  }

  private createJson(
    path: string,
    body: unknown,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.jsonRequest(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": requiredHeader(idempotencyKey),
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  private writeJson(
    path: string,
    method: "PATCH" | "POST",
    body: unknown,
    input: { expectedRevision: number; idempotencyKey: string; signal?: AbortSignal },
  ): Promise<unknown> {
    return this.jsonRequest(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "idempotency-key": requiredHeader(input.idempotencyKey),
        "if-match": revisionHeader(input.expectedRevision),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: input.signal,
    });
  }

  private async deleteResource(
    path: string,
    input: { expectedRevision: number; idempotencyKey: string; signal?: AbortSignal },
  ): Promise<void> {
    const response = await this.request(path, {
      method: "DELETE",
      headers: {
        "idempotency-key": requiredHeader(input.idempotencyKey),
        "if-match": revisionHeader(input.expectedRevision),
      },
      signal: input.signal,
    });
    if (!response.ok) throw await responseError(response);
  }

  private async jsonRequest(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.request(path, init);
    if (!response.ok) throw await responseError(response);
    try {
      return await response.json() as unknown;
    } catch {
      throw invalidResponse();
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const token = requiredHeader(this.accessToken());
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    try {
      return await this.fetch(new URL(path, this.origin).toString(), { ...init, headers });
    } catch (cause) {
      if (init.signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) {
        throw new CloudProductDataError("request_aborted");
      }
      if (cause instanceof CloudProductDataError) throw cause;
      throw new CloudProductDataError("network_unavailable", "Cannot reach MaxPower cloud data.");
    }
  }
}

function parsePage<T>(value: unknown, parse: (value: unknown) => T): CloudPage<T> {
  if (!isRecord(value) || !Array.isArray(value.data)) throw invalidResponse();
  const nextCursor = value.nextCursor;
  if (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor)) throw invalidResponse();
  return { data: value.data.map((item) => parseProductData(parse, item)), nextCursor };
}

function parseProductData<T>(parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value);
  } catch (cause) {
    if (cause instanceof CloudProductDataError) throw cause;
    throw invalidResponse();
  }
}

async function responseError(response: Response): Promise<CloudProductDataError> {
  let value: unknown;
  try {
    value = await response.json() as unknown;
  } catch {
    value = undefined;
  }
  const envelope = isRecord(value) && isRecord(value.error) ? value.error : undefined;
  const serverCode = envelope && typeof envelope.code === "string" ? envelope.code : undefined;
  const message = envelope && typeof envelope.message === "string" ? envelope.message : "MaxPower cloud request failed.";
  if (response.status === 401) return new CloudProductDataError("not_authenticated", message, response.status);
  if (response.status === 404) return new CloudProductDataError("not_found", message, response.status);
  if (response.status === 409 && serverCode === "revision_conflict") {
    return new CloudProductDataError("revision_conflict", message, response.status);
  }
  if (response.status === 409 && serverCode === "idempotency_key_reused") {
    return new CloudProductDataError("idempotency_conflict", message, response.status);
  }
  return new CloudProductDataError("request_failed", message, response.status);
}

function revisionHeader(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CloudProductDataError("configuration_error", "A positive expected revision is required.");
  }
  return `"${value}"`;
}

function requiredHeader(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new CloudProductDataError("configuration_error", "Cloud request credential or idempotency key is invalid.");
  }
  return value.trim();
}

function pathId(value: string): string {
  return encodeURIComponent(requiredHeader(value));
}

function invalidResponse(): CloudProductDataError {
  return new CloudProductDataError("invalid_response", "MaxPower returned invalid cloud product data.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
