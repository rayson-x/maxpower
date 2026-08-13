import type { DomainEvent } from "../coach/domain";

export const REPLICA_WIRE_SCHEMA_VERSION = 1 as const;

/**
 * The only payload permitted to cross the sync transport. It deliberately
 * excludes raw provider input, action tokens, media bytes and local logs.
 */
export interface ReplicaWireEnvelope {
  schemaVersion: typeof REPLICA_WIRE_SCHEMA_VERSION;
  userId: string;
  replicaId: string;
  deviceId: string;
  event: DomainEvent;
  payloadHash: string;
  hlc: string;
  causalParents: readonly string[];
  scope: "domain";
  tombstone?: { aggregateId: string; revision: number };
}

export interface ReplicaPushResult {
  acknowledgedEventIds: readonly string[];
  rejected: readonly { eventId: string; code: "account_mismatch" | "unknown_schema" | "payload_hash_mismatch" | "replayed" }[];
  cursor?: string;
}

export interface ReplicaPullResult {
  envelopes: readonly ReplicaWireEnvelope[];
  cursor?: string;
  hasMore: boolean;
}

/** Network/auth adapter only; it must not contain domain merge rules. */
export interface ReplicaTransportPort {
  readonly mode: "disabled" | "enabled";
  readonly replicaId?: string;
  readonly deviceId?: string;
  push(input: { userId: string; envelopes: readonly ReplicaWireEnvelope[]; idempotencyKey: string }): Promise<ReplicaPushResult>;
  pull(input: { userId: string; cursor?: string; limit: number }): Promise<ReplicaPullResult>;
}

export interface ReplicaSyncState {
  id: string;
  userId: string;
  transportId: string;
  cursor?: string;
  lastSucceededAt?: string;
  lastError?: string;
  updatedAt: string;
}

export interface PendingReplicaEnvelope {
  id: string;
  userId: string;
  envelope: ReplicaWireEnvelope;
  status: "pending_dependency" | "conflict" | "rejected" | "resolved";
  reason: "missing_dependency" | "concurrent_revision" | "unknown_schema" | "invalid_envelope";
  receivedAt: string;
  resolvedAt?: string;
}

export interface ReplicaSyncResult {
  status: "disabled" | "synchronized" | "partial" | "conflict";
  pushed: readonly string[];
  pulled: readonly string[];
  applied: readonly string[];
  pending: readonly string[];
  conflicts: readonly string[];
  rejected: readonly string[];
  cursor?: string;
  retryable: boolean;
}
