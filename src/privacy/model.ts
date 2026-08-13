/** The independently revocable purposes visible in MaxPower privacy settings. */
export type DataScope =
  | "account"
  | "sync"
  | "remote_llm"
  | "health"
  | "notifications"
  | "camera"
  | "nutrition_photo"
  | "training_video_upload"
  | "media_backup"
  | "observability";

export interface ConsentGrant {
  id: string;
  userId: string;
  scope: DataScope;
  purpose: string;
  status: "granted" | "denied" | "revoked";
  grantedAt?: string;
  revokedAt?: string;
  policyVersion: string;
}

export interface BackupManifest {
  schemaVersion: 1;
  userId: string;
  createdAt: string;
  encryption: "none" | "client_side";
  structuredContentHash: string;
  /** Present only for an encrypted portable backup; no passphrase or key is retained. */
  kdf?: {
    algorithm: "PBKDF2-SHA-256";
    iterations: number;
    saltBase64: string;
  };
  cipher?: {
    algorithm: "AES-256-GCM";
    ivBase64: string;
    ciphertextHash: string;
  };
  media: readonly { id: string; included: boolean; bytes?: number; reason?: "excluded_by_user" | "unavailable" }[];
}

/**
 * A local-only, content-addressed media reference. The same bytes can have the
 * same address on two devices, but the reference is always resolved inside a
 * local user namespace. Raw bytes never belong to a ReplicaTransport envelope.
 */
export interface MediaBlobReference {
  /** `media-sha256-<hex>` derived by the store, never supplied by a caller. */
  id: string;
  contentHash: `sha256-${string}`;
  userId: string;
  mimeType: string;
  byteLength: number;
  /** Honest local-at-rest protection state, not a cloud-encryption claim. */
  encryption: "platform_protected" | "client_side_encrypted" | "not_encrypted";
  /** Raw media starts local-only; an explicit backup feature must create a separate manifest. */
  replicationScope: "local_only";
  lifecycle: "active" | "deleted";
  createdAt: string;
  updatedAt: string;
}

export interface MediaBlob {
  reference: MediaBlobReference;
  bytes: Uint8Array;
}

/**
 * Local media boundary used by nutrition and capture features. `put` derives
 * the address from bytes, while every lookup requires the owning local user.
 * Deletion leaves metadata as a lifecycle tombstone so a missing file is not
 * accidentally presented as a live attachment.
 */
export interface MediaBlobStore {
  put(input: { userId: string; mimeType: string; bytes: Uint8Array }): Promise<MediaBlobReference>;
  get(input: { userId: string; id: string }): Promise<MediaBlob | null>;
  reference(input: { userId: string; id: string }): Promise<MediaBlobReference | null>;
  list(input: { userId: string; lifecycle?: MediaBlobReference["lifecycle"] }): Promise<readonly MediaBlobReference[]>;
  delete(input: { userId: string; id: string }): Promise<void>;
}

export type MediaBlobStoreErrorCode =
  | "invalid_input"
  | "unavailable"
  | "write_failed"
  | "read_failed"
  | "delete_failed"
  | "integrity_failed";

export class MediaBlobStoreError extends Error {
  constructor(readonly code: MediaBlobStoreErrorCode) {
    super(`media_blob_${code}`);
    this.name = "MediaBlobStoreError";
  }
}

export type RestoreConflict =
  | "target_profile_not_empty"
  | "domain_event_id_mismatch"
  | "domain_revision_diverged"
  | "runtime_record_diverged"
  | "active_session_conflict"
  | "cross_user_reference"
  | "unsupported_schema"
  | "missing_media";

export interface RestorePlan {
  id: string;
  mode: "merge" | "empty_profile";
  userId: string;
  schemaStatus: "compatible" | "migration_required" | "unsupported";
  eventCount: number;
  sessionCount: number;
  mediaAvailability: "included" | "excluded" | "partial";
  conflicts: readonly RestoreConflict[];
  requiredMigrations: readonly string[];
  estimatedStorageBytes: number;
  warnings: readonly string[];
  errors: readonly string[];
  canRestore: boolean;
}

export interface DeletionRequest {
  id: string;
  userId: string;
  scope: "local_media" | "local_data" | "cloud_replica" | "account" | "provider_request";
  status: "pending" | "completed" | "partial" | "failed";
  requestedAt: string;
  completedAt?: string;
  receipt?: string;
}

export type SecureCredentialScope = "sync" | "remote_llm" | "backup" | "device";

export interface SecureCredentialKey {
  accountId: string;
  scope: SecureCredentialScope;
  name: string;
}

export type SecureCredentialReadResult =
  | { status: "available"; value: string }
  /** Expo SecureStore intentionally cannot distinguish a deleted from an invalidated biometric key. */
  | { status: "missing_or_invalidated" }
  | { status: "unavailable" };

export type SecureCredentialErrorCode = "unavailable" | "locked" | "write_failed" | "delete_failed";

export class SecureCredentialError extends Error {
  constructor(readonly code: SecureCredentialErrorCode) {
    super(`secure_credential_${code}`);
    this.name = "SecureCredentialError";
  }
}

/** System secure storage only. No implementation may mirror these values into a CoachLedger or log. */
export interface SecureCredentialPort {
  put(input: { key: SecureCredentialKey; value: string; requireUserPresence?: boolean }): Promise<void>;
  get(input: { key: SecureCredentialKey; requireUserPresence?: boolean }): Promise<SecureCredentialReadResult>;
  delete(input: { key: SecureCredentialKey; requireUserPresence?: boolean }): Promise<void>;
  rotate(input: { key: SecureCredentialKey; value: string; requireUserPresence?: boolean }): Promise<void>;
}
