import type { Principal } from "../../kernel/principal.js";
import type { CursorPage, CursorPageInput } from "../../kernel/pagination.js";

export type { CursorPage, CursorPageInput } from "../../kernel/pagination.js";

export type MediaAssetKind =
  | "video"
  | "canonical_packet"
  | "keypoints"
  | "nutrition_photo";

export const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;

export type MediaAssetStatus = "uploading" | "ready";
export type MediaByteTransfer = "local_test" | "presigned_put" | "presigned_get";

export interface MediaTransferTarget {
  kind: MediaByteTransfer;
  url: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: string;
}

export interface MediaAsset {
  id: string;
  accountId: string;
  kind: MediaAssetKind;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  status: MediaAssetStatus;
  purpose: "personal";
  verification: "unverified_metadata" | "object_metadata_verified";
  revision: number;
  createdAt: string;
  readyAt: string | null;
}

export interface MediaAssetRelation {
  parentAssetId: string;
  childAssetId: string;
  relationType: "derived_from";
  createdAt: string;
}

export interface MediaUpload {
  id: string;
  assetId: string;
  status: "pending" | "completed" | "cancelled";
  byteTransfer: MediaByteTransfer;
  revision: number;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface CreateMediaUploadInput {
  kind: MediaAssetKind;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  parentAssetId?: string;
  idempotencyKey: string;
}

export interface CreateMediaUploadResult {
  asset: MediaAsset;
  upload: MediaUpload;
  uploadTarget: MediaTransferTarget;
}

export interface CompleteMediaUploadInput {
  uploadId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface CompleteMediaUploadResult {
  asset: MediaAsset;
  upload: MediaUpload;
}

export interface DeleteMediaAssetInput {
  assetId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface DeleteMediaAssetResult {
  deletedAssetIds: readonly string[];
}

export interface CreateMediaDownloadInput {
  assetId: string;
}

export interface MediaLibrary {
  createUpload(
    principal: Principal,
    input: CreateMediaUploadInput,
  ): Promise<CreateMediaUploadResult>;
  completeUpload(
    principal: Principal,
    input: CompleteMediaUploadInput,
  ): Promise<CompleteMediaUploadResult>;
  listAssets(principal: Principal, input?: CursorPageInput): Promise<CursorPage<MediaAsset>>;
  getAsset(principal: Principal, assetId: string): Promise<MediaAsset>;
  createDownload(
    principal: Principal,
    input: CreateMediaDownloadInput,
  ): Promise<MediaTransferTarget>;
  deleteAsset(
    principal: Principal,
    input: DeleteMediaAssetInput,
  ): Promise<DeleteMediaAssetResult>;
}
