import type { DomainAggregateKind } from "../coach/domain";
import type { LedgerSnapshot } from "../coach/model";
import type { PendingReplicaEnvelope } from "./model";

/**
 * A deliberately small, UI-safe view of local replication state. It is not a
 * second sync engine: callers can show status and open a human review without
 * receiving a transport cursor, remote payload, credential, or raw failure.
 */
export interface ReplicaSyncOverview {
  status:
    | "disabled"
    | "not_started"
    | "synchronized"
    | "pending_upload"
    | "pending_dependency"
    | "conflict"
    | "rejected"
    | "retry_needed";
  lastSucceededAt?: string;
  lastAttemptAt?: string;
  /** A retry is intentionally unavailable while a branch needs a human decision. */
  retryAvailable: boolean;
  outbox: {
    pending: number;
    acknowledged: number;
    conflicts: number;
  };
  pendingDependencies: number;
  rejected: number;
  conflicts: readonly ReplicaConflictOverview[];
}

/**
 * The merge-screen contract. `incoming` is represented only by stable event
 * metadata and a semantic change category; the user must make a new explicit
 * revision through the ordinary plan/goal/mandate editor. No branch is ever
 * selected or applied by this read model.
 */
export interface ReplicaConflictOverview {
  id: string;
  aggregate: {
    kind: DomainAggregateKind;
    id: string;
    localRevision: number;
    incomingRevision: number;
  };
  receivedAt: string;
  source: {
    /** Device IDs may be externally supplied identifiers and are never rendered directly. */
    device: "another_device";
    actor: "user" | "agent" | "rule_engine" | "sensor" | "sync" | "system";
  };
  change:
    | "goal_contract_revised"
    | "coaching_mandate_revised"
    | "plan_revised"
    | "aggregate_revised";
  resolution: "manual_new_revision_required";
}

export function buildReplicaSyncOverview(input: {
  snapshot: LedgerSnapshot;
  userId: string;
  enabled: boolean;
}): ReplicaSyncOverview {
  const userOutbox = input.snapshot.outbox.filter((entry) => entry.userId === input.userId);
  const pendingEnvelopes = input.snapshot.pendingReplicaEnvelopes.filter(
    (entry) => entry.userId === input.userId,
  );
  const conflicts = pendingEnvelopes
    .filter((entry) => entry.status === "conflict" && entry.reason === "concurrent_revision")
    .map((entry) => toConflictOverview(input.snapshot, entry));
  const pendingDependencies = pendingEnvelopes.filter(
    (entry) => entry.status === "pending_dependency",
  ).length;
  const rejected = pendingEnvelopes.filter((entry) => entry.status === "rejected").length;
  const outbox = {
    pending: userOutbox.filter((entry) => entry.status === "pending").length,
    acknowledged: userOutbox.filter((entry) => entry.status === "acknowledged").length,
    conflicts: userOutbox.filter((entry) => entry.status === "conflict").length,
  };
  const latest = input.snapshot.replicaSyncStates
    .filter((state) => state.userId === input.userId)
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  if (!input.enabled) {
    return {
      status: "disabled",
      lastSucceededAt: undefined,
      lastAttemptAt: undefined,
      retryAvailable: false,
      outbox,
      pendingDependencies,
      rejected,
      conflicts: [],
    };
  }

  const status = conflicts.length
    ? "conflict"
    : rejected || outbox.conflicts
      ? "rejected"
      : pendingDependencies
        ? "pending_dependency"
        : outbox.pending
          ? "pending_upload"
          : latest?.lastError
            ? "retry_needed"
            : latest?.lastSucceededAt
              ? "synchronized"
              : "not_started";
  return {
    status,
    ...(latest?.lastSucceededAt ? { lastSucceededAt: latest.lastSucceededAt } : {}),
    ...(latest ? { lastAttemptAt: latest.updatedAt } : {}),
    retryAvailable: status !== "synchronized" && status !== "conflict" && status !== "rejected",
    outbox,
    pendingDependencies,
    rejected,
    conflicts,
  };
}

function toConflictOverview(
  snapshot: LedgerSnapshot,
  entry: PendingReplicaEnvelope,
): ReplicaConflictOverview {
  const event = entry.envelope.event;
  const localRevision = snapshot.aggregateRevisions.find(
    (state) =>
      state.userId === entry.userId &&
      state.kind === event.aggregate.kind &&
      state.id === event.aggregate.id,
  )?.revision ?? 0;
  return {
    id: entry.id,
    aggregate: {
      kind: event.aggregate.kind,
      id: event.aggregate.id,
      localRevision,
      incomingRevision: event.aggregate.revision,
    },
    receivedAt: entry.receivedAt,
    source: { device: "another_device", actor: event.actor.kind },
    change: semanticChange(event.name),
    resolution: "manual_new_revision_required",
  };
}

function semanticChange(eventName: LedgerSnapshot["domainEvents"][number]["name"]): ReplicaConflictOverview["change"] {
  if (eventName === "goal_contract.created" || eventName === "goal_contract.revised") return "goal_contract_revised";
  if (eventName === "coaching_mandate.created" || eventName === "coaching_mandate.revised") return "coaching_mandate_revised";
  if (eventName === "plan.revised") return "plan_revised";
  return "aggregate_revised";
}
