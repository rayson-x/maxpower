import type {
  FactRef,
  HealthAdapterAvailability,
  HealthImportPermission,
  HealthMetric,
  RuntimeServices,
} from "./model";
import type { CoachLedger } from "./ledger";
import type { BackupCryptoPort, SecureCredentialPort } from "../privacy";

export type { BackupCryptoPort, SecureCredentialPort } from "../privacy";

export interface HealthDataPort {
  readFacts(userId: string, since: string): Promise<readonly FactRef[]>;
  readEvidencePage?(input: HealthEvidencePageRequest): Promise<HealthEvidencePage>;
  /** Optional platform-connection probe; it reads no health observations. */
  getConnectionState?(input: { metricTypes: readonly HealthMetric[] }): Promise<HealthConnectionState>;
  /** Must be called only from a user-initiated, feature-specific rationale. */
  requestPermissions?(input: { metricTypes: readonly HealthMetric[] }): Promise<HealthConnectionState>;
}

export type HealthPermissionState = HealthImportPermission;

export interface HealthEvidencePageRequest {
  userId: string;
  cursor?: string;
  metricTypes: readonly HealthMetric[];
}

export interface NormalizedHealthEvidence {
  id: string;
  metric: HealthMetric;
  value?: number;
  unit?: "hours" | "minutes" | "seconds" | "milliseconds" | "beats_per_minute" | "kg" | "lb" | "percent";
  /** Source occurrence for an upsert. Health Connect deletion changes omit it. */
  occurredAt?: string;
  /** When this source observation/change was observed by the platform adapter. */
  observedAt?: string;
  endedAt?: string;
  timezoneOffsetMinutes: number;
  origin: "healthkit" | "health_connect" | "wearable" | "manual";
  deviceId?: string;
  /** Health platform data-origin package; never used to infer a device. */
  sourceAppId?: string;
  clientRecordId?: string;
  clientRecordVersion?: string;
  deviceManufacturer?: string;
  deviceModel?: string;
  deviceType?: string;
  /** Provider-native capture mode; the normalized import method stays platform_import. */
  sourceRecordingMethod?: string;
  recordingMethod: "platform_import" | "device_measurement" | "manual_entry";
  algorithmVersion?: string;
  sourceRevision?: string;
  lastModifiedAt?: string;
  /** Platform update/deletion semantics, never inferred from a missing page. */
  change?: "upsert" | "delete";
  /** Optional measurement condition/method, e.g. sleep stage or scale identity. */
  measurementMethod?: string;
  permission: HealthPermissionState;
  freshness: "fresh" | "stale" | "partial";
  sourceRecordId?: string;
}

export interface HealthEvidencePage {
  /** Connection/query outcome, separate from per-metric permission state. */
  availability: HealthAdapterAvailability;
  evidence: readonly NormalizedHealthEvidence[];
  nextCursor?: string;
  /** Provider invalidated its opaque cursor; nextCursor begins a bounded resync. */
  cursorReset?: boolean;
  /**
   * The current bounded historical import has more provider pages. This is a
   * transport hint only: the application still commits each page separately
   * and may stop safely when the app backgrounds.
   */
  hasMore?: boolean;
  /**
   * True while the adapter is still walking its explicitly bounded first
   * import window. It is not a claim that older history does not exist.
   */
  initialSyncPending?: boolean;
  permissionByMetric: Readonly<Partial<Record<HealthMetric, HealthPermissionState>>>;
  capabilityByMetric: Readonly<Partial<Record<HealthMetric, "supported" | "not_supported">>>;
}

export interface HealthConnectionState {
  availability: HealthAdapterAvailability;
  permissionByMetric: HealthEvidencePage["permissionByMetric"];
  capabilityByMetric: HealthEvidencePage["capabilityByMetric"];
}

export interface NotificationPort {
  /**
   * Foreground, user-initiated system permission request. Recipe/background
   * execution deliberately has no way to invoke this method.
   */
  requestAuthorization?(): Promise<"granted" | "denied">;
  cancel(id: string): Promise<void>;
  /** The sole write contract: the stable id makes scheduling an idempotent replacement. */
  upsert(input: { id: string; at: string; title: string; body: string; deepLink?: string }): Promise<void>;
  deliveryStatus?(id: string): Promise<"scheduled" | "delivered" | "unknown">;
  /**
   * Minimal platform delivery/interactions only. The adapter never opens a
   * Ledger or renders a Coach artifact; the application validates the id and
   * records the receipt itself.
   */
  observe?(listener: (event: NotificationPlatformEvent) => void): () => void;
  lastInteraction?(): Promise<NotificationPlatformEvent | undefined>;
}

export interface NotificationPlatformEvent {
  notificationId: string;
  /** A dismissal is interaction metadata only; it never changes domain facts. */
  event: "delivered" | "tap" | "dismissed";
  deepLink?: string;
  occurredAt: string;
}

export interface BackgroundSchedulerPort {
  upsert(input: { id: string; earliestAt: string; latestAt: string; expiresAt: string }): Promise<void>;
  cancel(id: string): Promise<void>;
  list(): Promise<readonly { id: string; earliestAt: string; latestAt: string; expiresAt: string }[]>;
}

export interface MonotonicClock {
  nowMs(): number;
  /**
   * Identifies the lifetime of this monotonic counter when a platform can
   * expose one. A persisted deadline from another process/boot must fall back
   * to wall time instead of comparing unrelated monotonic origins.
   */
  epochId?(): string;
}

export type ActionTokenClaims =
  | {
      kind: "artifact_action";
      action: "apply" | "reject" | "undo";
      userId: string;
      sessionId: string;
      runId: string;
      toolCallId: string;
      artifactId: string;
      artifactHash: string;
      artifactSchemaVersion: number;
      expectedPlanRevision: number;
      expectedMandateRevision: number;
      expiresAt: string;
      nonce: string;
      undoOf?: string;
    }
  | {
      kind: "human_resume";
      action: "resume";
      pendingActionId: string;
      userId: string;
      sessionId: string;
      runId: string;
      toolCallId: string;
      expectedPlanRevision: number;
      expectedMandateRevision: number;
      expiresAt: string;
      nonce: string;
    };

export interface ActionTokenPrimitive {
  issue(claims: Readonly<ActionTokenClaims>): string;
}

/** Dependencies owned by the local product-domain kernel, never by Pi. */
export interface LocalProductKernelPorts {
  ledger: CoachLedger;
  runtime: RuntimeServices;
  health?: HealthDataPort;
  notifications?: NotificationPort;
  backgroundScheduler?: BackgroundSchedulerPort;
  /** Optional credential adapter; user facts remain in the local Ledger. */
  credentials?: SecureCredentialPort;
  /** Optional local crypto primitive for client-side encrypted structured backups. */
  backupCrypto?: BackupCryptoPort;
  monotonicClock?: MonotonicClock;
  actionTokens?: ActionTokenPrimitive;
}
