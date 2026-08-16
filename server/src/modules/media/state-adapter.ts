import type { MediaAsset, MediaAssetRelation, MediaUpload } from "./model.js";

export interface StoredMediaAsset extends MediaAsset {
  deletedAt: string | null;
}

export interface StoredMediaUpload extends MediaUpload {
  cancelledAt: string | null;
}

export interface StoredMediaIdempotencyResult {
  operation: string;
  fingerprint: string;
  result: unknown;
}

export interface MediaLibraryState {
  assets: Map<string, StoredMediaAsset>;
  uploads: Map<string, StoredMediaUpload>;
  relations: Map<string, MediaAssetRelation>;
  idempotency: Map<string, StoredMediaIdempotencyResult>;
}

export interface MediaLibraryStateAdapter {
  transact<T>(accountId: string, operation: (state: MediaLibraryState) => T): Promise<T>;
}

export function emptyMediaLibraryState(): MediaLibraryState {
  return {
    assets: new Map(),
    uploads: new Map(),
    relations: new Map(),
    idempotency: new Map(),
  };
}
