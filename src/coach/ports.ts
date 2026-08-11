import type {
  FactRef,
  HealthAdapterAvailability,
  HealthImportPermission,
  HealthMetric,
  RuntimeServices,
} from "./model";
import type { LLMProvider, LLMProviderResolver } from "./adapters/provider";
import type { MotionRuntime } from "./adapters/motion";
import type { CoachLedger } from "./ledger";
import type { NutritionObservationPort, NutritionObservationProviderResolver } from "../nutrition";
import type { ReplicaTransportPort } from "../sync";
import type { BackupCryptoPort, MediaBlobStore, SecureCredentialPort } from "../privacy";

export type { BackupCryptoPort, MediaBlobStore, SecureCredentialPort } from "../privacy";

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
  schedule(input: { id: string; at: string; title: string; body: string }): Promise<void>;
  cancel(id: string): Promise<void>;
  /** Optional native upsert; legacy adapters may implement schedule as an idempotent replacement. */
  upsert?(input: { id: string; at: string; title: string; body: string; deepLink?: string }): Promise<void>;
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

export interface SyncPort {
  readonly mode: "disabled" | "enabled";
  synchronize(): Promise<{ status: "disabled" | "synchronized" | "conflict" }>;
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

/**
 * Client-owned execution boundary for a single Provider stream. This is an
 * inactivity limit, rather than a total conversation limit: every canonical
 * Provider event renews the deadline. The Provider receives only AbortSignal;
 * it never gets a way to select or extend this policy.
 */
export interface ProviderExecutionPolicy {
  idleTimeoutMs?: number;
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

export interface CoachApplicationPorts {
  ledger: CoachLedger;
  runtime: RuntimeServices;
  llmProvider?: LLMProvider;
  /** Optional user-scoped local selector; no remote Agent runtime is introduced. */
  llmProviderResolver?: LLMProviderResolver;
  providerExecutionPolicy?: ProviderExecutionPolicy;
  motionRuntime?: MotionRuntime;
  health?: HealthDataPort;
  notifications?: NotificationPort;
  backgroundScheduler?: BackgroundSchedulerPort;
  sync?: SyncPort;
  /** Optional account transport. The client-owned ReplicaSynchronizer owns merge semantics. */
  replicaTransport?: ReplicaTransportPort;
  /** Optional credential adapter; user facts remain in the local Ledger. */
  credentials?: SecureCredentialPort;
  media?: MediaBlobStore;
  /** Optional local crypto primitive for client-side encrypted structured backups. */
  backupCrypto?: BackupCryptoPort;
  nutritionObservation?: NutritionObservationPort;
  nutritionObservationResolver?: NutritionObservationProviderResolver;
  monotonicClock?: MonotonicClock;
  actionTokens?: ActionTokenPrimitive;
}

export const disabledSyncPort: SyncPort = {
  mode: "disabled",
  async synchronize() {
    return { status: "disabled" };
  },
};
