import { CloudMediaLibraryError } from "./model";
import type {
  CloudMediaAsset,
  CloudMediaAssetPage,
  CloudMediaLibraryOptions,
  CloudMediaPageInput,
  CloudMediaUploadChoice,
  CloudMediaUploadOutcome,
  CloudMediaUploadOptions,
  CloudMediaUploadProgress,
  CloudMediaUploadTarget,
  CloudMediaUpload,
  DeleteCloudMediaAssetInput,
  DeleteCloudMediaAssetResult,
} from "./model";
import { linkAbortSignals } from "../linkAbortSignals";

/** Account-scoped client workflow for the optional private MediaLibrary. */
export class CloudMediaLibrary {
  private readonly origin: string;
  private readonly accountId: string;
  private readonly fetch: NonNullable<CloudMediaLibraryOptions["fetch"]>;

  constructor(private readonly options: CloudMediaLibraryOptions) {
    this.origin = apiOrigin(options.apiBaseUrl, options.allowInsecureHttp === true);
    this.accountId = requiredText(options.accountId, "cloud_media_account_required");
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async upload(
    choice: CloudMediaUploadChoice,
    options: CloudMediaUploadOptions = {},
  ): Promise<CloudMediaUploadOutcome> {
    if (choice.decision === "not_selected") return { status: "not_selected" };
    const kind = normalizeMediaKind(choice.kind);
    const fileName = requiredText(choice.fileName, "cloud_media_file_name_required");
    const contentType = requiredText(choice.contentType, "cloud_media_content_type_required");
    const idempotencyKey = requireIdempotencyKey(choice.idempotencyKey);
    assertByteSize(choice.byteSize);
    const sha256 = normalizeSha256(choice.sha256);
    const maxAttempts = normalizeMaxAttempts(options.maxTransferAttempts);
    const linked = linkAbortSignals(options.signal, this.options.accountSignal);
    const report = (progress: CloudMediaUploadProgress) => options.onProgress?.(progress);
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfAborted(linked.signal);
        report(progress("requesting_target", attempt, 0, choice.byteSize));
        const created = await this.createUpload({
          kind,
          fileName,
          contentType,
          byteSize: choice.byteSize,
          sha256,
          ...(choice.parentAssetId === undefined
            ? {}
            : { parentAssetId: requiredText(choice.parentAssetId, "cloud_media_parent_asset_required") }),
        }, idempotencyKey, linked.signal);
        throwIfAborted(linked.signal);

        let bytesSent = 0;
        report(progress("uploading", attempt, bytesSent, choice.byteSize));
        try {
          await this.options.byteTransfer.put({
            source: choice.source,
            url: created.uploadTarget.url,
            headers: created.uploadTarget.headers,
            totalBytes: choice.byteSize,
            ...(linked.signal === undefined ? {} : { signal: linked.signal }),
            onProgress: (next) => {
              const normalized = normalizeProgress(next, bytesSent, choice.byteSize);
              if (normalized === bytesSent) return;
              bytesSent = normalized;
              report(progress("uploading", attempt, bytesSent, choice.byteSize));
            },
          });
        } catch (cause) {
          throwIfAborted(linked.signal);
          if (attempt < maxAttempts) continue;
          throw new CloudMediaLibraryError("transfer_failed", undefined, undefined, { cause });
        }
        throwIfAborted(linked.signal);
        bytesSent = choice.byteSize;
        report(progress("completing", attempt, bytesSent, choice.byteSize));
        let completed: { asset: CloudMediaAsset; upload: CloudMediaUpload };
        try {
          completed = await this.completeUpload(
            created.upload.id,
            created.upload.revision,
            completionIdempotencyKey(idempotencyKey),
            linked.signal,
          );
        } catch (cause) {
          if (
            cause instanceof CloudMediaLibraryError
            && cause.code === "upload_expired"
            && attempt < maxAttempts
          ) continue;
          throw cause;
        }
        report(progress("ready", attempt, bytesSent, choice.byteSize));
        return { status: "ready", ...completed };
      }
      throw new Error("cloud_media_transfer_failed");
    } catch (cause) {
      if (linked.signal?.aborted || isAbortError(cause)) {
        throw new CloudMediaLibraryError("cancelled", undefined, undefined, { cause });
      }
      throw cause;
    } finally {
      linked.dispose();
    }
  }

  listAssets(input: CloudMediaPageInput = {}): Promise<CloudMediaAssetPage> {
    const url = new URL("/v1/media", this.origin);
    if (input.limit !== undefined) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new Error("cloud_media_limit_invalid");
      }
      url.searchParams.set("limit", String(input.limit));
    }
    if (input.cursor !== undefined) {
      url.searchParams.set("cursor", requiredText(input.cursor, "cloud_media_cursor_invalid"));
    }
    return this.withAccountSignal(input.signal, async (signal) => {
      const value = await this.request(url.toString(), { method: "GET", signal }, true);
      const page = requireRecord(value, "cloud_media_page_invalid");
      if (!Array.isArray(page.data)) throw new Error("cloud_media_page_invalid");
      return {
        data: page.data.map((asset) => parseAsset(asset, this.accountId)),
        nextCursor: page.nextCursor === null
          ? null
          : requiredText(page.nextCursor, "cloud_media_page_invalid"),
      };
    });
  }

  getAssetStatus(assetId: string, signal?: AbortSignal): Promise<CloudMediaAsset> {
    const id = requiredText(assetId, "cloud_media_asset_id_required");
    return this.withAccountSignal(signal, async (linked) =>
      parseAsset(await this.request(`/v1/media/${encodeURIComponent(id)}`, {
        method: "GET",
        signal: linked,
      }), this.accountId)
    );
  }

  deleteAsset(input: DeleteCloudMediaAssetInput): Promise<DeleteCloudMediaAssetResult> {
    const assetId = requiredText(input.assetId, "cloud_media_asset_id_required");
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const expectedRevision = requirePositiveInteger(
      input.expectedRevision,
      "cloud_media_revision_invalid",
    );
    return this.withAccountSignal(input.signal, async (signal) => {
      const value = await this.request(`/v1/media/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        headers: {
          "idempotency-key": idempotencyKey,
          "if-match": `\"${expectedRevision}\"`,
        },
        signal,
      });
      const result = requireRecord(value, "cloud_media_delete_response_invalid");
      if (result.status !== "deleted" || !Array.isArray(result.deletedAssetIds)) {
        throw new Error("cloud_media_delete_response_invalid");
      }
      return {
        deletedAssetIds: result.deletedAssetIds.map((id) =>
          requiredText(id, "cloud_media_delete_response_invalid")
        ),
      };
    });
  }

  private async createUpload(
    body: {
      kind: CloudMediaAsset["kind"];
      fileName: string;
      contentType: string;
      byteSize: number;
      sha256: string;
      parentAssetId?: string;
    },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<{ asset: CloudMediaAsset; upload: CloudMediaUpload; uploadTarget: CloudMediaUploadTarget }> {
    const value = await this.request("/v1/media/uploads", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body,
      signal,
    });
    const record = requireRecord(value, "cloud_media_create_response_invalid");
    return {
      asset: parseAsset(record.asset, this.accountId),
      upload: parseUpload(record.upload),
      uploadTarget: parseUploadTarget(record.uploadTarget),
    };
  }

  private async completeUpload(
    uploadId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<{ asset: CloudMediaAsset; upload: CloudMediaUpload }> {
    const value = await this.request(`/v1/media/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: "POST",
      headers: {
        "idempotency-key": idempotencyKey,
        "if-match": `\"${expectedRevision}\"`,
      },
      body: {},
      signal,
    });
    const record = requireRecord(value, "cloud_media_complete_response_invalid");
    return { asset: parseAsset(record.asset, this.accountId), upload: parseUpload(record.upload) };
  }

  private async request(
    path: string,
    input: {
      method: "GET" | "POST" | "DELETE";
      headers?: Readonly<Record<string, string>>;
      body?: unknown;
      signal?: AbortSignal;
    },
    absolute = false,
  ): Promise<unknown> {
    throwIfAborted(input.signal);
    const token = requiredText(
      await this.options.accessTokens.accessTokenFor(this.accountId),
      "cloud_media_access_token_required",
    );
    throwIfAborted(input.signal);
    let response: Response;
    try {
      response = await this.fetch(absolute ? path : new URL(path, this.origin).toString(), {
        method: input.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(input.body === undefined ? {} : { "content-type": "application/json" }),
          ...(input.headers ?? {}),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (cause) {
      if (input.signal?.aborted || isAbortError(cause)) {
        throw new CloudMediaLibraryError("cancelled", undefined, undefined, { cause });
      }
      throw new CloudMediaLibraryError("network_unavailable", undefined, undefined, { cause });
    }
    if (!response.ok) throw await responseError(response);
    return readJson(response);
  }

  private async withAccountSignal<T>(
    signal: AbortSignal | undefined,
    operation: (signal?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const linked = linkAbortSignals(signal, this.options.accountSignal);
    try {
      throwIfAborted(linked.signal);
      return await operation(linked.signal);
    } catch (cause) {
      if (linked.signal?.aborted || isAbortError(cause)) {
        throw new CloudMediaLibraryError("cancelled", undefined, undefined, { cause });
      }
      throw cause;
    } finally {
      linked.dispose();
    }
  }
}

function parseAsset(value: unknown, expectedAccountId: string): CloudMediaAsset {
  const row = requireRecord(value, "cloud_media_asset_invalid");
  const kind = requireOneOf(row.kind, ["video", "canonical_packet", "keypoints", "nutrition_photo"] as const);
  const status = requireOneOf(row.status, ["uploading", "ready"] as const);
  const verification = requireOneOf(
    row.verification,
    ["unverified_metadata", "object_metadata_verified"] as const,
  );
  if (row.purpose !== "personal") throw new Error("cloud_media_asset_invalid");
  const accountId = requiredText(row.accountId, "cloud_media_asset_invalid");
  if (accountId !== expectedAccountId) throw new Error("cloud_media_asset_account_mismatch");
  return {
    id: requiredText(row.id, "cloud_media_asset_invalid"),
    accountId,
    kind,
    fileName: requiredText(row.fileName, "cloud_media_asset_invalid"),
    contentType: requiredText(row.contentType, "cloud_media_asset_invalid"),
    byteSize: requireNonNegativeInteger(row.byteSize, "cloud_media_asset_invalid"),
    sha256: normalizeSha256(row.sha256),
    status,
    purpose: "personal",
    verification,
    revision: requirePositiveInteger(row.revision, "cloud_media_asset_invalid"),
    createdAt: requireTimestamp(row.createdAt, "cloud_media_asset_invalid"),
    readyAt: row.readyAt === null ? null : requireTimestamp(row.readyAt, "cloud_media_asset_invalid"),
  };
}

function normalizeMediaKind(value: unknown): CloudMediaAsset["kind"] {
  if (
    value !== "video" && value !== "canonical_packet"
    && value !== "keypoints" && value !== "nutrition_photo"
  ) throw new Error("cloud_media_kind_invalid");
  return value;
}

function parseUpload(value: unknown): CloudMediaUpload {
  const row = requireRecord(value, "cloud_media_upload_invalid");
  if (row.byteTransfer !== "presigned_put") throw new Error("cloud_media_upload_invalid");
  return {
    id: requiredText(row.id, "cloud_media_upload_invalid"),
    assetId: requiredText(row.assetId, "cloud_media_upload_invalid"),
    status: requireOneOf(row.status, ["pending", "completed", "cancelled"] as const),
    byteTransfer: "presigned_put",
    revision: requirePositiveInteger(row.revision, "cloud_media_upload_invalid"),
    createdAt: requireTimestamp(row.createdAt, "cloud_media_upload_invalid"),
    expiresAt: requireTimestamp(row.expiresAt, "cloud_media_upload_invalid"),
    completedAt: row.completedAt === null
      ? null
      : requireTimestamp(row.completedAt, "cloud_media_upload_invalid"),
  };
}

function parseUploadTarget(value: unknown): CloudMediaUploadTarget {
  const row = requireRecord(value, "cloud_media_upload_target_invalid");
  if (row.kind !== "presigned_put") throw new Error("cloud_media_upload_target_invalid");
  const url = requireHttpsUrl(row.url, "cloud_media_upload_target_invalid");
  const headers = requireRecord(row.headers, "cloud_media_upload_target_invalid");
  const normalizedHeaders: Record<string, string> = {};
  for (const [name, header] of Object.entries(headers)) {
    normalizedHeaders[name] = requiredText(header, "cloud_media_upload_target_invalid");
  }
  return {
    kind: "presigned_put",
    url,
    headers: normalizedHeaders,
    expiresAt: requireTimestamp(row.expiresAt, "cloud_media_upload_target_invalid"),
  };
}

function progress(
  phase: CloudMediaUploadProgress["phase"],
  attempt: number,
  bytesSent: number,
  totalBytes: number,
): CloudMediaUploadProgress {
  return { phase, attempt, bytesSent, totalBytes };
}

function normalizeProgress(value: number, previous: number, total: number): number {
  if (!Number.isFinite(value)) return previous;
  return Math.min(total, Math.max(previous, Math.floor(value)));
}

function normalizeMaxAttempts(value: number | undefined): number {
  const attempts = value ?? 1;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error("cloud_media_retry_limit_invalid");
  }
  return attempts;
}

function completionIdempotencyKey(createKey: string): string {
  return `media-complete:${createKey}`;
}

function apiOrigin(value: string, allowInsecureHttp: boolean): string {
  return requireServiceUrl(value, "cloud_media_api_url_invalid", true, allowInsecureHttp);
}

function requireHttpsUrl(value: unknown, code: string, originOnly = false): string {
  return requireServiceUrl(value, code, originOnly, false);
}

function requireServiceUrl(
  value: unknown,
  code: string,
  originOnly: boolean,
  allowInsecureHttp: boolean,
): string {
  let parsed: URL;
  try {
    parsed = new URL(typeof value === "string" ? value : "");
  } catch {
    throw new Error(code);
  }
  if (
    (parsed.protocol !== "https:" && !(allowInsecureHttp && parsed.protocol === "http:"))
    || !parsed.hostname || parsed.username || parsed.password
    || (originOnly && (parsed.search || parsed.hash))
  ) throw new Error(code);
  return originOnly ? parsed.origin : parsed.toString();
}

function assertByteSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 5 * 1024 * 1024 * 1024) {
    throw new Error("cloud_media_byte_size_invalid");
  }
}

function normalizeSha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("cloud_media_sha256_invalid");
  }
  return value.toLowerCase();
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error(code);
  return value.trim();
}

function requireIdempotencyKey(value: unknown): string {
  const key = requiredText(value, "cloud_media_idempotency_key_required");
  if (key.length > 180) throw new Error("cloud_media_idempotency_key_invalid");
  return key;
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function requireOneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error("cloud_media_response_invalid");
  return value as T[number];
}

function requireNonNegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function requirePositiveInteger(value: unknown, code: string): number {
  const integer = requireNonNegativeInteger(value, code);
  if (integer < 1) throw new Error(code);
  return integer;
}

function requireTimestamp(value: unknown, code: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(code);
  return new Date(value).toISOString();
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) throw new Error("cloud_media_response_invalid");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("cloud_media_response_invalid");
  }
}

async function responseError(response: Response): Promise<CloudMediaLibraryError> {
  let wireCode: string | undefined;
  let message: string | undefined;
  try {
    const body = requireRecord(await readJson(response), "cloud_media_error_response_invalid");
    const error = requireRecord(body.error, "cloud_media_error_response_invalid");
    if (typeof error.code === "string") wireCode = error.code;
    if (typeof error.message === "string" && error.message.trim()) message = error.message.trim();
  } catch {
    // Status still provides a stable client classification.
  }
  const code = wireCode === "upload_expired"
    ? "upload_expired"
    : response.status === 401
      ? "authentication_required"
      : response.status === 403
        ? "permission_denied"
        : response.status === 409
          ? "conflict"
          : "request_failed";
  return new CloudMediaLibraryError(code, message, response.status);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new CloudMediaLibraryError("cancelled");
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}
