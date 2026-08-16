/** The independently revocable purposes visible in MaxPower privacy settings. */
export type DataScope =
  | "account"
  | "remote_llm"
  | "health"
  | "notifications"
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
  scope: "local_media" | "local_data" | "account" | "provider_request";
  status: "pending" | "completed" | "partial" | "failed";
  requestedAt: string;
  completedAt?: string;
  receipt?: string;
}

export type SecureCredentialScope = "remote_llm" | "backup" | "device";

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
