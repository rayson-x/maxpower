export type CloudMediaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface CloudMediaAccessTokenSource {
  /** Reads the current short-lived service JWT; implementations must not persist it here. */
  accessTokenFor(accountId: string): string | Promise<string>;
}

export type MediaByteSource =
  | { kind: "uri"; uri: string }
  | { kind: "blob"; blob: Blob }
  | { kind: "bytes"; bytes: Uint8Array };

export interface MediaByteTransferInput {
  source: MediaByteSource;
  url: string;
  headers: Readonly<Record<string, string>>;
  totalBytes: number;
  signal?: AbortSignal;
  onProgress?(bytesSent: number): void;
}

/** Platform seam: native code may use XHR/file streaming without leaking it into the workflow. */
export interface MediaByteTransferPort {
  put(input: MediaByteTransferInput): Promise<void>;
}

export type CloudMediaAssetKind =
  | "video"
  | "canonical_packet"
  | "keypoints"
  | "nutrition_photo";

export interface CloudMediaAsset {
  id: string;
  accountId: string;
  kind: CloudMediaAssetKind;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  status: "uploading" | "ready";
  purpose: "personal";
  verification: "unverified_metadata" | "object_metadata_verified";
  revision: number;
  createdAt: string;
  readyAt: string | null;
}

export interface CloudMediaUpload {
  id: string;
  assetId: string;
  status: "pending" | "completed" | "cancelled";
  byteTransfer: "presigned_put";
  revision: number;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface CloudMediaUploadTarget {
  kind: "presigned_put";
  url: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: string;
}

export type CloudMediaUploadChoice =
  | { decision: "not_selected" }
  | {
      decision: "upload";
      kind: CloudMediaAssetKind;
      source: MediaByteSource;
      fileName: string;
      contentType: string;
      byteSize: number;
      sha256: string;
      parentAssetId?: string;
      idempotencyKey: string;
    };

export type CloudMediaUploadPhase =
  | "requesting_target"
  | "uploading"
  | "completing"
  | "ready";

export interface CloudMediaUploadProgress {
  phase: CloudMediaUploadPhase;
  attempt: number;
  bytesSent: number;
  totalBytes: number;
}

export interface CloudMediaUploadOptions {
  signal?: AbortSignal;
  /** Includes the first attempt; retries reuse the create idempotency key. */
  maxTransferAttempts?: number;
  onProgress?(progress: CloudMediaUploadProgress): void;
}

export interface CloudMediaPageInput {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface CloudMediaAssetPage {
  data: readonly CloudMediaAsset[];
  nextCursor: string | null;
}

export interface DeleteCloudMediaAssetInput {
  assetId: string;
  expectedRevision: number;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface DeleteCloudMediaAssetResult {
  deletedAssetIds: readonly string[];
}

export interface CloudMediaLibraryOptions {
  apiBaseUrl: string;
  /** Debug-only escape hatch supplied by the mobile composition root. */
  allowInsecureHttp?: boolean;
  accountId: string;
  accessTokens: CloudMediaAccessTokenSource;
  byteTransfer: MediaByteTransferPort;
  accountSignal?: AbortSignal;
  fetch?: CloudMediaFetch;
}

export type CloudMediaUploadOutcome =
  | { status: "not_selected" }
  | { status: "ready"; asset: CloudMediaAsset; upload: CloudMediaUpload };

export type CloudMediaLibraryErrorCode =
  | "cancelled"
  | "authentication_required"
  | "permission_denied"
  | "conflict"
  | "upload_expired"
  | "network_unavailable"
  | "invalid_response"
  | "transfer_failed"
  | "request_failed";

export class CloudMediaLibraryError extends Error {
  constructor(
    readonly code: CloudMediaLibraryErrorCode,
    message = `cloud_media_${code}`,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CloudMediaLibraryError";
  }
}
