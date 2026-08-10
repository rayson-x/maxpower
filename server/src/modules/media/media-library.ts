import { ApiError, conflict, forbidden, notFound } from "../../kernel/api-error.js";
import type { Clock } from "../../kernel/clock.js";
import { SystemClock } from "../../kernel/clock.js";
import type { IdFactory } from "../../kernel/ids.js";
import { randomId } from "../../kernel/ids.js";
import type { Principal } from "../../kernel/principal.js";
import { paginateByCreatedAt, type CursorPageInput } from "../../kernel/pagination.js";
import type { MediaEvidenceLifecycle } from "../product-data/model.js";
import type {
  CompleteMediaUploadInput,
  CompleteMediaUploadResult,
  CreateMediaDownloadInput,
  CreateMediaUploadInput,
  CreateMediaUploadResult,
  DeleteMediaAssetInput,
  DeleteMediaAssetResult,
  MediaAsset,
  MediaLibrary,
  MediaTransferTarget,
  MediaUpload,
} from "./model.js";
import type {
  MediaLibraryState,
  MediaLibraryStateAdapter,
  StoredMediaAsset,
  StoredMediaUpload,
} from "./state-adapter.js";

export interface MediaLibraryModuleDependencies {
  adapter: MediaLibraryStateAdapter;
  evidenceLifecycle?: MediaEvidenceLifecycle;
  transferExpirySeconds?: number;
  clock?: Clock;
  ids?: IdFactory;
}

/**
 * Personal media metadata and lifecycle. This module deliberately has no byte
 * transport interface; V1 records declared metadata only.
 */
export class MediaLibraryModule implements MediaLibrary {
  readonly #adapter: MediaLibraryStateAdapter;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #evidenceLifecycle: MediaEvidenceLifecycle | undefined;
  readonly #transferExpirySeconds: number;

  constructor(dependencies: MediaLibraryModuleDependencies) {
    this.#adapter = dependencies.adapter;
    this.#evidenceLifecycle = dependencies.evidenceLifecycle;
    this.#clock = dependencies.clock ?? new SystemClock();
    this.#ids = dependencies.ids ?? randomId;
    this.#transferExpirySeconds = dependencies.transferExpirySeconds ?? 15 * 60;
    if (!Number.isSafeInteger(this.#transferExpirySeconds) || this.#transferExpirySeconds < 60) {
      throw new ApiError(500, "invalid_media_configuration", "Transfer expiry must be at least 60 seconds.");
    }
  }

  createUpload(
    principal: Principal,
    input: CreateMediaUploadInput,
  ): Promise<CreateMediaUploadResult> {
    const fileName = requireText(input.fileName, "fileName");
    const contentType = requireText(input.contentType, "contentType");
    assertByteSize(input.byteSize);
    const sha256 = normalizeSha256(input.sha256);

    return this.#write(principal, "media_upload.create", input.idempotencyKey, input, (state, now) => {
      if (input.parentAssetId !== undefined) requireAsset(state, input.parentAssetId);
      const asset: StoredMediaAsset = {
        id: this.#ids("media_asset"),
        accountId: principal.accountId,
        kind: input.kind,
        fileName,
        contentType,
        byteSize: input.byteSize,
        sha256,
        status: "uploading",
        purpose: "personal",
        verification: "unverified_metadata",
        revision: 1,
        createdAt: now,
        readyAt: null,
        deletedAt: null,
      };
      const upload: StoredMediaUpload = {
        id: this.#ids("media_upload"),
        assetId: asset.id,
        status: "pending",
        byteTransfer: "local_test",
        revision: 1,
        createdAt: now,
        expiresAt: expiresAt(now, this.#transferExpirySeconds),
        completedAt: null,
        cancelledAt: null,
      };
      state.assets.set(asset.id, asset);
      state.uploads.set(upload.id, upload);
      if (input.parentAssetId !== undefined) {
        state.relations.set(relationKey(input.parentAssetId, asset.id), {
          parentAssetId: input.parentAssetId,
          childAssetId: asset.id,
          relationType: "derived_from",
          createdAt: now,
        });
      }
      return {
        asset: publicAsset(asset),
        upload: publicUpload(upload),
        uploadTarget: localTarget(
          "uploads",
          upload.id,
          upload.revision,
          now,
          this.#transferExpirySeconds,
        ),
      };
    }, (state, prior, now) => {
      const previous = structuredClone(prior) as CreateMediaUploadResult;
      const upload = state.uploads.get(previous.upload.id);
      if (
        upload === undefined || upload.status !== "pending" ||
        Date.parse(now) < Date.parse(upload.expiresAt)
      ) return previous;
      upload.revision += 1;
      upload.expiresAt = expiresAt(now, this.#transferExpirySeconds);
      return {
        ...previous,
        upload: publicUpload(upload),
        uploadTarget: localTarget(
          "uploads",
          upload.id,
          upload.revision,
          now,
          this.#transferExpirySeconds,
        ),
      };
    });
  }

  completeUpload(
    principal: Principal,
    input: CompleteMediaUploadInput,
  ): Promise<CompleteMediaUploadResult> {
    assertRevisionNumber(input.expectedRevision);
    return this.#write(
      principal,
      "media_upload.complete",
      input.idempotencyKey,
      input,
      (state, now) => {
        const upload = requireUpload(state, input.uploadId);
        assertRevision(upload.revision, input.expectedRevision, publicUpload(upload));
        if (upload.status !== "pending") {
          throw conflict("upload_not_pending", "The metadata upload is not pending.");
        }
        if (Date.parse(now) >= Date.parse(upload.expiresAt)) {
          throw new ApiError(410, "upload_expired", "The media upload target has expired.");
        }
        const asset = requireAsset(state, upload.assetId);
        upload.status = "completed";
        upload.completedAt = now;
        upload.revision += 1;
        asset.status = "ready";
        asset.readyAt = now;
        asset.revision += 1;
        return { asset: publicAsset(asset), upload: publicUpload(upload) };
      },
    );
  }

  listAssets(principal: Principal, input: CursorPageInput = {}) {
    return this.#adapter.transact(principal.accountId, (state) =>
      paginateByCreatedAt(
        [...state.assets.values()]
          .filter((asset) => asset.deletedAt === null)
          .map(publicAsset),
        input,
      ),
    );
  }

  getAsset(principal: Principal, assetId: string): Promise<MediaAsset> {
    return this.#adapter.transact(principal.accountId, (state) =>
      publicAsset(requireAsset(state, assetId)),
    );
  }

  createDownload(
    principal: Principal,
    input: CreateMediaDownloadInput,
  ): Promise<MediaTransferTarget> {
    return this.#adapter.transact(principal.accountId, (state) => {
      const asset = requireAsset(state, input.assetId);
      if (asset.status !== "ready") {
        throw conflict("asset_not_ready", "The media asset is not ready for download.");
      }
      return localTarget(
        "assets",
        asset.id,
        asset.revision,
        this.#clock.now().toISOString(),
        this.#transferExpirySeconds,
      );
    });
  }

  async deleteAsset(
    principal: Principal,
    input: DeleteMediaAssetInput,
  ): Promise<DeleteMediaAssetResult> {
    assertRevisionNumber(input.expectedRevision);
    const result = await this.#write(principal, "media_asset.delete", input.idempotencyKey, input, (state, now) => {
      const root = requireAsset(state, input.assetId);
      assertRevision(root.revision, input.expectedRevision, publicAsset(root));
      const deletedAssetIds = descendantsIncludingRoot(state, root.id);
      const deletedSet = new Set(deletedAssetIds);

      for (const assetId of deletedAssetIds) {
        const asset = state.assets.get(assetId);
        if (asset === undefined || asset.deletedAt !== null) continue;
        asset.deletedAt = now;
        asset.revision += 1;
        for (const upload of state.uploads.values()) {
          if (upload.assetId !== assetId || upload.status !== "pending") continue;
          upload.status = "cancelled";
          upload.cancelledAt = now;
          upload.revision += 1;
        }
      }
      for (const [key, relation] of state.relations) {
        if (deletedSet.has(relation.parentAssetId) || deletedSet.has(relation.childAssetId)) {
          state.relations.delete(key);
        }
      }
      return { deletedAssetIds };
    });
    await this.#evidenceLifecycle?.markMediaEvidenceDeleted({
      accountId: principal.accountId,
      assetIds: result.deletedAssetIds,
      deletedAt: this.#clock.now().toISOString(),
    });
    return result;
  }

  #write<T>(
    principal: Principal,
    operation: string,
    idempotencyKey: string,
    request: unknown,
    mutation: (state: MediaLibraryState, now: string) => T,
    replay?: (state: MediaLibraryState, prior: unknown, now: string) => T,
  ): Promise<T> {
    assertWritable(principal);
    const key = requireText(idempotencyKey, "idempotencyKey");
    const fingerprint = stableStringify(request);
    return this.#adapter.transact(principal.accountId, (state) => {
      const now = this.#clock.now().toISOString();
      const existing = state.idempotency.get(key);
      if (existing !== undefined) {
        if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
          throw conflict(
            "idempotency_key_reused",
            "The idempotency key was already used for a different request.",
          );
        }
        if (replay === undefined) return structuredClone(existing.result) as T;
        const result = replay(state, existing.result, now);
        existing.result = structuredClone(result);
        return result;
      }
      const result = mutation(state, now);
      state.idempotency.set(key, {
        operation,
        fingerprint,
        result: structuredClone(result),
      });
      return result;
    });
  }
}

function requireAsset(state: MediaLibraryState, assetId: string): StoredMediaAsset {
  const asset = state.assets.get(assetId);
  if (asset === undefined || asset.deletedAt !== null) throw notFound("media_asset");
  return asset;
}

function requireUpload(state: MediaLibraryState, uploadId: string): StoredMediaUpload {
  const upload = state.uploads.get(uploadId);
  if (upload === undefined || upload.cancelledAt !== null) throw notFound("media_upload");
  return upload;
}

function descendantsIncludingRoot(state: MediaLibraryState, rootId: string): string[] {
  const result: string[] = [];
  const pending = [rootId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const assetId = pending.shift();
    if (assetId === undefined || visited.has(assetId)) continue;
    visited.add(assetId);
    result.push(assetId);
    const children = [...state.relations.values()]
      .filter((relation) => relation.parentAssetId === assetId)
      .map((relation) => relation.childAssetId)
      .sort();
    pending.push(...children);
  }
  return result;
}

function publicAsset(asset: StoredMediaAsset): MediaAsset {
  return {
    id: asset.id,
    accountId: asset.accountId,
    kind: asset.kind,
    fileName: asset.fileName,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
    sha256: asset.sha256,
    status: asset.status,
    purpose: asset.purpose,
    verification: asset.verification,
    revision: asset.revision,
    createdAt: asset.createdAt,
    readyAt: asset.readyAt,
  };
}

function publicUpload(upload: StoredMediaUpload): MediaUpload {
  return {
    id: upload.id,
    assetId: upload.assetId,
    status: upload.status,
    byteTransfer: upload.byteTransfer,
    revision: upload.revision,
    createdAt: upload.createdAt,
    expiresAt: upload.expiresAt,
    completedAt: upload.completedAt,
  };
}

function localTarget(
  namespace: "assets" | "uploads",
  id: string,
  revision: number,
  now: string,
  expirySeconds: number,
): MediaTransferTarget {
  return {
    kind: "local_test",
    url: `memory://${namespace}/${encodeURIComponent(id)}?revision=${revision}`,
    headers: {},
    expiresAt: expiresAt(now, expirySeconds),
  };
}

function expiresAt(now: string, seconds: number): string {
  return new Date(Date.parse(now) + seconds * 1_000).toISOString();
}

function assertWritable(principal: Principal): void {
  if (principal.status !== "active") {
    throw forbidden("account_not_writable", "The account cannot accept writes.");
  }
}

function assertRevision(actual: number, expected: number, current: unknown): void {
  if (actual !== expected) {
    throw conflict("revision_conflict", "The resource was modified by another request.", {
      expectedRevision: expected,
      actualRevision: actual,
      current,
    });
  }
}

function assertRevisionNumber(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ApiError(400, "invalid_revision", "expectedRevision must be a positive integer.");
  }
}

function assertByteSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, "invalid_request", "byteSize must be a non-negative integer.", {
      field: "byteSize",
    });
  }
}

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ApiError(400, "invalid_request", "sha256 must contain 64 hexadecimal characters.", {
      field: "sha256",
    });
  }
  return normalized;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, "invalid_request", `${field} must not be empty.`, { field });
  }
  return normalized;
}

function relationKey(parentAssetId: string, childAssetId: string): string {
  return `${parentAssetId}:${childAssetId}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}
