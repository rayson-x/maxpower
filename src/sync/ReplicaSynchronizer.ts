import type { DomainEvent, OutboxEntry } from "../coach/domain";
import { LedgerConflictError, type CoachLedger } from "../coach/ledger";
import type { RuntimeServices } from "../coach/model";
import { stableHash } from "../coach/stable";
import {
  REPLICA_WIRE_SCHEMA_VERSION,
  type PendingReplicaEnvelope,
  type ReplicaSyncResult,
  type ReplicaSyncState,
  type ReplicaTransportPort,
  type ReplicaWireEnvelope,
} from "./model";

/** Avoid an unbounded foreground/background network loop while still draining a normal backlog. */
const MAX_PULL_PAGES_PER_SYNC = 10;

/**
 * Client-side synchronizer. Transport moves immutable envelopes only; this
 * module owns validation, idempotence and the decision to buffer a conflict.
 */
export class ReplicaSynchronizer {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly transport: ReplicaTransportPort,
  ) {}

  async synchronize(userId: string): Promise<ReplicaSyncResult> {
    if (this.transport.mode === "disabled") {
      return emptyResult("disabled");
    }
    const transportId = this.transport.replicaId ?? "replica-transport";
    let snapshot = await this.ledger.read();
    const priorState = snapshot.replicaSyncStates.find(
      (state) => state.userId === userId && state.transportId === transportId,
    );
    const pushed: string[] = [];
    const pulled: string[] = [];
    const applied: string[] = [];
    const pending: string[] = [];
    const conflicts: string[] = [];
    const rejected: string[] = [];

    const pendingOutbox = snapshot.outbox.filter((entry) => entry.userId === userId && entry.status === "pending");
    const validOutbox: OutboxEntry[] = [];
    const envelopes: ReplicaWireEnvelope[] = [];
    const outboxConflicts: OutboxEntry[] = [];
    for (const entry of pendingOutbox) {
      const event = snapshot.domainEvents.find((candidate) => candidate.id === entry.domainEventId);
      if (!event || stableHash(event) !== entry.payloadHash) {
        outboxConflicts.push({
          ...entry,
          status: "conflict",
          conflict: { code: "unknown_schema" },
        });
        conflicts.push(entry.domainEventId);
        continue;
      }
      validOutbox.push(entry);
      envelopes.push(toWireEnvelope(entry, event));
    }
    if (outboxConflicts.length) await this.persistState(userId, transportId, priorState, { updateOutbox: outboxConflicts });

    let cursor = priorState?.cursor;
    try {
      if (envelopes.length) {
        const result = await this.transport.push({
          userId,
          envelopes,
          idempotencyKey: `replica-push:${transportId}:${stableHash(envelopes.map((item) => item.event.id))}`,
        });
        const acknowledged = new Set(result.acknowledgedEventIds);
        const rejectedById = new Map(result.rejected.map((item) => [item.eventId, item]));
        const updates: OutboxEntry[] = [];
        for (const entry of validOutbox) {
          if (acknowledged.has(entry.domainEventId)) {
            pushed.push(entry.domainEventId);
            updates.push({ ...entry, status: "acknowledged", acknowledgedAt: this.runtime.now(), ...(result.cursor ? { remoteCursor: result.cursor } : {}) });
            continue;
          }
          const failure = rejectedById.get(entry.domainEventId);
          if (failure) {
            rejected.push(entry.domainEventId);
            updates.push({
              ...entry,
              status: "conflict",
              conflict: { code: failure.code === "account_mismatch" ? "account_mismatch" : "unknown_schema" },
            });
          }
        }
        if (updates.length) await this.persistState(userId, transportId, priorState, { updateOutbox: updates });
        // A push acknowledgement cursor is not a pull cursor: using it here
        // could skip an older concurrent event written by another device.
      }

      const pulledPages = await this.pullAvailablePages(userId, cursor);
      const candidates = dedupeEnvelopes([
        ...snapshot.pendingReplicaEnvelopes
          .filter((entry) => entry.userId === userId && entry.status === "pending_dependency")
          .map((entry) => entry.envelope),
        ...pulledPages.envelopes,
      ]);
      const buffers: PendingReplicaEnvelope[] = [];
      const priorPendingByEventId = new Map(
        snapshot.pendingReplicaEnvelopes
          .filter((entry) => entry.userId === userId)
          .map((entry) => [entry.envelope.event.id, entry]),
      );
      for (const envelope of candidates) {
        pulled.push(envelope.event.id);
        const outcome = await this.applyEnvelope(userId, transportId, envelope);
        if (outcome === "applied" || outcome === "duplicate") {
          if (outcome === "applied") applied.push(envelope.event.id);
          const priorPending = priorPendingByEventId.get(envelope.event.id);
          if (priorPending && priorPending.status === "pending_dependency") {
            buffers.push({ ...priorPending, status: "resolved", resolvedAt: this.runtime.now() });
          }
          continue;
        }
        const status = outcome === "concurrent_revision" ? "conflict" as const : outcome === "invalid" ? "rejected" as const : "pending_dependency" as const;
        buffers.push({
          id: `replica-pending-${stableHash({ userId, transportId, eventId: envelope.event.id })}`,
          userId,
          envelope,
          status,
          reason: outcome === "concurrent_revision" ? "concurrent_revision" : outcome === "invalid" ? "invalid_envelope" : "missing_dependency",
          receivedAt: this.runtime.now(),
        });
        if (status === "conflict") conflicts.push(envelope.event.id);
        else if (status === "rejected") rejected.push(envelope.event.id);
        else pending.push(envelope.event.id);
      }
      cursor = pulledPages.cursor ?? cursor;
      const state: ReplicaSyncState = {
        id: `replica-sync-${stableHash({ userId, transportId })}`,
        userId,
        transportId,
        ...(cursor ? { cursor } : {}),
        lastSucceededAt: this.runtime.now(),
        updatedAt: this.runtime.now(),
      };
      await this.persistState(userId, transportId, priorState, { state, pending: buffers });
      const status = conflicts.length ? "conflict" : (pending.length || rejected.length || pulledPages.hasMore) ? "partial" : "synchronized";
      return { status, pushed, pulled, applied, pending, conflicts, rejected, ...(cursor ? { cursor } : {}), retryable: status !== "synchronized" };
    } catch (error) {
      const state: ReplicaSyncState = {
        id: priorState?.id ?? `replica-sync-${stableHash({ userId, transportId })}`,
        userId,
        transportId,
        ...(cursor ? { cursor } : {}),
        // A failed retry must not make a previously synchronized replica look
        // like it has never completed a sync. The UI needs the last confirmed
        // point independently from this attempt's transport error.
        ...(priorState?.lastSucceededAt ? { lastSucceededAt: priorState.lastSucceededAt } : {}),
        // Transport errors can contain URLs, account identifiers or even a
        // library-provided request fragment. The retry state only needs a
        // stable category; detailed diagnostics stay inside the transport's
        // own ephemeral logging boundary and never enter the Coach ledger.
        lastError: "transport_error",
        updatedAt: this.runtime.now(),
      };
      await this.persistState(userId, transportId, priorState, { state });
      return { status: "partial", pushed, pulled, applied, pending, conflicts, rejected, ...(cursor ? { cursor } : {}), retryable: true };
    }
  }

  /**
   * Drain a finite chain of cursor pages. A non-advancing cursor with `hasMore`
   * is treated as partial instead of spinning indefinitely; the persisted
   * cursor stays unchanged so a later retry cannot skip undiscovered events.
   */
  private async pullAvailablePages(
    userId: string,
    initialCursor: string | undefined,
  ): Promise<{ envelopes: readonly ReplicaWireEnvelope[]; cursor?: string; hasMore: boolean }> {
    const envelopes: ReplicaWireEnvelope[] = [];
    let cursor = initialCursor;
    let hasMore = false;
    for (let page = 0; page < MAX_PULL_PAGES_PER_SYNC; page += 1) {
      const result = await this.transport.pull({ userId, ...(cursor ? { cursor } : {}), limit: 100 });
      envelopes.push(...result.envelopes);
      hasMore = result.hasMore;
      if (!hasMore) {
        return { envelopes, ...(result.cursor ? { cursor: result.cursor } : cursor ? { cursor } : {}) , hasMore: false };
      }
      // The remote service must move a continuation cursor forward. Keeping
      // the previous cursor is safer than accepting an ambiguous page twice.
      if (!result.cursor || result.cursor === cursor) {
        return { envelopes, ...(cursor ? { cursor } : {}), hasMore: true };
      }
      cursor = result.cursor;
    }
    return { envelopes, ...(cursor ? { cursor } : {}), hasMore: true };
  }

  private async applyEnvelope(
    userId: string,
    transportId: string,
    envelope: ReplicaWireEnvelope,
  ): Promise<"applied" | "duplicate" | "pending_dependency" | "concurrent_revision" | "invalid"> {
    if (!isValidEnvelope(userId, envelope)) return "invalid";
    const snapshot = await this.ledger.read();
    if (snapshot.domainEvents.some((event) => event.id === envelope.event.id)) return "duplicate";
    const current = snapshot.aggregateRevisions.find(
      (state) => state.userId === userId && state.kind === envelope.event.aggregate.kind && state.id === envelope.event.aggregate.id,
    );
    const expectedRevision = current?.revision ?? 0;
    if (envelope.event.aggregate.revision <= expectedRevision) return "concurrent_revision";
    if (envelope.event.aggregate.revision !== expectedRevision + 1) return "pending_dependency";
    try {
      await this.ledger.commit({
        kind: "domain",
        userId,
        actorId: envelope.event.actor.id,
        intent: "replica.import",
        expectedRevisions: [{ kind: envelope.event.aggregate.kind, id: envelope.event.aggregate.id, revision: expectedRevision }],
        domainEvents: [envelope.event],
        idempotencyKey: `replica-import:${transportId}:${envelope.event.id}`,
        recordedAt: this.runtime.now(),
      });
      return "applied";
    } catch (error) {
      if (error instanceof LedgerConflictError && error.code === "stale_aggregate") return "concurrent_revision";
      if (error instanceof LedgerConflictError && error.code === "invalid_reference") return "pending_dependency";
      return "invalid";
    }
  }

  private async persistState(
    userId: string,
    transportId: string,
    prior: ReplicaSyncState | undefined,
    input: { updateOutbox?: readonly OutboxEntry[]; state?: ReplicaSyncState; pending?: readonly PendingReplicaEnvelope[] },
  ): Promise<void> {
    if (!input.updateOutbox?.length && !input.state && !input.pending?.length) return;
    await this.ledger.commit({
      kind: "domain",
      userId,
      actorId: "replica_synchronizer",
      intent: "replica.sync.state",
      expectedRevisions: [],
      domainEvents: [],
      ...(input.updateOutbox?.length ? { updateOutbox: input.updateOutbox } : {}),
      ...(input.state ? { replicaSyncStates: [input.state] } : {}),
      ...(input.pending?.length ? { pendingReplicaEnvelopes: input.pending } : {}),
      idempotencyKey: `replica-state:${transportId}:${stableHash({ outbox: input.updateOutbox?.map((item) => [item.id, item.status]), state: input.state?.cursor, pending: input.pending?.map((item) => item.id), prior: prior?.cursor, at: this.runtime.now() })}`,
      recordedAt: this.runtime.now(),
    });
  }
}

function toWireEnvelope(entry: OutboxEntry, event: DomainEvent): ReplicaWireEnvelope {
  return {
    schemaVersion: REPLICA_WIRE_SCHEMA_VERSION,
    userId: entry.userId,
    replicaId: entry.replicaId,
    deviceId: entry.deviceId,
    event,
    payloadHash: entry.payloadHash,
    hlc: `${event.recordedAt}:${entry.deviceId}:${event.id}`,
    causalParents: event.causationId ? [event.causationId] : [],
    scope: "domain",
    ...(event.name === "aggregate.archived" ? { tombstone: { aggregateId: event.aggregate.id, revision: event.aggregate.revision } } : {}),
  };
}

function isValidEnvelope(userId: string, envelope: ReplicaWireEnvelope): boolean {
  return envelope.schemaVersion === REPLICA_WIRE_SCHEMA_VERSION &&
    envelope.scope === "domain" &&
    envelope.userId === userId &&
    envelope.event.userId === userId &&
    Boolean(envelope.replicaId && envelope.deviceId && envelope.hlc) &&
    stableHash(envelope.event) === envelope.payloadHash;
}

function dedupeEnvelopes(envelopes: readonly ReplicaWireEnvelope[]): readonly ReplicaWireEnvelope[] {
  const seen = new Set<string>();
  return envelopes.filter((item) => !seen.has(item.event.id) && (seen.add(item.event.id), true));
}

function emptyResult(status: "disabled"): ReplicaSyncResult {
  return { status, pushed: [], pulled: [], applied: [], pending: [], conflicts: [], rejected: [], retryable: false };
}
